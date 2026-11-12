// Profile fields, saving a profile, and the Welcome page
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { LEVELS, SCOPE_RANK, can, canVerifyClaim, cleanUsername, db, departmentNames, esc, facultyOf, fullAdminIds, layout, maxLevelFor, notify, optionsMap, optionsOf, profileComplete, upload, usernameProblem } = ctx;
  const levelOptions = (sel, blank, dept) => { const top = maxLevelFor(dept); return `<option value="">${blank}</option>${LEVELS.filter(l => l <= top || Number(sel) === l).map(l => `<option value="${l}"${Number(sel) === l ? ' selected' : ''}>${l} level</option>`).join('')}`; };
  // Once someone has signed up, their username, university, department and level are permanent -- only their name, picture and position can change.
  // (A level only moves when the central admin, or someone they appointed, promotes students.) A field is locked as soon as it has a value.
  const lockedOf = u => ({ username: !!(u && u.username), university: !!(u && u.university), department: !!(u && u.department), level: !!(u && u.level), option: !!(u && u.dept_option) });
  const lockedRow = (label, value) => `<label class="mut">${label}</label><div class="locked-field"><span>${esc(String(value))}</span></div>`;
  function profileFields(v, student, lk = {}) {
    const lockedBlock = lk.username || lk.university || lk.department || lk.level;
    const rows = db.prepare('SELECT name,faculty,max_level FROM departments ORDER BY faculty,name').all();
    const map = {}; for (const r of rows) (map[r.faculty] = map[r.faculty] || []).push([r.name, r.max_level]);
    const curFac = v.department ? (facultyOf(v.department) || '') : '';
    const facOpts = `<option value="">Choose your faculty...</option>${Object.keys(map).map(f => `<option value="${esc(f)}"${f === curFac ? ' selected' : ''}>${esc(f)}</option>`).join('')}`;
    const depOpts = curFac && map[curFac] ? `<option value="">Choose your department...</option>${map[curFac].map(([n]) => `<option value="${esc(n)}"${n === v.department ? ' selected' : ''}>${esc(n)}</option>`).join('')}` : `<option value="">Choose your faculty first...</option>`;
    const OM = optionsMap(), curOpts = OM[v.department] || [];
    const optRow = lk.option ? lockedRow('Course under ' + v.department, v.dept_option)
      : `<div id="optWrap"${curOpts.length ? '' : ' style="display:none"'}><label class="mut">Course under this department</label><select name="dept_option" id="optSel" data-search><option value="">Choose your course...</option>${curOpts.map(n => `<option value="${esc(n)}"${n === v.dept_option ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div>`;
    const script = `<script>(function(){var M=${JSON.stringify(map).replace(/</g, '\\u003c')},OM=${JSON.stringify(OM).replace(/</g, '\\u003c')},F=document.getElementById('facSel'),D=document.getElementById('deptSel'),L=document.getElementById('lvlSel'),OS=document.getElementById('optSel'),OW=document.getElementById('optWrap');if(!D)return;var LV=${JSON.stringify(LEVELS)};
function opts(sel,list,blank,cur){sel.innerHTML='';var o=document.createElement('option');o.value='';o.textContent=blank;sel.appendChild(o);list.forEach(function(x){var e=document.createElement('option');e.value=x[0];e.textContent=x[1];if(String(x[0])===String(cur))e.selected=true;sel.appendChild(e)})}
function ov(){if(!OS||!OW)return;var l=OM[D.value]||[];OS.innerHTML='';var o=document.createElement('option');o.value='';o.textContent='Choose your course...';OS.appendChild(o);l.forEach(function(n){var e=document.createElement('option');e.value=n;e.textContent=n;OS.appendChild(e)});OW.style.display=l.length?'':'none';OS.required=l.length>0}
function top(){var f=M[F.value]||[];for(var i=0;i<f.length;i++)if(f[i][0]===D.value)return f[i][1];return 0}
function lv(){if(!L)return;var t=top(),cur=L.value;opts(L,LV.filter(function(l){return l<=t}).map(function(l){return[l,l+' level']}),t?'Choose your level...':'Choose your department first...',cur)}
if(F)F.addEventListener('change',function(){var f=M[F.value]||[];opts(D,f.map(function(d){return[d[0],d[0]]}),F.value?'Choose your department...':'Choose your faculty first...','');lv();ov()});
D.addEventListener('change',function(){lv();ov()});
})()</script>`;
    return `<label class="mut">Your name</label><input name="name" value="${esc(v.name || '')}" maxlength="80" required>
${lk.username ? lockedRow('Username', '@' + v.username) : `<label class="mut">Username</label><input name="username" id="unameInput" value="${esc(v.username || '')}" maxlength="21" placeholder="@yourname" autocapitalize="none" autocomplete="off" required>
<p class="hint" id="unameHint">3 to 20 characters: letters, numbers, dots or underscores. Nobody else can have the same one, and friends will find you with it. <b>You cannot change it later.</b></p>`}
${lk.department ? lockedRow('Faculty', curFac || '-') + lockedRow('Department / course of study', v.department) : `<label class="mut">Faculty</label><select name="faculty" id="facSel"${student ? ' required' : ''}>${facOpts}</select>
<label class="mut">Department / course of study</label><select name="department" id="deptSel"${student ? ' required' : ''}>${depOpts}</select>`}
${optRow}
${lk.level ? lockedRow('Level', v.level + ' level' + (v.graduated ? ' - Graduate' : '')) : `<label class="mut">Level</label><select name="level" id="lvlSel"${student ? ' required' : ''}>${levelOptions(v.level, v.department ? 'Choose your level...' : 'Choose your department first...', v.department)}</select>`}
<p class="hint">${lockedBlock ? 'These are fixed once you have signed up. Your level moves up only when the school admin promotes students; if something is wrong, ask an admin.' : 'Your department and level decide which uploads you see. <b>You cannot change them later</b>, so choose carefully.'}</p>
${lk.university ? lockedRow('University', v.university) : `<label class="mut">University</label><input name="university" value="${esc(v.university || 'University of Uyo')}" maxlength="120"${student ? ' required' : ''}>`}
<label class="mut">Position held in school (optional)</label><input name="position" value="${esc(v.position || '')}" maxlength="60" placeholder="e.g. Director of Socials">
<p class="hint">If you add one, school authorities check it first. Once verified it shows beside your name.</p>${lk.department && lk.option ? '' : script}`;
  }
  const UNAME_JS = `(function(){var i=document.getElementById('unameInput'),h=document.getElementById('unameHint'),t=null;if(!i)return;
i.addEventListener('input',function(){clearTimeout(t);var v=i.value;t=setTimeout(function(){if(!v.replace(/^@+/,'').length)return;fetch('/api/username/check?u='+encodeURIComponent(v)).then(function(r){return r.json()}).then(function(j){h.textContent=j.message;h.className='hint '+(j.ok?'ok':'err')}).catch(function(){})},350)})})();`;
  function readProfile(user, body) {
    const trim = (v, n) => String(v || '').trim().slice(0, n);
    const student = user.role === 'user', lk = lockedOf(user);
    const d = { name: trim(body.name, 80) || user.name, username: cleanUsername(body.username), university: trim(body.university, 120) || null, department: trim(body.department, 120) || null, level: LEVELS.includes(Number(body.level)) && Number(body.level) <= maxLevelFor(trim(body.department, 120) || null) ? Number(body.level) : null, position: trim(body.position, 60) || null };
    // Locked fields can never be changed by the person: whatever was sent is thrown away and the saved value is kept.
    if (lk.username) d.username = user.username;
    if (lk.university) d.university = user.university;
    if (lk.department) d.department = user.department;
    if (lk.level) d.level = user.level;
    d.dept_option = lk.option ? user.dept_option : trim(body.dept_option, 120) || null;
    let problem = lk.username ? '' : usernameProblem(d.username, user.id);
    if (!problem && !lk.department && d.department && !departmentNames().includes(d.department)) problem = 'Choose your department from the list.';
    const myOpts = optionsOf(d.department);
    if (!problem && !lk.option && d.dept_option && !myOpts.includes(d.dept_option)) problem = 'Choose your course from the list.';
    if (!problem && !lk.option && !myOpts.length) d.dept_option = null;
    if (!problem && student && !lk.option && myOpts.length && !d.dept_option) problem = `Choose your course under ${d.department}.`;
    if (!problem && student) {
      if (!d.university) problem = 'Enter your university.';
      else if (!d.department) problem = 'Choose your department from the list.';
      else if (!d.level) problem = 'Choose your level.';
    }
    return { d, problem };
  }
  // Saves the profile. A position needs school authorities' approval (a full admin approves their own); until then no title shows.
  const normPos = v => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
  // No two people at one university may hold (or be waiting to hold) exactly the same position name.
  function positionTaken(university, position, exceptId) {
    const p = normPos(position);
    if (!p || !university) return false;
    return db.prepare("SELECT position FROM users WHERE university=? AND position IS NOT NULL AND position_status IN ('approved','pending') AND id!=?").all(university, exceptId || 0).some(r => normPos(r.position) === p);
  }
  // The controllers (central and full admin) of one university: they receive that university's position claims.
  const uniControllerIds = inst => inst ? db.prepare("SELECT id FROM users WHERE lp_inst=? AND virtual=0 AND role IN ('uniadmin','user')").all(inst).map(r => r.id) : [];
  function saveProfile(user, d) {
    const cur = db.prepare('SELECT username,university,department,level,dept_option FROM users WHERE id=?').get(user.id) || {};
    if (d.position && (d.position || null) !== (user.position || null) && !can.full(user) && positionTaken(cur.university || d.university, d.position, user.id)) return 'Someone at your university already holds or has claimed that exact position. Write it a little differently (for example add your department).';
    try { // a value that is already saved is never overwritten here, whatever the caller passed
      db.prepare('UPDATE users SET name=?, username=?, university=?, department=?, level=?, dept_option=? WHERE id=?').run(d.name, cur.username || d.username, cur.university || d.university, cur.department || d.department, cur.level || d.level, cur.dept_option || d.dept_option || null, user.id);
    } catch { return 'That username is already taken.'; }
    if ((d.position || null) !== (user.position || null)) {
      if (!d.position) db.prepare('UPDATE users SET position=NULL, position_status=NULL, title=NULL WHERE id=?').run(user.id);
      else if (can.full(user)) db.prepare("UPDATE users SET position=?, position_status='approved', title=? WHERE id=?").run(d.position, d.position, user.id);
      else {
        db.prepare("UPDATE users SET position=?, position_status='pending', title=NULL WHERE id=?").run(d.position, user.id);
        const claimant = { department: d.department, level: d.level, university: cur.university || d.university };
        const delegate = db.prepare("SELECT * FROM users WHERE position_status='approved' AND position_can_verify=1").all()
          .filter(v => canVerifyClaim(v, claimant))
          .sort((a, b) => (SCOPE_RANK[a.position_scope] || 1) - (SCOPE_RANK[b.position_scope] || 1))[0];
        const ctl = uniControllerIds(claimant.university);
        if (ctl.length) notify(ctl, { title: 'Position to verify', body: `${d.name} says: ${d.position}`, url: '/uni?tab=positions', tag: 'position' });
        if (delegate) notify([delegate.id], { title: 'Position to verify', body: `${d.name} says: ${d.position}`, url: '/settings', tag: 'position' });
        else if (!ctl.length) notify(fullAdminIds(), { title: 'Position to verify', body: `${d.name} says: ${d.position}`, url: '/admin#positions', tag: 'position' });
      }
    }
    return '';
  }
  const welcomePage = (user, err, v) => layout('Welcome', `<div class="auth" style="max-width:520px"><h1>Welcome to Studies Hub</h1>
<p class="mut">Tell us a little about yourself so we can show you the courses that are meant for you.</p>${err ? `<p class="err">${esc(err)}</p>` : ''}
<form method="post" action="/welcome" class="card" id="welcomeForm" enctype="multipart/form-data">${profileFields(v, user.role === 'user', lockedOf(user))}
<label class="mut">Profile picture</label><input type="file" name="avatar" accept="image/png,image/jpeg,image/webp" ${user.avatar_mime ? '' : 'required'}><button>Save and continue</button></form></div>
<script>${UNAME_JS}(function(){var f=document.getElementById('welcomeForm'),go=false;f.addEventListener('submit',function(e){if(go||!window.enablePush||!window.Notification||Notification.permission!=='default')return;e.preventDefault();go=true;var done=function(){f.submit()};window.enablePush().then(done,done)})})();</script>`, user, { noPushBar: true });
  app.get('/welcome', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/welcome');
    if (req.user.is_lecturer) return res.redirect('/lecturer/welcome');
    if (profileComplete(req.user)) return res.redirect('/dashboard');
    res.send(welcomePage(req.user, '', req.user));
  });
  app.post('/welcome', upload.single('avatar'), (req, res) => {
    if (!req.user) return res.redirect('/login?next=/welcome');
    const { d, problem } = readProfile(req.user, req.body);
    const fail = m => res.status(400).send(welcomePage(req.user, m, { ...d, username: d.username }));
    if (problem) return fail(problem);
    const hasExistingAvatar = !!db.prepare('SELECT avatar_mime FROM users WHERE id=?').get(req.user.id).avatar_mime;
    if (!hasExistingAvatar && !req.file) return fail('Please add a profile picture to finish signing up.');
    if (req.file && !/^image\//.test(req.file.mimetype)) return fail('Choose an image file for your profile picture.');
    const err = saveProfile(req.user, d);
    if (err) return fail(err);
    if (req.file) db.prepare('UPDATE users SET avatar_data=?, avatar_mime=? WHERE id=?').run(req.file.buffer, req.file.mimetype, req.user.id);
    res.redirect('/dashboard?welcome=1');
  });
  return { UNAME_JS, lockedOf, positionTaken, profileFields, readProfile, saveProfile };
};
