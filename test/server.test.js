'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const PORT = 3999;
const base = `http://127.0.0.1:${PORT}`;
let proc;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrpms-'));
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { env: { ...process.env, PORT, DATA_DIR: dir, PASS_STEPHANIE: 'a', PASS_FLORIANE: 'b' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/sante'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
});
test.after(() => proc.kill());

async function login(l, p) {
  const r = await fetch(base + '/login', { method: 'POST', body: new URLSearchParams({ login: l, pass: p }), redirect: 'manual' });
  return { status: r.status, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}

test('page protégée sans connexion', async () => {
  const r = await fetch(base + '/', { redirect: 'manual' });
  assert.strictEqual(r.status, 303);
  assert.strictEqual(r.headers.get('location'), '/login');
});
test('mauvais mot de passe refusé, compte sans mot de passe désactivé', async () => {
  assert.strictEqual((await login('floriane', 'x')).status, 401);
  assert.strictEqual((await login('yasmine', '')).status, 401);
});
test('connexion, identité et partage d’un document', async () => {
  const s = await login('stephanie', 'a'); const f = await login('floriane', 'b');
  assert.strictEqual(s.status, 303);
  const me = await (await fetch(base + '/api/me', { headers: { cookie: f.cookie } })).json();
  assert.deepStrictEqual(me, { id: 'u_floriane', nom: 'Floriane', proprio: false });
  const put = await fetch(base + '/api/doc?path=session/test', { method: 'PUT', headers: { cookie: f.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ v: [1, 2] }) });
  assert.strictEqual(put.status, 200);
  const got = await (await fetch(base + '/api/doc?path=session/test', { headers: { cookie: s.cookie } })).json();
  assert.deepStrictEqual(got, { exists: true, data: { v: [1, 2] } });
  const page = await (await fetch(base + '/', { headers: { cookie: s.cookie } })).text();
  assert.ok(page.includes('<script src="/shim.js"></script>'));
});
test('chemin de document invalide refusé', async () => {
  const s = await login('stephanie', 'a');
  const r = await fetch(base + '/api/doc?path=../../etc', { headers: { cookie: s.cookie } });
  assert.strictEqual(r.status, 400);
});
