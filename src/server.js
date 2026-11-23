/* CHR PMS — Les Trois Sources : serveur de la session de formation.
   Sert le simulateur PMS aux comptes de la formation et partage l'état entre les postes connectés.
   Aucune dépendance : Node 22+ uniquement. */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

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

/* ---------- comptes ---------- */
const COMPTES = [
  { login: 'stephanie', nom: 'Stéphanie', proprio: true, env: 'PASS_STEPHANIE' },
  { login: 'floriane', nom: 'Floriane', env: 'PASS_FLORIANE' },
  { login: 'soukayna', nom: 'Soukayna', env: 'PASS_SOUKAYNA' },
  { login: 'yasmine', nom: 'Yasmine', env: 'PASS_YASMINE' },
];
for (const c of COMPTES) {
  c.pass = String(process.env[c.env] || '').trim();
  if (!c.pass) console.warn(`[chr-pms] ${c.env} absent : le compte « ${c.login} » est désactivé.`);
}
function egal(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

/* ---------- sessions (cookie) ---------- */
const SESS_FILE = path.join(DATA_DIR, 'sessions.json');
let sessions = {};
try { sessions = JSON.parse(fs.readFileSync(SESS_FILE, 'utf8')); } catch { sessions = {}; }
const SESS_MAX = 1000 * 60 * 60 * 24 * 14; // 14 jours
function sauverSessions() { try { fs.writeFileSync(SESS_FILE, JSON.stringify(sessions)); } catch (e) { console.error(e); } }
function lireCookie(req, nom) {
  const m = (req.headers.cookie || '').split(/;\s*/).find((s) => s.startsWith(nom + '='));
  return m ? decodeURIComponent(m.slice(nom.length + 1)) : null;
}
function compteDe(req) {
  const t = lireCookie(req, 'chrpms');
  const s = t && sessions[t];
  if (!s || Date.now() - s.t > SESS_MAX) return null;
  const c = COMPTES.find((x) => x.login === s.login && x.pass);
  return c || null;
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
const CHEMIN_OK = /^[a-z0-9_-]{1,40}\/[a-z0-9_-]{1,60}$/i;

/* ---------- temps réel (Server-Sent Events) ---------- */
const clients = new Map(); // id -> { res, login, nom, presence }
function envoyer(res, type, data) { res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); }
function diffuser(type, data, sauf) { for (const [id, c] of clients) if (id !== sauf) envoyer(c.res, type, data); }
function listePresents() { return [...clients.entries()].map(([id, c]) => ({ peer: id, by: c.login, presence: c.presence || {} })); }
function diffuserPresents() { const l = listePresents(); for (const [id, c] of clients) envoyer(c.res, 'peers', { me: id, peers: l }); }
setInterval(() => { for (const c of clients.values()) c.res.write(': ping\n\n'); }, 25000);

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
const SECU = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};
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
  if (!PMS_HTML || !PROD) {
    const brut = fs.readFileSync(path.join(PUBLIC, 'pms.html'), 'utf8');
    PMS_HTML = brut.replace('<head>', '<head><script src="/shim.js"></script>');
  }
  return PMS_HTML;
}

/* ---------- routes ---------- */
const serveur = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    if (p === '/sante') return repondre(res, 200, 'text/plain', 'ok');
    if (p === '/logo.png' || p === '/shim.js') {
      const f = path.join(PUBLIC, p.slice(1));
      return repondre(res, 200, p.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'image/png', fs.readFileSync(f), { 'Cache-Control': 'no-cache' });
    }
    if (p === '/login' && req.method === 'GET') return repondre(res, 200, 'text/html; charset=utf-8', pageConnexion());
    if (p === '/login' && req.method === 'POST') {
      if (trop(req)) return repondre(res, 429, 'text/html; charset=utf-8', pageConnexion('Trop de tentatives : réessayez dans 15 minutes.'));
      const f = new URLSearchParams(await corps(req, 4096));
      // « Stéphanie », « STEPHANIE », « stephanie  » : on accepte toutes ces écritures.
      const login = String(f.get('login') || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
      // « admin » ou « administrateur » = le compte de la formatrice (même mot de passe que stephanie).
      const cible = (login === 'admin' || login === 'administrateur' || login === 'formatrice') ? 'stephanie' : login;
      const c = COMPTES.find((x) => x.login === cible && x.pass);
      if (!c) console.warn(`[chr-pms] connexion refusée : identifiant inconnu ou compte désactivé (« ${login.slice(0, 30)} »)`);
      else if (!egal(String(f.get('pass') || '').trim(), c.pass)) console.warn(`[chr-pms] connexion refusée : mauvais mot de passe pour « ${c.login} »`);
      if (!c || !egal(String(f.get('pass') || '').trim(), c.pass)) return repondre(res, 401, 'text/html; charset=utf-8', pageConnexion('Identifiant ou mot de passe incorrect.'));
      const t = crypto.randomBytes(32).toString('hex');
      sessions[t] = { login: c.login, t: Date.now() }; sauverSessions();
      res.writeHead(303, { Location: '/', 'Set-Cookie': `chrpms=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESS_MAX / 1000}${PROD ? '; Secure' : ''}`, ...SECU });
      return res.end();
    }
    if (p === '/logout') {
      const t = lireCookie(req, 'chrpms'); if (t) { delete sessions[t]; sauverSessions(); }
      res.writeHead(303, { Location: '/login', 'Set-Cookie': 'chrpms=; Path=/; Max-Age=0', ...SECU }); return res.end();
    }

    const moi = compteDe(req);
    if (!moi) {
      if (p.startsWith('/api/')) return json(res, 401, { erreur: 'non connecté' });
      res.writeHead(303, { Location: '/login', ...SECU }); return res.end();
    }

    if (p === '/' || p === '/index.html') return repondre(res, 200, 'text/html; charset=utf-8', pms(), { 'Cache-Control': 'no-store' });
    if (p === '/api/me') return json(res, 200, { id: 'u_' + moi.login, nom: moi.nom, proprio: !!moi.proprio });

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
      clients.set(id, { res, login: moi.login, nom: moi.nom, presence: {} });
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
serveur.listen(PORT, () => console.log(`[chr-pms] en ligne sur le port ${PORT}`));
module.exports = serveur;
