// Sticker board (each member's own saved stickers)
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { MAX_STICKERS, STICKER_MIMES, db, decryptBytes, isGroupMember, sendBytes, upload, zlib } = ctx;
  // ---------- sticker board (each member's own saved stickers) ----------
  app.get('/api/stickers', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    res.json({ stickers: db.prepare('SELECT id FROM stickers WHERE user_id=? ORDER BY id DESC').all(req.user.id).map(r => ({ id: r.id })) });
  });
  app.get('/api/stickers/:id', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const st = db.prepare('SELECT * FROM stickers WHERE id=? AND user_id=?').get(Number(req.params.id), req.user.id);
    if (!st) return res.sendStatus(404);
    sendBytes(req, res, Buffer.from(st.data), st.mime);
  });
  app.post('/api/stickers', upload.single('sticker'), (req, res) => {
    if (!req.user) return res.sendStatus(401);
    if (!req.file || !STICKER_MIMES.includes(req.file.mimetype)) return res.status(400).json({ error: 'Choose a PNG, WebP, GIF or JPEG picture.' });
    if (req.file.buffer.length > 1024 * 1024) return res.status(413).json({ error: 'Stickers can be up to 1 MB.' });
    if (db.prepare('SELECT COUNT(*) n FROM stickers WHERE user_id=?').get(req.user.id).n >= MAX_STICKERS) return res.status(400).json({ error: `Your sticker board is full (${MAX_STICKERS}).` });
    const info = db.prepare('INSERT INTO stickers(user_id,mime,data) VALUES(?,?,?)').run(req.user.id, req.file.mimetype, req.file.buffer);
    res.json({ id: Number(info.lastInsertRowid) });
  });
  // A tiny dependency-free .zip reader (stored + deflate entries only -- covers the vast majority of
  // real-world zips, especially ones a phone's "Compress" action creates) so a whole folder of sticker
  // pictures can be dropped in as one file, no extra packages needed.
  function readZipEntries(buf) {
    const EOCD = 0x06054b50, CEN = 0x02014b50, LOC = 0x04034b50;
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65557); i--) {
      if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip file');
    const total = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    const headers = [];
    for (let i = 0; i < total && p + 46 <= buf.length; i++) {
      if (buf.readUInt32LE(p) !== CEN) break;
      const method = buf.readUInt16LE(p + 10), compSize = buf.readUInt32LE(p + 20);
      const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
      const localOffset = buf.readUInt32LE(p + 42);
      const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
      headers.push({ name, method, compSize, localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    const out = [];
    for (const h of headers) {
      if (h.name.endsWith('/') || !h.name || h.name.includes('__MACOSX')) continue;
      const lp = h.localOffset;
      if (lp + 30 > buf.length || buf.readUInt32LE(lp) !== LOC) continue;
      const lNameLen = buf.readUInt16LE(lp + 26), lExtraLen = buf.readUInt16LE(lp + 28);
      const dataStart = lp + 30 + lNameLen + lExtraLen;
      const comp = buf.subarray(dataStart, dataStart + h.compSize);
      let data;
      if (h.method === 0) data = comp;
      else if (h.method === 8) { try { data = zlib.inflateRawSync(comp); } catch { continue; } }
      else continue; // unsupported (rare) compression method -- skip rather than fail the whole zip
      out.push({ name: h.name, data });
    }
    return out;
  }
  const EXT_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
  // Stickers now live on the device (IndexedDB), not the server, so there's no per-sticker size cap and no
  // board limit any more -- this route is a stateless unzip-and-hand-back service; nothing here is stored.
  app.post('/api/stickers/zip', upload.single('zip'), (req, res) => {
    if (!req.user) return res.sendStatus(401);
    if (!req.file) return res.status(400).json({ error: 'Choose a .zip file first.' });
    let entries;
    try { entries = readZipEntries(req.file.buffer); } catch { return res.status(400).json({ error: 'That does not look like a valid .zip file.' }); }
    const images = [], MAX_PER_ZIP = 200; // a sanity cap on one request's unzip work, not a storage limit
    let skipped = 0;
    for (const e of entries) {
      if (images.length >= MAX_PER_ZIP) { skipped++; continue; }
      const ext = (/\.([a-z0-9]+)$/i.exec(e.name) || [])[1];
      const mime = ext && EXT_MIME[ext.toLowerCase()];
      if (!mime) { skipped++; continue; }
      images.push({ mime, data: e.data.toString('base64') });
    }
    res.json({ images, skipped });
  });
  app.post('/api/stickers/:id/delete', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    db.prepare('DELETE FROM stickers WHERE id=? AND user_id=?').run(Number(req.params.id), req.user.id);
    res.json({ ok: true });
  });
  // Save a sticker someone sent you onto your own board.
  app.post('/api/stickers/from-message/:mid', (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const m = db.prepare("SELECT * FROM messages WHERE id=? AND kind='sticker'").get(Number(req.params.mid));
    if (!m) return res.status(404).json({ error: 'Sticker not found.' });
    const allowed = m.group_id ? isGroupMember(m.group_id, req.user.id) : (m.sender_id === req.user.id || m.recipient_id === req.user.id);
    if (!allowed || m.deleted_at) return res.status(404).json({ error: 'Sticker not found.' });
    if (db.prepare('SELECT COUNT(*) n FROM stickers WHERE user_id=?').get(req.user.id).n >= MAX_STICKERS) return res.status(400).json({ error: `Your sticker board is full (${MAX_STICKERS}).` });
    const buf = decryptBytes(m.media_enc, m.media_iv);
    if (!buf) return res.status(404).json({ error: 'Sticker not found.' });
    db.prepare('INSERT INTO stickers(user_id,mime,data) VALUES(?,?,?)').run(req.user.id, m.media_mime, buf);
    res.json({ ok: true });
  });
};
