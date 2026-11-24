/* Pont entre le simulateur PMS et le serveur CHR PMS.
   Le PMS a été écrit pour claude.ai (claude.use("db"|"user"|"room"|"downloads")) :
   ce fichier fournit les mêmes fonctions, branchées sur le serveur de la formation. */
(function () {
  'use strict';
  var peer = null, abonnes = {}, presents = [], ecoutePeers = [], pretPeer, attente = new Promise(function (ok) { pretPeer = ok; });
  var moi = null, moiP = fetch('/api/me', { credentials: 'same-origin' }).then(function (r) {
    if (r.status === 401) { location.href = '/login'; return null; } return r.json();
  }).then(function (m) { moi = m; if (m) window.__CHR_COMPTES = m.comptes || []; return m; }).catch(function () { return null; });

  function snap(e) { return { exists: !!e.exists, data: function () { return e.data; } }; }
  function relancer() {
    var es = new EventSource('/api/events');
    es.addEventListener('hello', function (e) { peer = JSON.parse(e.data).peer; pretPeer(peer); if (moiPres) envoyerPres(); });
    es.addEventListener('doc', function (e) { var d = JSON.parse(e.data); (abonnes[d.path] || []).forEach(function (f) { try { f(snap({ exists: true, data: d.data })); } catch (x) { console.error(x); } }); });
    es.addEventListener('peers', function (e) {
      var d = JSON.parse(e.data);
      presents = Object.freeze(d.peers.map(function (p) { return Object.freeze({ peer: p.peer, by: 'u_' + p.by, isMe: p.peer === peer, sameTab: p.peer === peer, kind: 'viewer', guest: false, presence: p.presence, updatedAt: Date.now() }); }));
      ecoutePeers.forEach(function (f) { try { f({ peers: presents, joined: [], left: [], updated: [] }); } catch (x) { console.error(x); } });
    });
    es.addEventListener('deconnexion', function () { es.close(); location.href = '/login'; });
    es.onerror = function () { if (es.readyState === 2) { es.close(); setTimeout(relancer, 3000); } };
  }
  relancer();

  var moiPres = null;
  function envoyerPres() {
    return attente.then(function (p) { return fetch('/api/presence', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ peer: p, patch: moiPres }) }); });
  }

  var db = {
    doc: function (chemin) {
      return {
        set: function (v) {
          return attente.then(function (p) {
            return fetch('/api/doc?path=' + encodeURIComponent(chemin) + '&peer=' + p, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) });
          }).then(function (r) { if (!r.ok) { var e = new Error('écriture refusée'); e.code = r.status === 401 ? 'not_granted' : 'upstream_error'; throw e; } });
        },
        onSnapshot: function (f) {
          (abonnes[chemin] = abonnes[chemin] || []).push(f);
          fetch('/api/doc?path=' + encodeURIComponent(chemin), { credentials: 'same-origin' }).then(function (r) { return r.json(); })
            .then(function (d) { f(snap(d)); }).catch(function () {});
          return function () { abonnes[chemin] = (abonnes[chemin] || []).filter(function (x) { return x !== f; }); };
        }
      };
    }
  };
  var user = {
    isOwner: function () { return moiP.then(function (m) { return !!(m && m.proprio); }); },
    canEdit: function () { return moiP.then(function (m) { return !!(m && m.proprio); }); },
    can: function (n) { return Promise.resolve(n === 'data.write'); },
    id: function () { return moiP.then(function (m) { return m ? m.id : null; }); },
    me: function () { return moiP.then(function (m) { return { id: m ? m.id : null, name: m ? m.nom : '', email: null, isOwner: !!(m && m.proprio), canEdit: !!(m && m.proprio), avatarUrl: '', color: '#1f3a5f' }; }); }
  };
  var room = {
    presence: function (patch) { moiPres = Object.assign({}, moiPres || {}, patch || {}); return envoyerPres().then(function () {}); },
    peers: function () { return presents; },
    onPeers: function (f) { ecoutePeers.push(f); setTimeout(function () { f({ peers: presents, joined: presents, left: [], updated: [] }); }, 0); return function () { ecoutePeers = ecoutePeers.filter(function (x) { return x !== f; }); }; },
    connected: function () { return !!peer; }
  };
  var downloads = {
    save: function (o) {
      var blob = new Blob([o.data], { type: o.mimeType || 'application/octet-stream' }), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = o.filename || 'fichier'; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      return Promise.resolve({ ok: true });
    }
  };
  var caps = { db: db, user: user, room: room, downloads: downloads };
  window.claude = Object.freeze({ use: function (n) { return moiP.then(function () { return caps[n] || null; }); } });

  /* Bouton de déconnexion discret */
  document.addEventListener('DOMContentLoaded', function () {
    moiP.then(function (m) {
      if (!m) return;
      var box = document.createElement('div');
      box.style.cssText = 'position:fixed;right:12px;bottom:10px;z-index:9999;display:flex;gap:6px';
      var st = 'font:600 12px system-ui;background:#0f2742;color:#fff;padding:6px 12px;border-radius:999px;text-decoration:none;opacity:.9';
      if (m.proprio){ var a = document.createElement('a'); a.href = '/admin'; a.textContent = (window.matchMedia && window.matchMedia('(max-width:700px)').matches) ? '⚙️' : '⚙️ Administration'; a.title = 'Administration'; a.style.cssText = st + ';background:#c9a24a;color:#0f2742'; box.appendChild(a); }
      var b = document.createElement('a'); b.href = '/logout'; var petit = window.matchMedia && window.matchMedia('(max-width:700px)').matches; b.textContent = petit ? '⎋ ' + m.nom : 'Se déconnecter (' + m.nom + ')'; b.title = 'Se déconnecter'; b.style.cssText = st; box.appendChild(b);
      document.body.appendChild(box);
    });
  });
})();
