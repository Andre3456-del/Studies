// The member dashboard and changing your display name
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { KIND_META, ROLE_LABEL, SEM, can, db, esc, hasPurchased, isCentral, layout, sortedFor } = ctx;
  const semLabel = p => p.semester ? SEM.semesterName(p.semester) : '';
  function previewTile(p, needsPay) {
    const [icon, label] = KIND_META[p.kind] || KIND_META.html;
    const chip = needsPay ? '<span class="chip pay">Pay</span>' : '';
    const thumb = p.kind === 'video' && p.video_id
      ? `<img class="pv-img" src="https://i.ytimg.com/vi/${esc(p.video_id)}/hqdefault.jpg" alt="" loading="lazy">`
      : `<div class="pv-img pv-icon">${icon}</div>`;
    return `<a class="pv" href="/p/${p.slug}">${thumb}<div class="pv-body">${chip}<h3>${esc(p.title)}</h3><span class="mut">${label}${p.level ? ` &middot; ${p.level} level` : ''}</span>${semLabel(p) ? `<br><span class="mut">${semLabel(p)}</span>` : ''}</div></a>`;
  }
  // Dashboard: a greeting, then only uploads that are meant for this member (their department and level).
  // "Available" = free to view plus anything they've paid for; "Locked" = pay-to-view CBT they haven't unlocked yet.
  function dashboardBody(req) {
    const u = req.user, initial = esc((u.name || '?').trim().charAt(0).toUpperCase() || '?'), staff = can.pages(u);
    const rows = db.prepare('SELECT id,slug,title,members_only,kind,paid,price_kobo,video_id,dept,level,author_id,course_id,semester,university FROM pages ORDER BY id DESC LIMIT 300').all().filter(p => sortedFor(p, u));
    const isLocked = p => !!p.paid && !staff && !hasPurchased(u.id, p.id);
    const locked = rows.filter(isLocked), available = rows.filter(p => !isLocked(p));
    const pill = u.verified ? '<span class="pill">&#10003; Verified</span>' : '<span class="pill pending">Verification pending</span>';
    const posPill = u.position_status === 'pending' ? ` <span class="pill pending">Position waiting for verification: ${esc(u.position)}</span>` : u.title ? ` <span class="pill">${esc(u.title)}</span>` : '';
    const forYou = [u.department, u.dept_option, u.level ? u.level + ' level' : '', u.graduated ? '🎓 Graduate' : ''].filter(Boolean).join(' · ');
    const subtitle = isCentral(u) ? 'You are the central admin.' : u.role !== 'user' ? `You are a ${esc(ROLE_LABEL[u.role] || 'admin')}.` : (forYou ? esc(forYou) : 'Uploads for you, at a glance.');
    const grid = list => `<div class="pv-grid">${list.map(p => previewTile(p, isLocked(p))).join('')}</div>`;
    return `<p class="mut" style="margin:8px 0 0">${SEM.semesterName(SEM.getCurrent(db))}</p>${req.query.welcome ? '<p class="pill" style="margin:10px 0 0">You are all set. Here is everything meant for you.</p>' : ''}<div class="dash-hero"><div class="dash-top">${u.avatar_mime ? `<img src="/avatar/${u.id}" class="drawer-av-img" style="width:52px;height:52px" alt="">` : `<span class="avatar">${initial}</span>`}<div><h1 style="margin:.1em 0">${esc(u.name)}</h1><p class="mut" style="margin:0">${u.username ? `@${esc(u.username)}` : ''}</p></div></div>
<p style="margin:14px 0 0">${pill}${posPill} <span class="mut">&middot; member since ${esc(String(u.created_at).slice(0, 10))}</span></p></div>
<h2 class="sec">${rows.length} upload${rows.length === 1 ? '' : 's'} for you</h2>
<div class="vtoggle" role="group" aria-label="How to show your courses"><button type="button" data-v="grid" aria-label="Grid">&#9638;</button><button type="button" data-v="list" aria-label="List">&#9776;</button></div>
<script>(function(){var d=document.documentElement,b=document.querySelectorAll('.vtoggle button');function set(v){d.setAttribute('data-pv',v);try{localStorage.setItem('pvView',v)}catch(e){}b.forEach(function(x){x.classList.toggle('on',x.getAttribute('data-v')===v)})}var v='grid';try{v=localStorage.getItem('pvView')||'grid'}catch(e){}set(v==='list'?'list':'grid');b.forEach(function(x){x.onclick=function(){set(x.getAttribute('data-v'))}})})()</script>
<div class="box"><h2>Available to you <span class="count">${available.length}</span></h2><p class="hint">Free to view, plus anything you have paid for.</p>${available.length ? grid(available) : '<p class="mut">Nothing available yet.</p>'}</div>
${locked.length ? `<div class="box"><h2>Locked &mdash; pay to view <span class="count">${locked.length}</span></h2><p class="hint">Pay once and it moves up into Available.</p>${grid(locked)}</div>` : ''}`;
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
    res.send(layout('Dashboard', dashboardBody(req), req.user));
  });
};
