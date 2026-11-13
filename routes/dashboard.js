// The member dashboard and changing your display name
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { KIND_META, ROLE_LABEL, SEM, can, db, esc, hasPurchased, isCentral, layout, sortedFor } = ctx;
  const semLabel = p => p.semester ? SEM.semesterName(p.semester) : '';
  function previewTile(p, needsPay) {
    const [icon, label] = KIND_META[p.kind] || KIND_META.html;
    const thumb = p.kind === 'video' && p.video_id
      ? `<img class="pv-img" src="https://i.ytimg.com/vi/${esc(p.video_id)}/hqdefault.jpg" alt="" loading="lazy">`
      : `<div class="pv-img pv-icon">${icon}</div>`;
    const who = String(p.author || '?').trim(), ini = esc(who.charAt(0).toUpperCase() || '?');
    const meta = [p.author ? esc(p.author) : '', p.course ? esc(p.course) : '', p.level ? p.level + ' level' : '', semLabel(p)].filter(Boolean).join(' &middot; ');
    return `<a class="pv" data-course="${esc(p.course || '')}" data-t="${esc(String(p.title).toLowerCase())}" href="/p/${p.slug}"><div class="pv-th">${thumb}<span class="pv-badge">${esc(label)}</span>${needsPay ? '<span class="pv-lock">&#128274; Pay</span>' : ''}</div><div class="pv-body"><span class="avatar pv-av">${ini}</span><div class="pv-tx"><h3>${esc(p.title)}</h3><span class="mut">${meta}</span></div></div></a>`;
  }
  // Course chips (YouTube style) and a search icon above the library
  function libTools(rows) {
    const courses = [...new Set(rows.map(p => p.course).filter(Boolean))].slice(0, 14);
    const chips = courses.length > 1 ? `<div class="chip-row lib-chips"><button type="button" class="chip on" data-c="">All</button>${courses.map(c => `<button type="button" class="chip" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : '';
    return `<div class="chat-tools"><button type="button" class="ct" id="libSearchBtn" aria-label="Search"><svg class="ic" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></button></div><input id="libSearch" class="chat-search hide" type="search" placeholder="Search" autocomplete="off">${chips}<script>(function(){var c='',q='',tiles=document.querySelectorAll('.pv');function f(){Array.prototype.forEach.call(tiles,function(t){t.style.display=((!c||t.getAttribute('data-course')===c)&&(!q||t.getAttribute('data-t').indexOf(q)>-1))?'':'none'})}
Array.prototype.forEach.call(document.querySelectorAll('.lib-chips .chip'),function(b){b.onclick=function(){c=b.getAttribute('data-c');Array.prototype.forEach.call(document.querySelectorAll('.lib-chips .chip'),function(x){x.classList.toggle('on',x===b)});f()}});
var s=document.getElementById('libSearch'),sb=document.getElementById('libSearchBtn');sb.onclick=function(){s.classList.toggle('hide');if(!s.classList.contains('hide'))s.focus()};s.oninput=function(){q=s.value.trim().toLowerCase();f()}})()</script>`;
  }
  // Dashboard: a greeting, then only uploads that are meant for this member (their department and level).
  // "Available" = free to view plus anything they've paid for; "Locked" = pay-to-view CBT they haven't unlocked yet.
  function kindChips(want) {
    const t = (k, label) => `<a class="chip${want === k ? ' on' : ''}" href="/materials${k ? '?kind=' + k : ''}">${label}</a>`;
    return `<div class="chip-row" style="margin:4px 0 8px;flex-wrap:nowrap;overflow-x:auto">${t('', 'All')}${t('materials', 'Materials')}${t('cbt', 'CBT tests')}${t('video', 'Videos')}</div>`;
  }
  function dashboardBody(req, mode = 'home') {
    const u = req.user, initial = esc((u.name || '?').trim().charAt(0).toUpperCase() || '?'), staff = can.pages(u);
    const rows = db.prepare('SELECT id,slug,title,members_only,kind,paid,price_kobo,video_id,dept,level,author_id,course_id,semester,university,(SELECT name FROM courses WHERE id=pages.course_id) course,(SELECT name FROM users WHERE id=pages.author_id) author FROM pages ORDER BY id DESC LIMIT 300').all().filter(p => sortedFor(p, u));
    const want = String(req.query.kind || '');
    const KIND = { video: p => p.kind === 'video', cbt: p => p.kind === 'cbt', materials: p => p.kind !== 'video' && p.kind !== 'cbt' };
    if (mode === 'materials' && KIND[want]) rows.splice(0, rows.length, ...rows.filter(KIND[want]));
    const isLocked = p => !!p.paid && !staff && !hasPurchased(u.id, p.id);
    const locked = rows.filter(isLocked), available = rows.filter(p => !isLocked(p));
    const pill = u.verified ? '<span class="pill">&#10003; Verified</span>' : '<span class="pill pending">Verification pending</span>';
    const posPill = u.position_status === 'pending' ? ` <span class="pill pending">Position waiting for verification: ${esc(u.position)}</span>` : u.title ? ` <span class="pill">${esc(u.title)}</span>` : '';
    const forYou = [u.department, u.dept_option, u.level ? u.level + ' level' : '', u.graduated ? '🎓 Graduate' : ''].filter(Boolean).join(' · ');
    const subtitle = isCentral(u) ? 'You are the central admin.' : u.role !== 'user' ? `You are a ${esc(ROLE_LABEL[u.role] || 'admin')}.` : (forYou ? esc(forYou) : 'Uploads for you, at a glance.');
    const friendsN = db.prepare("SELECT COUNT(*) c FROM friendships WHERE status='friends' AND (requester_id=? OR addressee_id=?)").get(u.id, u.id).c;
    const savedN = db.prepare('SELECT COUNT(*) c FROM news_saves WHERE user_id=?').get(u.id).c;
    const coursesN = new Set(rows.map(p => p.course).filter(Boolean)).size;
    const grid = list => `<div class="pv-grid">${list.map(p => previewTile(p, isLocked(p))).join('')}</div>`;
    if (mode === 'materials') return `${kindChips(want)}<div class="vtoggle" role="group" aria-label="How to show your courses"><button type="button" data-v="grid" aria-label="Grid">&#9638;</button><button type="button" data-v="list" aria-label="List">&#9776;</button></div>
<script>(function(){var d=document.documentElement,b=document.querySelectorAll('.vtoggle button');function set(v){d.setAttribute('data-pv',v);try{localStorage.setItem('pvView',v)}catch(e){}b.forEach(function(x){x.classList.toggle('on',x.getAttribute('data-v')===v)})}var v='grid';try{v=localStorage.getItem('pvView')||'grid'}catch(e){}set(v==='list'?'list':'grid');b.forEach(function(x){x.onclick=function(){set(x.getAttribute('data-v'))}})})()</script>
<span id="lib"></span>${libTools(rows)}<div class="box"><h2>Available to you <span class="count">${available.length}</span></h2><p class="hint">Free to view, plus anything you have paid for.</p>${available.length ? grid(available) : '<p class="mut">Nothing available yet.</p>'}</div>
${locked.length ? `<div class="box"><h2>Locked &mdash; pay to view <span class="count">${locked.length}</span></h2><p class="hint">Pay once and it moves up into Available.</p>${grid(locked)}</div>` : ''}`;
    return `${req.query.welcome ? '<p class="pill" style="margin:10px 0 0">You are all set. Here is everything meant for you.</p>' : ''}<div class="dash-hero"><div class="cover"></div><div class="prof">${u.avatar_mime ? `<img src="/avatar/${u.id}" class="prof-av" alt="">` : `<span class="avatar prof-av">${initial}</span>`}<div class="prof-tx"><h1>${esc(u.name)}</h1><p class="mut">${u.username ? `@${esc(u.username)}` : ''}${forYou ? ` &middot; ${esc(forYou)}` : ''}</p></div></div>
<p class="prof-pills">${pill}${posPill} <span class="pill">${esc(SEM.semesterName(SEM.getCurrent(db)))}</span></p>
<div class="stats"><a href="/chat"><b>${friendsN}</b><span>Friends</span></a><a href="/news/saved"><b>${savedN}</b><span>Saved</span></a><a href="/materials"><b>${coursesN}</b><span>Courses</span></a></div>
<div class="tiles"><a class="tile" href="/materials"><span class="ci"><svg class="ic" viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z"/><path d="M18 19v2H6"/></svg></span>Materials</a><a class="tile" href="/materials?kind=cbt"><span class="ci"><svg class="ic" viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="m9 9 2 2 4-4M9 16h6"/></svg></span>CBT tests</a><a class="tile" href="/materials?kind=video"><span class="ci"><svg class="ic" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/></svg></span>Videos</a><a class="tile" href="/news/saved"><span class="ci"><svg class="ic" viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></svg></span>Saved</a></div></div>`;
  }

  app.post('/account/name', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const name = String(req.body.name || '').trim().slice(0, 80);
    if (!name) return res.redirect('/dashboard');
    db.prepare('UPDATE users SET name=? WHERE id=?').run(name, req.user.id);
    res.redirect('/dashboard');
  });

  app.get('/dashboard', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/dashboard');
    if (req.user.role === 'uniadmin') return res.redirect('/uni');
    res.send(layout('Home', dashboardBody(req), req.user));
  });
  app.get('/materials', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/materials');
    if (req.user.role === 'uniadmin') return res.redirect('/uni');
    res.set('Cache-Control', 'no-store').send(layout('Materials', dashboardBody(req, 'materials'), req.user));
  });
};
