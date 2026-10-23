'use strict';
const { AccessToken } = require('livekit-server-sdk');

const RING_MS = 45000; // how long a call rings before it counts as missed

function registerCalling(app, { db, crypto, logCall }) {
  db.exec("CREATE TABLE IF NOT EXISTS call_sessions(id TEXT PRIMARY KEY,room_name TEXT UNIQUE NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('audio','video')),group_id INTEGER,created_by INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'active',created_at TEXT DEFAULT CURRENT_TIMESTAMP,ended_at TEXT); CREATE TABLE IF NOT EXISTS call_participants(call_id TEXT NOT NULL,user_id INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'invited',invited_by INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(call_id,user_id)); CREATE INDEX IF NOT EXISTS call_participants_user_status ON call_participants(user_id,status);");
  const cpCols = db.prepare('PRAGMA table_info(call_participants)').all().map(c => c.name);
  if (!cpCols.includes('joined_at')) db.exec('ALTER TABLE call_participants ADD COLUMN joined_at TEXT');
  const isMember = (g,u) => !!db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(g,u);
  const friends = (a,b) => !!db.prepare("SELECT 1 FROM friendships WHERE status='friends' AND ((requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?))").get(a,b,b,a);
  const callById = id => db.prepare('SELECT * FROM call_sessions WHERE id=?').get(id);
  const participant = (id,u) => db.prepare('SELECT * FROM call_participants WHERE call_id=? AND user_id=?').get(id,u);
  const people = id => db.prepare('SELECT cp.user_id,cp.status,u.name FROM call_participants cp JOIN users u ON u.id=cp.user_id WHERE cp.call_id=? ORDER BY u.name').all(id);
  const ready = () => !!(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
  // One place that ends a call: marks everybody, and for a 1-to-1 call writes the "Video call - 47 sec / Missed / Declined" line into their chat.
  function finishCall(c, reason) {
    const cur = callById(c.id); if (!cur || cur.status !== 'active') return;
    const ps = db.prepare('SELECT * FROM call_participants WHERE call_id=?').all(cur.id);
    db.prepare("UPDATE call_sessions SET status='ended',ended_at=CURRENT_TIMESTAMP WHERE id=? AND status='active'").run(cur.id);
    const callee = ps.find(p => p.user_id !== cur.created_by);
    if (!cur.group_id && ps.length === 2 && callee && logCall) {
      let state = reason === 'declined' ? 'declined' : 'missed', secs = 0;
      if (reason === 'ended' && callee.joined_at) { state = 'ended'; secs = Math.max(1, Math.round((Date.now() - Date.parse(callee.joined_at.replace(' ', 'T') + 'Z')) / 1000)); }
      try { logCall(cur.created_by, callee.user_id, cur.kind, state, secs); } catch (e) { console.error('Call log failed:', e.message); }
    }
    db.prepare("UPDATE call_participants SET status=CASE WHEN status='invited' THEN ? ELSE 'left' END,updated_at=CURRENT_TIMESTAMP WHERE call_id=? AND status IN ('invited','joined')").run(reason === 'declined' ? 'declined' : 'missed', cur.id);
  }
  // Every few seconds: invitations that rang too long become "missed" and end a 1-to-1 call; very old calls are closed.
  function sweep() {
    try {
      const stale = db.prepare("SELECT cp.call_id,cp.user_id FROM call_participants cp JOIN call_sessions c ON c.id=cp.call_id WHERE cp.status='invited' AND c.status='active' AND (strftime('%s','now')-strftime('%s',COALESCE(cp.updated_at,cp.created_at)))*1000>?").all(RING_MS);
      for (const r of stale) {
        db.prepare("UPDATE call_participants SET status='missed',updated_at=CURRENT_TIMESTAMP WHERE call_id=? AND user_id=? AND status='invited'").run(r.call_id, r.user_id);
        const c = callById(r.call_id); if (c && !c.group_id) finishCall(c, 'missed');
      }
      for (const c of db.prepare("SELECT * FROM call_sessions WHERE status='active' AND created_at < datetime('now','-6 hours')").all()) finishCall(c, 'ended');
    } catch (e) { console.error('Call sweep failed:', e.message); }
  }
  setInterval(sweep, 5000).unref();
  function eligible(call, uid) {
    let rows;
    if (call.group_id) rows = db.prepare('SELECT u.id,u.name FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.group_id=? AND u.id<>? ORDER BY u.name').all(call.group_id,uid);
    else rows = db.prepare("SELECT u.id,u.name FROM friendships f JOIN users u ON u.id=CASE WHEN f.requester_id=? THEN f.addressee_id ELSE f.requester_id END WHERE f.status='friends' AND (f.requester_id=? OR f.addressee_id=?) AND u.id<>? ORDER BY u.name").all(uid,uid,uid,uid);
    return rows.filter(p => { const x=participant(call.id,p.id); return !x || x.status==='left' || x.status==='declined'; });
  }
  function mayInvite(call, uid, target) {
    if (uid===target || !db.prepare('SELECT id FROM users WHERE id=?').get(target)) return false;
    return call.group_id ? isMember(call.group_id,uid) && isMember(call.group_id,target) : friends(uid,target);
  }
  const callTitle = (c, uid) => {
    if (c.group_id) return (db.prepare('SELECT name FROM groups WHERE id=?').get(c.group_id) || {}).name || 'Group call';
    const o = db.prepare('SELECT u.name FROM call_participants cp JOIN users u ON u.id=cp.user_id WHERE cp.call_id=? AND cp.user_id<>?').get(c.id, uid);
    return o ? o.name : 'Call';
  };
  app.post('/api/calls/start',(req,res)=>{
    if(!req.user)return res.sendStatus(401);
    const uid=req.user.id, kind=req.body&&req.body.kind==='video'?'video':'audio', gid=Number(req.body&&req.body.group_id)||null, peer=Number(req.body&&req.body.peer_id)||null;
    if(gid ? !isMember(gid,uid) : (!peer || peer===uid || !friends(uid,peer))) return res.status(403).json({error:'You must be a group member or friend to start this call.'});
    const ids=Array.isArray(req.body&&req.body.invited_user_ids)?[...new Set(req.body.invited_user_ids.map(Number).filter(n=>Number.isSafeInteger(n)&&n>0&&n!==uid))]:[];
    if(!gid&&peer)ids.push(peer);
    const id=crypto.randomUUID(), room='studieshub-'+id;
    db.prepare('INSERT INTO call_sessions(id,room_name,kind,group_id,created_by,status) VALUES(?,?,?,?,?,?)').run(id,room,kind,gid,uid,'active');
    db.prepare("INSERT INTO call_participants(call_id,user_id,status,invited_by) VALUES(?,?,?,?)").run(id,uid,'joined',uid);
    const add=db.prepare("INSERT OR IGNORE INTO call_participants(call_id,user_id,status,invited_by) VALUES(?,?,?,?)");
    for(const target of ids)if(mayInvite({id,group_id:gid},uid,target))add.run(id,target,'invited',uid);
    res.status(201).json({id,kind,url:'/call/'+encodeURIComponent(id)});
  });
  app.get('/api/calls/incoming',(req,res)=>{
    if(!req.user)return res.sendStatus(401);
    res.json({calls:db.prepare("SELECT c.id,c.kind,c.created_at,u.name caller_name,g.name group_name FROM call_participants cp JOIN call_sessions c ON c.id=cp.call_id JOIN users u ON u.id=c.created_by LEFT JOIN groups g ON g.id=c.group_id WHERE cp.user_id=? AND cp.status='invited' AND c.status='active' AND (strftime('%s','now')-strftime('%s',COALESCE(cp.updated_at,cp.created_at)))*1000<=? ORDER BY c.created_at DESC LIMIT 5").all(req.user.id,RING_MS)});
  });
  app.get('/api/calls/eligible',(req,res)=>{
    if(!req.user)return res.sendStatus(401);
    const id=String(req.query.call_id||''), call=id?callById(id):null;
    if(call){if(call.status!=='active'||!participant(id,req.user.id))return res.status(404).json({error:'Call not found.'});return res.json({people:eligible(call,req.user.id)});}
    const gid=Number(req.query.group_id)||null;
    if(!gid||!isMember(gid,req.user.id))return res.status(400).json({error:'Choose a valid group.'});
    res.json({people:db.prepare('SELECT u.id,u.name FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.group_id=? AND u.id<>? ORDER BY u.name').all(gid,req.user.id)});
  });
  app.get('/api/calls/:id',(req,res)=>{
    if(!req.user)return res.sendStatus(401);const c=callById(String(req.params.id)),p=c&&participant(c.id,req.user.id);
    if(!c||!p)return res.status(404).json({error:'Call not found.'});
    res.json({id:c.id,kind:c.kind,group_id:c.group_id,created_by:c.created_by,status:c.status,people:people(c.id),me:p.status,title:callTitle(c,req.user.id),livekit_configured:ready()});
  });
  app.post('/api/calls/:id/accept',(req,res)=>{
    if(!req.user)return res.sendStatus(401);const c=callById(String(req.params.id)),p=c&&participant(c.id,req.user.id);
    if(!c||c.status!=='active'||!p||!['invited','joined'].includes(p.status))return res.status(404).json({error:'This call invitation is no longer available.'});
    db.prepare("UPDATE call_participants SET status='joined',joined_at=COALESCE(joined_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE call_id=? AND user_id=?").run(c.id,req.user.id);res.json({ok:true,url:'/call/'+encodeURIComponent(c.id)});
  });
  app.post('/api/calls/:id/decline',(req,res)=>{
    if(!req.user)return res.sendStatus(401);const c=callById(String(req.params.id));
    if(!c||!participant(c.id,req.user.id))return res.status(404).json({error:'Call not found.'});
    db.prepare("UPDATE call_participants SET status='declined',updated_at=CURRENT_TIMESTAMP WHERE call_id=? AND user_id=? AND status='invited'").run(c.id,req.user.id);if(!c.group_id)finishCall(c,'declined');res.json({ok:true});
  });
  app.post('/api/calls/:id/invite',(req,res)=>{
    if(!req.user)return res.sendStatus(401);const c=callById(String(req.params.id));
    if(!c||c.status!=='active'||!participant(c.id,req.user.id))return res.status(404).json({error:'Call not found.'});
    const ids=Array.isArray(req.body&&req.body.user_ids)?[...new Set(req.body.user_ids.map(Number).filter(n=>Number.isSafeInteger(n)&&n>0))]:[];
    if(!ids.length||ids.length>30)return res.status(400).json({error:'Choose 1–30 people.'});
    const add=db.prepare("INSERT INTO call_participants(call_id,user_id,status,invited_by) VALUES(?,?,?,?) ON CONFLICT(call_id,user_id) DO UPDATE SET status='invited',invited_by=excluded.invited_by,updated_at=CURRENT_TIMESTAMP WHERE call_participants.status IN ('declined','left')");
    let n=0;for(const target of ids)if(mayInvite(c,req.user.id,target)){add.run(c.id,target,'invited',req.user.id);n++;}
    if(!n)return res.status(400).json({error:'No eligible people selected.'});res.json({ok:true,invited:n});
  });
  app.post('/api/calls/:id/token',async(req,res)=>{
    if(!req.user)return res.sendStatus(401);const c=callById(String(req.params.id)),p=c&&participant(c.id,req.user.id);
    if(!c||c.status!=='active'||!p||!['invited','joined'].includes(p.status))return res.status(404).json({error:'This call is no longer available.'});
    if(!ready())return res.status(503).json({error:'Calling needs LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET in Railway Variables.'});
    try{const t=new AccessToken(process.env.LIVEKIT_API_KEY,process.env.LIVEKIT_API_SECRET,{identity:'user-'+req.user.id,name:String(req.user.name||'StudiesHub member').slice(0,80),ttl:'1h'});t.addGrant({roomJoin:true,room:c.room_name,canPublish:true,canSubscribe:true,canPublishData:true});res.json({serverUrl:process.env.LIVEKIT_URL,token:await t.toJwt(),kind:c.kind});}
    catch(e){console.error('LiveKit token generation failed:',e.message);res.status(503).json({error:'Could not prepare the call. Check LiveKit settings.'});}
  });
  app.post('/api/calls/:id/leave',(req,res)=>{
    if(!req.user)return res.sendStatus(401);const c=callById(String(req.params.id));
    if(!c||!participant(c.id,req.user.id))return res.status(404).json({error:'Call not found.'});
    db.prepare("UPDATE call_participants SET status='left',updated_at=CURRENT_TIMESTAMP WHERE call_id=? AND user_id=?").run(c.id,req.user.id);
    if(!c.group_id||!db.prepare("SELECT 1 FROM call_participants WHERE call_id=? AND status='joined'").get(c.id))finishCall(c,'ended');res.json({ok:true});
  });
  app.post('/api/calls/:id/end',(req,res)=>{
    if(!req.user)return res.sendStatus(401);const c=callById(String(req.params.id));
    if(!c||c.created_by!==req.user.id)return res.status(403).json({error:'Only the call creator can end it for everyone.'});
    finishCall(c,'ended');res.json({ok:true});
  });
  app.get('/call/:id',(req,res)=>{
    if(!req.user)return res.redirect('/login?next='+encodeURIComponent(req.originalUrl));
    const c=callById(String(req.params.id));if(!c||c.status!=='active'||!participant(c.id,req.user.id))return res.status(404).send('This call is no longer available.');
    const video=c.kind==='video', isHost=c.created_by===req.user.id, id=JSON.stringify(c.id), kind=JSON.stringify(c.kind);
    const others=people(c.id).filter(x=>x.user_id!==req.user.id);
    res.type('html').send(callPage({id:c.id,kind:c.kind,host:isHost,me:req.user.id,group:c.group_id||0,peer:c.group_id?0:(others[0]&&others[0].user_id)||0,invited:others.map(x=>x.user_id),title:callTitle(c,req.user.id)}));
  });
}

// ---------- the call screen (runs in the browser; kept as a real function so node can syntax-check it) ----------
function callScreen() {
  const C = window.__CALL, $ = x => document.getElementById(x);
  let room, lp, sharing = false, micOn = true, camOn = C.kind === 'video', startedAt = 0, everConnected = false, facing = 'user', ended = false, status = {}, toastT;
  const api = (url, body) => fetch(url, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
    .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw Error(j.error || 'Request failed'); return j; });
  const toast = t => { const e = $('toast'); e.textContent = t; e.style.opacity = '1'; clearTimeout(toastT); toastT = setTimeout(() => { e.style.opacity = '0'; }, 2200); };
  const pad = n => String(n).padStart(2, '0');
  function tickTimer() { if (!startedAt || ended) return; const s = Math.floor((Date.now() - startedAt) / 1000); $('sub').textContent = (s >= 3600 ? Math.floor(s / 3600) + ':' : '') + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60); }
  function setSub(t) { if (!startedAt) $('sub').textContent = t; }
  function tile(id, name) {
    let e = $('r-' + id);
    if (!e) {
      e = document.createElement('div'); e.id = 'r-' + id; e.className = 'rtile';
      const av = document.createElement('div'); av.className = 'avatar'; av.textContent = (name || '?').trim().charAt(0).toUpperCase();
      const photo = document.createElement('img'); photo.alt = ''; photo.src = '/avatar/' + String(id).replace('user-', '').replace('-screen', ''); photo.onload = () => { av.textContent = ''; av.appendChild(photo); }; photo.onerror = () => photo.remove();
      const nm = document.createElement('div'); nm.className = 'rname'; nm.textContent = name || 'Participant';
      const mu = document.createElement('span'); mu.className = 'rmute'; mu.textContent = '\u{1F507}'; mu.hidden = true; nm.appendChild(mu);
      e.append(av, nm); $('remote').appendChild(e); layoutTiles();
    }
    return e;
  }
  function layoutTiles() { const n = $('remote').children.length; $('remote').setAttribute('data-n', Math.min(n, 4)); }
  function showFailed(why) {
    if (ended) return; ended = true; if (room) room.disconnect();
    $('whyText').textContent = why || ''; $('failed').hidden = false;
  }
  function finish(msg) {
    if (ended) return; ended = true; if (room) room.disconnect();
    if (!everConnected) { ended = false; showFailed(msg || 'Call ended'); return; }
    $('sub').textContent = 'Call ended'; setTimeout(() => { location.href = '/chat'; }, 1200);
  }
  function whyFromPeople(people) {
    const others = people.filter(p => p.user_id !== C.me);
    if (others.some(p => p.status === 'declined')) return 'Declined';
    if (others.some(p => p.status === 'missed')) return 'No answer';
    return 'Call ended';
  }
  function refresh() {
    if (ended) return;
    api('/api/calls/' + C.id).then(j => {
      status = j;
      if (j.status !== 'active') return finish(whyFromPeople(j.people));
      const others = j.people.filter(p => p.user_id !== C.me), joined = others.filter(p => p.status === 'joined').length;
      if (!room || room.remoteParticipants.size === 0) setSub(others.some(p => p.status === 'invited') ? 'Ringing…' : (joined ? 'Connecting…' : 'Calling…'));
      $('peerName').textContent = j.title || 'Call';
    }).catch(e => { if (!ended) { if (/not found|no longer/i.test(e.message)) finish('Call ended'); } });
  }
  const isScreen = pub => !!pub && pub.source === 'screen_share';
  function attach(track, p, pub) {
    if (track.kind === 'audio') { const a = track.attach(); a.autoplay = true; a.style.display = 'none'; a.setAttribute('data-aid', track.sid); document.body.appendChild(a); return; }
    const screen = isScreen(pub), key = p.identity + (screen ? '-screen' : ''), box = tile(key, (p.name || p.identity) + (screen ? ' (screen)' : '')), old = box.querySelector('video'); if (old) old.remove();
    const v = track.attach(); v.autoplay = true; v.playsInline = true; box.insertBefore(v, box.firstChild); box.classList.add('hasvideo'); if (screen) { box.classList.add('screen'); toast((p.name || 'Someone') + ' is sharing their screen'); }
  }
  function detach(track, p, pub) {
    track.detach().forEach(e => e.remove());
    if (track.kind === 'video' && p) { if (isScreen(pub)) { const sb = $('r-' + p.identity + '-screen'); if (sb) { sb.remove(); layoutTiles(); } } else { const b = $('r-' + p.identity); if (b) b.classList.remove('hasvideo'); } }
  }
  function setRemoteMute(p, muted, announce) {
    const b = $('r-' + p.identity); if (b) b.querySelector('.rmute').hidden = !muted;
    if (!C.group) $('peerMute').hidden = !muted;
    if (announce) toast((p.name || 'Someone') + (muted ? ' is muted' : ' unmuted'));
  }
  function updateButtons() {
    $('micBtn').classList.toggle('off', !micOn); $('micBtn').title = micOn ? 'Mute' : 'Unmute';
    $('camBtn').classList.toggle('off', !camOn); $('camBtn').title = camOn ? 'Turn camera off' : 'Turn camera on';
    $('selfWin').hidden = C.kind !== 'video' || !camOn; $('selfWin').classList.toggle('mirror', facing === 'user');
    $('selfMute').hidden = micOn;
    $('shareBar').hidden = !sharing; $('shareBtn').textContent = sharing ? 'Stop sharing your screen' : 'Share your screen';
  }
  async function start() {
    try {
      if (!window.LivekitClient) throw Error('Calling client did not load. Check your connection.');
      const c = await api('/api/calls/' + C.id + '/token', {});
      const L = window.LivekitClient;
      room = new L.Room({
        adaptiveStream: true, dynacast: true,
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, voiceIsolation: true, channelCount: 1, sampleRate: 48000 },
        publishDefaults: { dtx: true, red: true, forceStereo: false, audioPreset: { maxBitrate: 32000 } }
      });
      lp = room.localParticipant;
      room.on(L.RoomEvent.TrackSubscribed, (t, pub, p) => { attach(t, p, pub); if (pub && pub.kind === 'audio') setRemoteMute(p, !!pub.isMuted, false); });
      room.on(L.RoomEvent.TrackUnsubscribed, (t, pub, p) => detach(t, p, pub));
      room.on(L.RoomEvent.LocalTrackUnpublished, pub => { if (isScreen(pub)) { sharing = false; updateButtons(); } });
      room.on(L.RoomEvent.TrackMuted, (pub, p) => { if (p !== lp && pub.kind === 'audio') setRemoteMute(p, true, true); });
      room.on(L.RoomEvent.TrackUnmuted, (pub, p) => { if (p !== lp && pub.kind === 'audio') setRemoteMute(p, false, false); });
      room.on(L.RoomEvent.ParticipantConnected, p => { tile(p.identity, p.name || p.identity); if (!startedAt) { startedAt = Date.now(); everConnected = true; tickTimer(); } });
      room.on(L.RoomEvent.ParticipantDisconnected, p => {
        const b = $('r-' + p.identity), sb = $('r-' + p.identity + '-screen'); if (b) b.remove(); if (sb) sb.remove(); layoutTiles();
        if (!C.group && room.remoteParticipants.size === 0) { api('/api/calls/' + C.id + '/leave', {}).catch(() => {}); finish('Call ended'); }
      });
      room.on(L.RoomEvent.Reconnecting, () => { $('sub').textContent = 'Reconnecting…'; });
      room.on(L.RoomEvent.Reconnected, () => { tickTimer(); });
      room.on(L.RoomEvent.AudioPlaybackStatusChanged, () => { if (!room.canPlaybackAudio) toast('Tap the screen to turn on sound'); });
      room.on(L.RoomEvent.Disconnected, () => { if (!ended) finish('Disconnected from the call'); });
      await room.connect(c.serverUrl, c.token);
      const unlock = () => { if (room) room.startAudio().catch(() => {}); };
      unlock(); document.addEventListener('click', unlock); document.addEventListener('touchend', unlock);
      await lp.setMicrophoneEnabled(true);
      if (C.kind === 'video') {
        await lp.setCameraEnabled(true);
        const pub = lp.getTrackPublication(L.Track.Source.Camera);
        if (pub && pub.videoTrack) { pub.videoTrack.attach($('selfVid')); }
      }
      room.remoteParticipants.forEach(p => { tile(p.identity, p.name || p.identity); p.trackPublications.forEach(pub => { if (pub.track) attach(pub.track, p, pub); }); if (!startedAt) { startedAt = Date.now(); everConnected = true; } });
      updateButtons(); refresh();
      setInterval(refresh, 2000); setInterval(tickTimer, 1000);
      try { if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {}); } catch (e) { /* optional */ }
    } catch (e) { showFailed(e.message || 'Could not join the call.'); }
  }
  async function leave() { try { await api('/api/calls/' + C.id + '/leave', {}); } catch (e) { /* already gone */ } ended = true; if (room) room.disconnect(); location.href = '/chat'; }
  $('endBtn').onclick = leave;
  $('cancelBtn').onclick = () => { api('/api/calls/' + C.id + '/leave', {}).catch(() => {}); location.href = '/chat'; };
  $('againBtn').onclick = async () => {
    try { const body = { kind: C.kind }; if (C.group) { body.group_id = C.group; body.invited_user_ids = C.invited; } else body.peer_id = C.peer; const j = await api('/api/calls/start', body); location.href = j.url; }
    catch (e) { $('whyText').textContent = e.message; }
  };
  $('micBtn').onclick = async () => { if (!lp) return; micOn = !micOn; await lp.setMicrophoneEnabled(micOn); updateButtons(); if (!micOn) toast("You're muted"); };
  $('camBtn').onclick = async () => {
    if (!lp) return; camOn = !camOn; await lp.setCameraEnabled(camOn);
    if (camOn) { const pub = lp.getTrackPublication(window.LivekitClient.Track.Source.Camera); if (pub && pub.videoTrack) pub.videoTrack.attach($('selfVid')); }
    updateButtons();
  };
  $('flipBtn').onclick = async () => {
    if (!lp) return; const pub = lp.getTrackPublication(window.LivekitClient.Track.Source.Camera), t = pub && pub.videoTrack; if (!t) return;
    facing = facing === 'user' ? 'environment' : 'user';
    try { await t.restartTrack({ facingMode: facing }); }
    catch (e) {
      try { const ds = await window.LivekitClient.Room.getLocalDevices('videoinput'); if (ds.length > 1) { const cur = t.mediaStreamTrack.getSettings().deviceId, i = ds.findIndex(d => d.deviceId === cur); await room.switchActiveDevice('videoinput', ds[(i + 1) % ds.length].deviceId); } else toast('No other camera found'); }
      catch (e2) { toast('Could not switch camera'); }
    }
    updateButtons();
  };
  $('moreBtn').onclick = e => { e.stopPropagation(); $('moreMenu').hidden = !$('moreMenu').hidden; };
  document.addEventListener('click', e => { if (!$('moreMenu').contains(e.target)) $('moreMenu').hidden = true; });
  async function fillDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try { const d = await navigator.mediaDevices.enumerateDevices(); [['audioinput', 'audioDevice'], ['videoinput', 'videoDevice']].forEach(([k, id]) => { const s = $(id); s.length = 1; d.filter(x => x.kind === k).forEach(x => { const o = document.createElement('option'); o.value = x.deviceId; o.textContent = x.label || 'Device'; s.appendChild(o); }); }); } catch (e) { /* optional */ }
  }
  $('moreBtn').addEventListener('click', fillDevices);
  $('audioDevice').onchange = e => room && e.target.value && room.switchActiveDevice('audioinput', e.target.value).catch(() => {});
  $('videoDevice').onchange = e => room && e.target.value && room.switchActiveDevice('videoinput', e.target.value).catch(() => {});
  async function toggleShare() {
    if (!lp) return; $('moreMenu').hidden = true;
    try { sharing = !sharing; await lp.setScreenShareEnabled(sharing); if (sharing) toast('You are sharing your screen'); }
    catch (e) { sharing = false; toast(e && e.name === 'NotAllowedError' ? 'Screen sharing was cancelled' : 'Could not share your screen'); }
    updateButtons();
  }
  $('shareBtn').onclick = toggleShare; $('stopShare').onclick = toggleShare;
  if (!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)) $('shareBtn').hidden = true; // phones' browsers cannot share a screen
  $('endAllBtn').onclick = async () => { if (!confirm('End this call for everyone?')) return; try { await api('/api/calls/' + C.id + '/end', {}); } catch (e) { toast(e.message); } ended = true; if (room) room.disconnect(); location.href = '/chat'; };
  async function openInvite() {
    try {
      const j = await api('/api/calls/eligible?call_id=' + encodeURIComponent(C.id)), box = $('choices'); box.textContent = '';
      if (!j.people.length) box.textContent = 'No one else to add.';
      j.people.forEach(p => { const l = document.createElement('label'); l.className = 'pick'; const c = document.createElement('input'); c.type = 'checkbox'; c.value = p.id; const n = document.createElement('span'); n.textContent = p.name; l.append(c, n); box.appendChild(l); });
      $('inviteBox').hidden = false;
    } catch (e) { toast(e.message); }
  }
  $('addBtn').onclick = openInvite; $('inviteMenu').onclick = () => { $('moreMenu').hidden = true; openInvite(); };
  $('cancelInvites').onclick = () => { $('inviteBox').hidden = true; };
  $('sendInvites').onclick = async () => {
    const ids = Array.from($('choices').querySelectorAll('input:checked')).map(x => Number(x.value)); if (!ids.length) return;
    try { const j = await api('/api/calls/' + C.id + '/invite', { user_ids: ids }); toast('Added ' + j.invited + ' to the call'); $('inviteBox').hidden = true; refresh(); } catch (e) { toast(e.message); }
  };
  window.addEventListener('beforeunload', () => { if (room && !ended) room.disconnect(); });
  $('peerName').textContent = C.title; $('sub').textContent = 'Connecting…'; updateButtons();
  start();
}
const callCss = '*{box-sizing:border-box}html,body{margin:0;height:100%;background:#0b141a;color:#e9edef;font:16px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}'
  + '#stage{position:fixed;left:0;top:0;right:0;bottom:0;display:flex;flex-direction:column}'
  + '.top{position:absolute;left:0;right:0;top:0;z-index:5;display:flex;align-items:center;gap:10px;padding:calc(12px + env(safe-area-inset-top,0px)) 14px 28px;background:linear-gradient(#000a,#0000)}'
  + '.who{flex:1;text-align:center}.who b{display:block;font-size:20px}.who span{font-size:14px;opacity:.85}'
  + '.ibtn{width:46px;height:46px;border-radius:50%;border:0;background:#ffffff1f;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}.ibtn:hover{background:#ffffff33}.ibtn.off{background:#fff;color:#111}.ibtn.red{background:#e53935;color:#fff}'
  + '#remote{flex:1;display:grid;grid-template-columns:1fr;gap:2px;width:100%}#remote[data-n="2"]{grid-template-rows:1fr 1fr}#remote[data-n="3"],#remote[data-n="4"]{grid-template-columns:1fr 1fr}'
  + '.rtile{position:relative;display:flex;align-items:center;justify-content:center;background:#111b21;overflow:hidden;min-height:0}.rtile video{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;background:#000}'
  + '.avatar{width:min(34vw,150px);height:min(34vw,150px);border-radius:50%;background:#2a3942;display:flex;align-items:center;justify-content:center;font-size:min(14vw,64px);color:#cfd8dc}.hasvideo .avatar{display:none}'
  + '.rname{display:none;position:absolute;left:12px;bottom:110px;font-size:14px;background:#0007;padding:3px 10px;border-radius:99px}.rmute{margin-left:6px}'
  + '#remote:not([data-n="1"]) .rname{display:block}.avatar img{width:100%;height:100%;border-radius:50%;object-fit:cover}'
  + '.rtile.screen video{object-fit:contain}#shareBar{position:absolute;left:50%;transform:translateX(-50%);top:calc(84px + env(safe-area-inset-top,0px));z-index:9;display:flex;align-items:center;gap:12px;background:#00a884;color:#fff;padding:6px 8px 6px 16px;border-radius:99px;font-size:14px}#shareBar button{background:#0003;border:0;color:#fff;border-radius:99px;padding:6px 14px;font:inherit;cursor:pointer}'
  + '.selfwin{position:absolute;right:12px;top:calc(88px + env(safe-area-inset-top,0px));z-index:6;width:min(28vw,120px);aspect-ratio:3/4;border-radius:14px;overflow:hidden;background:#000;box-shadow:0 4px 16px #0008;border:1px solid #ffffff33}'
  + '.selfwin video{width:100%;height:100%;object-fit:cover}.selfwin.mirror video{transform:scaleX(-1)}.selfwin .ibtn{position:absolute;right:4px;bottom:4px;width:32px;height:32px;background:#0009}#selfMute{position:absolute;left:6px;top:6px;font-size:14px}'
  + '.pill{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(22px + env(safe-area-inset-bottom,0px));z-index:7;display:flex;gap:12px;padding:10px 14px;background:#1f2c34f2;border-radius:99px;box-shadow:0 6px 24px #0009}'
  + '#toast{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(110px + env(safe-area-inset-bottom,0px));z-index:9;background:#000b;color:#fff;padding:8px 16px;border-radius:99px;font-size:14px;opacity:0;transition:opacity .25s;pointer-events:none;white-space:nowrap}'
  + '#moreMenu{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(100px + env(safe-area-inset-bottom,0px));z-index:8;width:min(320px,92vw);background:#1f2c34;border-radius:16px;padding:10px;box-shadow:0 8px 30px #000a}'
  + '#moreMenu button.row{display:block;width:100%;text-align:left;background:none;border:0;color:#fff;padding:12px;border-radius:10px;font:inherit;cursor:pointer}#moreMenu button.row:hover{background:#ffffff14}#moreMenu label{display:block;font-size:13px;opacity:.8;margin:8px 4px 0}#moreMenu select{width:100%;padding:9px;border-radius:10px;border:1px solid #ffffff33;background:#111b21;color:#fff;font:inherit;margin-top:4px}'
  + '#failed,#inviteBox{position:absolute;left:0;top:0;right:0;bottom:0;z-index:20;background:#0b141aee;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center}[hidden]{display:none!important}'
  + '#failed h2{margin:0;font-size:24px}#failed p{margin:0;opacity:.8}.btnrow{display:flex;gap:12px;margin-top:10px}.tbtn{padding:12px 26px;border-radius:99px;border:1px solid #ffffff44;background:#1f2c34;color:#fff;font:inherit;cursor:pointer}.tbtn.go{background:#00a884;border-color:#00a884}'
  + '#inviteBox .card{background:#1f2c34;border-radius:16px;padding:16px;width:min(420px,100%);max-height:70vh;overflow:auto;text-align:left}label.pick{display:flex;gap:12px;padding:10px 4px;align-items:center}label.pick input{width:auto}';
const ICON = {
  mic: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  cam: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="M15.5 10.5l6-3.5v10l-6-3.5z"/></svg>',
  more: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  end: '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M12 9c-3.2 0-6.2 1-8.6 2.8a1.5 1.5 0 0 0-.2 2.2l1.4 1.5a1.5 1.5 0 0 0 2 .1l2-1.5a1.5 1.5 0 0 0 .6-1.3V12a11 11 0 0 1 6.8 0v.8a1.5 1.5 0 0 0 .6 1.3l2 1.5a1.5 1.5 0 0 0 2-.1l1.4-1.5a1.5 1.5 0 0 0-.2-2.2C18.200 10 15.200 9 12 9z"/></svg>',
  add: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="8" r="4"/><path d="M2.500 20a7.500 7.500 0 0 1 15 0M19 8v6M16 11h6"/></svg>',
  flip: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15.500-6.200L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.500 6.200L3 16M3 21v-5h5"/></svg>'
};
function callPage(data) {
  const video = data.kind === 'video';
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0b141a"><title>StudiesHub call</title><style>' + callCss + '</style></head><body><div id="stage">'
    + '<div class="top"><button type="button" class="ibtn" id="addBtn" title="Add people">' + ICON.add + '</button><div class="who"><b><span id="peerName"></span><span id="peerMute" hidden> 🔇</span></b><span id="sub">Connecting…</span></div><span style="width:46px"></span></div>'
    + '<div id="remote" data-n="0"></div>'
    + (video ? '<div id="selfWin" class="selfwin mirror"><video id="selfVid" autoplay playsinline muted></video><span id="selfMute" hidden>🔇</span><button type="button" class="ibtn" id="flipBtn" title="Flip camera">' + ICON.flip + '</button></div>' : '<div id="selfWin" hidden><video id="selfVid" muted></video><span id="selfMute" hidden></span><button type="button" id="flipBtn" hidden></button></div>')
    + '<div id="toast"></div>'
    + '<div id="shareBar" hidden><span>You’re sharing your screen</span><button type="button" id="stopShare">Stop</button></div>'
    + '<div id="moreMenu" hidden><button type="button" class="row" id="inviteMenu">Add people to the call</button><button type="button" class="row" id="shareBtn">Share your screen</button>' + (data.host && data.group ? '<button type="button" class="row" id="endAllBtn">End call for everyone</button>' : '<button type="button" class="row" id="endAllBtn" hidden>End call for everyone</button>')
    + '<label>Microphone<select id="audioDevice"><option value="">Default</option></select></label>' + (video ? '<label>Camera<select id="videoDevice"><option value="">Default</option></select></label>' : '<select id="videoDevice" hidden></select>') + '</div>'
    + '<div class="pill"><button type="button" class="ibtn" id="moreBtn" title="More">' + ICON.more + '</button>' + (video ? '<button type="button" class="ibtn" id="camBtn" title="Camera">' + ICON.cam + '</button>' : '<button type="button" class="ibtn" id="camBtn" hidden></button>')
    + '<button type="button" class="ibtn" id="micBtn" title="Mute">' + ICON.mic + '</button><button type="button" class="ibtn red" id="endBtn" title="End call">' + ICON.end + '</button></div>'
    + '<div id="failed" hidden><h2>Couldn’t make call</h2><p id="whyText"></p><div class="btnrow"><button type="button" class="tbtn" id="cancelBtn">Cancel</button><button type="button" class="tbtn go" id="againBtn">Call again</button></div></div>'
    + '<div id="inviteBox" hidden><div class="card"><b>Add people</b><div id="choices"></div><div class="btnrow"><button type="button" class="tbtn" id="cancelInvites">Cancel</button><button type="button" class="tbtn go" id="sendInvites">Add</button></div></div></div>'
    + '</div><script>window.__CALL=' + JSON.stringify(data).replace(/</g, '\\u003c') + ';</script><script src="https://cdn.jsdelivr.net/npm/livekit-client/dist/livekit-client.umd.min.js"></script><script>(' + callScreen.toString() + ')();</script></body></html>';
}

const clientScript = '(' + function() {
  const path=location.pathname, group=path.match(/^\/chat\/group\/(\d+)$/), peer=path.match(/^\/chat\/(\d+)$/), chat=!!(group||peer);
  const post=(url,body)=>fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'Request failed');return j;});
  let ring=null,ringT=null,shownId=null;
  function stopRing(){if(ringT){clearInterval(ringT);ringT=null}if(navigator.vibrate)try{navigator.vibrate(0)}catch(e){}}
  function startRing(){stopRing();const buzz=()=>{if(navigator.vibrate)try{navigator.vibrate([400,200,400])}catch(e){}try{ring=ring||new (window.AudioContext||window.webkitAudioContext)();if(ring.state==='suspended')ring.resume().catch(()=>{});[0,0.5].forEach(d=>{const o=ring.createOscillator(),g=ring.createGain();o.frequency.value=d?480:440;g.gain.value=0.08;o.connect(g);g.connect(ring.destination);o.start(ring.currentTime+d);o.stop(ring.currentTime+d+0.4)})}catch(e){}};buzz();ringT=setInterval(buzz,2500)}
  function incoming(){fetch('/api/calls/incoming',{credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():{calls:[]}).then(j=>{const c=(j.calls||[])[0];let b=document.getElementById('incomingCallBar');
    if(!c){if(b)b.remove();shownId=null;stopRing();return}
    if(b&&shownId===c.id)return;if(b)b.remove();shownId=c.id;
    b=document.createElement('div');b.id='incomingCallBar';b.style.cssText='position:fixed;left:0;top:0;right:0;bottom:0;z-index:99999;background:#0b141af2;color:#e9edef;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:12vh 24px 12vh;text-align:center;font-family:system-ui,-apple-system,sans-serif';
    const top=document.createElement('div');const who=document.createElement('div');who.textContent=c.group_name||c.caller_name;who.style.cssText='font-size:28px;font-weight:600';const sub=document.createElement('div');sub.textContent=(c.group_name?c.caller_name+' · ':'')+'Incoming '+(c.kind==='video'?'video':'voice')+' call…';sub.style.cssText='margin-top:8px;opacity:.8;font-size:16px';
    const av=document.createElement('div');av.textContent=(c.caller_name||'?').trim().charAt(0).toUpperCase();av.style.cssText='width:140px;height:140px;border-radius:50%;background:#2a3942;margin:36px auto 0;display:flex;align-items:center;justify-content:center;font-size:60px;color:#cfd8dc';top.append(who,sub,av);
    const row=document.createElement('div');row.style.cssText='display:flex;gap:64px;align-items:center';
    function round(label,color,yes){const w=document.createElement('div');const x=document.createElement('button');x.type='button';x.setAttribute('aria-label',label);x.style.cssText='width:72px;height:72px;border-radius:50%;border:0;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;background:'+color;x.innerHTML=yes?'<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M6.6 3.5h2.7l1.5 3.8-1.9 1.4a11.5 11.5 0 0 0 5.4 5.4l1.4-1.9 3.8 1.5v2.7a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z"/></svg>':'<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" style="transform:rotate(135deg)"><path d="M6.6 3.5h2.7l1.5 3.8-1.9 1.4a11.5 11.5 0 0 0 5.4 5.4l1.4-1.9 3.8 1.5v2.7a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z"/></svg>';
      const l=document.createElement('div');l.textContent=label;l.style.cssText='margin-top:8px;font-size:14px;opacity:.85';x.onclick=()=>{x.disabled=true;stopRing();post('/api/calls/'+encodeURIComponent(c.id)+'/'+(yes?'accept':'decline'),{}).then(r=>{if(yes)location.href=r.url;else{b.remove();shownId=null;incoming()}}).catch(e=>{alert(e.message);b.remove();shownId=null})};w.append(x,l);row.appendChild(w)}
    round('Decline','#e53935',false);round('Accept','#00a884',true);b.append(top,row);document.body.appendChild(b);startRing()}).catch(()=>{})}
  if(chat){const h=document.querySelector('.chat-head');if(h&&!document.getElementById('callingBar')){const bar=document.createElement('div');bar.id='callingBar';bar.style.cssText='display:flex;gap:2px;align-items:center;margin-left:auto;flex:none';function btn(label,kind,icon){const b=document.createElement('button');b.type='button';b.setAttribute('aria-label',label);b.title=label;b.innerHTML=icon;b.style.cssText='background:none;border:0;box-shadow:none;margin:0;padding:9px;width:auto;border-radius:50%;line-height:0;color:var(--fg,inherit);cursor:pointer';b.onclick=()=>start(kind);bar.appendChild(b)}btn('Video call','video','<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="M15.5 10.5l6-3.5v10l-6-3.5z"/></svg>');btn('Voice call','audio','<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M6.6 3.5h2.7l1.5 3.8-1.9 1.4a11.5 11.5 0 0 0 5.4 5.4l1.4-1.9 3.8 1.5v2.7a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z"/></svg>');h.appendChild(bar)}
    async function start(kind){try{let body={kind};if(group){const r=await fetch('/api/calls/eligible?group_id='+group[1],{credentials:'same-origin'}),j=await r.json();if(!r.ok)throw Error(j.error||'Could not load group members.');if(!j.people.length)throw Error('No other group members to invite.');const overlay=document.createElement('div');overlay.style.cssText='position:fixed;inset:0;z-index:9998;background:#0009;display:grid;place-items:center;padding:16px';const box=document.createElement('div');box.style.cssText='background:var(--card,#101e30);color:var(--fg,inherit);border:1px solid var(--line,#344);border-radius:16px;padding:16px;width:min(440px,100%);max-height:80vh;overflow:auto';const title=document.createElement('h3');title.textContent='Choose participants';box.appendChild(title);const checks=[];j.people.forEach(p=>{const l=document.createElement('label');l.style.cssText='display:flex;gap:10px;padding:8px 0';const c=document.createElement('input');c.type='checkbox';c.checked=true;c.value=p.id;c.style.width='auto';const n=document.createElement('span');n.textContent=p.name;l.append(c,n);box.appendChild(l);checks.push(c)});const go=document.createElement('button');go.textContent='Start call';go.onclick=async()=>{body.group_id=Number(group[1]);body.invited_user_ids=checks.filter(c=>c.checked).map(c=>Number(c.value));if(!body.invited_user_ids.length){alert('Select at least one participant.');return}try{const j=await post('/api/calls/start',body);location.href=j.url}catch(e){alert(e.message)}overlay.remove()};const cancel=document.createElement('button');cancel.textContent='Cancel';cancel.style.marginLeft='8px';cancel.onclick=()=>overlay.remove();box.append(go,cancel);overlay.appendChild(box);overlay.onclick=e=>{if(e.target===overlay)overlay.remove()};document.body.appendChild(overlay)}else{body.peer_id=Number(peer[1]);const j=await post('/api/calls/start',body);location.href=j.url}}catch(e){alert(e.message||'Could not start call.')}}
  }
  incoming();setInterval(incoming,2000);
}.toString() + ')();';
module.exports = { registerCalling, clientScript };
