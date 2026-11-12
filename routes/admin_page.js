// The Admin page
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { FLW_WINDOW, KIND_META, LEVELS, PRICE_KOBO, PRICE_NGN, ROLES, ROLE_LABEL, SCOPE_RANK, adminish, atLink, can, canPromote, db, departmentCheckboxes, deptListOf, esc, facultyOf, isCentral, layout, mayManageNews, optionsMap, presenceDot, semesterField } = ctx;
  app.get('/admin', adminish, (req, res) => {
    const me = req.user, central_ = isCentral(me);
    const cp = can.pages(me), ck = can.allKinds(me), cn = can.news(me), cs = can.support(me), cf = can.full(me);
    const pages = cp ? db.prepare('SELECT * FROM pages WHERE author_id IS NULL AND (admin_id=? OR (admin_id IS NULL AND ?=1)) ORDER BY id DESC').all(me.id, cf ? 1 : 0) : [];
    const roleSelect = u => `<form method="post" action="/admin/users/${u.id}/role" class="row" style="gap:6px;flex-wrap:nowrap"><select name="role">${ROLES.map(r => `<option value="${r}"${u.role === r ? ' selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select><button class="link">Update role</button></form>`;
    // Central admin only: every payment Flutterwave has handled, with its tick or cross. Nothing here needs approving by hand.
    const flwSection = cf ? (() => {
      const rows = db.prepare("SELECT f.*, COALESCE(u.name, (SELECT guest_name FROM sponsor_posts WHERE id=f.item_id), 'A visitor') un, COALESCE(u.email, (SELECT guest_email FROM sponsor_posts WHERE id=f.item_id), '') ue FROM flw_payments f LEFT JOIN users u ON u.id=f.user_id WHERE f.status='paid' OR f.created_at>? ORDER BY f.created_at DESC LIMIT 60").all(Date.now() - FLW_WINDOW);
      if (!rows.length) return '<h3 id="payments">Flutterwave payments</h3><p class="mut">No payments yet.</p>';
      const mark = r => r.status === 'paid' ? '<span style="color:#22c55e;font-weight:700">&#10003; Verified</span>' : r.status === 'cancelled' || r.created_at < Date.now() - 172800000 ? '<span style="color:#ef4444;font-weight:700">&#10007; Not completed</span>' : `<span style="color:#f59e0b;font-weight:700">Waiting for Flutterwave &middot; <span class="flwLeft" data-end="${r.created_at + FLW_WINDOW}"></span> left</span>`;
      const total = db.prepare("SELECT COALESCE(SUM(amount_kobo),0) n FROM flw_payments WHERE status='paid'").get().n;
      return `<script>(function(){function t(){document.querySelectorAll('.flwLeft').forEach(function(e){var s=Math.max(0,Math.round((e.dataset.end-Date.now())/1000));e.textContent=Math.floor(s/60)+':'+('0'+s%60).slice(-2)})}t();setInterval(t,1000)})()</script><h3 id="payments">Flutterwave payments</h3><p class="mut">Verified in total: <b>₦${(total / 100).toLocaleString()}</b></p>${rows.map(r => `<div class="card"><b>${esc(r.un)}</b> <span class="mut">${esc(r.ue)}</span><br>${r.kind === 'sponsor' ? 'Sponsor post' : 'Locked page'} &middot; ₦${(r.amount_kobo / 100).toLocaleString()} &middot; ${mark(r)}<br><span class="mut">${new Date(r.created_at).toISOString().slice(0, 16).replace('T', ' ')}</span>${r.user_id === me.id && r.status !== 'paid' ? `<form method="post" action="/admin/flw/delete" style="margin-top:8px"><input type="hidden" name="ref" value="${esc(r.tx_ref)}"><button class="link">Delete</button></form>` : ''}</div>`).join('')}`;
    })() : '';
    const paymentsSection = cf ? (() => {
      const claims = db.prepare("SELECT p.*, u.name un, u.email ue, pg.title pt, pg.slug ps, pg.price_kobo FROM purchases p JOIN users u ON u.id=p.user_id JOIN pages pg ON pg.id=p.page_id WHERE p.status='pending' ORDER BY p.id DESC").all();
      if (!claims.length) return '';
      return `<h3 id="payments">Payment claims waiting for you (${claims.length})</h3>${claims.map(c => `<div class="card row"><div><b>${esc(c.un)}</b> <span class="mut">${esc(c.ue)}</span><br><span class="mut">₦${((c.price_kobo || PRICE_KOBO) / 100).toFixed(0)} for "${esc(c.pt)}"</span></div>
<div class="row" style="gap:6px"><form method="post" action="/admin/payments/${c.id}/approve"><button>Approve</button></form><form method="post" action="/admin/payments/${c.id}/reject" onsubmit="return confirm('Reject this payment claim?')"><button class="link">Reject</button></form></div></div>`).join('')}`;
    })() : '';
    const sponsorsSection = cf ? require('../lib/sponsor_admin')({ db, esc }) : '';
    const levelSection = canPromote(me) ? `<h3 id="levels">Levels</h3><p class="mut" style="margin-top:0">Move students up to the next level (everyone, or one department or level) and choose who else may do it.</p><p><a class="btn" href="/admin/levels">Open level promotion</a></p>` : '';
    const positionsSection = cf ? (() => {
      const pend = db.prepare("SELECT id,name,username,position,department,level FROM users WHERE position_status='pending' ORDER BY id").all();
      const depts = db.prepare('SELECT id,name,faculty,max_level FROM departments ORDER BY faculty,name').all();
      const facs = [...new Set(depts.map(d => d.faculty))], OPTS = optionsMap();
      const approvers = db.prepare("SELECT id,name,title FROM users WHERE position_status='approved' AND position_auto_role='news' ORDER BY name").all();
      const approverOpts = `<option value="">No extra approval needed</option>${approvers.map(a => `<option value="${a.id}">${esc(a.name)}${a.title ? ' -- ' + esc(a.title) : ''}</option>`).join('')}`;
      return `<h3 id="positions">Positions waiting for verification (${pend.length})</h3>${pend.map(p => `<div class="card"><b>${esc(p.name)}</b> <span class="mut">${p.username ? '@' + esc(p.username) : ''} ${esc(p.department || '')} ${p.level ? p.level + ' level' : ''}</span><br>Says they are: <b>${esc(p.position)}</b>
<form method="post" action="/admin/positions/${p.id}/approve" style="margin-top:10px">
<label class="mut">How far their posts reach</label>
<select name="scope"><option value="own">Their own department + level (e.g. a class rep)</option><option value="department">Their whole department, every level (e.g. a departmental president)</option><option value="faculty">Their whole faculty, every department (e.g. a faculty president)</option><option value="school">The whole school</option></select>
<label class="mut">Grant automatically, once verified</label>
<select name="auto_role"><option value="">Nothing extra -- just show the title</option><option value="news">News admin -- can post news directly</option><option value="content">Files admin -- can upload course content</option><option value="observer">Observer -- read-only view of Admin, no posting power</option></select>
<label class="mut">Their news must be approved by</label>
<select name="approver_id">${approverOpts}</select>
<label class="row" style="gap:8px;margin-top:8px;cursor:pointer"><input type="checkbox" class="shsw" name="can_verify" value="1" style="width:auto">Let them verify other position claims within their own scope (e.g. a president verifying their reps)</label>
<div class="row" style="gap:6px;margin-top:8px"><button>Verify</button></div>
</form>
<form method="post" action="/admin/positions/${p.id}/reject" style="margin-top:4px"><button class="link">Reject instead</button></form>
</div>`).join('') || '<p class="mut">No positions waiting.</p>'}
<h3 id="departments">Departments (${depts.length})</h3><p class="mut" style="margin-top:0">This list feeds sign-up and the upload form. Add anything that is missing.</p>
<form class="card" method="post" action="/admin/departments/add"><input name="name" placeholder="Department or programme name" required maxlength="120"><input name="faculty" list="facList" placeholder="Faculty (e.g. Science)" maxlength="80"><datalist id="facList">${facs.map(f => `<option value="${esc(f)}">`).join('')}</datalist><label class="mut">Last level</label><select name="max_level">${[300, 400, 500, 600].map(l => `<option value="${l}"${l === 500 ? ' selected' : ''}>${l} level</option>`).join('')}</select><button>Add department</button></form>
<form class="card" method="post" action="/admin/faculties/maxlevel" onsubmit="return confirm('Set the last level for every department in this faculty?')"><b>Set the last level for a whole faculty</b><br><select name="faculty" required><option value="">Choose a faculty...</option>${facs.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('')}</select><select name="max_level">${[300, 400, 500, 600].map(l => `<option value="${l}">${l} level</option>`).join('')}</select><button>Apply to the faculty</button><p class="mut" style="margin:6px 0 0">Students at the last level are flagged as graduates when you promote.</p></form>
<form class="card" method="post" action="/admin/departments/breakdown"><b>Break a department down into courses</b><p class="mut" style="margin:4px 0">For a department that has parts (for example Education: Mathematics, English, Biology). Students of that department will then also pick their course. Type the names separated by commas or on separate lines.</p><select name="department" data-search required><option value="">Choose the department...</option>${depts.map(d => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('')}</select><textarea name="names" placeholder="e.g. Mathematics, English, Biology" required maxlength="3000" style="width:100%;min-height:60px;font:inherit;padding:11px 13px;margin:6px 0;color:var(--fg);background:rgba(8,10,22,.65);border:1px solid var(--line);border-radius:10px"></textarea><button>Add courses</button></form>
<details class="card"><summary style="cursor:pointer">Show all departments</summary>${facs.map(f => `<p class="chat-label">${esc(f)}</p>${depts.filter(d => d.faculty === f).map(d => `<div class="row" style="gap:8px"><span style="flex:1">${esc(d.name)}</span><form method="post" action="/admin/departments/${d.id}/maxlevel" style="margin:0"><select name="max_level" onchange="this.form.submit()" title="Last level">${[300, 400, 500, 600].map(l => `<option value="${l}"${l === d.max_level ? ' selected' : ''}>${l} level</option>`).join('')}</select></form><form method="post" action="/admin/departments/${d.id}/delete" style="margin:0" onsubmit="return confirm('Remove this department from the list?')"><button class="link">Remove</button></form></div>${(OPTS[d.name] || []).length ? `<div style="margin:2px 0 8px 12px" class="mut">Courses: ${OPTS[d.name].map(n => `<form method="post" action="/admin/departments/breakdown/remove" style="display:inline;margin:0 6px 0 0"><input type="hidden" name="department" value="${esc(d.name)}"><input type="hidden" name="name" value="${esc(n)}"><button class="chip" title="Remove this course" onclick="return confirm('Remove ${esc(n).replace(/'/g, '')}?')">${esc(n)} &times;</button></form>`).join('')}</div>` : ''}`).join('')}`).join('')}</details>`;
    })() : '';
    const delegatedVerifySection = me.position_can_verify ? (() => {
      let pend;
      if (me.position_scope === 'own') pend = db.prepare("SELECT id,name,username,position,department,level FROM users WHERE position_status='pending' AND department=? AND level=?").all(me.department, me.level);
      else if (me.position_scope === 'department') pend = db.prepare("SELECT id,name,username,position,department,level FROM users WHERE position_status='pending' AND department=?").all(me.department);
      else if (me.position_scope === 'faculty') {
        const fac = facultyOf(me.department);
        const depts = fac ? db.prepare('SELECT name FROM departments WHERE faculty=?').all(fac).map(d => d.name) : [];
        pend = depts.length ? db.prepare(`SELECT id,name,username,position,department,level FROM users WHERE position_status='pending' AND department IN (${depts.map(() => '?').join(',')})`).all(...depts) : [];
      } else pend = db.prepare("SELECT id,name,username,position,department,level FROM users WHERE position_status='pending'").all();
      if (me.university) pend = pend.filter(p => { const u = db.prepare('SELECT university FROM users WHERE id=?').get(p.id); return !u || !u.university || u.university === me.university; });
      const myRank = SCOPE_RANK[me.position_scope] || 1;
      const SCOPE_LABEL = { own: 'Their own department + level', department: 'Their whole department', faculty: 'Their whole faculty', school: 'The whole school' };
      const scopeOpts = Object.keys(SCOPE_RANK).filter(s => SCOPE_RANK[s] <= myRank).map(s => `<option value="${s}">${SCOPE_LABEL[s]}</option>`).join('');
      return `<h3 id="verify-queue">Position claims waiting for you to verify (${pend.length})</h3>${pend.map(p => `<div class="card"><b>${esc(p.name)}</b> <span class="mut">${p.username ? '@' + esc(p.username) : ''} ${esc(p.department || '')} ${p.level ? p.level + ' level' : ''}</span><br>Says they are: <b>${esc(p.position)}</b>
<form method="post" action="/positions/${p.id}/verify" style="margin-top:8px">
<select name="scope">${scopeOpts}</select>
<select name="auto_role"><option value="">Nothing extra</option><option value="news">News admin</option><option value="content">Files admin</option></select>
<label class="row" style="gap:8px;margin-top:6px;cursor:pointer"><input type="checkbox" class="shsw" name="can_verify" value="1" style="width:auto">Let them verify others too</label>
<div class="row" style="gap:6px;margin-top:8px"><button>Verify</button></div>
</form>
<form method="post" action="/positions/${p.id}/verify-reject" style="margin-top:4px"><button class="link">Reject</button></form>
</div>`).join('') || '<p class="mut">No one waiting on you right now.</p>'}`;
    })() : '';
    const lecturersSection = cf ? (() => {
      const pend = db.prepare("SELECT id,name,email,university,lecturer_reg_no FROM users WHERE is_lecturer=1 AND lecturer_status='pending' ORDER BY id").all();
      if (!pend.length) return '';
      return `<h3 id="lecturers">Lecturers waiting for verification (${pend.length})</h3>${pend.map(l => {
        const courses = db.prepare('SELECT c.name FROM courses c JOIN lecturer_courses lc ON lc.course_id=c.id WHERE lc.lecturer_id=?').all(l.id).map(c => c.name).join(', ');
        return `<div class="card"><b>${esc(l.name)}</b> <span class="mut">${esc(l.email)}</span><br><b>${esc(l.university)}</b>${l.lecturer_reg_no ? ' &middot; reg. no. ' + esc(l.lecturer_reg_no) : ''}<br><span class="mut">Teaches: ${esc(courses) || '(none picked)'}</span>
<div class="row" style="gap:6px;margin-top:8px"><form method="post" action="/admin/lecturers/${l.id}/approve"><button>Verify</button></form><form method="post" action="/admin/lecturers/${l.id}/reject"><button class="link">Reject</button></form></div></div>`;
      }).join('')}`;
    })() : '';
    const observerSection = me.role === 'observer' ? (() => {
      const counts = {
        users: db.prepare("SELECT COUNT(*) n FROM users WHERE role='user' AND is_lecturer=0").get().n,
        pendingPositions: db.prepare("SELECT COUNT(*) n FROM users WHERE position_status='pending'").get().n,
        pendingNews: db.prepare("SELECT COUNT(*) n FROM news WHERE status IN ('pending','pending_approver')").get().n,
        pages: db.prepare('SELECT COUNT(*) n FROM pages').get().n,
      };
      const verified = db.prepare("SELECT name, username, title, department, level FROM users WHERE position_status='approved' ORDER BY name").all();
      return `<p class="mut">Read-only view -- you can see what's happening across the site, but nothing here can be changed from this account.</p>
<h3>At a glance</h3><p class="mut" style="margin-top:0">${counts.users} students &middot; ${counts.pages} pages uploaded &middot; ${counts.pendingNews} news item${counts.pendingNews === 1 ? '' : 's'} awaiting approval &middot; ${counts.pendingPositions} position${counts.pendingPositions === 1 ? '' : 's'} awaiting verification</p>
<h3>Verified positions (${verified.length})</h3>${verified.map(v => `<p class="mut">${esc(v.name)}${v.username ? ' @' + esc(v.username) : ''} -- <b>${esc(v.title || '')}</b> (${esc(v.department || '')}${v.level ? ', ' + v.level + ' level' : ''})</p>`).join('') || '<p class="mut">None yet.</p>'}`;
    })() : '';
    const usersSection = cs ? (() => {
      const users = db.prepare('SELECT id,name,email,role,verified,created_at,last_seen,title,username,position_status FROM users WHERE is_lecturer=0 AND virtual=0 ORDER BY id DESC').all();
      const post = (u, action, label, extra = '', confirmMsg = '') => `<form method="post" action="/admin/users/${u.id}/${action}"${confirmMsg ? ` onsubmit="return confirm('${confirmMsg}')"` : ''}>${extra}<button class="link">${label}</button></form>`;
      const rows = users.map(u => {
        const protectedTarget = u.role === 'admin' && !cf; // login-help admins can't touch full admins
        const status = u.verified ? 'verified' : `${post(u, 'verify', 'Verify now')}${post(u, 'resend-verification', 'Resend link')}`;
        const roleCell = u.email === ctx.ADMIN_EMAIL ? 'Central admin' : central_ ? roleSelect(u) : (ROLE_LABEL[u.role] || 'User');
        const titleCell = cf ? (u.title ? `<span class="role-tag" style="margin:0">${esc(u.title)}</span>` : u.position_status === 'pending' ? '<span class="mut">awaiting verification</span>' : '') : '';
        const helpCell = protectedTarget ? '' : `${post(u, 'reset-code', 'Send reset code')}${post(u, 'signout', 'Sign out everywhere', '', 'Sign this person out of every device?')}`;
        const removeCell = cf && u.role !== 'admin' ? post(u, 'delete', 'Remove', '', 'Remove this user?') : '';
        return `<tr><td>${presenceDot(u)}${esc(u.name)}${u.username ? ` <span class="mut">${atLink(u.username)}</span>` : ''}</td><td>${esc(u.email)}</td><td>${esc(String(u.created_at).slice(0, 10))}</td><td>${status}</td><td>${roleCell}</td>${cf ? `<td>${titleCell}</td>` : ''}<td>${helpCell}</td>${cf ? `<td>${removeCell}</td>` : ''}</tr>`;
      }).join('');
      return `<h3 id="users">${cf ? 'Registered users' : 'Login help'} (${users.length})</h3><div style="overflow-x:auto"><table><tr><th>Name</th><th>Email</th><th>Joined</th><th>Status</th><th>Role</th>${cf ? '<th>Title</th>' : ''}<th>Login help</th>${cf ? '<th></th>' : ''}</tr>${rows}</table></div>`;
    })() : '';
    const pendingNews = cn ? db.prepare("SELECT n.*, u.name un, u.email ue FROM news n JOIN users u ON u.id = n.author_id WHERE n.status='pending' ORDER BY n.id DESC").all() : [];
    const newsThumb = n => n.image_data ? `<img src="/news-image/${n.id}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;float:left;margin-right:10px">` : '';
    const pendingNewsSection = pendingNews.length ? `<h3 id="pending-news">News waiting for you (${pendingNews.length})</h3>${pendingNews.map(n => `<div class="card" style="overflow:hidden">${newsThumb(n)}<b>${esc(n.title)}</b> <span class="mut">by ${esc(n.un)} (${esc(n.ue)})</span><p class="mut" style="margin:6px 0;white-space:pre-wrap">${esc(n.body)}</p>
<div class="row" style="gap:6px"><form method="post" action="/admin/news/${n.id}/approve"><button>Approve</button></form><form method="post" action="/admin/news/${n.id}/delete" onsubmit="return confirm('Reject this news item?')"><button class="link">Reject</button></form></div></div>`).join('')}` : '';
    const newsItems = cn ? db.prepare("SELECT * FROM news WHERE status='approved' ORDER BY id DESC").all().filter(n => mayManageNews(me, n)) : [];
    const newsSection = cn ? `${pendingNewsSection}<h3 id="news">Post news (${newsItems.length})</h3>
<form class="card" method="post" action="/admin/news" enctype="multipart/form-data"><input name="title" placeholder="Headline" required maxlength="140"><input type="file" name="image" accept="image/*" style="padding:9px 0"><textarea name="body" placeholder="Short summary" required maxlength="2000000" style="width:100%;min-height:70px;font:inherit;padding:11px 13px;margin:6px 0;color:var(--fg);background:rgba(8,10,22,.65);border:1px solid var(--line);border-radius:10px"></textarea><button>Post</button></form>
${newsItems.map(n => `<div class="card row" style="overflow:hidden">${newsThumb(n)}<span class="mut">${esc(n.title)}</span><a href="/admin/news/${n.id}/edit">Edit</a><form method="post" action="/admin/news/${n.id}/delete" onsubmit="return confirm('Delete this news item?')"><button class="link">Delete</button></form></div>`).join('') || '<p class="mut">No news posted yet.</p>'}` : '';
    const pagesSection = cp ? `<form class="card" id="upload" data-bgup method="post" action="/admin/upload" enctype="multipart/form-data"><h3>Upload content</h3>
<input name="title" placeholder="Title (optional — defaults to file name)">
${ck ? `<select name="kind" id="kindSelect"><option value="html">HTML page</option><option value="cbt">CBT (quiz) HTML</option><option value="pdf">PDF document</option><option value="doc">Word document</option><option value="video">Video (YouTube link or from your phone)</option><option value="image">Image (JPG or PNG)</option></select>`
      : '<input type="hidden" name="kind" value="html"><p class="mut" style="margin:4px 0">Your role can upload plain HTML pages. PDFs, Word documents, videos and CBT pages need a Files admin or a full admin.</p>'}
<div id="fileField"><input type="file" name="file" accept=".html,.htm,text/html"></div>
${ck ? `<div id="videoField" style="display:none"><input name="video_url" placeholder="https://youtube.com/watch?v=..."><p class="hint" style="margin:4px 0 0">Paste a YouTube link here, <b>or</b> choose a video from your phone above. Either one works.</p></div>` : ''}
<label><input type="checkbox" class="shsw" name="members_only" value="1"> Members only (login required)</label><br>
<label class="hint" style="display:block;margin-top:8px">Who is this for?</label>
<details><summary>Which departments? (leave all unchecked for every department)</summary>${departmentCheckboxes([])}</details>
<select name="level"><option value="auto">Level: detect from the course code in the title (GST 121 = 100 level)</option><option value="all">All levels</option>${LEVELS.map(l => `<option value="${l}">${l} level only</option>`).join('')}</select>
${cf ? `<div id="payField" style="display:none"><label><input type="radio" name="visibility" value="normal" checked> Free to view</label> <label style="margin-left:14px"><input type="radio" name="visibility" value="paid"> Payment to view (₦${PRICE_NGN})</label><p class="hint">Only CBT uploads can be pay-to-view.</p></div>` : ''}
${semesterField('')}
<button>Upload</button></form>
${ck ? `<script>(function(){var k=document.getElementById('kindSelect'),f=document.getElementById('fileField'),v=document.getElementById('videoField'),fi=f.querySelector('input'),pf=document.getElementById('payField');function sync(){var isVideo=k.value==='video',isImg=k.value==='image';if(pf)pf.style.display=k.value==='cbt'?'':'none';v.style.display=isVideo?'':'none';fi.required=!isVideo;fi.accept=isVideo?'video/*':isImg?'image/png,image/jpeg,.png,.jpg,.jpeg':k.value==='pdf'?'.pdf':k.value==='doc'?'.doc,.docx':'.html,.htm,text/html'}k.addEventListener('change',sync);sync()})()</script>
<script>if('launchQueue' in window){window.launchQueue.setConsumer(function(lp){if(!lp.files||!lp.files.length)return;lp.files[0].getFile().then(function(file){var dt=new DataTransfer();dt.items.add(file);var fi=document.querySelector('#fileField input[type=file]');fi.files=dt.files;var n=file.name.toLowerCase();var ks=document.getElementById('kindSelect');ks.value=n.indexOf('.pdf')>-1?'pdf':(n.indexOf('.doc')>-1?'doc':'html');ks.dispatchEvent(new Event('change'));document.getElementById('upload').scrollIntoView({behavior:'smooth'})})})}</script>` : ''}
${cp ? `<script>if('serviceWorker' in navigator){navigator.serviceWorker.addEventListener('message',function(e){if(e.data&&e.data.type==='uploads-synced')location.reload()})}</script>` : ''}
<h3 id="pages">Pages (${pages.length})</h3>${(() => {
      if (!pages.length) return '<p class="mut">No pages yet.</p>';
      const pageCard = p => {
        const [pIcon, pLabel] = KIND_META[p.kind] || KIND_META.html;
        const status = p.paid ? `₦${((p.price_kobo || PRICE_KOBO) / 100).toFixed(0)} to view` : (p.members_only ? 'Members only' : 'Open');
        const replaceCtrl = p.kind === 'video'
          ? (ck ? `<form method="post" action="/admin/pages/${p.id}/video" class="row"><input name="video_url" placeholder="New YouTube URL" style="width:auto"><button>Update link</button></form><form method="post" action="/admin/pages/${p.id}/replace" enctype="multipart/form-data" class="row"><input type="file" name="file" accept="video/*" required style="width:auto"><button>Upload another video</button></form>` : '')
          : (p.kind === 'html' || ck ? `<form method="post" action="/admin/pages/${p.id}/replace" enctype="multipart/form-data" class="row"><input type="file" name="file" required style="width:auto"><button>Replace file</button></form>` : '');
        const deptList = deptListOf(p);
        const forWho = `${deptList.length ? esc(deptList.join(', ')) : 'All departments'} &middot; ${p.level ? p.level + ' level' : 'All levels'}`;
        return `<div class="card"><div class="row"><a href="/p/${p.slug}" target="_blank">${pIcon} ${esc(p.title)}</a><span class="mut">/p/${p.slug} &middot; ${pLabel} &middot; ${status}</span></div>
<p class="mut" style="margin:6px 0 0">For: ${forWho} &middot; <a href="/admin/pages/${p.id}/sort">Change</a></p>
<div class="row" style="margin-top:10px">
<form method="post" action="/admin/pages/${p.id}/toggle"><button class="link">${p.members_only ? '🔒 Members only — make open' : 'Open — make members only'}</button></form>
${replaceCtrl}
<form method="post" action="/admin/pages/${p.id}/delete" onsubmit="return confirm('Delete this page?')"><button class="link">Delete</button></form></div></div>`;
      };
      // Folders by level -- "All levels" first, then 100 up to 600, each only shown if it actually has pages.
      const groups = [['All levels', pages.filter(p => !p.level)]].concat(LEVELS.map(l => [`${l} level`, pages.filter(p => p.level === l)]));
      return groups.filter(([, list]) => list.length).map(([label, list]) => `<details class="card"><summary style="cursor:pointer;font-weight:600">${esc(label)} (${list.length})</summary><div style="margin-top:10px">${list.map(pageCard).join('')}</div></details>`).join('');
    })()}` : '';
    const tab = String(req.query.tab || ''), msgHtml = req.query.msg ? `<p class="mut">${esc(req.query.msg)}</p>` : '';
    const count = sql => { try { return Number(db.prepare(sql).get().n) || 0; } catch (e) { return 0; } };
    const TABS = {
      pages: [cp, '⬆️', 'Uploads & pages', 'Upload files and manage what you posted', pagesSection, 0],
      news: [cn, '📢', 'News', 'Post news and review what students share', newsSection, pendingNews.length],
      positions: [cf || !!me.position_can_verify, '🎖️', 'Positions & departments', 'Verify positions and claims', `${delegatedVerifySection}${positionsSection}`, cf ? count("SELECT COUNT(*) n FROM users WHERE position_status='pending'") : 0],
      lecturers: [false, '🎓', 'Lecturers', 'Verify lecturer accounts', lecturersSection, cf ? count("SELECT COUNT(*) n FROM users WHERE is_lecturer=1 AND lecturer_status='pending'") : 0],
      payments: [cf, '💳', 'Payments & sponsors', 'Payments checked by Flutterwave', `${flwSection}${paymentsSection}${sponsorsSection}`, cf ? count("SELECT COUNT(*) n FROM purchases WHERE status='pending'") + count("SELECT COUNT(*) n FROM sponsor_posts WHERE status='pending_payment'") : 0],
      users: [cs, '👥', cf ? 'Users' : 'Login help', cf ? 'Everyone who registered' : 'Help people who cannot log in', usersSection, 0],
      overview: [me.role === 'observer', '👁️', 'Overview', 'Read-only look at the site', observerSection, 0],
    };
    const tile = (href, icon, label, desc, n) => `<a class="tile" href="${href}"><span class="stat">${icon}</span>${n > 0 ? `<span class="chip pay">${n} waiting</span>` : ''}<h3>${esc(label)}</h3><span class="go">${esc(desc)} &rarr;</span></a>`;
    const T = TABS[tab];
    if (T && T[0]) return res.send(layout('Admin', `<p class="mut"><a href="/admin">&larr; Admin</a></p><h1>${esc(T[2])}</h1>${msgHtml}${T[4] || '<p class="mut">Nothing is waiting here right now.</p>'}`, req.user));
    const tiles = Object.entries(TABS).filter(([, t]) => t[0]).map(([k, t]) => tile('/admin?tab=' + k, t[1], t[2], t[3], t[5]))
      .concat(canPromote(me) ? [tile('/admin/levels', '🪜', 'Levels', 'Move students up a level', 0)] : [])
      .concat(central_ ? [tile('/admin/checks', '🔌', 'Connection checks', 'Notifications and the Firebase key: is everything working?', 0), tile('/admin/team', '🧑‍💼', 'Admin team', 'Appoint admins by @username', 0), tile('/admin/structure', '🏛️', 'Site structure', 'Faculties, departments, institutions, courses', 0), tile('/admin/maintenance', '📣', 'Site notices', 'Tell everyone about an upgrade', 0), tile('/lecturer/admin?tab=admins', '🏫', 'University admins', 'Invite admins for one university by email', 0)] : []);
    res.send(layout('Admin', `<h1>Admin</h1><p class="mut" style="margin-top:0">${central_ ? 'Central admin' : esc(ROLE_LABEL[me.role] || 'Admin')}</p>${msgHtml}<div class="grid">${tiles.join('')}</div>
<script>(function(){var h=location.hash.slice(1),m={upload:'pages',pages:'pages',news:'news','pending-news':'news',positions:'positions','verify-queue':'positions',lecturers:'lecturers',payments:'payments',sponsors:'payments',users:'users'};if(h&&m[h]&&location.search.indexOf('tab=')<0)location.replace('/admin?tab='+m[h]+'#'+h);else if(h==='levels')location.replace('/admin/levels')})()</script>`, req.user));
  });
};
