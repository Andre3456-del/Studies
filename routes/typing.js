// The little "typing…" and "recording audio…" signal between two people in a chat, or in a group.
const TY = require('../lib/typing_state');
module.exports = function register(app, ctx) {
  const { db, isGroupMember } = ctx;
  app.post('/api/typing', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const b = req.body || {}, type = b.type === 'group' ? 'group' : 'dm', id = Number(b.id), kind = b.kind === 'typing' || b.kind === 'recording' ? b.kind : '';
    if (!id) return res.sendStatus(400);
    if (type === 'group' && !isGroupMember(id, req.user.id)) return res.sendStatus(403);
    TY.set(req.user.id, req.user.name, type, id, kind);
    res.sendStatus(204);
  });
};
