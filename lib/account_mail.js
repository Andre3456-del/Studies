'use strict';
// Emails about a person's own account. They are sent whatever the person's notification-email setting is, like a verification code.
//   created        the email address was confirmed: "your account was created"
//   welcome        they finished their profile (picture and all): the official welcome
//   loginOk        successful log in (at most one every 10 minutes per person, so nobody is spammed)
//   passwordChanged  the password was changed or reset
//   deleting       they tapped "Delete my account" (sent before anything is removed)
//   deleted        it is done
// Nothing here can break the request that called it: every send is wrapped.
let C = null;
const lastLogin = new Map();
const first = n => String(n || '').trim().split(/\s+/).filter(w => !/^(prof|dr|mr|mrs|ms|engr|rev|pastor|chief|hon|barr|alh|alhaji|mal|sir)\.?$/i.test(w))[0] || 'there';
const when = () => new Date().toLocaleString('en-GB', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' }) + ' (Nigeria time)';
const device = req => { const ua = String((req && req.headers && req.headers['user-agent']) || ''); return /StudiesHub|; wv\)/i.test(ua) ? 'the Studies Hub app' : /Android/i.test(ua) ? 'an Android browser' : /iPhone|iPad/i.test(ua) ? 'an iPhone or iPad' : /Windows/i.test(ua) ? 'a Windows computer' : /Mac OS/i.test(ua) ? 'a Mac' : /Linux/i.test(ua) ? 'a Linux computer' : 'a device'; };

function init(ctx) { C = ctx; try { ctx.db.exec('ALTER TABLE users ADD COLUMN welcomed INTEGER DEFAULT 0'); } catch (e) { /* already there */ } }
function user(id) { return C && C.db.prepare('SELECT id,name,email,verified FROM users WHERE id=?').get(Number(id)); }
async function send(to, subject, lines, button) {
  if (!C || !C.deliver || !to) return;
  const e = C.esc, name = lines.name;
  const text = `Dear ${name},\n\n${lines.body.join('\n\n')}\n\n— The Studies Hub Team`;
  const base = (process.env.BASE_URL || 'https://studieshub.org').replace(/\/$/, '');
  const html = C.emailShell(`<h2 style="margin:0 0 14px;font-size:22px;color:#1b2430">${e(lines.title)}</h2><p style="margin:0 0 14px"><b>Dear ${e(name)},</b></p>${lines.body.map(p => `<p style="margin:0 0 14px;line-height:1.6">${e(p)}</p>`).join('')}${button ? `<p style="margin:18px 0 0"><a href="${base}${button[1]}" style="background:#6c5ce7;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;display:inline-block">${e(button[0])}</a></p>` : ''}`);
  try { await C.deliver(to, subject, text, html); } catch (err) { console.error('Account email failed:', err.message); }
}
const safe = fn => (...a) => { try { Promise.resolve(fn(...a)).catch(e => console.error('Account email failed:', e.message)); } catch (e) { console.error('Account email failed:', e.message); } };

module.exports = {
  init,
  created: safe(id => { const u = user(id); if (u) return send(u.email, 'Your Studies Hub account is ready', { name: first(u.name), title: 'Account created', body: ['Your email is confirmed and your Studies Hub account has been created successfully.', 'Log in to finish setting up your profile.'] }, ['Log in', '/login']); }),
  welcome: safe(id => { const u = user(id); if (u) return send(u.email, 'Welcome to Studies Hub – your learning community 🎓', { name: first(u.name), title: 'Welcome to Studies Hub', body: ['You are all set! Explore, connect, share knowledge and grow together with Studikins across the community.', 'Let us make every learning experience count.', '— The Studies Hub Team'] }, ['Open Studies Hub', '/']); }),
  loginOk: safe((id, req) => {
    const u = user(id); if (!u) return;
    const t = Date.now(); if (t - (lastLogin.get(u.id) || 0) < 10 * 60e3) return; lastLogin.set(u.id, t); if (lastLogin.size > 5000) lastLogin.clear();
    return send(u.email, 'New login to your Studies Hub account', { name: first(u.name), title: 'You logged in', body: [`Your account was logged in on ${when()} from ${device(req)}.`, 'If this was you, you do not need to do anything. If it was not you, change your password right away in Settings → Security.'] }, ['Change password', '/settings/security']);
  }),
  passwordChanged: safe(id => { const u = user(id); if (u) return send(u.email, 'Your Studies Hub password was changed', { name: first(u.name), title: 'Password changed', body: [`The password on your account was changed on ${when()}.`, 'If this was not you, reset it immediately with "Forgot password" on the login page, or contact us.'] }); }),
  // Awaited by the caller, so it goes out before anything is removed.
  deleting: async u => { try { await send(u.email, 'Your Studies Hub account is being deleted', { name: first(u.name), title: 'We are deleting your account', body: ['You asked us to delete your Studies Hub account, and the deletion has started.', 'Your profile, chats, saved items and stories are being removed for good. This cannot be undone.', 'If this was not you, contact us immediately.'] }); } catch (e) { /* never stop the deletion */ } },
  deleted: safe(u => send(u.email, 'Your Studies Hub account has been deleted', { name: first(u.name), title: 'Account deleted', body: ['Your Studies Hub account and all its data have been deleted.', 'Thank you for being part of Studies Hub. You are welcome back any time.'] }, ['Visit Studies Hub', '/'])),
};
