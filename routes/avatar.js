// Profile pictures
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { db } = ctx;
  app.get('/avatar/:id', (req, res) => {
    const row = db.prepare('SELECT avatar_data, avatar_mime FROM users WHERE id=?').get(req.params.id);
    if (!row || !row.avatar_data) return res.sendStatus(404);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Type', row.avatar_mime || 'application/octet-stream');
    res.send(Buffer.from(row.avatar_data));
  });
};
