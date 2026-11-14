// Likes, comments and saves on news posts. The icons themselves live in lib/news_actions.js.
const A = require('../lib/news_actions');
module.exports = function register(app, ctx) {
  const { canSeeNewsItem, db, esc, layout, timeAgo } = ctx;
  db.exec(`CREATE TABLE IF NOT EXISTS news_likes (news_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY(news_id, user_id));
CREATE TABLE IF NOT EXISTS news_saves (news_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY(news_id, user_id));
CREATE TABLE IF NOT EXISTS news_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, news_id INTEGER NOT NULL, user_id INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS news_comments_n ON news_comments(news_id, id)`);
  const postOf = (req, id) => { const n = db.prepare("SELECT n.*, u.name AS author FROM news n LEFT JOIN users u ON u.id=n.author_id WHERE n.id=? AND n.status='approved'").get(Number(id)); return n && canSeeNewsItem(n, req.user) ? n : null; };
  const toggle = (table, extra) => (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'login' });
    const n = postOf(req, req.params.id); if (!n) return res.sendStatus(404);
    const had = db.prepare(`SELECT 1 FROM ${table} WHERE news_id=? AND user_id=?`).get(n.id, req.user.id);
    if (had) db.prepare(`DELETE FROM ${table} WHERE news_id=? AND user_id=?`).run(n.id, req.user.id); else db.prepare(`INSERT INTO ${table}(news_id,user_id) VALUES(?,?)`).run(n.id, req.user.id);
    res.json({ on: !had, count: extra ? db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE news_id=?`).get(n.id).c : null });
  };
  app.post('/news/:id/like', toggle('news_likes', true));
  app.post('/news/:id/save', toggle('news_saves', false));

  app.get('/news/saved', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/news/saved');
    const rows = db.prepare("SELECT n.id,n.title,n.created_at FROM news_saves s JOIN news n ON n.id=s.news_id WHERE s.user_id=? AND n.status='approved' ORDER BY n.id DESC").all(req.user.id);
    res.send(layout('Saved news', `<p class="mut"><a href="/news">&larr; News</a></p><h1>Saved</h1>${rows.length ? rows.map(n => `<a class="card" href="/news/${n.id}" style="display:block"><b>${esc(n.title)}</b><br><span class="mut" style="font-size:13px">${timeAgo(n.created_at)}</span></a>`).join('') : '<p class="mut">Nothing saved yet. Tap the bookmark on a post.</p>'}`, req.user));
  });

  const commentsPage = (req, n, err = '') => {
    const rows = db.prepare('SELECT c.*, u.name, u.avatar_mime FROM news_comments c JOIN users u ON u.id=c.user_id WHERE c.news_id=? ORDER BY c.id').all(n.id);
    const list = rows.map(c => `<div class="cm"><a href="/u/${c.user_id}">${ctx.avatarOr({ id: c.user_id, name: c.name, avatar_mime: c.avatar_mime }, 36)}</a><div class="cm-b"><b>${esc(c.name)}</b> <span class="mut" style="font-size:12px">${timeAgo(c.created_at)}</span><p>${esc(c.body)}</p></div>${c.user_id === (req.user && req.user.id) ? `<form method="post" action="/news/${n.id}/comments/${c.id}/delete" style="margin:0"><button class="cm-x" aria-label="Delete">&times;</button></form>` : ''}</div>`).join('');
    const form = req.user ? `<form method="post" action="/news/${n.id}/comments" class="cm-form"><input name="body" maxlength="1000" placeholder="Add a comment" autocomplete="off" required><button aria-label="Send"><svg class="ic" viewBox="0 0 24 24"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg></button></form>` : `<p><a href="/login?next=/news/${n.id}/comments">Log in</a> to comment.</p>`;
    return layout('Comments', `<p class="mut"><a href="/news/${n.id}">&larr; ${esc(n.title)}</a></p><h1>Comments</h1>${err ? `<p class="err">${esc(err)}</p>` : ''}${list || '<p class="mut">No comments yet.</p>'}${form}`, req.user);
  };
  app.get('/news/:id/comments', (req, res) => { const n = postOf(req, req.params.id); if (!n) return res.status(404).send(layout('Not found', '<p><a href="/news">Back to News</a></p>', req.user)); res.set('Cache-Control', 'private, no-cache').send(commentsPage(req, n)); });
  app.post('/news/:id/comments', (req, res) => {
    if (!req.user) return res.redirect('/login');
    const n = postOf(req, req.params.id); if (!n) return res.sendStatus(404);
    const body = String(req.body.body || '').trim().slice(0, 1000);
    if (body) {
      db.prepare('INSERT INTO news_comments(news_id,user_id,body,created_at) VALUES(?,?,?,?)').run(n.id, req.user.id, body, new Date().toISOString().slice(0, 19).replace('T', ' '));
      if (n.author_id && n.author_id !== req.user.id && ctx.notify) { try { ctx.notify([n.author_id], { title: 'New comment', body: `${req.user.name}: ${body.slice(0, 80)}`, url: '/news/' + n.id + '/comments', tag: 'news-comment-' + n.id }); } catch (e) {} }
    }
    res.redirect('/news/' + n.id + '/comments');
  });
  app.post('/news/:id/comments/:cid/delete', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    db.prepare('DELETE FROM news_comments WHERE id=? AND news_id=? AND user_id=?').run(Number(req.params.cid), Number(req.params.id), req.user.id);
    res.redirect('/news/' + Number(req.params.id) + '/comments');
  });
};
