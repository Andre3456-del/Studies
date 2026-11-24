// Sign-up details (name, registration number, school, department, level) are locked.
// To change them the person asks for a 6-digit code by email; once it is typed in they get 15 minutes
// and one change, then the details lock again.
const crypto = require('crypto');
const sha = s => crypto.createHash('sha256').update('plock:' + String(s)).digest('hex');

function init(db) {
  db.exec('CREATE TABLE IF NOT EXISTS profile_unlock(user_id INTEGER PRIMARY KEY, code_hash TEXT, expires INTEGER, tries INTEGER NOT NULL DEFAULT 0, sent_at INTEGER, until INTEGER)');
}
const unlocked = (db, id) => { const r = db.prepare('SELECT until FROM profile_unlock WHERE user_id=?').get(id); return !!(r && r.until && r.until > Date.now()); };
const relock = (db, id) => db.prepare('UPDATE profile_unlock SET until=0, code_hash=NULL WHERE user_id=?').run(id);
const rows = (esc, list) => list.filter(x => x[1]).map(([k, v]) => `<label class="mut">${esc(k)}</label><div class="locked-field"><span>${esc(String(v))}</span></div>`).join('');
const button = '<form method="post" action="/settings/profile/code"><p class="mut" style="margin:10px 0">These are locked to keep your account safe. To change them we first send a code to your email.</p><button>Change my details</button></form>';

function register(app, ctx) {
  const { db, esc, layout, deliver, emailShell } = ctx;
  init(db);
  const mailCode = (u, code) => deliver(u.email, 'Your Studies Hub code', `Your code to change your details is ${code}. It expires in 10 minutes. If you did not ask for it, ignore this email and nothing changes.`,
    emailShell(`<h2 style="margin:0 0 18px;font-size:24px;line-height:1.3;color:#1b2430">Change your details</h2><p style="margin:0 0 12px">Use this code:</p><p style="font-size:34px;font-weight:800;letter-spacing:8px;margin:0 0 18px;background:#f3f1ff;border-radius:12px;padding:14px 18px;text-align:center;color:#3b2fc9">${code}</p><p style="color:#5b6675;font-size:13px;margin:0">It expires in 10 minutes. If you did not ask for it, ignore this email and nothing changes.</p>`));
  const page = (u, msg, err) => layout('Verify it is you', `<p class="mut"><a href="/settings/profile">&larr; Profile</a></p><h1>Verify it is you</h1>
${msg ? `<p class="${err ? 'err' : 'mut'}">${esc(msg)}</p>` : ''}
<form method="post" action="/settings/profile/verify" class="card" autocomplete="off"><p class="mut" style="margin:0 0 8px">We sent a 6-digit code to ${esc(u.email)}.</p>
<input name="code" inputmode="numeric" maxlength="6" placeholder="6-digit code" required autofocus><button>Continue</button></form>
<form method="post" action="/settings/profile/code"><button class="ghost">Send the code again</button></form>`, u);
  const go = (res, m, e) => res.redirect('/settings/profile?' + (e ? 'err=1&' : '') + 'msg=' + encodeURIComponent(m));
  app.post('/settings/profile/code', async (req, res) => {
    if (!req.user) return res.redirect('/login?next=/settings/profile');
    const u = db.prepare('SELECT id,email,name FROM users WHERE id=?').get(req.user.id);
    const r = db.prepare('SELECT sent_at FROM profile_unlock WHERE user_id=?').get(u.id);
    if (r && Date.now() - (r.sent_at || 0) < 60000) return res.send(page(u, 'Please wait a minute before asking for another code.', 1));
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    db.prepare('INSERT INTO profile_unlock(user_id,code_hash,expires,tries,sent_at,until) VALUES(?,?,?,0,?,0) ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash, expires=excluded.expires, tries=0, sent_at=excluded.sent_at, until=0').run(u.id, sha(code), Date.now() + 600e3, Date.now());
    try { await mailCode(u, code); } catch (e) { console.error('Change-details code email failed:', e.message); return res.send(page(u, 'The email could not be sent just now. Try again in a minute.', 1)); }
    res.send(page(u, 'Code sent. Check your inbox and your spam folder.'));
  });
  app.get('/settings/profile/verify', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/settings/profile');
    res.send(page(db.prepare('SELECT id,email FROM users WHERE id=?').get(req.user.id)));
  });
  app.post('/settings/profile/verify', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/settings/profile');
    const u = db.prepare('SELECT id,email FROM users WHERE id=?').get(req.user.id);
    const r = db.prepare('SELECT * FROM profile_unlock WHERE user_id=?').get(u.id);
    if (!r || !r.code_hash || r.expires < Date.now()) return res.send(page(u, 'That code has expired. Ask for a new one.', 1));
    if (r.tries >= 5) return res.send(page(u, 'Too many wrong tries. Ask for a new code.', 1));
    if (sha(String(req.body.code || '').trim()) !== r.code_hash) { db.prepare('UPDATE profile_unlock SET tries=tries+1 WHERE user_id=?').run(u.id); return res.send(page(u, 'That code is not right.', 1)); }
    db.prepare('UPDATE profile_unlock SET code_hash=NULL, until=? WHERE user_id=?').run(Date.now() + 15 * 60e3, u.id);
    go(res, 'Verified. You can change your details now.');
  });
}
module.exports = { init, unlocked, relock, rows, button, register };
