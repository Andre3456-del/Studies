'use strict';
// Rings / notifies the Android app through Google's Firebase Cloud Messaging, even when the app is closed.
// Needs the Railway variable FIREBASE_SERVICE_ACCOUNT (the service-account key JSON, pasted as is or base64). Does nothing without it.
const crypto = require('crypto');

function account() {
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  if (!raw) return null;
  try { if (!raw.trim().startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8'); const a = JSON.parse(raw); return a.private_key && a.client_email ? a : null; } catch (e) { return null; }
}
// Says in plain words why the key cannot be used (for the admin check page).
function whyBad() {
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  if (!raw.trim()) return 'The Railway variable FIREBASE_SERVICE_ACCOUNT is empty or missing.';
  try { if (!raw.trim().startsWith('{')) raw = Buffer.from(raw.trim(), 'base64').toString('utf8'); } catch (e) { return 'The variable is not valid JSON or base64.'; }
  let a; try { a = JSON.parse(raw); } catch (e) { return 'The variable is there but is not the full key file. Paste the whole contents of the downloaded .json file, from the first { to the last }.'; }
  if (!a.client_email) return 'The key has no client_email. Download a fresh private key from Firebase > Project settings > Service accounts.';
  if (!a.private_key) return 'The key has no private_key. Download a fresh private key from Firebase > Project settings > Service accounts.';
  if (!a.project_id) return 'The key has no project_id. Download a fresh private key from Firebase.';
  return '';
}
// Turns Google's answer into a sentence a person can act on.
function explain(status, text) {
  const s = String(text || '');
  if (status === 200) return 'Sent. Google accepted it.';
  if (/SERVICE_DISABLED|has not been used|is disabled/i.test(s)) return 'Firebase Cloud Messaging API is switched off for this project. In Google Cloud Console open "Firebase Cloud Messaging API" and press Enable.';
  if (status === 401) return 'Google did not accept the key. Make a new private key in Firebase and replace the Railway variable.';
  if (status === 403 && /SENDER_ID_MISMATCH/.test(s)) return 'This phone was registered by a different Firebase project than the key. Install the latest app build (uninstall the old app first) so the phone and the key match.';
  if (status === 403) return 'Google refused permission. The service account needs the role "Firebase Cloud Messaging Admin" (or Firebase Admin).';
  if (status === 404 || /UNREGISTERED|NOT_FOUND/.test(s)) return 'That phone is no longer valid (app removed or reinstalled). It was removed from the list; open the app again to register it.';
  if (status === 400) return 'Google rejected the message for this phone: ' + s.slice(0, 160);
  if (status === 429) return 'Google says too many messages. Wait a minute and try again.';
  if (status >= 500) return 'Google had a problem on its side. Try again shortly.';
  return 'Unexpected answer: ' + s.slice(0, 160);
}
const b64u = b => Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
let cached = { token: null, exp: 0 };
async function accessToken(a) {
  if (cached.token && Date.now() < cached.exp - 60000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64u(JSON.stringify({ iss: a.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(head + '.' + claims).sign(a.private_key);
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(12000), body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + head + '.' + claims + '.' + b64u(sig) });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error('Google sign-in failed: ' + (j.error_description || j.error || r.status));
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}

function register(db) {
  db.exec('CREATE TABLE IF NOT EXISTS fcm_tokens(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  const seen = new Map(); // token -> user id, so we only write when something changed
  const hits = new Map(); // token -> last time that phone talked to the server (proves it is alive)
  return {
    configured: () => !!account(),
    count: userId => db.prepare(userId ? 'SELECT COUNT(*) n FROM fcm_tokens WHERE user_id=?' : 'SELECT COUNT(*) n FROM fcm_tokens').get(...(userId ? [userId] : [])).n,
    reason: whyBad,
    // For the admin check page: can we sign in to Google with the key?
    async check() {
      const a = account(); if (!a) return { configured: !!(process.env.FIREBASE_SERVICE_ACCOUNT || '').trim(), ok: false, error: whyBad() };
      try { cached = { token: null, exp: 0 }; await accessToken(a); return { configured: true, ok: true, project: a.project_id }; } catch (e) { return { configured: true, ok: false, error: e.name === 'TimeoutError' ? 'Google did not answer in time.' : e.message, project: a.project_id }; }
    },
    // The phones on one account, newest first, with when each last spoke to the server.
    phones(userId) {
      return db.prepare('SELECT token, created_at FROM fcm_tokens WHERE user_id=? ORDER BY created_at DESC').all(userId).map(r => ({ id: r.token.slice(0, 8), created: r.created_at, seen: hits.get(r.token) || 0 }));
    },
    // Which of this person's phones have talked to the server since a moment in time (the test message makes a closed app call back).
    seenSince(userId, since) {
      return db.prepare('SELECT token FROM fcm_tokens WHERE user_id=?').all(userId).filter(r => (hits.get(r.token) || 0) > since).map(r => r.token.slice(0, 8));
    },
    // Sends one real test notification to every phone this person has registered and returns what Google answered, in plain words.
    async test(userId) {
      const a = account(); if (!a) return { sentAt: Date.now(), results: [{ error: whyBad() }] };
      const rows = db.prepare('SELECT token FROM fcm_tokens WHERE user_id=?').all(userId);
      if (!rows.length) return { sentAt: Date.now(), results: [{ error: 'No phone is registered for your account yet. Open the Android app while logged in (not the website), wait a few seconds, then try again.' }] };
      const tk = await accessToken(a), sentAt = Date.now();
      const results = await Promise.all(rows.map(async ({ token }) => {
        try {
          const r = await fetch(`https://fcm.googleapis.com/v1/projects/${a.project_id}/messages:send`, { method: 'POST', signal: AbortSignal.timeout(12000), headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: { token, data: { type: 'note', title: 'Studies Hub test', body: 'If you can see this, notifications work.', url: '/', tag: 'test' }, android: { priority: 'HIGH', ttl: '60s' } } }) });
          const answer = (await r.text()).slice(0, 400);
          const old = (r.status === 404 || r.status === 400) && /UNREGISTERED|NOT_FOUND|INVALID_ARGUMENT/.test(answer);
          if (old) this.forget(token);
          return { phone: token.slice(0, 8), status: r.status, ok: r.status === 200, old, message: explain(r.status, answer) };
        } catch (e) { return { phone: token.slice(0, 8), status: 0, ok: false, message: e.name === 'TimeoutError' ? 'Google did not answer in time.' : 'Could not reach Google: ' + e.message }; }
      }));
      return { sentAt, results };
    },
    // Remember which phone belongs to which signed-in person.
    remember(token, userId) {
      if (!/^[\w:.\-]{20,400}$/.test(token || '')) return;
      if (hits.size > 5000) hits.clear();
      hits.set(token, Date.now());
      if (seen.get(token) === userId) return;
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
      if (p.ring) { data = { type: 'ring', id: p.ring.id, kind: p.ring.kind, av: p.ring.av || '', title: p.title, body: p.body }; ttl = '45s'; }
      else if (p.ringEnd) data = { type: 'end', id: String(p.tag || '').replace(/^call-/, '') };
      else {
        const tg = String(p.tag || ''), q = p.quickReply || {};
        const chat = /^(dm|group)-\d+$/.test(tg);
        const cat = chat ? 'messages' : /news/.test(tg) ? 'news' : /upload/.test(tg) ? 'uploads' : 'general';
        data = { type: 'note', title: p.title, body: p.body, url: p.url || '/', tag: tg, cat };
        ttl = '86400s'; // keep it for a day: a phone whose data was off gets it the moment data returns, and tells the server (which makes the sender's ticks go double)
        if (/^\W*Missed (video|voice) call/.test(String(p.body || ''))) data.missed = '1';
        if (chat) { data.chat = q.group ? 'group' : 'dm'; data.cid = String(q.group || q.to || ''); data.av = q.group ? '/group-avatar/' + q.group : '/avatar/' + q.to; }
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
