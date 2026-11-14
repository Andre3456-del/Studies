// Friends
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { db, notify } = ctx;
  // ---------- friends ----------
  // 'none' | 'sent' (I asked them) | 'received' (they asked me) | 'friends'
  function friendStatus(a, b) {
    const row = db.prepare('SELECT requester_id,status FROM friendships WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)').get(a, b, b, a);
    if (!row) return 'none';
    if (row.status === 'friends') return 'friends';
    return row.requester_id === a ? 'sent' : 'received';
  }
  const friendIds = me => db.prepare("SELECT CASE WHEN requester_id=? THEN addressee_id ELSE requester_id END o FROM friendships WHERE (requester_id=? OR addressee_id=?) AND status='friends'").all(me, me, me).map(r => r.o);
  const pendingReceivedCount = me => db.prepare("SELECT COUNT(*) n FROM friendships WHERE addressee_id=? AND status='pending'").get(me).n;
  // No friend requests: anyone you find can be messaged straight away. Starting a chat makes you contacts both ways.
  try { db.prepare("UPDATE friendships SET status='friends' WHERE status='pending'").run(); } catch (e) {}
  function friendActionHtml(viewerId, otherId) {
    if (friendStatus(viewerId, otherId) === 'friends') return `<a class="btn" href="/chat/${otherId}">Message</a>`;
    return `<form method="post" action="/api/friends/${otherId}/request" style="display:inline"><input type="hidden" name="back" value="/chat/${otherId}"><button>Message</button></form>`;
  }
  app.post('/api/friends/:id/request', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const otherId = Number(req.params.id);
    if (!otherId || otherId === req.user.id || !db.prepare('SELECT 1 FROM users WHERE id=?').get(otherId)) return res.status(400).json({ error: 'User not found.' });
    const st = friendStatus(req.user.id, otherId);
    if (st === 'none') db.prepare("INSERT INTO friendships(requester_id,addressee_id,status) VALUES(?,?,'friends')").run(req.user.id, otherId);
    else if (st !== 'friends') db.prepare("UPDATE friendships SET status='friends' WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)").run(req.user.id, otherId, otherId, req.user.id);
    res.redirect(String((req.body && req.body.back) || '/chat/' + otherId));
  });
  app.post('/api/friends/:id/accept', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const otherId = Number(req.params.id);
    const row = db.prepare("SELECT 1 FROM friendships WHERE requester_id=? AND addressee_id=? AND status='pending'").get(otherId, req.user.id);
    if (row) {
      db.prepare("UPDATE friendships SET status='friends' WHERE requester_id=? AND addressee_id=?").run(otherId, req.user.id);
      notify([otherId], { title: 'Friend request accepted', body: `${req.user.name} accepted your request`, url: '/u/' + req.user.id, tag: 'friend-accept' });
    }
    res.redirect(req.body.back || '/chat?tab=find');
  });
  app.post('/api/friends/:id/decline', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const otherId = Number(req.params.id);
    db.prepare("DELETE FROM friendships WHERE requester_id=? AND addressee_id=? AND status='pending'").run(otherId, req.user.id);
    res.redirect(req.body.back || '/chat?tab=find');
  });
  app.post('/api/friends/:id/cancel', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const otherId = Number(req.params.id);
    db.prepare("DELETE FROM friendships WHERE requester_id=? AND addressee_id=? AND status='pending'").run(req.user.id, otherId);
    res.redirect(req.body.back || '/chat?tab=find');
  });
  app.post('/api/friends/:id/remove', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const otherId = Number(req.params.id);
    db.prepare("DELETE FROM friendships WHERE ((requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)) AND status='friends'").run(req.user.id, otherId, otherId, req.user.id);
    res.redirect(req.body.back || '/chat');
  });
  return { friendActionHtml, friendIds, friendStatus, pendingReceivedCount };
};
