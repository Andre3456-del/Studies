// Admin: are the connections working?
// Every row says in plain words what is wrong and what to do. Two buttons run real tests:
// a notification sent through Google (and the page waits to see whether the phone answered), and a question to the assistant.
module.exports = function register(app, ctx) {
  const { esc, fcm, layout, notice } = ctx;
  const admin = req => req.user && req.user.role === 'admin';
  const ago = t => { if (!t) return 'not seen since the server last restarted'; const s = Math.round((Date.now() - t) / 1000); return s < 60 ? s + ' sec ago' : s < 3600 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' h ago'; };

  app.get('/admin/checks', async (req, res) => {
    if (!admin(req)) return res.status(403).send(notice('Not allowed', 'Only the admin can see this page.', '<p><a class="btn" href="/">Home</a></p>'));
    const f = await fcm.check().catch(e => ({ configured: true, ok: false, error: e.message }));
    const row = (name, ok, detail) => `<div class="card row" style="gap:12px;align-items:center"><span style="font-size:22px">${ok ? '✅' : '❌'}</span><div style="flex:1"><b>${esc(name)}</b><br><span class="mut" style="font-size:13px">${esc(detail)}</span></div></div>`;
    const lk = !!(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
    const phones = fcm.phones(req.user.id);
    const aiOn = !!(process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY || process.env.ANTHROPIC_API_KEY);
    const aiName = process.env.OPENAI_API_KEY ? 'OpenAI' : process.env.GROQ_API_KEY ? 'Groq' : process.env.ANTHROPIC_API_KEY ? 'Claude' : '';
    res.send(layout('Checks', `<p class="mut"><a href="/admin">&larr; Admin</a></p><h1>Connection checks</h1>
${row('Firebase key (notifications and ringing calls)', !!f.ok, f.ok ? 'Google accepted the key for project ' + f.project + '.' : f.error || 'Not set. Add the Railway variable FIREBASE_SERVICE_ACCOUNT.')}
${row('Phones registered for notifications', fcm.count() > 0, fcm.count() + ' phone(s) in total, ' + phones.length + ' on your account' + (phones.length ? ' (' + phones.map(p => p.id + '… last heard ' + ago(p.seen)).join('; ') + ')' : '') + '. A phone registers when someone opens the Android app while logged in.')}
${row('Google sign-in inside the app', ctx.APP_GOOGLE_IDS.length > 0, ctx.APP_GOOGLE_IDS.length ? ctx.APP_GOOGLE_IDS.length + ' Google app ID(s) loaded.' : 'No Google app ID found.')}
${row('Voice and video calls (LiveKit)', lk, lk ? 'The LiveKit settings are all present.' : 'One or more LIVEKIT_ variables are missing.')}
${row('Assistant (Ask AI)', aiOn, aiOn ? aiName + ' key is set.' : 'No key. Add OPENAI_API_KEY in Railway to turn the assistant on.')}
<div class="card"><b>Send a test notification to my phone</b><p class="mut" style="font-size:13px">Sends a real message through Google to the phone(s) on your account, then waits up to 20 seconds to see whether the phone answered. Close the Android app first (swipe it away) so the test is honest.</p><button type="button" id="tst">Send test</button><div id="tout" class="mut" style="white-space:pre-wrap;font-size:14px;margin-top:8px"></div></div>
<div class="card"><b>Test the assistant</b><p class="mut" style="font-size:13px">Asks the assistant one tiny question and shows exactly what came back.</p><button type="button" id="ast">Test assistant</button><div id="aout" class="mut" style="white-space:pre-wrap;font-size:14px;margin-top:8px"></div></div>
<script>
function post(u){return fetch(u,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'}).then(function(r){return r.json()})}
document.getElementById('tst').onclick=function(){
  var o=document.getElementById('tout'),b=this;b.disabled=true;o.textContent='Sending...';
  post('/admin/checks/test').then(function(j){
    var rs=j.results||[];
    var lines=rs.map(function(x){return (x.error?'❌ '+x.error:(x.ok?'✅':'❌')+' Phone '+x.phone+': '+x.message)});
    var sent=rs.filter(function(x){return x.ok}).length;
    if(!sent){o.textContent=lines.join('\\n')||j.error||'No answer.';b.disabled=false;return}
    o.textContent=lines.join('\\n')+'\\nWaiting for the phone to answer...';
    var n=0,t=setInterval(function(){
      n++;
      fetch('/admin/checks/seen?since='+j.sentAt,{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(s){
        if(s.seen&&s.seen.length){clearInterval(t);o.textContent=lines.join('\\n')+'\\n✅ The phone received it and answered. Notifications work.';b.disabled=false}
        else if(n>=10){clearInterval(t);o.textContent=lines.join('\\n')+'\\n⚠️ Google sent it, but the phone did not answer in 20 seconds. Check: the app is installed and was opened once while logged in; notifications are allowed for Studies Hub in the phone settings; battery saver is not stopping the app; the phone has internet.';b.disabled=false}
      }).catch(function(){})
    },2000)
  }).catch(function(){o.textContent='❌ Could not reach the server.';b.disabled=false})
};
document.getElementById('ast').onclick=function(){
  var o=document.getElementById('aout'),b=this;b.disabled=true;o.textContent='Asking...';
  post('/admin/checks/ai').then(function(j){o.textContent=j.ok?'✅ '+j.provider+' ('+j.model+') answered: '+j.reply:'❌ '+(j.provider?j.provider+' ('+j.model+') said: ':'')+(j.error||'No answer.');b.disabled=false}).catch(function(){o.textContent='❌ Could not reach the server.';b.disabled=false})
};
</script>`, req.user));
  });
  app.post('/admin/checks/test', async (req, res) => {
    if (!admin(req)) return res.sendStatus(403);
    try { res.json(await fcm.test(req.user.id)); } catch (e) { res.json({ sentAt: Date.now(), results: [{ error: 'Could not send: ' + e.message }] }); }
  });
  app.get('/admin/checks/seen', (req, res) => {
    if (!admin(req)) return res.sendStatus(403);
    res.json({ seen: fcm.seenSince(req.user.id, Number(req.query.since) || Date.now()) });
  });
};
