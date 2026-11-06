'use strict';
// Rings / notifies the Android app through Google's Firebase Cloud Messaging, even when the app is closed.
// Needs the Railway variable FIREBASE_SERVICE_ACCOUNT (the service-account key JSON, pasted as is or base64). Does nothing without it.
const crypto = require('crypto');

function account() {
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  if (!raw) return null;
  try { if (!raw.trim().startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8'); const a = JSON.parse(raw); return a.private_key && a.client_email ? a : null; } catch (e) { return null; }
}
const b64u = b => Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
let cached = { token: null, exp: 0 };
async function accessToken(a) {
  if (cached.token && Date.now() < cached.exp - 60000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64u(JSON.stringify({ iss: a.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(head + '.' + claims).sign(a.private_key);
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + head + '.' + claims + '.' + b64u(sig) });
  const j = await r.json();
  if (!j.access_token) throw new Error('Google sign-in failed: ' + (j.error_description || j.error || r.status));
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}

function register(db) {
  db.exec('CREATE TABLE IF NOT EXISTS fcm_tokens(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  const seen = new Map(); // token -> user id, so we only write when something changed
  return {
    configured: () => !!account(),
    count: userId => db.prepare(userId ? 'SELECT COUNT(*) n FROM fcm_tokens WHERE user_id=?' : 'SELECT COUNT(*) n FROM fcm_tokens').get(...(userId ? [userId] : [])).n,
    // For the admin check page: can we sign in to Google with the key?
    async check() {
      const a = account(); if (!a) return { configured: false };
      try { await accessToken(a); return { configured: true, ok: true, project: a.project_id }; } catch (e) { return { configured: true, ok: false, error: e.message, project: a.project_id }; }
    },
    // Sends one real test notification to every phone this person has registered and returns what Google answered.
    async test(userId) {
      const a = account(); if (!a) return [{ error: 'The Railway variable FIREBASE_SERVICE_ACCOUNT is not set (or is not valid).' }];
      const rows = db.prepare('SELECT token FROM fcm_tokens WHERE user_id=?').all(userId);
      if (!rows.length) return [{ error: 'No phone is registered for your account yet. Open the Android app while logged in, then try again.' }];
      const tk = await accessToken(a);
      return Promise.all(rows.map(async ({ token }) => {
        const r = await fetch(`https://fcm.googleapis.com/v1/projects/${a.project_id}/messages:send`, { method: 'POST', headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: { token, data: { type: 'note', title: 'Studies Hub test', body: 'If you can see this, notifications work.', url: '/', tag: 'test' }, android: { priority: 'HIGH', ttl: '60s' } } }) });
        return { phone: token.slice(0, 8) + '...', status: r.status, answer: (await r.text()).slice(0, 300) };
      }));
    },
    // Remember which phone belongs to which signed-in person.
    remember(token, userId) {
      if (!/^[\w:.\-]{20,400}$/.test(token || '') || seen.get(token) === userId) return;
      db.prepare('INSERT INTO fcm_tokens(token,user_id) VALUES(?,?) ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id').run(token, userId);
      seen.set(token, userId);
    },
    forget(token) { if (token) { db.prepare('DELETE FROM fcm_tokens WHERE token=?').run(token); seen.delete(token); } },
    // payload is what notify() was given: ring / ringEnd for calls, anything else is a normal notification.
    async send(userIds, p) {
      const a = account(); if (!a || !userIds.length) return;
      const rows = db.prepare(`SELECT token FROM fcm_tokens WHERE user_id IN (${userIds.map(() => '?').join(',')})`).all(...userIds);
      if (!rows.length) return;
      let data, ttl = '60s';
      if (p.ring) { data = { type: 'ring', id: p.ring.id, kind: p.ring.kind, title: p.title, body: p.body }; ttl = '45s'; }
      else if (p.ringEnd) data = { type: 'end', id: String(p.tag || '').replace(/^call-/, '') };
      else {
        const tg = String(p.tag || ''), q = p.quickReply || {};
        const chat = /^(dm|group)-\d+$/.test(tg);
        const cat = chat ? 'messages' : /news/.test(tg) ? 'news' : /upload/.test(tg) ? 'uploads' : 'general';
        data = { type: 'note', title: p.title, body: p.body, url: p.url || '/', tag: tg, cat };
        if (chat) { data.chat = q.group ? 'group' : 'dm'; data.cid = String(q.group || q.to || ''); }
      }
      const tk = await accessToken(a), project = a.project_id;
      await Promise.allSettled(rows.map(async ({ token }) => {
        const r = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, { method: 'POST', headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: { token, data, android: { priority: 'HIGH', ttl } } }) });
        if (r.status === 404 || r.status === 400) { const t = await r.text(); if (/UNREGISTERED|NOT_FOUND|INVALID_ARGUMENT/.test(t)) this.forget(token); else console.error('FCM send failed:', t.slice(0, 200)); }
        else if (!r.ok) console.error('FCM send failed:', r.status);
      }));
    },
  };
}
module.exports = { register };
