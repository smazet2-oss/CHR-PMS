/* Comptes de la formation : enregistrés dans DATA_DIR/comptes.json (mots de passe chiffrés par scrypt).
   Au premier démarrage, les comptes définis par variables PASS_* sont importés.
   La formatrice (stephanie) garde toujours un accès de secours par PASS_STEPHANIE. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PROPRIO = 'stephanie';
const IMPORT = [
  { login: 'stephanie', nom: 'Stéphanie', env: 'PASS_STEPHANIE' },
  { login: 'floriane', nom: 'Floriane', env: 'PASS_FLORIANE' },
  { login: 'soukayna', nom: 'Soukayna', env: 'PASS_SOUKAYNA' },
  { login: 'yasmine', nom: 'Yasmine', env: 'PASS_YASMINE' },
];

function hacher(pass) {
  const sel = crypto.randomBytes(16).toString('hex');
  return { sel, hash: crypto.scryptSync(String(pass), sel, 32).toString('hex') };
}
function verifier(pass, c) {
  if (!c.hash || !c.sel) return false;
  const a = crypto.scryptSync(String(pass), c.sel, 32);
  const b = Buffer.from(c.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function egalTexte(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
function normLogin(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

function creer(dataDir) {
  const fichier = path.join(dataDir, 'comptes.json');
  let liste = [];
  try { liste = JSON.parse(fs.readFileSync(fichier, 'utf8')); } catch { liste = []; }
  const secoursProprio = String(process.env.PASS_STEPHANIE || '').trim();

  function sauver() {
    const tmp = fichier + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(liste, null, 1));
    fs.renameSync(tmp, fichier);
  }
  // import initial depuis les variables d'environnement (sans écraser un compte existant)
  let change = false;
  for (const c of IMPORT) {
    const pass = String(process.env[c.env] || '').trim();
    if (liste.some((x) => x.login === c.login)) continue;
    if (!pass && c.login !== PROPRIO) continue;
    liste.push({ login: c.login, nom: c.nom, ...(pass ? hacher(pass) : {}), actif: true, cree: new Date().toISOString(), origine: 'variable ' + c.env });
    change = true;
  }
  if (change) sauver();
  if (!secoursProprio && !liste.find((x) => x.login === PROPRIO && x.hash)) console.warn('[chr-pms] Aucun mot de passe pour stephanie : définir PASS_STEPHANIE sur Render.');

  const api = {
    PROPRIO,
    normLogin,
    tous: () => liste.map(({ login, nom, actif, cree, origine, derniere }) => ({ login, nom, actif: actif !== false, cree, origine, derniere, proprio: login === PROPRIO })),
    trouver: (login) => liste.find((x) => x.login === login) || null,
    actif: (login) => { const c = api.trouver(login); return !!c && (c.actif !== false || login === PROPRIO); },
    estProprio: (login) => login === PROPRIO,
    /* renvoie le compte si identifiant + mot de passe sont bons, sinon une raison */
    authentifier(loginSaisi, pass) {
      let login = normLogin(loginSaisi);
      if (login === 'admin' || login === 'administrateur' || login === 'formatrice') login = PROPRIO;
      const c = api.trouver(login);
      const p = String(pass || '').trim();
      if (login === PROPRIO && secoursProprio && egalTexte(p, secoursProprio)) return { ok: true, compte: c || { login: PROPRIO, nom: 'Stéphanie' } };
      if (!c) return { ok: false, raison: `identifiant inconnu (« ${login.slice(0, 30)} »)` };
      if (c.actif === false) return { ok: false, raison: `compte « ${login} » désactivé`, desactive: true };
      if (!verifier(p, c)) return { ok: false, raison: `mauvais mot de passe pour « ${login} »` };
      return { ok: true, compte: c };
    },
    ajouter({ login, nom, pass }) {
      login = normLogin(login).replace(/\s+/g, '.');
      nom = String(nom || '').trim().slice(0, 40);
      if (!/^[a-z0-9._-]{2,30}$/.test(login)) throw new Error('Identifiant : 2 à 30 caractères, lettres sans accent, chiffres, point ou tiret.');
      if (['admin', 'administrateur', 'formatrice'].includes(login)) throw new Error('Cet identifiant est réservé.');
      if (!nom) throw new Error('Le prénom est obligatoire.');
      if (String(pass || '').trim().length < 6) throw new Error('Mot de passe : 6 caractères minimum.');
      if (api.trouver(login)) throw new Error('Cet identifiant existe déjà.');
      liste.push({ login, nom, ...hacher(String(pass).trim()), actif: true, cree: new Date().toISOString(), origine: 'administration' });
      sauver();
      return login;
    },
    modifier(login, { nom, actif, pass }) {
      const c = api.trouver(login); if (!c) throw new Error('Compte introuvable.');
      if (nom !== undefined) { const n = String(nom).trim().slice(0, 40); if (!n) throw new Error('Le prénom est obligatoire.'); c.nom = n; }
      if (actif !== undefined) { if (login === PROPRIO && !actif) throw new Error('Le compte de la formatrice ne peut pas être désactivé.'); c.actif = !!actif; }
      if (pass !== undefined) { if (String(pass).trim().length < 6) throw new Error('Mot de passe : 6 caractères minimum.'); Object.assign(c, hacher(String(pass).trim())); }
      sauver();
    },
    supprimer(login) {
      if (login === PROPRIO) throw new Error('Le compte de la formatrice ne peut pas être supprimé.');
      const i = liste.findIndex((x) => x.login === login); if (i < 0) throw new Error('Compte introuvable.');
      liste.splice(i, 1); sauver();
    },
    vu(login) { const c = api.trouver(login); if (c) { c.derniere = new Date().toISOString(); } },
    sauver,
  };
  setInterval(() => { try { sauver(); } catch {} }, 60000).unref();
  return api;
}
module.exports = { creer, normLogin };
