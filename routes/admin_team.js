// Admin team: the central admin appoints admins
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { ROLES, ROLE_LABEL, atLink, central, db, emailEveryone, esc, layout, notify } = ctx;
  // ---------- Admin team: the central admin appoints (and changes) admins by @username, each with just the job they are given ----------
  const TEAM_ROLES = ROLES.filter(r => r !== 'user');
  const ROLE_JOB = { partial: 'Can upload plain HTML pages.', content: 'Can upload every kind of file (PDF, Word, video, CBT).', news: 'Can post news and review what students share.', support: 'Can help people who cannot log in.', observer: 'Can look but not change anything.', admin: 'Full admin: everything except the central admin\'s own powers.' };
  const teamBack = msg => '/admin/team?msg=' + encodeURIComponent(msg);
  app.get('/admin/maintenance', central, (req, res) => {
    const n = db.prepare('SELECT COUNT(*) n FROM users WHERE verified=1').get().n;
    const msg = req.query.msg ? `<p class="pill">${esc(req.query.msg)}</p>` : '';
    res.send(layout('Site notices', `<p class="mut"><a href="/admin">&larr; Admin</a></p><h1>Site notices</h1>${msg}
<p class="mut">Send a message to everyone by email and phone notification. ${n} verified member${n === 1 ? '' : 's'} will receive it. The Studies Hub logo is added for you.</p>
<p class="mut">Your email service has a daily sending limit (Resend's free plan is about 100 a day). If you have more members than that, the rest will not be delivered until you upgrade the plan.</p>
<form method="post" action="/admin/maintenance/start" class="card" onsubmit="return confirm('Send this to all ${n} members?')"><label class="mut">Title</label><input name="title" maxlength="80" required placeholder="What is this about?"><label class="mut">Message</label><textarea name="note" rows="5" maxlength="600" required style="width:100%" placeholder="Write the message people will read"></textarea><button style="margin-top:8px">Send to everyone</button></form>`, req.user));
  });
  app.post('/admin/maintenance/start', central, (req, res) => {
    const note = String(req.body.note || '').trim().slice(0, 600), title = String(req.body.title || '').trim().slice(0, 80);
    if (!note || !title) return res.redirect('/admin/maintenance?msg=' + encodeURIComponent('Please write both a title and a message.'));
    const n = emailEveryone(title, title, note);
    console.log(`Audit: ${req.user.email} sent a site notice to ${n} members`);
    res.redirect('/admin/maintenance?msg=' + encodeURIComponent(`Your message is going out to ${n} members.`));
  });
  app.get('/admin/team', central, (req, res) => {
    const staff = db.prepare("SELECT id,name,email,username,role FROM users WHERE role!='user' AND virtual=0 ORDER BY name").all();
    const roleOpts = (cur, withUser) => (withUser ? ['user'] : []).concat(TEAM_ROLES).map(r => `<option value="${r}"${cur === r ? ' selected' : ''}>${esc(ROLE_LABEL[r])}</option>`).join('');
    const rows = staff.map(u => u.email === ctx.ADMIN_EMAIL
      ? `<div class="card"><b>${esc(u.name)}</b> ${u.username ? `<span class="mut">${atLink(u.username)}</span>` : ''}<br><span class="mut">Central admin</span></div>`
      : `<div class="card"><b>${esc(u.name)}</b> ${u.username ? `<span class="mut">${atLink(u.username)}</span>` : ''}<br><span class="mut">${esc(ROLE_JOB[u.role] || '')}</span>
<form method="post" action="/admin/team/${u.id}/role" class="row" style="gap:6px;margin-top:8px"><select name="role" style="width:auto">${roleOpts(u.role, true)}</select><button>Save</button></form></div>`).join('');
    res.send(layout('Admin team', `<p class="mut"><a href="/admin">&larr; Admin</a></p><h1>Admin team</h1>${req.query.msg ? `<p class="mut">${esc(req.query.msg)}</p>` : ''}
<p class="mut" style="margin-top:0">Give someone a job by their @username. Each role only opens the tools for that job. They stay on the team until you change their role here.</p>
<form class="card" method="post" action="/admin/team/appoint"><label class="mut">@username or email</label><input name="who" placeholder="@username" required maxlength="120" autocapitalize="none" autocomplete="off">
<label class="mut">Role</label><select name="role">${roleOpts('news', false)}</select><button>Appoint</button></form>
<h3>Roles</h3>${TEAM_ROLES.map(r => `<p class="mut" style="margin:2px 0"><b>${esc(ROLE_LABEL[r])}</b> &mdash; ${esc(ROLE_JOB[r] || '')}</p>`).join('')}
<h3>Current team (${staff.length})</h3>${rows || '<p class="mut">No one yet.</p>'}`, req.user));
  });
  function setTeamRole(target, role, by) {
    db.prepare('UPDATE users SET role=? WHERE id=?').run(role, target.id);
    notify([target.id], { title: role === 'user' ? 'Admin role removed' : 'You were appointed: ' + ROLE_LABEL[role], body: role === 'user' ? `${by.name} changed your role back to a normal member.` : `${by.name} gave you a role on Studies Hub. Open Admin to start.`, url: role === 'user' ? '/dashboard' : '/admin', tag: 'role' });
  }
  app.post('/admin/team/appoint', central, (req, res) => {
    const who = String(req.body.who || '').trim().replace(/^@/, '').toLowerCase().slice(0, 120), role = TEAM_ROLES.includes(req.body.role) ? req.body.role : null;
    if (!who || !role) return res.redirect(teamBack('Type a @username and choose a role.'));
    const u = db.prepare('SELECT id,name,email,role,is_lecturer FROM users WHERE lower(username)=? OR lower(email)=?').get(who, who);
    if (!u) return res.redirect(teamBack('No member found with that username or email.'));
    if (u.email === ctx.ADMIN_EMAIL) return res.redirect(teamBack('That is you, the central admin.'));
    if (u.is_lecturer) return res.redirect(teamBack('Lecturer accounts cannot be given admin roles.'));
    setTeamRole(u, role, req.user);
    res.redirect(teamBack(`${u.name} is now: ${ROLE_LABEL[role]}.`));
  });
  app.post('/admin/team/:id/role', central, (req, res) => {
    const role = req.body.role === 'user' ? 'user' : TEAM_ROLES.includes(req.body.role) ? req.body.role : null;
    const u = role && db.prepare('SELECT id,name,email FROM users WHERE id=?').get(req.params.id);
    if (!u || u.email === ctx.ADMIN_EMAIL) return res.redirect(teamBack('Could not change that role.'));
    setTeamRole(u, role, req.user);
    res.redirect(teamBack(role === 'user' ? `${u.name} is a normal member again.` : `${u.name} is now: ${ROLE_LABEL[role]}.`));
  });
};
