// The bell at the top of every page: counts what is new for this person (messages, news, materials, stories, comments on their posts),
// and /notifications lists it. "New" means newer than the last time they opened the list; unread messages stay until they are read.
module.exports = function register(app, ctx) {
  const { db, esc, chatBadge, friendIds, canSeeNewsItem, layout } = ctx;
  db.exec('CREATE TABLE IF NOT EXISTS notif_mark(user_id INTEGER PRIMARY KEY, news INTEGER NOT NULL, pages INTEGER NOT NULL, stories INTEGER NOT NULL, comments INTEGER NOT NULL)');
  const top = t => { try { return db.prepare(`SELECT COALESCE(MAX(id),0) m FROM ${t}`).get().m; } catch (e) { return 0; } };
  const tops = () => ({ news: top('news'), pages: top('pages'), stories: top('stories'), comments: top('news_comments') });
  const marks = uid => {
    let m = db.prepare('SELECT * FROM notif_mark WHERE user_id=?').get(uid);
    if (!m) { const t = tops(); db.prepare('INSERT INTO notif_mark(user_id,news,pages,stories,comments) VALUES(?,?,?,?,?)').run(uid, t.news, t.pages, t.stories, t.comments); m = { user_id: uid, ...t }; }
    return m;
  };
  const q = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch (e) { return []; } };
  function items(user) {
    const uid = user.id, m = marks(uid), out = [];
    const chat = Number(chatBadge(uid)) || 0;
    if (chat > 0) out.push({ n: chat, t: chat + ' unread message' + (chat > 1 ? 's' : ''), d: 'Open your chats', href: '/chat' });
    for (const n of q("SELECT * FROM news WHERE id>? AND status='approved' AND COALESCE(author_id,0)!=? ORDER BY id DESC LIMIT 20", m.news, uid)) { let ok = true; try { ok = !canSeeNewsItem || canSeeNewsItem(n, user); } catch (e) {} if (ok) out.push({ n: 1, t: 'New news', d: n.title, href: '/news/' + n.id }); }
    for (const p of q('SELECT id,slug,title FROM pages WHERE id>? ORDER BY id DESC LIMIT 20', m.pages)) out.push({ n: 1, t: 'New material', d: p.title, href: '/p/' + p.slug });
    const fr = friendIds(uid);
    if (fr.length) {
      const seen = new Set();
      for (const s of q(`SELECT s.id,s.user_id,u.name FROM stories s JOIN users u ON u.id=s.user_id WHERE s.id>? AND s.created_at>? AND s.user_id IN (${fr.map(Number).join(',')}) ORDER BY s.id DESC`, m.stories, Date.now() - 864e5)) { if (seen.has(s.user_id)) continue; seen.add(s.user_id); out.push({ n: 1, t: s.name + ' posted a story', d: 'Tap to watch', href: '/stories/' + s.user_id }); }
    }
    for (const c of q('SELECT c.id,c.news_id,u.name,n.title FROM news_comments c JOIN news n ON n.id=c.news_id JOIN users u ON u.id=c.user_id WHERE c.id>? AND n.author_id=? AND c.user_id!=? ORDER BY c.id DESC LIMIT 20', m.comments, uid, uid)) out.push({ n: 1, t: c.name + ' commented on your post', d: c.title, href: '/news/' + c.news_id + '/comments' });
    return out;
  }
  app.get('/api/notif-count', (req, res) => {
    if (!req.user) return res.status(401).json({ n: 0 });
    let n = 0; try { n = items(req.user).reduce((s, i) => s + i.n, 0); } catch (e) {}
    res.set('Cache-Control', 'no-store').json({ n });
  });
  app.get('/notifications', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/notifications');
    const list = items(req.user);
    const t = tops(); db.prepare('UPDATE notif_mark SET news=?,pages=?,stories=?,comments=? WHERE user_id=?').run(t.news, t.pages, t.stories, t.comments, req.user.id);
    res.set('Cache-Control', 'no-store').send(layout('Notifications', `<h1>Notifications</h1>${list.length ? `<div class="srows">${list.map(i => `<a class="srow" href="${esc(i.href)}"><div><b>${esc(i.t)}</b><span>${esc(i.d)}</span></div><i>&rsaquo;</i></a>`).join('')}</div>` : '<p class="mut" style="text-align:center;margin-top:40px">You are all caught up.</p>'}`, req.user));
  });
};
