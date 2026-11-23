/* CHR PMS — Les Trois Sources : serveur de la session de formation.
   Sert le simulateur PMS aux comptes de la formation, partage l'état entre les postes connectés,
   et donne à la formatrice une page d'administration (comptes, accès, connexions).
   Aucune dépendance : Node 22+ uniquement. */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { creer: creerComptes } = require('./comptes');

const PORT = Number(process.env.PORT) || 3000;
let DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PUBLIC = path.join(__dirname, '..', 'public');
const PROD = process.env.NODE_ENV === 'production';
try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.accessSync(DATA_DIR, fs.constants.W_OK); }
catch (e) {
  const repli = path.join(__dirname, '..', 'data');
  console.warn(`[chr-pms] ${DATA_DIR} inaccessible (${e.code}) : disque absent ? Données gardées dans ${repli}, perdues au prochain redémarrage.`);
  DATA_DIR = repli; fs.mkdirSync(DATA_DIR, { recursive: true });
}
const comptes = creerComptes(DATA_DIR);

/* ---------- sessions de connexion (cookie) ---------- */
const SESS_FILE = path.join(DATA_DIR, 'sessions.json');
let sessions = {};
try { sessions = JSON.parse(fs.readFileSync(SESS_FILE, 'utf8')); } catch { sessions = {}; }
const SESS_MAX = 1000 * 60 * 60 * 24 * 14; // 14 jours
let timerSess = null;
function sauverSessions() { clearTimeout(timerSess); timerSess = setTimeout(() => { try { fs.writeFileSync(SESS_FILE, JSON.stringify(sessions)); } catch (e) { console.error(e); } }, 300); }
function lireCookie(req, nom) {
  const m = (req.headers.cookie || '').split(/;\s*/).find((s) => s.startsWith(nom + '='));
  return m ? decodeURIComponent(m.slice(nom.length + 1)) : null;
}
function moiDe(req) {
  const t = lireCookie(req, 'chrpms');
  const s = t && sessions[t];
  if (!s || Date.now() - s.t > SESS_MAX) return null;
  if (!comptes.actif(s.login)) return null;
  const c = comptes.trouver(s.login) || (comptes.estProprio(s.login) ? { login: s.login, nom: 'Stéphanie' } : null);
  if (!c) return null;
  if (!s.vu || Date.now() - s.vu > 60000) { s.vu = Date.now(); comptes.vu(s.login); sauverSessions(); }
  return { login: c.login, nom: c.nom, proprio: comptes.estProprio(c.login), jeton: t };
}
function fermerSessionsDe(login) {
  let n = 0;
  for (const [t, s] of Object.entries(sessions)) if (s.login === login) { delete sessions[t]; n++; }
  sauverSessions();
  for (const [id, c] of clients) if (c.login === login) { envoyer(c.res, 'deconnexion', {}); c.res.end(); clients.delete(id); }
  diffuserPresents();
  return n;
}

/* ---------- documents partagés ---------- */
const DOCS_FILE = path.join(DATA_DIR, 'docs.json');
let docs = {};
try { docs = JSON.parse(fs.readFileSync(DOCS_FILE, 'utf8')); } catch { docs = {}; }
let timerSauve = null;
function sauverDocs() {
  clearTimeout(timerSauve);
  timerSauve = setTimeout(() => {
    const tmp = DOCS_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(docs), (e) => { if (e) return console.error(e); fs.rename(tmp, DOCS_FILE, (e2) => e2 && console.error(e2)); });
  }, 400);
}
const CHEMIN_OK = /^[a-z0-9_-]{1,40}\/[a-z0-9_.-]{1,60}$/i;

/* ---------- temps réel (Server-Sent Events) ---------- */
const clients = new Map(); // id -> { res, login, nom, presence, depuis }
function envoyer(res, type, data) { res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); }
function diffuser(type, data, sauf) { for (const [id, c] of clients) if (id !== sauf) envoyer(c.res, type, data); }
function listePresents() { return [...clients.entries()].map(([id, c]) => ({ peer: id, by: c.login, presence: c.presence || {} })); }
function diffuserPresents() { const l = listePresents(); for (const c of clients.values()) envoyer(c.res, 'peers', { peers: l }); }
setInterval(() => { for (const c of clients.values()) c.res.write(': ping\n\n'); }, 25000).unref();

/* ---------- utilitaires HTTP ---------- */
const ESSAIS = new Map();
function trop(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  const e = ESSAIS.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - e.t > 15 * 60 * 1000) { e.n = 0; e.t = Date.now(); }
  e.n++; ESSAIS.set(ip, e);
  return e.n > 20;
}
function corps(req, max) {
  return new Promise((ok, ko) => {
    let n = 0; const morceaux = [];
    req.on('data', (b) => { n += b.length; if (n > max) { ko(new Error('trop gros')); req.destroy(); } else morceaux.push(b); });
    req.on('end', () => ok(Buffer.concat(morceaux).toString('utf8')));
    req.on('error', ko);
  });
}
const SECU = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' };
function repondre(res, code, type, txt, extra) { res.writeHead(code, { 'Content-Type': type, ...SECU, ...(extra || {}) }); res.end(txt); }
function json(res, code, obj) { repondre(res, code, 'application/json; charset=utf-8', JSON.stringify(obj), { 'Cache-Control': 'no-store' }); }
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function pageConnexion(msg) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connexion — CHR PMS</title><link rel="icon" href="/logo.png">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f2742;font:15px system-ui,-apple-system,Segoe UI,sans-serif;color:#1c2430}
.box{background:#fff;border-radius:16px;padding:32px 30px;width:min(360px,90vw);box-shadow:0 20px 60px rgba(0,0,0,.35);border-top:5px solid #c9a24a}
h1{font-size:20px;margin:14px 0 4px}p{margin:0 0 18px;color:#5b6573;font-size:13.5px}label{display:block;font-weight:600;font-size:13px;margin:12px 0 4px}
input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cfd6e0;border-radius:8px;font:inherit}
button{margin-top:18px;width:100%;padding:11px;border:0;border-radius:8px;background:#0f2742;color:#fff;font:inherit;font-weight:700;cursor:pointer}
.err{background:#fde2e2;color:#9b1c1c;border-radius:8px;padding:8px 10px;font-size:13px;margin-top:10px}img{height:46px}</style></head>
<body><form class="box" method="post" action="/login"><img src="/logo.png" alt="CHR Solution"><h1>Les Trois Sources</h1><p>Simulateur PMS — formation réception. Connectez-vous avec l'identifiant donné par votre formatrice.</p>
<label for="l">Identifiant</label><input id="l" name="login" autocomplete="username" required autofocus>
<label for="p">Mot de passe</label><input id="p" name="pass" type="password" autocomplete="current-password" required>
${msg ? `<div class="err">${esc(msg)}</div>` : ''}<button type="submit">Se connecter</button></form></body></html>`;
}

let PMS_HTML = null;
function pms() {
  if (!PMS_HTML || !PROD) PMS_HTML = fs.readFileSync(path.join(PUBLIC, 'pms.html'), 'utf8').replace('<head>', '<head><script src="/shim.js"></script>');
  return PMS_HTML;
}

/* ---------- administration (formatrice uniquement) ---------- */
function etatConnexions() {
  const enLigne = {};
  for (const c of clients.values()) enLigne[c.login] = (enLigne[c.login] || 0) + 1;
  const ouvertes = {};
  for (const s of Object.values(sessions)) if (Date.now() - s.t <= SESS_MAX) ouvertes[s.login] = (ouvertes[s.login] || 0) + 1;
  return comptes.tous().map((c) => ({ ...c, postes: enLigne[c.login] || 0, sessions: ouvertes[c.login] || 0 }));
}
async function routeAdmin(req, res, url, moi) {
  if (!moi.proprio) return json(res, 403, { erreur: 'Réservé à la formatrice.' });
  if (req.method !== 'GET' && req.headers['x-chr'] !== '1') return json(res, 403, { erreur: 'requête refusée' });
  const p = url.pathname;
  try {
    if (p === '/api/admin/comptes' && req.method === 'GET') return json(res, 200, { comptes: etatConnexions() });
    if (p === '/api/admin/comptes' && req.method === 'POST') {
      const b = JSON.parse(await corps(req, 4096));
      const login = comptes.ajouter(b);
      console.log(`[chr-pms] compte créé : ${login}`);
      return json(res, 201, { ok: true, login });
    }
    const m = p.match(/^\/api\/admin\/comptes\/([a-z0-9._-]{2,30})(\/deconnecter)?$/);
    if (m) {
      const login = m[1];
      if (m[2] && req.method === 'POST') return json(res, 200, { ok: true, fermees: fermerSessionsDe(login) });
      if (req.method === 'PATCH') {
        const b = JSON.parse(await corps(req, 4096));
        comptes.modifier(login, b);
        if (b.actif === false || b.pass !== undefined) fermerSessionsDe(login);
        console.log(`[chr-pms] compte modifié : ${login}${b.actif === false ? ' (désactivé)' : ''}${b.pass !== undefined ? ' (mot de passe changé)' : ''}`);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'DELETE') { fermerSessionsDe(login); comptes.supprimer(login); console.log(`[chr-pms] compte supprimé : ${login}`); return json(res, 200, { ok: true }); }
    }
    return json(res, 404, { erreur: 'Introuvable' });
  } catch (e) {
    return json(res, 400, { erreur: e.message || 'Erreur' });
  }
}

/* ---------- routes ---------- */
const serveur = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    if (p === '/sante') return repondre(res, 200, 'text/plain', 'ok');
    if (p === '/logo.png' || p === '/shim.js') {
      return repondre(res, 200, p.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'image/png', fs.readFileSync(path.join(PUBLIC, p.slice(1))), { 'Cache-Control': 'no-cache' });
    }
    if (p === '/login' && req.method === 'GET') return repondre(res, 200, 'text/html; charset=utf-8', pageConnexion());
    if (p === '/login' && req.method === 'POST') {
      if (trop(req)) return repondre(res, 429, 'text/html; charset=utf-8', pageConnexion('Trop de tentatives : réessayez dans 15 minutes.'));
      const f = new URLSearchParams(await corps(req, 4096));
      const r = comptes.authentifier(f.get('login'), f.get('pass'));
      if (!r.ok) {
        console.warn(`[chr-pms] connexion refusée : ${r.raison}`);
        return repondre(res, 401, 'text/html; charset=utf-8', pageConnexion(r.desactive ? 'Ce compte est désactivé : adressez-vous à votre formatrice.' : 'Identifiant ou mot de passe incorrect.'));
      }
      const t = crypto.randomBytes(32).toString('hex');
      sessions[t] = { login: r.compte.login, t: Date.now(), vu: Date.now() }; sauverSessions(); comptes.vu(r.compte.login);
      console.log(`[chr-pms] connexion : ${r.compte.login}`);
      res.writeHead(303, { Location: '/', 'Set-Cookie': `chrpms=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESS_MAX / 1000}${PROD ? '; Secure' : ''}`, ...SECU });
      return res.end();
    }
    if (p === '/logout') {
      const t = lireCookie(req, 'chrpms'); if (t) { delete sessions[t]; sauverSessions(); }
      res.writeHead(303, { Location: '/login', 'Set-Cookie': 'chrpms=; Path=/; Max-Age=0', ...SECU }); return res.end();
    }

    const moi = moiDe(req);
    if (!moi) {
      if (p.startsWith('/api/')) return json(res, 401, { erreur: 'non connecté' });
      res.writeHead(303, { Location: '/login', ...SECU }); return res.end();
    }

    if (p === '/' || p === '/index.html') return repondre(res, 200, 'text/html; charset=utf-8', pms(), { 'Cache-Control': 'no-store' });
    if (p === '/admin') {
      if (!moi.proprio) { res.writeHead(303, { Location: '/', ...SECU }); return res.end(); }
      return repondre(res, 200, 'text/html; charset=utf-8', fs.readFileSync(path.join(PUBLIC, 'admin.html')), { 'Cache-Control': 'no-store' });
    }
    if (p.startsWith('/api/admin/')) return routeAdmin(req, res, url, moi);
    if (p === '/api/me') {
      return json(res, 200, { id: 'u_' + moi.login, login: moi.login, nom: moi.nom, proprio: moi.proprio,
        comptes: comptes.tous().filter((c) => c.actif || c.proprio).map((c) => ({ login: c.login, nom: c.nom, proprio: c.proprio })) });
    }

    if (p === '/api/doc') {
      const chemin = url.searchParams.get('path') || '';
      if (!CHEMIN_OK.test(chemin)) return json(res, 400, { erreur: 'chemin' });
      if (req.method === 'GET') return json(res, 200, docs[chemin] ? { exists: true, data: docs[chemin] } : { exists: false });
      if (req.method === 'PUT') {
        let v; try { v = JSON.parse(await corps(req, 8 * 1024 * 1024)); } catch { return json(res, 400, { erreur: 'corps' }); }
        docs[chemin] = v; sauverDocs();
        diffuser('doc', { path: chemin, data: v }, url.searchParams.get('peer'));
        return json(res, 200, { ok: true });
      }
    }
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...SECU });
      const id = crypto.randomBytes(8).toString('hex');
      clients.set(id, { res, login: moi.login, nom: moi.nom, presence: {}, depuis: Date.now() });
      envoyer(res, 'hello', { peer: id });
      diffuserPresents();
      req.on('close', () => { clients.delete(id); diffuserPresents(); });
      return;
    }
    if (p === '/api/presence' && req.method === 'POST') {
      let b; try { b = JSON.parse(await corps(req, 8192)); } catch { return json(res, 400, { erreur: 'corps' }); }
      const c = clients.get(String(b.peer || ''));
      if (!c || c.login !== moi.login) return json(res, 404, { erreur: 'poste' });
      c.presence = { ...c.presence, ...(b.patch || {}) };
      for (const k of Object.keys(c.presence)) if (c.presence[k] === null) delete c.presence[k];
      diffuserPresents();
      return json(res, 200, { ok: true });
    }
    return repondre(res, 404, 'text/plain; charset=utf-8', 'Introuvable');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) repondre(res, 500, 'text/plain; charset=utf-8', 'Erreur serveur');
  }
});
serveur.listen(PORT, () => {
  const l = comptes.tous();
  console.log(`[chr-pms] en ligne sur le port ${PORT} — ${l.length} compte(s) : ${l.map((c) => c.login + (c.actif ? '' : ' (désactivé)')).join(', ')}`);
});
module.exports = serveur;
