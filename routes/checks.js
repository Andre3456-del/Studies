// Admin: are the connections working?
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { esc, fcm, layout, notice } = ctx;
  // ---------- Admin: are the connections working? ----------
  app.get('/admin/checks', async (req, res) => {
    if (!req.user || req.user.role !== 'admin') return res.status(403).send(notice('Not allowed', 'Only the admin can see this page.', '<p><a class="btn" href="/">Home</a></p>'));
    const f = await fcm.check().catch(e => ({ configured: true, ok: false, error: e.message }));
    const row = (name, ok, detail) => `<div class="card row" style="gap:12px;align-items:center"><span style="font-size:22px">${ok ? '✅' : '❌'}</span><div style="flex:1"><b>${esc(name)}</b><br><span class="mut" style="font-size:13px">${esc(detail)}</span></div></div>`;
    const lk = !!(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
    res.send(layout('Checks', `<p class="mut"><a href="/admin">&larr; Admin</a></p><h1>Connection checks</h1>
${row('Firebase key (notifications and ringing calls)', !!f.ok, !f.configured ? 'Not set. Add the Railway variable FIREBASE_SERVICE_ACCOUNT.' : f.ok ? 'Google accepted the key for project ' + f.project + '.' : 'Google refused the key: ' + f.error)}
${row('Phones registered for notifications', fcm.count() > 0, fcm.count() + ' phone(s) in total, ' + fcm.count(req.user.id) + ' on your account. A phone registers when someone opens the Android app while logged in.')}
${row('Google sign-in inside the app', ctx.APP_GOOGLE_IDS.length > 0, ctx.APP_GOOGLE_IDS.length ? ctx.APP_GOOGLE_IDS.length + ' Google app ID(s) loaded.' : 'No Google app ID found.')}
${row('Voice and video calls (LiveKit)', lk, lk ? 'The LiveKit settings are all present.' : 'One or more LIVEKIT_ variables are missing.')}
<div class="card"><b>Send a test notification to my phone</b><p class="mut" style="font-size:13px">Sends a real message through Google to the phone(s) on your account and shows Google's answer. Close the app first to test it properly.</p><button type="button" id="tst">Send test</button><pre id="tout" class="mut" style="white-space:pre-wrap;font-size:13px"></pre></div>
<script>document.getElementById('tst').onclick=function(){var o=document.getElementById('tout');o.textContent='Sending...';fetch('/admin/checks/test',{method:'POST',credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){o.textContent=(j.results||[]).map(function(x){return x.error?x.error:'Phone '+x.phone+': Google answered '+x.status+(x.status===200?' (sent)':x.old?' - old phone (app was removed or reinstalled). Removed from the list, nothing to fix.':' - '+x.answer)}).join('\\n')||j.error||'No answer.'}).catch(function(){o.textContent='No connection.'})}</script>`, req.user));
  });
  app.post('/admin/checks/test', async (req, res) => {
    if (!req.user || req.user.role !== 'admin') return res.sendStatus(403);
    try { res.json({ results: await fcm.test(req.user.id) }); } catch (e) { res.json({ results: [{ error: 'Could not send: ' + e.message }] }); }
  });
};
