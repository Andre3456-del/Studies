// Email preferences (unsubscribe link page)
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { crypto, db, esc, layout, mailSig } = ctx;
  function mailPrefPage(req, u, note) {
    const on = u.email_notify !== 0;
    const t = mailSig(u.id);
    return layout('Email preferences', `<div style="max-width:460px;margin:40px auto;padding:0 16px;text-align:center"><div class="card" style="padding:28px 22px">
<h2 style="margin:0 0 10px">${on ? 'You are subscribed' : 'You are unsubscribed'}</h2>
${note ? `<p style="margin:0 0 12px;color:#22c55e;font-weight:600">${esc(note)}</p>` : ''}
<p style="opacity:.8;margin:0 0 20px">${on ? 'You get Studies Hub emails about uploads, news and other updates.' : 'You will not get Studies Hub emails about uploads, news and other updates. Important emails, like verification codes and site notices, still reach you.'}</p>
<form method="post" action="/email/preferences"><input type="hidden" name="u" value="${u.id}"><input type="hidden" name="t" value="${t}"><input type="hidden" name="do" value="${on ? 'off' : 'on'}">
<button type="submit" style="padding:12px 26px;font-size:16px;font-weight:700;border:0;border-radius:12px;background:#5bc8ff;color:#04101f;cursor:pointer">${on ? 'Unsubscribe' : 'Subscribe again'}</button></form></div></div>`, req.user);
  }
  function mailPrefUser(id, t) {
    id = Number(id);
    if (!id || String(t || '').length !== 32 || !crypto.timingSafeEqual(Buffer.from(String(t)), Buffer.from(mailSig(id)))) return null;
    return db.prepare('SELECT id,email_notify FROM users WHERE id=?').get(id) || null;
  }
  app.get('/email/preferences', (req, res) => {
    const u = mailPrefUser(req.query.u, req.query.t);
    if (!u) return res.status(400).send(layout('Email preferences', '<div style="max-width:460px;margin:40px auto;padding:0 16px;text-align:center"><h2>This link is not valid</h2><p style="opacity:.8">Please use the link in the latest email we sent you.</p></div>', req.user));
    res.send(mailPrefPage(req, u));
  });
  app.post('/email/preferences', (req, res) => {
    const u = mailPrefUser(req.body.u, req.body.t);
    if (!u) return res.sendStatus(400);
    const on = req.body.do === 'on';
    db.prepare('UPDATE users SET email_notify=? WHERE id=?').run(on ? 1 : 0, u.id);
    res.send(mailPrefPage(req, { id: u.id, email_notify: on ? 1 : 0 }, on ? 'You will get these emails again.' : 'Done. You will not get these emails any more.'));
  });
};
