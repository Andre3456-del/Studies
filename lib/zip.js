// A small zip reader/writer (no packages): used by the study-bot batch download and import.
const zlib = require('zlib');
const T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
// entries: [{ name, data: Buffer }] -> Buffer
exports.write = entries => {
  const parts = [], central = []; let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8'), raw = Buffer.from(e.data), def = raw.length <= 2097152 ? zlib.deflateRawSync(raw) : raw, useDef = def !== raw && def.length < raw.length, body = useDef ? def : raw;
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(useDef ? 8 : 0, 8);
    h.writeUInt32LE(crc32(raw), 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(name.length, 26);
    parts.push(h, name, body);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(useDef ? 8 : 0, 10);
    c.writeUInt32LE(crc32(raw), 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, name); off += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
};
// Buffer -> [{ name, data }]. Refuses anything odd (encrypted, zip64, bad sizes) and caps what it will unpack.
exports.read = (buf, { maxFiles = 500, maxBytes = 200 * 1024 * 1024 } = {}) => {
  let e = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('That is not a zip file.');
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16), total = 0; const out = [];
  if (n > maxFiles) throw new Error('Too many files in the zip.');
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('The zip is damaged.');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl); p += 46 + nl + xl + cl;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new Error('The zip is password protected.');
    if (/(^|\/)\.\.(\/|$)|^\/|\\/.test(name)) throw new Error('The zip has an unsafe file name.');
    total += usize; if (total > maxBytes) throw new Error('The zip is too big when unpacked.');
    if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('The zip is damaged.');
    const ds = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28), body = buf.subarray(ds, ds + csize);
    const data = method === 0 ? Buffer.from(body) : method === 8 ? zlib.inflateRawSync(body, { maxOutputLength: maxBytes }) : null;
    if (!data) throw new Error('That zip uses a method this page cannot open.');
    out.push({ name, data });
  }
  return out;
};
exports.crc32 = crc32;
