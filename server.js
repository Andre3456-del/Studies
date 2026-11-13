const express = require('express');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite'); // built into Node 22.13+, nothing to compile
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'site.db'));

// Big files arrive in small numbered pieces (the Android app sends them this way so a weak network can
// pause and carry on). When the final request says X-Assembled, the pieces are joined and handed to the
// same handler a normal upload would reach.
const UP_DIR = path.join(DATA_DIR, 'up_chunks');
fs.mkdirSync(UP_DIR, { recursive: true });
const upDir = (uid, id) => path.join(UP_DIR, `${Number(uid)}_${String(id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60)}`);
setInterval(() => { try { for (const d of fs.readdirSync(UP_DIR)) { const p = path.join(UP_DIR, d); if (Date.now() - fs.statSync(p).mtimeMs > 48 * 3600e3) fs.rmSync(p, { recursive: true, force: true }); } } catch (e) {} }, 3600e3).unref();
const b64txt = s => Buffer.from(String(s || ''), 'base64').toString('utf8');
function assembledUpload(req, res, next) {
  if (!req.user) return res.sendStatus(401);
  try {
    const d = upDir(req.user.id, req.headers['x-assembled']), total = Number(req.headers['x-chunks']);
    if (!Number.isInteger(total) || total < 1 || total > 4000) return res.status(400).json({ error: 'Upload incomplete.' });
    const parts = [];
    let size = 0;
    for (let k = 0; k < total; k++) {
      const f = path.join(d, k + '.part');
      if (!fs.existsSync(f)) return res.status(409).json({ error: 'Upload incomplete.' });
      const b = fs.readFileSync(f); size += b.length; parts.push(b);
      if (size > 200 * 1024 * 1024) return res.status(413).json({ error: 'That file is too big (200 MB is the limit).' });
    }
    const fields = {};
    for (const [k, v] of JSON.parse(b64txt(req.headers['x-fields']) || '[]')) { if (k in fields) fields[k] = [].concat(fields[k], v); else fields[k] = v; }
    req.file = { fieldname: 'file', originalname: b64txt(req.headers['x-filename']) || 'file', mimetype: String(req.headers['x-mime'] || 'application/octet-stream').slice(0, 100), buffer: Buffer.concat(parts), size };
    req.body = Object.assign({}, req.body, fields);
    fs.rmSync(d, { recursive: true, force: true });
    next();
  } catch (e) { res.status(400).json({ error: 'Upload incomplete.' }); }
}
const _single = upload.single.bind(upload);
upload.single = name => { const mw = _single(name); return (req, res, next) => req.headers['x-assembled'] ? assembledUpload(req, res, next) : mw(req, res, next); };
db.exec('PRAGMA journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', created_at TEXT DEFAULT CURRENT_TIMESTAMP, verified INTEGER NOT NULL DEFAULT 0, verify_hash TEXT, verify_expires INTEGER, verify_sent INTEGER);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS device_links(token TEXT PRIMARY KEY, created INTEGER NOT NULL, label TEXT, user_id INTEGER, approved INTEGER, done INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS linked_devices(sid TEXT PRIMARY KEY, user_id INTEGER NOT NULL, label TEXT, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS pages(id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, html TEXT NOT NULL, members_only INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS purchases(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, page_id INTEGER NOT NULL, reference TEXT UNIQUE NOT NULL, amount INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, page_id));
CREATE TABLE IF NOT EXISTS courses(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS lecturer_courses(lecturer_id INTEGER NOT NULL, course_id INTEGER NOT NULL, PRIMARY KEY(lecturer_id, course_id));
`);try { db.exec('ALTER TABLE device_links ADD COLUMN kind TEXT'); } catch (e) { /* already there */ }

// Upgrade older databases that predate email verification
const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
for (const [c, def] of [['gsignup', 'INTEGER NOT NULL DEFAULT 0'], ['can_promote', 'INTEGER NOT NULL DEFAULT 0'], ['verified', 'INTEGER NOT NULL DEFAULT 0'], ['verify_hash', 'TEXT'], ['verify_expires', 'INTEGER'], ['verify_sent', 'INTEGER'], ['reset_hash', 'TEXT'], ['reset_expires', 'INTEGER'], ['reset_attempts', 'INTEGER NOT NULL DEFAULT 0'], ['last_seen', 'INTEGER'], ['avatar_data', 'BLOB'], ['avatar_mime', 'TEXT'], ['department', 'TEXT'], ['university', 'TEXT'], ['course', 'TEXT'], ['title', 'TEXT'], ['can_set_title', 'INTEGER NOT NULL DEFAULT 0'], ['username', 'TEXT'], ['level', 'INTEGER'], ['position', 'TEXT'], ['position_status', 'TEXT'],
  // A verified position can carry real reach and capability: how far their news posts travel (their own
  // department+level, their whole faculty, or the whole school), what admin capability it grants automatically,
  // and -- for positions that need a specific person's sign-off rather than the general news queue -- who that is.
  ['position_scope', 'TEXT'], ['position_auto_role', 'TEXT'], ['position_approver_id', 'INTEGER'], ['position_can_verify', 'INTEGER NOT NULL DEFAULT 0'],
  // Lecturers are a separate account type entirely -- their own signup link, their own verification
  // (by a full admin, shown which institution they claimed), their own interface. is_lecturer marks the
  // account type; lecturer_status tracks pending/approved/rejected; lecturer_reg_no is optional.
  ['is_lecturer', 'INTEGER NOT NULL DEFAULT 0'], ['lecturer_status', 'TEXT'], ['lecturer_reg_no', 'TEXT'],
  ['theme', 'TEXT'], ['hide_active', 'INTEGER NOT NULL DEFAULT 0'], ['email_notify', 'INTEGER NOT NULL DEFAULT 1'], ['lp_inst', 'TEXT'], ['uni_role', 'TEXT'], ['virtual', 'INTEGER NOT NULL DEFAULT 0'], ['sub_role', 'TEXT'], ['sub_inst', 'TEXT'], ['sub_perms', 'TEXT'], ['sub_title', 'TEXT'], ['sub_by', 'INTEGER'], ['graduated', 'INTEGER NOT NULL DEFAULT 0'], ['graduated_at', 'TEXT'], ['dept_option', 'TEXT']])
  if (!userCols.includes(c)) db.exec(`ALTER TABLE users ADD COLUMN ${c} ${def}`);
// Upgrade older databases that predate paid/media pages
const pageCols = db.prepare('PRAGMA table_info(pages)').all().map(c => c.name);
for (const [c, def] of [['kind', "TEXT NOT NULL DEFAULT 'html'"], ['paid', 'INTEGER NOT NULL DEFAULT 0'], ['price_kobo', 'INTEGER'], ['file_data', 'BLOB'], ['file_mime', 'TEXT'], ['file_name', 'TEXT'], ['admin_id', 'INTEGER'], ['video_id', 'TEXT'], ['dept', 'TEXT'], ['level', 'INTEGER'], ['author_id', 'INTEGER'], ['course_id', 'INTEGER']])
  if (!pageCols.includes(c)) db.exec(`ALTER TABLE pages ADD COLUMN ${c} ${def}`);
if (!pageCols.includes('university')) db.exec('ALTER TABLE pages ADD COLUMN university TEXT');
db.exec('CREATE TABLE IF NOT EXISTS secrets(key TEXT PRIMARY KEY, value TEXT NOT NULL)');
db.exec('CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, sender_id INTEGER NOT NULL, recipient_id INTEGER NOT NULL, body_enc BLOB NOT NULL, iv BLOB NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
db.exec('CREATE INDEX IF NOT EXISTS messages_pair ON messages(sender_id, recipient_id)');
// Voice notes and stickers ride on the same messages table (kind = text | voice | sticker); their media is encrypted too.
const msgCols = db.prepare('PRAGMA table_info(messages)').all().map(c => c.name);
for (const [c, def] of [['kind', "TEXT NOT NULL DEFAULT 'text'"], ['media_enc', 'BLOB'], ['media_iv', 'BLOB'], ['media_mime', 'TEXT'], ['media_ms', 'INTEGER'], ['media_name', 'TEXT'], ['media_size', 'INTEGER']])
  if (!msgCols.includes(c)) db.exec(`ALTER TABLE messages ADD COLUMN ${c} ${def}`);
// Each member's personal sticker board.
db.exec('CREATE TABLE IF NOT EXISTS stickers(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
db.exec('CREATE INDEX IF NOT EXISTS stickers_user ON stickers(user_id)');
const purchaseCols = db.prepare('PRAGMA table_info(purchases)').all().map(c => c.name);
for (const [c, def] of [['status', "TEXT NOT NULL DEFAULT 'pending'"]])
  if (!purchaseCols.includes(c)) db.exec(`ALTER TABLE purchases ADD COLUMN ${c} ${def}`);
db.exec("CREATE TABLE IF NOT EXISTS news(id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, image_url TEXT, author_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP)");
const newsCols = db.prepare('PRAGMA table_info(news)').all().map(c => c.name);
if (!newsCols.includes('status')) db.exec("ALTER TABLE news ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'");
// image_url stays only so news posted before this fix still shows its picture -- every new submission uses
// image_data/image_mime instead (a real uploaded image file, not a pasted link).
if (!newsCols.includes('image_data')) db.exec('ALTER TABLE news ADD COLUMN image_data BLOB');
if (!newsCols.includes('image_mime')) db.exec('ALTER TABLE news ADD COLUMN image_mime TEXT');
// Scope: NULL means visible to everyone (every existing post, and anything from an unscoped poster, stays
// exactly as before). 'own' restricts to one department+level; 'faculty' restricts to every department sharing
// that faculty. approver_id/status support a post that needs one specific person's sign-off instead of the
// general news queue -- their approval publishes it directly.
for (const [c, def] of [['scope_type', 'TEXT'], ['scope_department', 'TEXT'], ['scope_level', 'INTEGER'], ['scope_faculty', 'TEXT'], ['approver_id', 'INTEGER'], ['approver_status', 'TEXT'], ['scope_university', 'TEXT']])
  if (!newsCols.includes(c)) db.exec(`ALTER TABLE news ADD COLUMN ${c} ${def}`);
// Paid promotional posts from businesses/services -- shown in News, separately from regular submissions.
db.exec("CREATE TABLE IF NOT EXISTS feedback(id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, who TEXT, rating INTEGER, liked TEXT, suggest TEXT, other TEXT, read INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)");
db.exec(`CREATE TABLE IF NOT EXISTS sponsor_posts(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, contact TEXT, image_data BLOB, image_mime TEXT, reference TEXT UNIQUE NOT NULL, amount_kobo INTEGER NOT NULL, duration_days INTEGER NOT NULL DEFAULT 30, status TEXT NOT NULL DEFAULT 'pending_payment', created_at TEXT DEFAULT CURRENT_TIMESTAMP, expires_at TEXT)`);
const sponsorCols = db.prepare('PRAGMA table_info(sponsor_posts)').all().map(c => c.name);
if (!sponsorCols.includes('duration_days')) db.exec("ALTER TABLE sponsor_posts ADD COLUMN duration_days INTEGER NOT NULL DEFAULT 30");
// ---- usernames, departments, friends, groups, receipts, reactions, push subscriptions ----
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users(lower(username))');
db.exec(`
CREATE TABLE IF NOT EXISTS level_log(id INTEGER PRIMARY KEY, by_user INTEGER NOT NULL, department TEXT, from_level INTEGER, moved INTEGER NOT NULL, at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS departments(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, faculty TEXT NOT NULL DEFAULT 'Other', max_level INTEGER NOT NULL DEFAULT 500);
CREATE TABLE IF NOT EXISTS friendships(id INTEGER PRIMARY KEY, requester_id INTEGER NOT NULL, addressee_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(requester_id, addressee_id));
CREATE TABLE IF NOT EXISTS groups(id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_by INTEGER NOT NULL, avatar_data BLOB, avatar_mime TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS group_members(group_id INTEGER NOT NULL, user_id INTEGER NOT NULL, role TEXT NOT NULL DEFAULT 'member', added_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(group_id, user_id));
CREATE TABLE IF NOT EXISTS message_reads(message_id INTEGER NOT NULL, user_id INTEGER NOT NULL, read_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(message_id, user_id));
CREATE TABLE IF NOT EXISTS message_hidden(message_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY(message_id, user_id));
CREATE TABLE IF NOT EXISTS message_stars(user_id INTEGER NOT NULL, message_id INTEGER NOT NULL, PRIMARY KEY(user_id, message_id));
CREATE TABLE IF NOT EXISTS chat_prefs(user_id INTEGER NOT NULL, kind TEXT NOT NULL, target_id INTEGER NOT NULL, pinned_at INTEGER, archived_upto INTEGER, muted INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0, unread_mark INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, kind, target_id));
CREATE TABLE IF NOT EXISTS message_reactions(message_id INTEGER NOT NULL, user_id INTEGER NOT NULL, emoji TEXT NOT NULL, PRIMARY KEY(message_id, user_id));
CREATE TABLE IF NOT EXISTS push_subscriptions(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, endpoint TEXT UNIQUE NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS friendships_addr ON friendships(addressee_id, status);
CREATE INDEX IF NOT EXISTS gm_user ON group_members(user_id);
CREATE INDEX IF NOT EXISTS push_user ON push_subscriptions(user_id);
`);
if (!db.prepare('PRAGMA table_info(departments)').all().some(c => c.name === 'max_level')) db.exec('ALTER TABLE departments ADD COLUMN max_level INTEGER NOT NULL DEFAULT 500');
const msgCols2 = db.prepare('PRAGMA table_info(messages)').all().map(c => c.name);
for (const [c, def] of [['group_id', 'INTEGER'], ['edited_at', 'TEXT'], ['deleted_at', 'TEXT'], ['deleted_by', 'INTEGER'], ['reply_to_id', 'INTEGER'], ['delivered_at', 'TEXT'], ['forwarded', 'INTEGER NOT NULL DEFAULT 0']])
  if (!msgCols2.includes(c)) db.exec(`ALTER TABLE messages ADD COLUMN ${c} ${def}`);
db.exec('CREATE INDEX IF NOT EXISTS messages_undelivered ON messages(recipient_id, delivered_at)');
const groupCols = db.prepare('PRAGMA table_info(groups)').all().map(c => c.name);
for (const [c, def] of [['avatar_data', 'BLOB'], ['avatar_mime', 'TEXT']])
  if (!groupCols.includes(c)) db.exec(`ALTER TABLE groups ADD COLUMN ${c} ${def}`);
db.exec('CREATE INDEX IF NOT EXISTS messages_group ON messages(group_id)');
// Pay-to-view is only for CBT (quiz) uploads now -- anything else that was marked paid becomes free.
db.prepare("UPDATE pages SET paid=0 WHERE paid=1 AND kind != 'cbt'").run();

// The starting list of programmes / departments (grouped by faculty). A full admin can add or remove entries in /admin.
const DEPARTMENT_SEED = {
  'Agriculture': ['Agricultural Economics and Extension', 'Animal Science', 'Crop Science', 'Fisheries and Aquaculture', 'Food Science and Technology', 'Forestry and Wildlife', 'Home Economics', 'Soil Science'],
  'Arts': ['Communication Arts', 'English', 'Foreign Languages', 'History and International Studies', 'Linguistics and Nigerian Languages', 'Music', 'Philosophy', 'Religious Studies'],
  'Basic Medical Sciences': ['Anatomy', 'Physiology'],
  'Business Administration': ['Accounting', 'Banking and Finance', 'Business Management', 'Marketing', 'Public Administration'],
  'Clinical Sciences / Health': ['Medicine and Surgery', 'Medical Laboratory Science', 'Nursing Science'],
  'Education': ['Accounting Education', 'Business Education', 'Curriculum Studies, Educational Management and Planning', 'Guidance and Counselling', 'Human Kinetics and Health Education', 'Library and Information Science', 'Science Education'],
  'Engineering': ['Agricultural Engineering', 'Chemical Engineering', 'Civil Engineering', 'Computer Engineering', 'Electrical/Electronic Engineering', 'Food Engineering', 'Mechanical Engineering', 'Petroleum Engineering'],
  'Environmental Studies': ['Architecture', 'Building', 'Estate Management', 'Geoinformatics and Surveying', 'Geography and Natural Resources Management', 'Urban and Regional Planning'],
  'Law': ['Law'],
  'Pharmacy': ['Pharmacy'],
  'Science': ['Animal and Environmental Biology', 'Biochemistry', 'Botany and Ecological Studies', 'Chemistry', 'Computer Science', 'Mathematics', 'Microbiology', 'Physics', 'Statistics'],
  'Social Sciences': ['Development Communication', 'Economics', 'Political Science', 'Psychology', 'Sociology and Anthropology'],
};
if (!db.prepare('SELECT 1 FROM departments LIMIT 1').get()) {
  const insDept = db.prepare('INSERT OR IGNORE INTO departments(name,faculty) VALUES(?,?)');
  for (const [fac, list] of Object.entries(DEPARTMENT_SEED)) for (const d of list) insDept.run(d, fac);
}
db.prepare("UPDATE users SET verified=1 WHERE role='admin'").run();
db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());

// Admin account: email defaults to the owner's address; password comes from ADMIN_PASSWORD
let ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'studieshub.org@gmail.com').toLowerCase();
const existingAdmin = db.prepare("SELECT id,email FROM users WHERE role='admin'").get();
if (!existingAdmin) {
  const generated = !process.env.ADMIN_PASSWORD;
  const pass = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  db.prepare('INSERT INTO users(name,email,hash,role,verified) VALUES(?,?,?,?,1)').run('Admin', ADMIN_EMAIL, bcrypt.hashSync(pass, 12), 'admin');
  console.log(`Admin account created: ${ADMIN_EMAIL}` + (generated ? `  password: ${pass}  (set ADMIN_PASSWORD to choose your own)` : ''));
} else {
  if (existingAdmin.email !== ADMIN_EMAIL) {
    if (db.prepare('SELECT 1 FROM users WHERE email=? AND id!=?').get(ADMIN_EMAIL, existingAdmin.id)) {
      // Someone already registered with that address: do not crash and do not touch their account. Keep the admin on its current email until that account is removed.
      console.log(`WARNING: ${ADMIN_EMAIL} is already used by another account, so the admin email was NOT changed (still ${existingAdmin.email}). Remove that account in Admin > Users, then restart.`);
      ADMIN_EMAIL = existingAdmin.email;
    } else {
      db.prepare('UPDATE users SET email=? WHERE id=?').run(ADMIN_EMAIL, existingAdmin.id);
      console.log(`Admin email updated to ${ADMIN_EMAIL}`);
    }
  }
  // Keep the admin password in sync with ADMIN_PASSWORD on every start, so setting it
  // (or changing it) in Variables always takes effect -- no need to reset the database.
  if (process.env.ADMIN_PASSWORD) db.prepare('UPDATE users SET hash=? WHERE id=?').run(bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12), existingAdmin.id);
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
// Safety headers on every response: the site cannot be shown inside someone else's page (click-jacking), browsers
// must not guess file types, the address of this site is not leaked to other sites, and HTTPS is remembered.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=(self), payment=(self), usb=(), serial=()');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self'; base-uri 'self'; object-src 'none'");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  if (process.env.NODE_ENV === 'production' || req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
// Forged-request shield: a browser that is changing something (POST/PUT/PATCH/DELETE) from a different website,
// or from a sandboxed page, is turned away. Phones and apps that send no Origin at all are unaffected.
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const o = req.headers.origin, site = req.headers['sec-fetch-site'];
  if (site === 'cross-site') return res.status(403).type('text').send('Blocked: this request came from another website.');
  if (o) {
    let ok = false;
    try { const h = new URL(o).host, mine = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim(); ok = h === mine; if (!ok && process.env.BASE_URL) ok = h === new URL(process.env.BASE_URL).host; } catch (e) { ok = false; }
    if (!ok) return res.status(403).type('text').send('Blocked: this request came from another website.');
  }
  next();
});
// Squeeze pages and data before they travel (about 5 to 8 times smaller): on a slow phone connection this is the biggest speed-up there is.
app.use((req, res, next) => {
  if (!/\bgzip\b/.test(String(req.headers['accept-encoding'] || '')) || req.headers.range) return next();
  const send = res.send;
  res.send = function (body) {
    try {
      const isStr = typeof body === 'string', isBuf = Buffer.isBuffer(body);
      if ((isStr || isBuf) && !res.getHeader('Content-Encoding') && res.statusCode !== 204 && res.statusCode !== 304 && req.method !== 'HEAD') {
        const ct = String(res.getHeader('Content-Type') || (isStr ? 'text/html' : ''));
        if (/^(text\/|application\/(json|javascript|xml)|image\/svg)/i.test(ct) && Buffer.byteLength(body) > 1024) {
          const z = zlib.gzipSync(isStr ? Buffer.from(body, 'utf8') : body, { level: 5 });
          res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Vary', 'Accept-Encoding');
          if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
          return send.call(this, z);
        }
      }
    } catch (e) { /* send it plain */ }
    return send.call(this, body);
  };
  next();
});
// ---- shared page parts as files ----
const ASSET_DIR = path.join(DATA_DIR, 'web-assets');
try { fs.mkdirSync(ASSET_DIR, { recursive: true }); } catch (e) { /* ignore */ }
const ASSET_MEM = new Map();    // file name -> text
const ASSET_BLOCKS = [];        // [{ full, ref }]
function externalize(html) {
  for (const b of ASSET_BLOCKS) if (html.includes(b.full)) html = html.split(b.full).join(b.ref);
  return html;
}
function harvestAssets() {
  const fake = (id, role) => ({ id, name: 'Sample User', username: 'sample' + id, email: `sample${id}@example.com`, role, verified: 1, university_id: 1, department_id: 1, level: 100, avatar: null, created_at: '2020-01-01' });
  const users = [null, fake(1, 'student'), fake(2, 'admin')];
  const seen = new Map();
  for (const u of users) for (const o of [{}, { footer: true }]) {
    let h = '';
    try { h = layoutRaw('Sample', '<p>Sample</p>', u, o); } catch (e) { continue; }
    const here = new Set();
    for (const m of h.matchAll(/<(script|style)>([\s\S]*?)<\/\1>/g)) here.add(m[1] + '\u0000' + m[2]);
    for (const k of here) seen.set(k, (seen.get(k) || 0) + 1);
  }
  ASSET_BLOCKS.length = 0;
  for (const [k, n] of seen) {
    const [tag, content] = k.split('\u0000');
    if (n < 2 || content.length < 400 || /<\/(script|style)/i.test(content)) continue;
    const ext = tag === 'script' ? 'js' : 'css';
    const name = require('crypto').createHash('sha1').update(content).digest('hex').slice(0, 12) + '.' + ext;
    ASSET_MEM.set(name, content);
    try { const f = path.join(ASSET_DIR, name); if (!fs.existsSync(f)) fs.writeFileSync(f, content); } catch (e) { /* kept in memory */ }
    ASSET_BLOCKS.push({ full: `<${tag}>${content}</${tag}>`, ref: ext === 'js' ? `<script src="/assets/${name}"></script>` : `<link rel="stylesheet" href="/assets/${name}">` });
  }
  return ASSET_MEM.size;
}
app.get('/assets/:f', (req, res, next) => {
  const f = req.params.f;
  if (!/^[a-f0-9]{12}\.(js|css)$/.test(f)) return next();
  let t = ASSET_MEM.get(f);
  if (t === undefined) { try { t = fs.readFileSync(path.join(ASSET_DIR, f), 'utf8'); } catch (e) { return res.status(404).end(); } }
  res.set({ 'Content-Type': f.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable' });
  res.send(t);
});
// ---- live updates: when content changes (an upload, a news post, an approval), every open page is told, so counts and lists change at once ----
const liveClients = new Set();
let liveTimer = null;
function liveBump() {
  if (liveTimer) return;
  liveTimer = setTimeout(() => { liveTimer = null; for (const r of liveClients) { try { r.write('data: content\n\n'); } catch (e) { liveClients.delete(r); } } }, 700);
}
app.use((req, res, next) => {
  if (req.method === 'POST' || req.method === 'DELETE') {
    res.on('finish', () => { if (res.statusCode < 400 && /^\/(admin|lecturer|uni)\//.test(req.path) && !/^\/admin\/(checks|maintenance)/.test(req.path)) liveBump(); });
  }
  next();
});
app.use(express.urlencoded({ extended: false }));
const jsonSmall = express.json({ limit: '20kb' }), jsonBackup = express.json({ limit: '1mb' });
app.use((req, res, next) => (req.path === '/api/backup' ? jsonBackup : jsonSmall)(req, res, next));

// ---------- optional features (each turns on only when its variables are set) ----------
const GOOGLE_ON = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const AI = process.env.GROQ_API_KEY ? 'groq' : process.env.ANTHROPIC_API_KEY ? 'claude' : null;
const AI_MODEL = process.env.AI_MODEL || (AI === 'groq' ? 'llama-3.3-70b-versatile' : 'claude-haiku-4-5-20251001');
const PRICE_NGN = Number(process.env.PRICE_NGN || 100);
// Paid pages are unlocked by a direct bank transfer, confirmed by hand in /admin -- not a payment gateway.
const BANK_NAME = process.env.BANK_NAME || 'OPay';
const BANK_ACCOUNT_NUMBER = process.env.BANK_ACCOUNT_NUMBER || '7043309103';
const BANK_ACCOUNT_NAME = process.env.BANK_ACCOUNT_NAME || 'Esseabasi Usen Inyangmme';
const PRICE_KOBO = Math.round(PRICE_NGN * 100);
const SPONSOR_PRICE_NGN = Number(process.env.SPONSOR_PRICE_NGN || 2500);
const SPONSOR_PRICE_KOBO = Math.round(SPONSOR_PRICE_NGN * 100);
const FLW_PUBLIC_KEY = process.env.FLUTTERWAVE_PUBLIC_KEY || process.env.FLW_PUBLIC_KEY || '';
const FLW_SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY || process.env.FLW_SECRET_KEY || '';
const FLW_ON = !!FLW_SECRET_KEY; // the hosted payment page only needs the secret key
// Always re-verify against Flutterwave's own record of the transaction -- the browser's "payment successful"
// callback is never trusted by itself, since that could be spoofed by anyone who can run JavaScript.
// JSON for use inside an inline <script>: also escapes < > & so a title or name containing "</script>" can't break out of it.
const jsForScript = v => JSON.stringify(v).replace(/[<>&\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
async function verifyFlutterwave(transactionId) {
  try {
    const r = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`, {
      headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` },
    });
    const j = await r.json();
    if (j && j.status === 'success' && j.data && j.data.status === 'successful') return j.data;
  } catch {}
  return null;
}

// Messages are encrypted at rest with AES-256-GCM, so a stolen copy of the database file is unreadable.
// The key auto-generates once and lives in this database from then on -- MESSAGE_KEY can override it.
let storedKey = db.prepare("SELECT value FROM secrets WHERE key='message_key'").get();
if (!storedKey) {
  const generated = crypto.randomBytes(32).toString('base64');
  db.prepare("INSERT INTO secrets(key,value) VALUES('message_key',?)").run(generated);
  storedKey = { value: generated };
}
const MESSAGE_KEY = Buffer.from(process.env.MESSAGE_KEY || storedKey.value, 'base64');
function encryptMsg(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', MESSAGE_KEY, iv);
  const body_enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return { body_enc, iv };
}
function decryptMsg(body_enc, iv) {
  const buf = Buffer.from(body_enc), tag = buf.subarray(buf.length - 16), enc = buf.subarray(0, buf.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', MESSAGE_KEY, Buffer.from(iv));
  decipher.setAuthTag(tag);
  try { return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8'); }
  catch { return '[unreadable message]'; }
}
// Same AES-256-GCM, for raw bytes (voice notes and sticker images).
function encryptBytes(buf) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', MESSAGE_KEY, iv);
  return { enc: Buffer.concat([cipher.update(buf), cipher.final(), cipher.getAuthTag()]), iv };
}
function decryptBytes(enc, iv) {
  const buf = Buffer.from(enc), tag = buf.subarray(buf.length - 16), body = buf.subarray(0, buf.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', MESSAGE_KEY, Buffer.from(iv));
  decipher.setAuthTag(tag);
  try { return Buffer.concat([decipher.update(body), decipher.final()]); } catch { return null; }
}
const SECURE = process.env.NODE_ENV === 'production' ? '; Secure' : '';

// ---------- brand assets (the Studies logo lives in the assets folder) ----------
const LOGO_PNG = fs.readFileSync(path.join(__dirname, 'assets', 'logo.png')); // the Studies logo (assets/logo.png)
const ICON_192 = fs.readFileSync(path.join(__dirname, 'assets', 'icon-192.png')); // the Studies logo (assets/icon-192.png)
const ICON_512 = fs.readFileSync(path.join(__dirname, 'assets', 'icon-512.png')); // the Studies logo (assets/icon-512.png)

// ---------- web push (built in -- no extra packages): VAPID keys + encrypted payloads, RFC 8291 / 8292 ----------
let vapidRow = db.prepare("SELECT value FROM secrets WHERE key='vapid_jwk'").get();
if (!vapidRow) {
  const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const value = JSON.stringify(kp.privateKey.export({ format: 'jwk' }));
  db.prepare("INSERT INTO secrets(key,value) VALUES('vapid_jwk',?)").run(value);
  vapidRow = { value };
}
const VAPID_JWK = JSON.parse(vapidRow.value);
const VAPID_KEY = crypto.createPrivateKey({ key: VAPID_JWK, format: 'jwk' });
const b64u = b => Buffer.from(b).toString('base64url');
const VAPID_PUBLIC = b64u(Buffer.concat([Buffer.from([4]), Buffer.from(VAPID_JWK.x, 'base64url'), Buffer.from(VAPID_JWK.y, 'base64url')]));
function vapidHeader(endpoint) {
  const m = /<([^>]+)>/.exec(process.env.EMAIL_FROM || '');
  const sub = 'mailto:' + (m ? m[1] : (process.env.EMAIL_FROM && process.env.EMAIL_FROM.includes('@') ? process.env.EMAIL_FROM : ADMIN_EMAIL));
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub }));
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + claims), { key: VAPID_KEY, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${VAPID_PUBLIC}`;
}
function encryptPush(payload, p256dh, authSecret) {
  const ua = Buffer.from(p256dh, 'base64url'), auth = Buffer.from(authSecret, 'base64url');
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const asPub = ecdh.getPublicKey(), secret = ecdh.computeSecret(ua), salt = crypto.randomBytes(16);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, ct]);
}
async function pushTo(sub, payload) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(sub.endpoint, {
      method: 'POST', signal: ctl.signal,
      headers: { Authorization: vapidHeader(sub.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(Math.max(0, Math.min(86400, Number(payload && payload.ttl) || 86400))), Urgency: 'high' },
      body: encryptPush(JSON.stringify(payload), sub.p256dh, sub.auth),
    });
    if (r.status === 404 || r.status === 410) db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(sub.id); // that phone/browser unsubscribed
    return r.status;
  } catch (e) { return 0; } finally { clearTimeout(timer); }
}
// ---------- the same alerts by email ----------
// News, uploads, verifications, payments and the like also go to the person's email (chat messages and calls do not).
// Sent one at a time, with a daily ceiling (MAIL_ALERTS_PER_DAY, default 80) so the email provider's free limit is never
// burned through; sign-up links and reset codes are sent separately and are never held back by this.
const MAIL_ALERT_TAGS = new Set(['news', 'upload', 'news-review', 'friend-request', 'friend-accept', 'position', 'lecturer', 'payment', 'sponsor', 'level']);
// Every alert email carries a link that opens a small page (no sign-in) where the person can switch these emails off, and on again.
// Verification codes, password resets and site notices are never affected. The link is signed, so nobody can change another person's choice.
function mailKey() { let k = getSecret('mail_pref_key'); if (!k) { k = crypto.randomBytes(24).toString('hex'); setSecret('mail_pref_key', k); } return k; }
const mailSig = id => crypto.createHmac('sha256', mailKey()).update('pref:' + id).digest('hex').slice(0, 32);
const mailPrefLink = (id, base) => `${base}/email/preferences?u=${id}&t=${mailSig(id)}`;
const mailQueue = []; let mailBusy = false, mailDay = '', mailCount = 0;
function emailAlso(ids, p) {
  if (!MAIL_ALERT_TAGS.has(p.tag) || process.env.MAIL_ALERTS_OFF === '1') return;
  const rows = db.prepare(`SELECT id,email,name FROM users WHERE id IN (${ids.map(() => '?').join(',')}) AND verified=1 AND email_notify!=0`).all(...ids);
  for (const u of rows) mailQueue.push({ u, p });
  if (rows.length) setImmediate(pumpMail);
}
async function pumpMail() {
  if (mailBusy) return; mailBusy = true;
  const cap = Number(process.env.MAIL_ALERTS_PER_DAY || 80);
  try {
    while (mailQueue.length) {
      const day = new Date().toISOString().slice(0, 10);
      if (day !== mailDay) { mailDay = day; mailCount = 0; }
      if (mailCount >= cap) { console.log(`Email alerts: daily limit of ${cap} reached, ${mailQueue.length} skipped.`); mailQueue.length = 0; break; }
      const { u, p } = mailQueue.shift();
      const base = process.env.BASE_URL || process.env.APP_URL || 'https://studieshub.org', link = base + (p.url || '/');
      const first = esc(String(u.name || '').trim().split(/\s+/)[0] || 'there');
      const text = `Hi ${String(u.name || '').trim().split(/\s+/)[0] || 'there'},\n\n${p.title}${p.body ? '\n' + p.body : ''}\n\nOpen it: ${link}\n\nYou get this email because you have a Studies Hub account.\nTo stop these emails (or turn them back on): ${mailPrefLink(u.id, base)}`;
      const html = emailShell(`<h2 style="margin:0 0 18px;font-size:24px;line-height:1.3;color:#1b2430">${esc(p.title)}</h2><p style="margin:0 0 12px"><b>Hi ${first},</b></p>${p.body ? `<p style="margin:0 0 16px">${esc(p.body)}</p>` : ''}<p style="margin:0 0 20px"><a href="${esc(link)}" style="background:#6d5efc;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:12px;display:inline-block;font-weight:700;font-size:16px">Open on Studies Hub</a></p><p style="margin:22px 0 0;font-size:12px;line-height:1.5;color:#8a93a3">You get this email because you have a Studies Hub account. <a href="${esc(mailPrefLink(u.id, base))}" style="color:#8a93a3">Unsubscribe</a></p>`, base);
      mailCount++;
      try { await deliver(u.email, p.title, text, html); } catch (e) { console.error('Alert email failed:', e.message); }
      await new Promise(r => setTimeout(r, 700));
    }
  } finally { mailBusy = false; }
}
// Things that happen on the lecturer platform go to the central admin and to that institution's lecturer admin(s).
function notifyLecturerAdmin(title, body, institution) {
  try {
    const ids = [...fullAdminIds(), ...(institution ? db.prepare("SELECT id FROM users WHERE lp_inst=? AND (uni_role IS NULL OR uni_role!='full')").all(institution).map(r => r.id) : [])];
    notify(ids, { title, body, url: '/lecturer/admin?tab=verify', tag: 'lecturer' });
  } catch (e) { console.error('Lecturer admin alert failed:', e.message); }
}
// ---------- site notices: tell everyone by email (and push) about an upgrade, and when we are back ----------
const getSecret = k => (db.prepare('SELECT value FROM secrets WHERE key=?').get(k) || {}).value || null;
const setSecret = (k, v) => v == null ? db.prepare('DELETE FROM secrets WHERE key=?').run(k) : db.prepare('INSERT INTO secrets(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
const noticeQueue = []; let noticeBusy = false;
async function pumpNotices() {
  if (noticeBusy) return; noticeBusy = true;
  try { while (noticeQueue.length) { const j = noticeQueue.shift(); try { await deliver(j.to, j.subject, j.text, j.html); } catch (e) { console.error('Notice email failed:', e.message); } await new Promise(r => setTimeout(r, 700)); } }
  finally { noticeBusy = false; }
}
function emailEveryone(subject, heading, message) {
  const base = process.env.BASE_URL || process.env.APP_URL || 'https://studieshub.org';
  const people = db.prepare('SELECT id,email,name FROM users WHERE verified=1').all();
  for (const u of people) {
    const first = String(u.name || '').trim().split(/\s+/)[0] || 'there';
    noticeQueue.push({ to: u.email, subject, text: `Dear ${first},\n\n${message}\n\n${base}`, html: emailShell(`<h2 style="margin:0 0 18px;font-size:24px;line-height:1.3;color:#1b2430">${esc(heading)}</h2><p style="margin:0 0 12px"><b>Dear ${esc(first)},</b></p><p style="margin:0 0 18px">${esc(message)}</p><p><a href="${esc(base)}" style="background:#6d5efc;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:12px;display:inline-block;font-weight:700;font-size:16px">Open Studies Hub</a></p>`, base) });
  }
  notify(people.map(u => u.id), { title: heading, body: message, url: '/', tag: 'site-notice' });
  setImmediate(pumpNotices);
  return people.length;
}
const MAINT_START = 'Studies Hub is being upgraded right now. The site may be slow or unavailable for a few minutes. Please bear with us. We will email you again the moment we are back.';
const MAINT_BACK = 'We are back in business. Thank you for your patience. Everything is running normally again.';
function maintenanceBack() { setSecret('maintenance_since', null); return emailEveryone('Studies Hub is back', 'We are back', MAINT_BACK); }
const fcm = require('./lib/fcm').register(db);
// Send a notification to these people (all their devices). Never throws and is never awaited by callers.
function notify(userIds, payload) {
  const ids = [...new Set((userIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return Promise.resolve();
  const p = { icon: '/icon-192.png?v=2', ...payload, body: String(payload.body || '').slice(0, 140), title: String(payload.title || 'Studies Hub').slice(0, 80) };
  try { emailAlso(ids, p); } catch (e) { console.error('Email alert failed:', e.message); }
  try { fcm.send(ids, p).catch(e => console.error('FCM failed:', e.message)); } catch (e) { /* app notifications are best effort */ }
  const subs = db.prepare(`SELECT * FROM push_subscriptions WHERE user_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  return Promise.allSettled(subs.map(sub => pushTo(sub, p))).catch(() => {});
}

const baseUrl = req => process.env.BASE_URL || process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
const buckets = new Map();
function limited(key, max, ms) { // true when `key` has already used up `max` hits in the last `ms`
  const now = Date.now(), hits = (buckets.get(key) || []).filter(t => now - t < ms);
  if (hits.length >= max) { buckets.set(key, hits); return true; }
  hits.push(now); buckets.set(key, hits); return false;
}
const CHAT_HTML = `<button id="ai-open" class="ai-fab" aria-label="Ask the assistant">Ask AI</button><div id="ai-box" class="ai-box" hidden><div class="ai-head"><b>Studies Hub assistant</b><button id="ai-close" class="link" aria-label="Close">&times;</button></div><div id="ai-log" class="ai-log"></div><form id="ai-form" class="ai-form"><input id="ai-in" placeholder="Ask a question" maxlength="1000" autocomplete="off"><button>Send</button></form></div><script>(function(){var h=[],box=document.getElementById('ai-box'),log=document.getElementById('ai-log'),inp=document.getElementById('ai-in');function add(c,t){var d=document.createElement('div');d.className='ai-m '+c;d.textContent=t;log.appendChild(d);log.scrollTop=log.scrollHeight;return d}document.getElementById('ai-open').onclick=function(){box.hidden=!box.hidden;if(!box.hidden){if(!log.children.length)add('bot','Hi! Ask me anything about the pages here.');inp.focus()}};document.getElementById('ai-close').onclick=function(){box.hidden=true};document.getElementById('ai-form').onsubmit=function(e){e.preventDefault();var q=inp.value.trim();if(!q)return;inp.value='';add('me',q);h.push({role:'user',content:q});var w=add('bot','Thinking...');fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:h})}).then(function(r){return r.json()}).then(function(j){var t=j.reply||j.error||'Something went wrong.';w.textContent=t;if(j.reply)h.push({role:'assistant',content:t});else h.pop()}).catch(function(){w.textContent='Network problem. Try again.';h.pop()})}})()</script>`;

// ---------- helpers ----------
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Escapes text, then turns any http(s) link inside it into a real, tappable, underlined link that opens
// in a new tab. Runs on already-escaped text, so it never introduces raw HTML from what someone typed.
// Finds everything tappable in a piece of text: web links, email addresses, phone numbers and @usernames.
// One function used on the server (news, sponsor posts, chat history) and, copied into the page, for live chat messages.
function linkTokens(text) {
  const re = /(https?:\/\/[^\s<]+|www\.[^\s<]+)|([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})|(\+?\d(?:[ .()-]?\d){6,18})|@([A-Za-z0-9_.]{3,20})/g;
  const out = []; let last = 0, m;
  while ((m = re.exec(text))) {
    const prev = m.index ? text.charAt(m.index - 1) : '', raw = m[0];
    let tok = null, len = raw.length;
    if (m[1]) {
      const mm = /^(.*?)([.,!?;:'")\]]+)$/.exec(raw), url = mm ? mm[1] : raw;
      len = url.length; tok = { t: 'url', v: url, href: /^www\./i.test(url) ? 'https://' + url : url };
    } else if (m[2]) {
      tok = { t: 'email', v: raw, href: 'mailto:' + raw };
    } else if (m[3]) {
      const digits = raw.replace(/\D/g, ''), plus = raw.charAt(0) === '+';
      const isDate = /^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/.test(raw) || /^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}$/.test(raw);
      if (!/[\w@\/]/.test(prev) && !isDate && ((digits.length >= 10 && digits.length <= 15) || (plus && digits.length >= 8 && digits.length <= 15))) tok = { t: 'phone', v: raw, href: 'tel:' + (plus ? '+' : '') + digits };
    } else {
      const name = m[4].replace(/\.+$/, '');
      if (!/[\w@\/]/.test(prev) && name.length >= 3) { len = name.length + 1; tok = { t: 'user', v: '@' + name, href: '/@' + name.toLowerCase() }; }
    }
    if (!tok) { re.lastIndex = m.index + 1; continue; } // not a link after all: look again from the next character
    if (m.index > last) out.push({ t: 'text', v: text.slice(last, m.index) });
    out.push(tok); last = m.index + len; re.lastIndex = last;
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
  return out;
}
function linkify(text) {
  return linkTokens(String(text == null ? '' : text)).map(k => k.t === 'text' ? esc(k.v)
    : `<a href="${esc(k.href)}"${k.t === 'url' ? ' target="_blank" rel="noopener noreferrer"' : ''} class="autolink${k.t === 'user' ? ' mention' : ''}">${esc(k.v)}</a>`).join('');
}
// A @username that opens that member's profile.
const atLink = username => `<a href="/@${esc(String(username).toLowerCase())}" class="autolink mention">@${esc(username)}</a>`;
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'page';
const safeNext = n => (typeof n === 'string' && /^\/(?!\/)/.test(n) ? n : '');
function uniqueSlug(base) {
  let s = base, i = 2;
  while (db.prepare('SELECT 1 FROM pages WHERE slug=?').get(s)) s = `${base}-${i++}`;
  return s;
}
const COMMON_PW = new Set(['password','password1','password12','password123','12345678','123456789','1234567890','qwertyuiop','qwerty123','11111111','00000000','iloveyou','abc12345','abcd1234','admin123','welcome1','welcome123','letmein1','studieshub','studies123','football1','whatever1','passw0rd','p@ssw0rd','nigeria123','unilag123','changeme']);
const weakPw = (pw, email) => { const l = String(pw).toLowerCase(); return COMMON_PW.has(l) || /^(.)\1+$/.test(l) || (email && l === String(email).toLowerCase()) || (email && l === String(email).split('@')[0].toLowerCase()); };
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);
const fails = new Map();
const recent = ip => (fails.get(ip) || []).filter(t => Date.now() - t < 9e5);
const tooMany = ip => recent(ip).length >= 10;
const noteFail = ip => fails.set(ip, [...recent(ip), Date.now()]);

// ---------- email verification ----------
// Railway blocks SMTP on Free/Trial/Hobby plans, so use an HTTPS email API there (Resend or Brevo).
// SMTP (Gmail etc.) still works on your own computer, a phone, a VPS, or a Railway Pro plan.
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const mailer = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
}) : null;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

let gTok = { t: null, exp: 0 };
async function googleAccessToken() {
  if (gTok.t && Date.now() < gTok.exp) return gTok.t;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: process.env.GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token' })
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Google token: ' + (j.error_description || j.error || r.status));
  gTok = { t: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000 };
  return gTok.t;
}

// Sends through the Gmail API over HTTPS, so it works on Railway (unlike SMTP)
async function gmailSend(to, subject, text, html) {
  const addr = process.env.EMAIL_FROM || ADMIN_EMAIL, b = 'sh_' + crypto.randomBytes(8).toString('hex');
  const w = s => Buffer.from(s).toString('base64').replace(/.{76}/g, '$&\r\n');
  const raw = [`From: Studies Hub <${addr}>`, `To: ${to}`, `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`, 'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${b}"`, '', `--${b}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', w(text),
    `--${b}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', w(html), `--${b}--`].join('\r\n');
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: `Bearer ${await googleAccessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(raw).toString('base64url') })
  });
  if (!r.ok) throw new Error(`Gmail ${r.status}: ${await r.text()}`);
}

// Every email gets the same look: the Studies Hub logo and name at the top, then the message.
function emailShell(inner, base) {
  base = base || process.env.BASE_URL || process.env.APP_URL || 'https://studieshub.org';
  const F = "font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  return `<div style="background:#eef1f7;padding:28px 12px;${F}"><div style="max-width:560px;margin:0 auto"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:18px;overflow:hidden;color:#1b2430"><tr><td style="height:6px;background:#6d5efc;font-size:0;line-height:0">&nbsp;</td></tr><tr><td style="padding:30px 32px 6px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:12px"><img src="${base}/logo.png?v=2" width="52" height="52" alt="Studies Hub" style="display:block;border-radius:12px;border:0"></td><td style="${F};font-size:20px;font-weight:700;color:#1b2430">Studies Hub</td></tr></table></td></tr><tr><td style="padding:18px 32px 34px;${F};font-size:16px;line-height:1.75;color:#2a3442">${inner}</td></tr></table><p style="text-align:center;color:#8a94a3;${F};font-size:12px;line-height:1.6;margin:18px 12px 0">You are getting this email because you have a Studies Hub account.<br>Studies Hub &middot; Study smarter, together</p></div></div>`;
}
async function deliver(to, subject, text, html) {
  const from = process.env.MAIL_FROM || process.env.EMAIL_FROM || process.env.SMTP_USER;
  if (GOOGLE_ON && process.env.GOOGLE_REFRESH_TOKEN) {
    await gmailSend(to, subject, text, html);
  } else if (process.env.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text, html })
    });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
  } else if (process.env.BREVO_API_KEY) {
    const m = /^(.*)<(.+)>\s*$/.exec(from || '');
    const name = m && m[1].trim();
    const sender = m ? { email: m[2].trim(), ...(name ? { name } : {}) } : { email: from };
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender, to: [{ email: to }], subject, textContent: text, htmlContent: html })
    });
    if (!r.ok) throw new Error(`Brevo ${r.status}: ${await r.text()}`);
  } else if (mailer) {
    await mailer.sendMail({ from, to, subject, text, html });
  } else return false;
  return true;
}

async function sendVerification(req, user) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('UPDATE users SET verify_hash=?, verify_expires=?, verify_sent=? WHERE id=?').run(sha(token), Date.now() + 864e5, Date.now(), user.id);
  const base = baseUrl(req);
  const link = `${base}/verify?token=${token}`;
  const sent = await deliver(user.email, 'Verify your email for Studies Hub',
    `Hi ${user.name},\n\nConfirm your email to activate your account:\n${link}\n\nThis link expires in 24 hours. If you did not sign up, ignore this email.`,
    emailShell(`<h2 style="margin:0 0 18px;font-size:24px;line-height:1.3;color:#1b2430">Welcome to Studies Hub</h2><p style="margin:0 0 12px"><b>Hi ${esc(user.name)},</b></p><p style="margin:0 0 16px">Confirm your email to activate your account.</p><p style="margin:0 0 16px"><a href="${link}" style="background:#6d5efc;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:12px;display:inline-block;font-weight:700;font-size:16px">Confirm your email</a></p><p style="color:#5b6675;font-size:13px;margin:0">This link expires in 24 hours. If you did not sign up, ignore this email.</p>`, base));
  if (!sent) console.log(`[email not configured] Verification link for ${user.email}: ${link}`);
}

async function sendResetCode(email, code) {
  const sent = await deliver(email, 'Your Studies Hub password reset code',
    `Your password reset code is ${code}. It expires in 10 minutes. If you did not ask for it, ignore this email.`,
    emailShell(`<h2 style="margin:0 0 18px;font-size:24px;line-height:1.3;color:#1b2430">Reset your password</h2><p style="margin:0 0 12px">Use this code to choose a new password:</p><p style="font-size:34px;font-weight:800;letter-spacing:8px;margin:0 0 18px;background:#f3f1ff;border-radius:12px;padding:14px 18px;text-align:center;color:#3b2fc9">${code}</p><p style="color:#5b6675;font-size:13px;margin:0">It expires in 10 minutes. If you did not ask for it, ignore this email.</p>`));
  if (!sent) console.log(`[email not configured] Reset code for ${email}: ${code}`);
}

async function sendSafely(req, u) {
  if (Date.now() - (u.verify_sent || 0) < 60000) return 'wait'; // 1-minute cooldown per account
  try { await sendVerification(req, u); return 'sent'; }
  catch (e) { console.error('Verification email failed:', e.message); return 'fail'; }
}

// The browser keeps the real session key; the database keeps only a one-way fingerprint of it, so even someone who
// got a copy of the database could not sign in as anybody.
const sidKey = raw => crypto.createHash('sha256').update('sid:' + String(raw)).digest('hex');
for (const r of db.prepare('SELECT id FROM sessions WHERE length(id)<64').all()) db.prepare('UPDATE OR REPLACE sessions SET id=? WHERE id=?').run(sidKey(r.id), r.id);

// ---------- removing a person completely ----------
// Everything that belongs to or mentions a person is wiped in one go: chats, friendships, groups they started,
// uploads, payments, calls, notifications, sign-ins (including Continue with Google, which is just their email on
// their account). Their old id number is never handed out again, and anything an earlier removal left behind is
// swept at start-up, so a new person can never inherit someone else's friends or messages.
function dbRun(sql, ...a) { try { return db.prepare(sql).run(...a); } catch (e) { if (!/no such (table|column)/i.test(e.message)) throw e; } }
function dbAll(sql, ...a) { try { return db.prepare(sql).all(...a); } catch (e) { if (!/no such (table|column)/i.test(e.message)) throw e; return []; } }
function deleteMessageRows(ids) {
  for (let i = 0; i < ids.length; i += 400) {
    const part = ids.slice(i, i + 400), q = part.map(() => '?').join(',');
    for (const t of ['message_reads', 'message_hidden', 'message_stars', 'message_reactions']) dbRun(`DELETE FROM ${t} WHERE message_id IN (${q})`, ...part);
    dbRun(`UPDATE messages SET reply_to_id=NULL WHERE reply_to_id IN (${q})`, ...part);
    dbRun(`DELETE FROM messages WHERE id IN (${q})`, ...part);
  }
}
function deleteGroupEntirely(gid) {
  deleteMessageRows(dbAll('SELECT id FROM messages WHERE group_id=?', gid).map(r => r.id));
  dbRun('DELETE FROM group_members WHERE group_id=?', gid);
  dbRun("DELETE FROM chat_prefs WHERE kind='group' AND target_id=?", gid);
  for (const c of dbAll('SELECT id FROM call_sessions WHERE group_id=?', gid)) { dbRun('DELETE FROM call_participants WHERE call_id=?', c.id); dbRun('DELETE FROM call_sessions WHERE id=?', c.id); }
  dbRun('DELETE FROM groups WHERE id=?', gid);
}
function wipeUserData(id) {
  id = Number(id);
  deleteMessageRows(dbAll('SELECT id FROM messages WHERE sender_id=? OR (recipient_id=? AND group_id IS NULL)', id, id).map(r => r.id));
  for (const t of ['message_reads', 'message_hidden', 'message_stars', 'message_reactions']) dbRun(`DELETE FROM ${t} WHERE user_id=?`, id);
  dbRun('DELETE FROM friendships WHERE requester_id=? OR addressee_id=?', id, id);
  for (const g of dbAll('SELECT id FROM groups WHERE created_by=?', id)) { // a group they started carries on with its oldest other member in charge, or ends if nobody is left
    const heir = db.prepare('SELECT user_id FROM group_members WHERE group_id=? AND user_id!=? ORDER BY (role=\'admin\') DESC, added_at, user_id LIMIT 1').get(g.id, id);
    if (heir) { db.prepare('UPDATE groups SET created_by=? WHERE id=?').run(heir.user_id, g.id); db.prepare("UPDATE group_members SET role='admin' WHERE group_id=? AND user_id=?").run(g.id, heir.user_id); }
  }
  dbRun('DELETE FROM group_members WHERE user_id=?', id);
  for (const g of dbAll('SELECT g.id FROM groups g WHERE NOT EXISTS (SELECT 1 FROM group_members m WHERE m.group_id=g.id)')) deleteGroupEntirely(g.id);
  dbRun("DELETE FROM chat_prefs WHERE user_id=? OR (kind='dm' AND target_id=?)", id, id);
  dbRun('DELETE FROM push_subscriptions WHERE user_id=?', id);
  dbRun('DELETE FROM stickers WHERE user_id=?', id);
  for (const c of dbAll('SELECT id FROM call_sessions WHERE created_by=?', id)) { dbRun('DELETE FROM call_participants WHERE call_id=?', c.id); dbRun('DELETE FROM call_sessions WHERE id=?', c.id); }
  dbRun('DELETE FROM call_participants WHERE user_id=? OR invited_by=?', id, id);
  dbRun('DELETE FROM purchases WHERE page_id IN (SELECT id FROM pages WHERE author_id=?)', id);
  dbRun('DELETE FROM pages WHERE author_id=?', id);
  dbRun('UPDATE pages SET admin_id=NULL WHERE admin_id=?', id);
  dbRun('DELETE FROM purchases WHERE user_id=?', id);
  dbRun('DELETE FROM lecturer_courses WHERE lecturer_id=?', id);
  dbRun('UPDATE news SET author_id=NULL WHERE author_id=?', id);
  dbRun('DELETE FROM feedback WHERE user_id=?', id);
  dbRun('UPDATE news SET approver_id=NULL WHERE approver_id=?', id);
  dbRun('DELETE FROM sponsor_posts WHERE user_id=?', id);
  dbRun('DELETE FROM level_log WHERE by_user=?', id);
  dbRun('UPDATE users SET position_approver_id=NULL WHERE position_approver_id=?', id);
  dbRun('DELETE FROM sessions WHERE user_id=?', id);
}
function setIdFloor(n) {
  const cur = Number((db.prepare("SELECT value FROM secrets WHERE key='user_id_floor'").get() || {}).value || 0);
  if (n > cur) db.prepare("INSERT INTO secrets(key,value) VALUES('user_id_floor',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(n));
}
function purgeUser(id) {
  id = Number(id);
  const u = db.prepare('SELECT id,role FROM users WHERE id=?').get(id);
  if (!u || u.role === 'admin') return false;
  db.exec('BEGIN');
  try {
    wipeUserData(id);
    db.prepare('DELETE FROM users WHERE id=?').run(id);
    setIdFloor(id);
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
  return true;
}
// A brand-new person always gets a number nobody has ever had, and starts with nothing attached to it.
function insertUser(cols, vals) {
  const floor = Number((db.prepare("SELECT value FROM secrets WHERE key='user_id_floor'").get() || {}).value || 0);
  const id = Math.max(floor, db.prepare('SELECT COALESCE(MAX(id),0) m FROM users').get().m) + 1;
  setIdFloor(id);
  wipeUserData(id);
  db.prepare(`INSERT INTO users(id,${cols}) VALUES(?,${vals.map(() => '?').join(',')})`).run(id, ...vals);
  return id;
}
// Start-up clean-up: finds anything left behind by people removed in the past (before this existed) and deletes it,
// including chats and friendships that are older than the account they have ended up attached to.
function sweepRemnants() {
  const exists = new Set(db.prepare('SELECT id FROM users').all().map(r => r.id));
  const ghosts = new Set();
  for (const r of dbAll('SELECT DISTINCT sender_id a FROM messages UNION SELECT DISTINCT recipient_id FROM messages WHERE group_id IS NULL UNION SELECT requester_id FROM friendships UNION SELECT addressee_id FROM friendships UNION SELECT user_id FROM group_members UNION SELECT user_id FROM purchases UNION SELECT user_id FROM push_subscriptions UNION SELECT user_id FROM chat_prefs UNION SELECT lecturer_id FROM lecturer_courses UNION SELECT user_id FROM stickers UNION SELECT user_id FROM sponsor_posts')) if (r.a != null && !exists.has(r.a)) ghosts.add(r.a);
  for (const r of dbAll('SELECT DISTINCT author_id a FROM pages WHERE author_id IS NOT NULL')) if (!exists.has(r.a)) ghosts.add(r.a);
  let floor = 0;
  for (const g of ghosts) { wipeUserData(g); floor = Math.max(floor, g); }
  for (const r of dbAll('SELECT MAX(sender_id) a FROM messages UNION SELECT MAX(requester_id) FROM friendships UNION SELECT MAX(addressee_id) FROM friendships UNION SELECT MAX(id) FROM users')) if (r.a) floor = Math.max(floor, r.a);
  setIdFloor(floor);
  const early = new Set();
  for (const r of dbAll("SELECT m.id FROM messages m JOIN users u ON u.id=m.sender_id WHERE u.created_at IS NOT NULL AND datetime(m.created_at) < datetime(u.created_at)")) early.add(r.id);
  for (const r of dbAll("SELECT m.id FROM messages m JOIN users u ON u.id=m.recipient_id WHERE m.group_id IS NULL AND u.created_at IS NOT NULL AND datetime(m.created_at) < datetime(u.created_at)")) early.add(r.id);
  deleteMessageRows([...early]);
  dbRun("DELETE FROM friendships WHERE id IN (SELECT f.id FROM friendships f JOIN users u ON u.id IN (f.requester_id,f.addressee_id) WHERE u.created_at IS NOT NULL AND datetime(f.created_at) < datetime(u.created_at))");
  dbRun("DELETE FROM group_members WHERE rowid IN (SELECT gm.rowid FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE u.created_at IS NOT NULL AND gm.added_at IS NOT NULL AND datetime(gm.added_at) < datetime(u.created_at))");
  dbRun("DELETE FROM purchases WHERE id IN (SELECT p.id FROM purchases p JOIN users u ON u.id=p.user_id WHERE u.created_at IS NOT NULL AND datetime(p.created_at) < datetime(u.created_at))");
  for (const g of dbAll('SELECT g.id FROM groups g WHERE NOT EXISTS (SELECT 1 FROM group_members m WHERE m.group_id=g.id)')) deleteGroupEntirely(g.id);
  if (ghosts.size || early.size) console.log(`Clean-up: removed leftovers of ${ghosts.size} deleted account(s) and ${early.size} message(s) that pre-dated their owner.`);
}
function startSession(res, userId) {
  const sid = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sidKey(sid), userId, Date.now() + 7 * 864e5);
  const secure = process.env.NODE_ENV === 'production' || !!(res.req && res.req.secure);
  res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure ? '; Secure' : ''}`);
  return sidKey(sid);
}

app.get('/health', (req, res) => res.type('text').send('ok'));
// The Android app calls this every ~45 seconds while the phone has internet; the request itself marks the person online (see the presence stamp below).

app.use((req, res, next) => {
  const c = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('sid='));
  req.sid = c && /^[0-9a-f]{48,64}$/.test(c.slice(4)) ? c.slice(4) : null;
  req.user = req.sid
    ? db.prepare('SELECT u.id,u.dept_option,u.graduated,u.lp_inst,u.uni_role,u.sub_role,u.sub_inst,u.sub_perms,u.sub_title,u.sub_by,u.name,u.email,u.role,u.verified,u.created_at,u.last_seen,u.avatar_mime,u.department,u.university,u.course,u.title,u.can_set_title,u.username,u.level,u.position,u.position_status,u.position_scope,u.position_auto_role,u.position_approver_id,u.position_can_verify,u.is_lecturer,u.lecturer_status,u.lecturer_reg_no,u.theme,u.hide_active,u.can_promote FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires>?').get(sidKey(req.sid), Date.now()) || null
    : null;
  // Presence: stamp last_seen at most once every 20s per user, so the online/offline dot in
  // /admin has real data without writing to the database on every single request.
  if (req.user && Date.now() - (req.user.last_seen || 0) > 20000) {
    db.prepare('UPDATE users SET last_seen=? WHERE id=?').run(Date.now(), req.user.id);
    req.user.last_seen = Date.now();
    markDelivered(req.user.id);
  }
  // The Android app puts its phone ID in a cookie, so we know where to ring this person.
  if (req.user) { const f = /(?:^|;\s*)fcm=([\w:.\-]+)/.exec(req.headers.cookie || ''); if (f) { try { fcm.remember(f[1], req.user.id); } catch (e) { /* ignore */ } } }
  next();
});

// Laptop view: opening any inner page directly (refresh, bookmark, shared link) shows the same three-part screen,
// with the page itself inside the big area, so the list and menu stay in place.
app.use((req, res, next) => {
  if (req.method !== 'GET' || !req.user || req.query.embed) return next();
  if (String(req.headers['sec-fetch-dest'] || '') !== 'document' || !isWideScreen(req)) return next();
  const tabbed = /^\/(admin|lecturer|uni)$/.test(req.path) && (req.query.tab || req.query.share), newsShare = req.path === '/news' && req.query.share;
  if (!(tabbed || newsShare) && !/^\/(p|news|chat|settings|admin|lecturer|uni)\/./.test(req.path) || /\/raw$|\.(csv|pdf|zip|png|jpe?g|gif|webp|mp4)$|\/(export|download|avatar|logout)/.test(req.path)) return next();
  const url = req.originalUrl + (req.originalUrl.includes('?') ? '&' : '?') + 'embed=1';
  const pm = /^\/p\/([^/]+)$/.exec(req.path), pg = pm && db.prepare('SELECT title FROM pages WHERE slug=?').get(pm[1]);
  res.send(layout(pg ? pg.title : 'Studies Hub', `<iframe class="reader" src="${esc(url)}" title="Page"></iframe>`, req.user));
});
// LiveKit calling module; credentials stay in server-side environment variables.
const { pdfViewerHtml } = require('./lib/pdf_viewer');
const { registerCalling, clientScript: CALLING_CLIENT_JS } = require('./lib/calling');
const { registerLecturerAdmin } = require('./lib/lecturer_admin');
const { register: registerAI } = require('./lib/ai_assistant');
const { registerUniversityAdmin } = require('./lib/university_admin');
// ---------- semesters (semester.js): first and second semester uploads never mix ----------
const SEM = require('./lib/semester');
SEM.ensureSchema(db);
SEM.addSemesterColumn(db, 'pages', 'title');
// Reads the semester from the course code in each new upload's title (GST 121 -> second semester); no code = shows in both.
function stampSemesters() {
  const rows = db.prepare("SELECT id,title FROM pages WHERE semester IS NULL AND title GLOB '*[0-9][0-9][0-9]*'").all(), set = db.prepare('UPDATE pages SET semester=? WHERE id=?');
  for (const r of rows) { const sm = SEM.parseCourseCode(r.title).semester; if (sm) set.run(sm, r.id); }
}
registerCalling(app, { db, crypto, notify, logCall: (callerId, calleeId, kind, state, secs) => {
  // A line in the 1-to-1 chat: "Video call - 47 sec", "Missed video call", "Declined".
  const enc = encryptMsg(JSON.stringify({ k: kind, s: state, d: secs || 0 }));
  const id = Number(db.prepare("INSERT INTO messages(sender_id,recipient_id,group_id,body_enc,iv,kind) VALUES(?,?,NULL,?,?,'call')").run(callerId, calleeId, enc.body_enc, enc.iv).lastInsertRowid);
  if (state !== 'missed') db.prepare('INSERT OR IGNORE INTO message_reads(message_id,user_id) VALUES(?,?)').run(id, calleeId);
  else { const caller = db.prepare('SELECT id,name FROM users WHERE id=?').get(callerId); if (caller) notifyNewMessage(caller, { recipient_id: calleeId, group_id: null }, '📞 Missed ' + (kind === 'video' ? 'video' : 'voice') + ' call', id); }
} });

// ---------- usernames, levels and "who can see what" ----------
const fullAdminIds = () => db.prepare("SELECT id FROM users WHERE role='admin'").all().map(r => r.id);
function broadcastNews(newsId, exceptId) {
  const n = db.prepare('SELECT * FROM news WHERE id=?').get(newsId);
  if (!n) return;
  let ids;
  if (!n.scope_type) {
    ids = db.prepare('SELECT id FROM users WHERE verified=1 AND is_lecturer=0 AND id != ?').all(exceptId || 0).map(r => r.id);
  } else if (n.scope_type === 'university') {
    ids = db.prepare('SELECT id FROM users WHERE verified=1 AND is_lecturer=0 AND id != ? AND university=?').all(exceptId || 0, n.scope_university).map(r => r.id);
  } else if (n.scope_type === 'own') {
    ids = db.prepare('SELECT id FROM users WHERE verified=1 AND is_lecturer=0 AND id != ? AND department=? AND level=?').all(exceptId || 0, n.scope_department, n.scope_level).map(r => r.id);
  } else if (n.scope_type === 'department') {
    ids = db.prepare('SELECT id FROM users WHERE verified=1 AND is_lecturer=0 AND id != ? AND department=?').all(exceptId || 0, n.scope_department).map(r => r.id);
  } else {
    const depts = db.prepare('SELECT name FROM departments WHERE faculty=?').all(n.scope_faculty).map(d => d.name);
    ids = depts.length ? db.prepare(`SELECT id FROM users WHERE verified=1 AND is_lecturer=0 AND id != ? AND department IN (${depts.map(() => '?').join(',')})`).all(exceptId || 0, ...depts).map(r => r.id) : [];
  }
  notify(ids, { title: 'New on Studies Hub', body: n.title, url: '/news/' + newsId, tag: 'news' });
}
function announceUpload(page) {
  stampSemesters();
  const rowSem = page.slug ? db.prepare('SELECT semester FROM pages WHERE slug=?').get(page.slug) : null;
  if (!SEM.visibleInSemester(rowSem && rowSem.semester != null ? rowSem.semester : SEM.parseCourseCode(page.title).semester, SEM.getCurrent(db))) return; // not this semester's material: no alert
  const ids = audienceFor(page);
  const where = [deptListOf(page).join(', '), page.level ? page.level + ' level' : ''].filter(Boolean).join(' · ');
  notify(ids, { title: page.paid ? 'New CBT (pay to view)' : 'New upload', body: `${page.title}${where ? ' — ' + where : ''}`, url: '/p/' + page.slug, tag: 'upload' });
}
const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;
const RESERVED_USERNAMES = ['admin', 'administrator', 'support', 'help', 'studies', 'studieshub', 'moderator', 'root', 'system', 'staff'];
const cleanUsername = v => String(v || '').trim().replace(/^@+/, '').toLowerCase();
function usernameProblem(v, exceptId) {
  const u = cleanUsername(v);
  if (!USERNAME_RE.test(u)) return 'A username is 3 to 20 characters: letters, numbers, dots or underscores.';
  if (RESERVED_USERNAMES.includes(u)) return 'That username is reserved. Pick another.';
  const hit = db.prepare('SELECT id FROM users WHERE lower(username)=?').get(u);
  if (hit && hit.id !== exceptId) return 'That username is already taken.';
  return '';
}
const LEVELS = [100, 200, 300, 400, 500, 600];
// A representative (not exhaustive -- NUC lists ~280+) set of Nigerian federal, state and private
// universities, for the lecturer institution picker. "Other" lets anyone not listed type their own.
const NIGERIAN_UNIVERSITIES = ['University of Uyo', 'University of Ibadan', 'University of Lagos', 'Ahmadu Bello University', 'University of Nigeria, Nsukka', 'Obafemi Awolowo University', 'Bayero University, Kano', 'University of Benin', 'University of Calabar', 'University of Ilorin', 'University of Jos', 'University of Port Harcourt', 'University of Maiduguri', 'Usmanu Danfodiyo University', 'Federal University of Technology, Akure', 'Federal University of Technology, Minna', 'Federal University of Technology, Owerri', 'Federal University, Oye-Ekiti', 'Federal University, Dutse', 'Federal University, Dutsin-Ma', 'Federal University, Kashere', 'Federal University, Lafia', 'Federal University, Lokoja', 'Federal University, Otuoke', 'Federal University, Wukari', 'Federal University, Birnin Kebbi', 'Federal University, Gusau', 'Federal University, Gashua', 'Federal University of Agriculture, Abeokuta', 'Nnamdi Azikiwe University', 'Nasarawa State University, Keffi', 'National Open University of Nigeria', 'Nigerian Defence Academy', 'Abubakar Tafawa Balewa University',
  'Abia State University', 'Adamawa State University', 'Akwa Ibom State University', 'Bauchi State University', 'Benue State University', 'Borno State University', 'Cross River State University of Technology', 'Delta State University, Abraka', 'Ebonyi State University', 'Ekiti State University', 'Enugu State University of Science and Technology', 'Gombe State University', 'Imo State University', 'Kaduna State University', 'Kano State University', 'Kebbi State University of Science and Technology', 'Kogi State University', 'Kwara State University', 'Lagos State University', 'Nasarawa State University', 'Ondo State University of Science and Technology', 'Osun State University', 'Plateau State University', 'Rivers State University', 'Sokoto State University', 'Taraba State University', 'Zamfara State University',
  'Covenant University', 'Babcock University', 'Bowen University', 'Afe Babalola University', 'American University of Nigeria', 'Nile University of Nigeria', "Redeemer's University", 'Lead City University', 'Madonna University', 'Igbinedion University', 'Benson Idahosa University', 'Joseph Ayo Babalola University', 'Caleb University', 'Achievers University', 'Landmark University', 'Bingham University', 'Veritas University', 'Al-Hikmah University', 'Crescent University', 'Pan-Atlantic University', 'Crawford University', 'Novena University', 'Salem University', 'Tansian University', 'Gregory University', 'Augustine University',
  'Other (type it in below)'];
db.exec('CREATE TABLE IF NOT EXISTS institutions(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL)');
if (!db.prepare('SELECT 1 FROM institutions LIMIT 1').get()) { const insI = db.prepare('INSERT OR IGNORE INTO institutions(name) VALUES(?)'); NIGERIAN_UNIVERSITIES.filter(n => !/^Other/.test(n)).forEach(n => insI.run(n)); }
const OTHER_UNI = 'Other (type it in below)';
const institutionList = () => db.prepare('SELECT name FROM institutions ORDER BY name').all().map(r => r.name);
// A course code's first digit is the level: GST 121 / ENT 121 = 100 level, PHY 2xx = 200 level ... up to 6xx.
// Semester choice on upload forms: "auto" reads it from the course code in the title (GST 121 = second semester); 1 or 2 is set by hand.
function semesterField(selected) {
  const cur = SEM.semesterName(SEM.getCurrent(db)), sel = Number(selected);
  return `<label class="mut">Semester</label><select name="semester"><option value="auto">Detect from the course code (it is ${esc(cur)} now)</option><option value="1"${sel === 1 ? ' selected' : ''}>First semester</option><option value="2"${sel === 2 ? ' selected' : ''}>Second semester</option></select>`;
}
function applySemester(where, choice) { // where: {slug} or {id}
  const col = where.slug != null ? 'slug' : 'id', val = where.slug != null ? where.slug : where.id, c = String(choice || 'auto');
  if (c === '1' || c === '2') db.prepare(`UPDATE pages SET semester=? WHERE ${col}=?`).run(Number(c), val);
  else { db.prepare(`UPDATE pages SET semester=NULL WHERE ${col}=?`).run(val); stampSemesters(); }
}
function levelFromText(text) {
  const m = /\b[A-Za-z]{2,5}[\s_-]?([1-6])\d{2}\b/.exec(String(text || ''));
  return m ? Number(m[1]) * 100 : null;
}
// Some departments are broken down further (e.g. Education into Mathematics, English...): the admin lists the parts, a student picks one.
db.exec('CREATE TABLE IF NOT EXISTS department_options(id INTEGER PRIMARY KEY, department TEXT NOT NULL, name TEXT NOT NULL, UNIQUE(department,name))');
const optionsOf = dept => dept ? db.prepare('SELECT name FROM department_options WHERE department=? ORDER BY name').all(dept).map(r => r.name) : [];
const optionsMap = () => { const m = {}; for (const r of db.prepare('SELECT department,name FROM department_options ORDER BY name').all()) (m[r.department] = m[r.department] || []).push(r.name); return m; };
const departmentNames = () => db.prepare('SELECT name FROM departments ORDER BY name').all().map(r => r.name);
// Nobody goes past their department's last level (500 by default, 400 for some): the site owner sets it per department or faculty.
const DEFAULT_LAST_LEVEL = 500;
const maxLevelFor = dept => { const r = dept ? db.prepare('SELECT max_level FROM departments WHERE name=?').get(dept) : null; return r ? r.max_level : DEFAULT_LAST_LEVEL; };
const LAST_LEVEL_SQL = "COALESCE((SELECT d.max_level FROM departments d WHERE d.name=users.department), 500)";
const facultyNames = () => db.prepare('SELECT DISTINCT faculty FROM departments ORDER BY faculty').all().map(r => r.faculty);
function departmentOptions(selected) {
  const rows = db.prepare('SELECT name,faculty FROM departments ORDER BY faculty,name').all(), groups = {};
  for (const r of rows) (groups[r.faculty] = groups[r.faculty] || []).push(r.name);
  return Object.keys(groups).map(f => `<optgroup label="${esc(f)}">${groups[f].map(n => `<option value="${esc(n)}"${n === selected ? ' selected' : ''}>${esc(n)}</option>`).join('')}</optgroup>`).join('');
}
// dept is stored as a comma-separated list of department names, or NULL for "every department".
const deptListOf = page => (page.dept || '').split(',').map(s => s.trim()).filter(Boolean);
// Checkboxes for picking one, several, or (by picking none) every department -- grouped by faculty like the admin's own department list.
function departmentCheckboxes(selectedList) {
  const rows = db.prepare('SELECT name,faculty FROM departments ORDER BY faculty,name').all(), groups = {};
  for (const r of rows) (groups[r.faculty] = groups[r.faculty] || []).push(r.name);
  const box = n => `<label class="row" style="justify-content:flex-start;gap:8px"><input type="checkbox" name="dept" value="${esc(n)}" style="width:auto"${selectedList.includes(n) ? ' checked' : ''}>${esc(n)}</label>`;
  return `<div class="dbox"><input type="search" placeholder="Search departments..." oninput="var q=this.value.toLowerCase();[].forEach.call(this.parentNode.querySelectorAll('label.row'),function(l){l.style.display=l.textContent.toLowerCase().indexOf(q)>-1?'':'none'})" style="margin:4px 0">` + Object.keys(groups).map(f => `<p class="chat-label">${esc(f)}</p>${groups[f].map(box).join('')}`).join('') + '</div>';
}
// An upload is either general (no department, no level), or aimed at one or more departments and/or one level.
function sortedFor(page, user) {
  if (can.pages(user)) return true;
  if (page.university && (!user || user.university !== page.university)) return false; // a university's own upload stays inside that university
  // A lecturer sees only lecturer uploads: their own and those of colleagues teaching the same course. Anything a
  // student (or the admin acting as a student) uploads is never shown in the lecturer portal.
  if (user && user.is_lecturer) {
    if (page.author_id != null && page.author_id === user.id) return true;
    return page.course_id != null && user.lecturer_status === 'approved' && !!db.prepare('SELECT 1 FROM lecturer_courses WHERE lecturer_id=? AND course_id=?').get(user.id, page.course_id);
  }
  if (!SEM.visibleInSemester(page.semester, SEM.getCurrent(db))) return false; // the other semester's uploads stay hidden until that semester starts
  if (page.dept == null && page.level == null) return true;
  if (!user) return false;
  if (page.dept != null && !deptListOf(page).includes(user.department)) return false;
  if (page.level != null && Number(page.level) !== Number(user.level)) return false;
  return true;
}
// Everyone who should be told about a new upload.
function audienceFor(page) {
  const where = ["role='user'", 'verified=1', 'is_lecturer=0'], args = [];
  if (page.university) { where.push('university=?'); args.push(page.university); }
  const list = page.dept != null ? deptListOf(page) : [];
  if (list.length) { where.push(`department IN (${list.map(() => '?').join(',')})`); args.push(...list); }
  if (page.level != null) { where.push('level=?'); args.push(page.level); }
  return db.prepare(`SELECT id FROM users WHERE ${where.join(' AND ')}`).all(...args).map(r => r.id);
}
const facultyOf = dept => dept ? (db.prepare('SELECT faculty FROM departments WHERE name=?').get(dept) || {}).faculty : null;
// Four tiers, lowest to highest reach: a class rep covers their own department+level, a departmental president
// their whole department (every level), a faculty president their whole faculty (every department in it), and
// 'school' is unrestricted -- same as having no scoped position at all.
const SCOPE_RANK = { own: 1, department: 2, faculty: 3, school: 4 };
// What reach a news post from this poster should carry, snapshotted at the moment they post (so it stays
// correct even if their own department/level changes later). A user with no verified, scoped position reaches
// everyone, exactly as before this feature existed -- scoping only ever narrows reach for someone it applies to.
function newsReachFor(user) {
  if (!user || user.position_status !== 'approved' || !user.position_scope) return { scope_type: null, scope_department: null, scope_level: null, scope_faculty: null };
  if (user.position_scope === 'own') return { scope_type: 'own', scope_department: user.department || null, scope_level: user.level || null, scope_faculty: null };
  if (user.position_scope === 'department') return { scope_type: 'department', scope_department: user.department || null, scope_level: null, scope_faculty: null };
  if (user.position_scope === 'faculty') return { scope_type: 'faculty', scope_department: null, scope_level: null, scope_faculty: facultyOf(user.department) };
  return { scope_type: null, scope_department: null, scope_level: null, scope_faculty: null }; // 'school' -- same unrestricted reach as the default
}
function canSeeNewsItem(item, viewer) {
  if (!item.scope_type) return true; // unrestricted: every post made before this feature, and every school-wide one, stays visible to all
  if (!viewer) return false; // department/faculty-scoped posts need a known department -- only logged-in students have one
  if (item.scope_type === 'university') return viewer.role === 'admin' || (!!item.scope_university && viewer.university === item.scope_university);
  if (item.scope_type === 'own') return viewer.department === item.scope_department && Number(viewer.level) === Number(item.scope_level);
  if (item.scope_type === 'department') return viewer.department === item.scope_department;
  if (item.scope_type === 'faculty') return !!item.scope_faculty && facultyOf(viewer.department) === item.scope_faculty;
  return true;
}
// Members finish their details (username, university, department, level) before anything else; staff only need a username.
const profileComplete = u => u.role === 'uniadmin' ? !!u.username && !!u.name : u.is_lecturer
  ? !!u.name && !!u.university && !!u.lecturer_status
  : !!u.username && !!u.name && (u.role !== 'user' || (!!u.department && !!u.level && !!u.university));
let adminTab = '';
const TAB_OF = p => /^\/admin\/(payments|sponsors)/.test(p) ? 'payments' : /^\/admin\/(upload|pages)/.test(p) ? 'pages' : /^\/admin\/lecturers/.test(p) ? 'lecturers' : /^\/(admin\/positions|positions|admin\/departments)/.test(p) ? 'positions' : /^\/admin\/news/.test(p) ? 'news' : /^\/admin\/users/.test(p) ? 'users' : '';
app.use((req, res, next) => { adminTab = TAB_OF(req.path); next(); });
const GATE_OPEN = ['/welcome', '/lecturer/welcome', '/logout', '/privacy', '/terms', '/about', '/how-it-works', '/contact', '/guides', '/sitemap.xml', '/robots.txt', '/pay/return', '/health', '/sw.js', '/offline.html', '/app', '/app/version', '/StudiesHub.apk', '/.well-known/assetlinks.json', '/manifest.webmanifest', '/logo.png', '/icon-192.png', '/icon-512.png', '/favicon.ico'];
app.use((req, res, next) => {
  if (req.user && req.method === 'GET' && !profileComplete(req.user) && !GATE_OPEN.includes(req.path) && !req.path.startsWith('/api/') && !req.path.startsWith('/avatar/')) return res.redirect(req.user.is_lecturer ? '/lecturer/welcome' : '/welcome');
  next();
});

// ---------- logo, app icons, install manifest and the notification service worker ----------
const sendAsset = (res, buf, type) => { res.setHeader('Content-Type', type); res.setHeader('Cache-Control', 'no-cache'); res.send(buf); }; // no-cache: always check, so a new logo shows straight away
app.get('/logo.png', (req, res) => sendAsset(res, LOGO_PNG, 'image/png'));
app.get('/icon-192.png', (req, res) => sendAsset(res, ICON_192, 'image/png'));
app.get('/favicon.ico', (req, res) => sendAsset(res, ICON_192, 'image/png'));
app.get('/icon-512.png', (req, res) => sendAsset(res, ICON_512, 'image/png'));
app.get('/manifest.webmanifest', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.send(JSON.stringify({
    name: 'Studies Hub', short_name: 'Studies', description: 'Study pages, CBT practice, news and chat for your department and level.',
    id: '/', start_url: '/', scope: '/', display: 'standalone', display_override: ['window-controls-overlay', 'tabbed', 'standalone'],
    edge_side_panel: { preferred_width: 400 },
    note_taking: { new_note_url: '/news' },
    background_color: '#12121c', theme_color: '#12121c',
    related_applications: [{ platform: 'play', id: 'org.studieshub.app' }], prefer_related_applications: false,
    icons: [{ src: '/icon-192.png?v=2', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png?v=2', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
    // Shortcuts: long-press the installed icon to jump straight to a section.
    shortcuts: [
      { name: 'Dashboard', url: '/dashboard', icons: [{ src: '/icon-192.png?v=2', sizes: '192x192' }] },
      { name: 'Chat', url: '/chat', icons: [{ src: '/icon-192.png?v=2', sizes: '192x192' }] },
      { name: 'News', url: '/news', icons: [{ src: '/icon-192.png?v=2', sizes: '192x192' }] },
      { name: 'Settings', url: '/settings', icons: [{ src: '/icon-192.png?v=2', sizes: '192x192' }] },
    ],
    // Launch handler: re-opening the installed app (from a notification, a shared link, etc) focuses the
    // existing window instead of spawning a duplicate one.
    launch_handler: { client_mode: 'focus-existing' },
    // Share target: "Share" a link, text or photo from any other app straight into a News post.
    share_target: { action: '/share-target', method: 'POST', enctype: 'multipart/form-data',
      params: { title: 'title', text: 'text', url: 'url', files: [{ name: 'photo', accept: ['image/*'] }] } },
    // File handlers: "Open with Studies Hub" on a PDF/Word file from the phone's file manager lands
    // straight on the admin upload form with that file already attached.
    file_handlers: [{ action: '/admin', accept: {
      'application/pdf': ['.pdf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    } }],
    // Protocol handler: a foundation for future deep links of the form web+studieshub://chat/5
    // (e.g. from a QR code or a message) opening straight inside the installed app.
    protocol_handlers: [{ protocol: 'web+studieshub', url: '/open?u=%s' }],
    // Widgets: a Windows 11 Widgets Board card showing the latest News. Windows-only today, but spec-correct.
    widgets: [{
      name: 'Studies Hub News', short_name: 'News', description: 'The latest approved news from Studies Hub.',
      tag: 'studies-hub-news', template: 'studies-hub-news-template', ms_ac_template: '/widgets/news-template.json',
      data: '/widgets/news-data.json', type: 'application/json', auth: false, update: 21600,
      screenshots: [{ src: '/icon-512.png?v=2', sizes: '512x512', label: 'Studies Hub News widget' }],
      icons: [{ src: '/icon-192.png?v=2', sizes: '192x192' }],
    }],
  }));
});
// Widgets Board data: the Adaptive Card template (fixed) and the live data (latest 3 approved news items) it binds to.
app.get('/widgets/news-template.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json({
    type: 'AdaptiveCard', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', version: '1.5',
    body: [
      { type: 'TextBlock', size: 'Medium', weight: 'Bolder', text: 'Studies Hub News' },
      { type: 'Container', $data: '${items}', separator: true, items: [
        { type: 'TextBlock', text: '${title}', weight: 'Bolder', wrap: true },
        { type: 'TextBlock', text: '${snippet}', wrap: true, isSubtle: true, spacing: 'None' },
      ] },
    ],
    actions: [{ type: 'Action.Execute', title: 'Open Studies Hub', verb: 'open-news' }],
  });
});
app.get('/widgets/news-data.json', (req, res) => {
  const items = db.prepare("SELECT title, body FROM news WHERE status='approved' ORDER BY id DESC LIMIT 3").all()
    .map(n => ({ title: n.title, snippet: n.body.length > 100 ? n.body.slice(0, 100) + '…' : n.body }));
  res.setHeader('Content-Type', 'application/json');
  res.json({ items });
});
const OFFLINE_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline - Studies Hub</title>
<style>body{margin:0;background:#04101f;color:#eaf2ff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px;box-sizing:border-box}
.card{max-width:360px}img{width:72px;height:72px;border-radius:16px;margin-bottom:18px}
h1{font-size:1.25rem;margin:0 0 8px}p{color:#93a0bd;line-height:1.5;margin:0 0 20px}
button{background:#5bc8ff;color:#04101f;border:none;border-radius:10px;padding:12px 22px;font-size:1rem;font-weight:600;cursor:pointer}</style></head>
<body><div class="card"><img src="/icon-192.png?v=2" alt="Studies Hub"><h1>You're offline</h1>
<p>This page needs a connection. Reconnect and try again -- anything you already opened recently may still work.</p>
<button onclick="location.reload()">Try again</button></div></body></html>`;
app.get('/offline.html', (req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.send(OFFLINE_HTML); });

// Lets Android know studieshub.org links belong to the app (opens them in the app) and lets the site see the app is installed.
app.get('/.well-known/assetlinks.json', (req, res) => res.json([{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'org.studieshub.app', sha256_cert_fingerprints: ['86:04:23:C0:3E:E0:80:51:CD:FE:6B:50:B5:05:62:18:38:3B:E2:CC:68:06:03:6F:17:4C:D8:28:19:1F:83:40'] } }]));
// Android app download: served from our own site so the phone's download finishes cleanly.
const APK_URL = 'https://github.com/Andre3456-del/Studies/releases/download/app-latest/StudiesHub.apk';
// The release is looked up fresh (every 30 s) and the cached file is only reused if it is that same build, so the version the app is told about and the file it downloads can never disagree.
let apkCache = { buf: null, n: 0 };
let appVer = { n: 0, assetId: null, at: 0 };
async function latestApp() {
  if (appVer.n && Date.now() - appVer.at < 30 * 1000) return appVer;
  try {
    const r = await fetch('https://api.github.com/repos/Andre3456-del/Studies/releases/tags/app-latest', { headers: { 'User-Agent': 'studieshub', Accept: 'application/vnd.github+json' } });
    const j = r.ok ? await r.json() : null, m = j && /versionCode:\s*(\d+)/.exec(j.body || '');
    const asset = j && (j.assets || []).find(x => x.name === 'StudiesHub.apk');
    if (m && asset) appVer = { n: Number(m[1]), assetId: asset.id, at: Date.now() };
    else throw new Error('api');
  } catch (e) {
    // GitHub's data service refuses busy shared servers now and then; the ordinary release page still answers, so read the build number there.
    try {
      const r2 = await fetch('https://github.com/Andre3456-del/Studies/releases/tag/app-latest', { headers: { 'User-Agent': 'studieshub' } });
      const m2 = r2.ok ? /versionCode:\s*(\d+)/.exec(await r2.text()) : null;
      if (m2) appVer = { n: Number(m2[1]), assetId: null, at: Date.now() };
    } catch (e2) { /* keep the last known build */ }
  }
  return appVer;
}
app.get('/StudiesHub.apk', async (req, res) => {
  try {
    const v = await latestApp();
    if (!v.n) throw new Error('no release');
    if (!apkCache.buf || apkCache.n !== v.n) {
      const r = await fetch(APK_URL, { redirect: 'follow' });
      if (!r.ok) throw new Error('apk ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      // a real app file is a zip (starts with "PK") and is well over 1 MB; anything else is a half-published or error page
      if (buf.length < 1000000 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error('bad apk');
      apkCache = { buf, n: v.n };
    }
    res.set({ 'Content-Type': 'application/vnd.android.package-archive', 'Content-Disposition': 'attachment; filename="StudiesHub.apk"', 'Content-Length': apkCache.buf.length, 'Cache-Control': 'no-store', 'X-App-Version': String(apkCache.n) });
    res.end(apkCache.buf);
  } catch (e) { apkCache = { buf: null, n: 0 }; res.status(502).send('The app file is not ready yet. Please try again in a minute.'); }
});
// The installed Android app asks this on start: "is there a newer version?" (the build number is written in the release notes).
app.get('/app/version', async (req, res) => {
  const v = await latestApp();
  res.set('Cache-Control', 'no-store').json({ versionCode: v.n, url: '/StudiesHub.apk' });
});
app.get('/app', (req, res) => {
  // The download page is for the website only: inside the app it can never open, even by a stale link.
  if (inApp(req)) return res.redirect('/settings');
  const body = `<main class="auth" style="max-width:520px;width:100%;margin:24px auto;padding:22px;text-align:center"><img src="/icon-192.png?v=2" alt="" width="96" height="96" style="border-radius:22px"><h1>Studies Hub app</h1><p class="muted">For Android phones and tablets. It opens full screen, like any other app.</p><p><a id="dlApp" class="btn" href="/StudiesHub.apk" download="StudiesHub.apk" style="display:inline-block;padding:14px 28px;font-size:18px">Download the app</a></p><ol style="text-align:left;line-height:1.7"><li>Tap <b>Download the app</b> and wait for it to finish.</li><li>Open the downloaded file (swipe down from the top of your phone and tap it).</li><li>If Android asks, tap <b>Settings</b> and allow installing from this browser, go back, then tap <b>Install</b>.</li><li>Open <b>Studies Hub</b> from your home screen.</li></ol><script>(function(){var a=document.getElementById('dlApp');try{navigator.getInstalledRelatedApps&&navigator.getInstalledRelatedApps().then(function(r){if(r&&r.length&&a){a.textContent='Open the app';a.removeAttribute('download');a.href='intent://studieshub.org/#Intent;scheme=https;package=org.studieshub.app;S.browser_fallback_url='+encodeURIComponent('https://studieshub.org/StudiesHub.apk')+';end'}}).catch(function(){})}catch(e){}})()</script><p class="muted">iPhone: open studieshub.org in Safari, tap Share, then Add to Home Screen.</p></main>`;
  res.send(layout('Get the app', body, req.user));
});
const UPLOAD_QUEUED_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Saved - Studies Hub</title>
<style>body{margin:0;background:#04101f;color:#eaf2ff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px;box-sizing:border-box}
.card{max-width:360px}.tick{font-size:48px;margin-bottom:12px}
h1{font-size:1.25rem;margin:0 0 8px}p{color:#93a0bd;line-height:1.5;margin:0 0 20px}
a.btn{display:inline-block;background:#5bc8ff;color:#04101f;border:none;border-radius:10px;padding:12px 22px;font-size:1rem;font-weight:600;text-decoration:none}</style></head>
<body><div class="card"><div class="tick">💾</div><h1>Saved on your device</h1>
<p>No connection right now, so this is waiting on your phone. It'll upload itself as soon as you're back online -- no need to try again.</p>
<a class="btn" href="/admin">Back to Admin</a></div></body></html>`;
const SW_JS = `var OFFLINE_CACHE='studies-hub-offline-v3',UPLOAD_PATHS=['/admin/upload'];
self.addEventListener('install',function(e){self.skipWaiting();e.waitUntil(caches.open(OFFLINE_CACHE).then(function(c){return c.add('/offline.html')}))});
self.addEventListener('fetch',function(e){
  if(e.request.mode!=='navigate')return;
  var pathname=new URL(e.request.url).pathname;
  if(e.request.method==='POST'&&UPLOAD_PATHS.indexOf(pathname)>-1){e.respondWith(handleUploadNav(e.request,pathname));return}
  if(e.request.method!=='GET'){e.respondWith(fetch(e.request).catch(function(){return caches.open(OFFLINE_CACHE).then(function(c){return c.match('/offline.html')})}));return}
  // A normal page visit: try the network and remember the result, so the same page can still open with no connection later.
  var skip=pathname==='/app'||pathname==='/saved'||pathname==='/settings';
  e.respondWith(fetch(e.request).then(function(res){if(!skip){var copy=res.clone();caches.open(OFFLINE_CACHE).then(function(c){c.put(e.request,copy)})}return res})
    .catch(function(){return caches.open(OFFLINE_CACHE).then(function(c){return c.match(e.request).then(function(cached){return cached||c.match('/offline.html')})})}));
});
self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k.indexOf('studies-hub-offline-')===0&&k!==OFFLINE_CACHE}).map(function(k){return caches.delete(k)}))}).then(function(){return self.clients.claim()}))});
// Periodic Background Sync: a Chromium-only, engagement-gated API -- the browser decides if/how often this
// actually fires. Used here to keep a few key pages fresh for offline browsing, and to refresh the News widget.
function refreshCachedPages(){
  return caches.open(OFFLINE_CACHE).then(function(c){
    return Promise.all(['/dashboard','/news','/chat'].map(function(p){return fetch(p).then(function(res){if(res.ok)return c.put(p,res)}).catch(function(){})}));
  });
}
function updateWidget(widget){
  var d=widget.definition;
  return Promise.all([fetch(d.msAcTemplate).then(function(r){return r.text()}),fetch(d.data).then(function(r){return r.text()})])
    .then(function(r){return self.widgets.updateByTag(d.tag,{template:r[0],data:r[1]})}).catch(function(){});
}
self.addEventListener('periodicsync',function(e){
  if(e.tag==='refresh-content')e.waitUntil(refreshCachedPages());
  if('widgets' in self)e.waitUntil(self.widgets.getByTag(e.tag).then(function(w){if(w)return updateWidget(w)}));
});
// Windows 11 Widgets Board lifecycle (does nothing on platforms without a widgets host).
self.addEventListener('widgetinstall',function(e){
  e.waitUntil(updateWidget(e.widget).then(function(){
    if(!self.registration.periodicSync)return;
    return self.registration.periodicSync.getTags().then(function(tags){
      if(tags.indexOf(e.widget.definition.tag)===-1)return self.registration.periodicSync.register(e.widget.definition.tag,{minInterval:(e.widget.definition.update||21600)*1000});
    });
  }).catch(function(){}));
});
self.addEventListener('widgetresume',function(e){e.waitUntil(updateWidget(e.widget))});
self.addEventListener('widgetclick',function(e){if(e.action==='open-news')e.waitUntil(self.clients.openWindow('/news'))});
self.addEventListener('sync',function(e){
  if(e.tag==='send-queued-messages')e.waitUntil(flushQueuedMessages());
  if(e.tag==='send-queued-uploads')e.waitUntil(flushQueuedUploads());
});
function pendingDB(){return new Promise(function(res,rej){var rq=indexedDB.open('shq-pending',2);rq.onupgradeneeded=function(){var db=rq.result;if(!db.objectStoreNames.contains('msgs'))db.createObjectStore('msgs',{keyPath:'id',autoIncrement:true});if(!db.objectStoreNames.contains('uploads'))db.createObjectStore('uploads',{keyPath:'id',autoIncrement:true})};rq.onsuccess=function(){res(rq.result)};rq.onerror=function(){rej(rq.error)}})}
function storeAll(store){return pendingDB().then(function(db){return new Promise(function(res){var rq=db.transaction(store,'readonly').objectStore(store).getAll();rq.onsuccess=function(){res(rq.result)};rq.onerror=function(){res([])}})})}
function storeDelete(store,id){return pendingDB().then(function(db){return new Promise(function(res){var tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(id);tx.oncomplete=function(){res()}})})}
function flushQueuedMessages(){
  return storeAll('msgs').then(function(items){
    var sentTempIds=[];
    return items.reduce(function(p,it){return p.then(function(){
      return fetch('/api/messages/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(it.payload)}).then(function(r){return r.json()}).then(function(j){
        if(j&&j.id){sentTempIds.push(it.tempId);return storeDelete('msgs',it.id)}
      }).catch(function(){});
    })},Promise.resolve()).then(function(){
      return self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(cs){cs.forEach(function(c){c.postMessage({type:'chat-synced',tempIds:sentTempIds})})});
    });
  });
}
// A failed upload-form submission (offline) lands here instead of a native error: save it whole (fields + the
// file itself) and hand back a friendly confirmation page instead of the browser's own offline error.
function handleUploadNav(req,pathname){
  var clone=req.clone();
  return fetch(req).catch(function(){
    return clone.formData().then(function(fd){
      var fields={},file=null;
      fd.forEach(function(v,k){
        if(v&&typeof v==='object'&&typeof v.arrayBuffer==='function'&&v.size>0){file={name:v.name||'upload',type:v.type||'application/octet-stream',blob:v}}
        else if(!(v&&typeof v==='object'&&typeof v.arrayBuffer==='function')){
          if(fields[k]===undefined)fields[k]=v;else if(Array.isArray(fields[k]))fields[k].push(v);else fields[k]=[fields[k],v];
        }
      });
      return pendingDB().then(function(db){return new Promise(function(res,rej){var tx=db.transaction('uploads','readwrite'),rq=tx.objectStore('uploads').add({url:pathname,fields:fields,file:file});rq.onsuccess=function(){res()};rq.onerror=function(){rej(rq.error)}})});
    }).then(function(){
      return self.registration.sync.register('send-queued-uploads').catch(function(){});
    }).then(function(){
      return new Response(UPLOAD_QUEUED_HTML,{status:200,headers:{'Content-Type':'text/html; charset=utf-8'}});
    });
  });
}
function flushQueuedUploads(){
  return storeAll('uploads').then(function(items){
    return items.reduce(function(p,it){return p.then(function(){
      var fd=new FormData();
      Object.keys(it.fields).forEach(function(k){var v=it.fields[k];if(Array.isArray(v))v.forEach(function(vv){fd.append(k,vv)});else fd.append(k,v)});
      if(it.file)fd.append('file',it.file.blob,it.file.name);
      return fetch(it.url,{method:'POST',body:fd}).then(function(res){if(res.ok)return storeDelete('uploads',it.id)}).catch(function(){});
    })},Promise.resolve());
  }).then(function(){
    return self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(cs){cs.forEach(function(c){c.postMessage({type:'uploads-synced'})})});
  });
}
self.addEventListener('push',function(e){
  var d={};
  try{d=e.data.json()}catch(_){d={title:'Studies Hub',body:e.data?e.data.text():''}}
  if(d.ringEnd){
    e.waitUntil(self.registration.showNotification(d.title||'Call ended',{tag:d.tag,silent:true,icon:'/icon-192.png?v=2',badge:'/icon-192.png?v=2'}).then(function(){return new Promise(function(r){setTimeout(r,700)})}).then(function(){return self.registration.getNotifications({tag:d.tag})}).then(function(list){list.forEach(function(n){n.close()})}));
    return;
  }
  if(d.ring){
    e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(cs){
      for(var i=0;i<cs.length;i++){if(cs[i].visibilityState==='visible')return}
      return self.registration.showNotification(d.title||'Incoming call',{body:d.body||'Incoming call',icon:d.icon||'/icon-192.png?v=2',badge:'/icon-192.png?v=2',tag:d.tag,renotify:true,requireInteraction:true,silent:false,vibrate:[500,250,500,250,500,250,500,250,500,250,500],actions:[{action:'answer',title:'Answer'},{action:'decline',title:'Decline'}],data:{url:'/chat',call:d.ring}});
    }));
    return;
  }
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(cs){
    var url=d.url||'/';
    for(var i=0;i<cs.length;i++){var c=cs[i];if(c.visibilityState==='visible'&&c.focused&&new URL(c.url).pathname===url.split('?')[0])return}
    var replyTo=d.quickReply&&d.quickReply.reply_to_id;
    var options={body:d.body||'',icon:d.icon||'/icon-192.png?v=2',badge:'/icon-192.png?v=2',tag:d.tag||undefined,renotify:!!d.tag,data:{url:url,replyTo:replyTo||null}};
    if(d.quickReply)options.actions=[{action:'reply',title:'Reply'}];
    return self.registration.showNotification(d.title||'Studies Hub',options);
  }));
});
function openApp(url){
  return self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(cs){
    for(var i=0;i<cs.length;i++){var c=cs[i];if('focus' in c){if(c.navigate)c.navigate(url);return c.focus()}}
    return self.clients.openWindow(url);
  });
}
self.addEventListener('notificationclick',function(e){
  var n=e.notification,data=n.data||{},url=data.url||'/';
  n.close();
  if(data.call){
    var cid=encodeURIComponent(data.call.id);
    if(e.action==='decline'){e.waitUntil(fetch('/api/calls/'+cid+'/decline',{method:'POST',credentials:'include'}).catch(function(){}));return}
    if(e.action==='answer'){e.waitUntil(fetch('/api/calls/'+cid+'/accept',{method:'POST',credentials:'include'}).then(function(r){return r.ok?r.json():{}}).then(function(j){return openApp(j&&j.url?j.url:'/chat')}).catch(function(){return openApp('/chat')}));return}
    e.waitUntil(openApp('/chat'));return;
  }
  if(e.action==='reply'&&data.replyTo&&!/[?&]reply_to=/.test(url))url+=(url.indexOf('?')>=0?'&':'?')+'reply_to='+encodeURIComponent(data.replyTo);
  e.waitUntil(openApp(url));
});`;
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Service-Worker-Allowed', '/');
  res.send(SW_JS);
});
app.post('/api/push/subscribe', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const b = req.body || {}, k = b.keys || {};
  let host = '';
  try { host = new URL(String(b.endpoint || '')).protocol; } catch { host = ''; }
  if (host !== 'https:' || !k.p256dh || !k.auth || String(b.endpoint).length > 1000) return res.status(400).json({ error: 'Invalid subscription.' });
  db.prepare('INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth) VALUES(?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth')
    .run(req.user.id, String(b.endpoint), String(k.p256dh), String(k.auth));
  res.json({ ok: true });
});
app.post('/api/push/unsubscribe', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?').run(String((req.body && req.body.endpoint) || ''), req.user.id);
  res.json({ ok: true });
});

// The Android app's "my data is on" ping (every ~45 s, and the moment a push reaches the phone). It counts the person as reachable right now,
// which is what turns a sent message's one tick into two. (It must sit after the login check above, otherwise it can never know who is calling.)
const pingHandler = (req, res) => {
  if (!req.user) return res.sendStatus(401);
  db.prepare('UPDATE users SET last_seen=? WHERE id=?').run(Date.now(), req.user.id);
  req.user.last_seen = Date.now();
  markDelivered(req.user.id);
  res.set('Cache-Control', 'no-store').sendStatus(204);
};
app.get('/api/ping', pingHandler);
app.post('/api/ping', pingHandler);
app.get('/api/live', (req, res) => {
  if (!req.user) return res.status(401).end();
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  liveClients.add(res);
  const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch (e) { /* closed */ } }, 25000);
  req.on('close', () => { clearInterval(hb); liveClients.delete(res); });
});

// Is this request from the Studies Hub Android app? The app's name is in its user-agent, but the browser's background page loader does not send
// that, so the app also keeps a small "shapp" cookie. Both count.
const inApp = req => /StudiesHubApp/.test(req.headers['user-agent'] || '') || /(?:^|;\s*)shapp=1(?:;|$)/.test(req.headers.cookie || '');
const ONLINE_MS = 2 * 60 * 1000; // a user counts as "online" if seen in the last 2 minutes
const isReachable = u => !!u.last_seen && Date.now() - u.last_seen < ONLINE_MS; // the person's phone has data on right now (used for the two ticks and ringing)
const isOnline = u => isReachable(u) && !u.hide_active; // what may be shown as "online": only when they have active status on
const presenceDot = u => `<span title="${isOnline(u) ? 'Online' : 'Offline'}" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${isOnline(u) ? '#22c55e' : '#ef4444'};margin-right:7px;vertical-align:middle"></span>`;

// Roles: user | partial (HTML pages only) | content (all file types) | news | support (login help) | admin (everything).
// Only the central admin (the ADMIN_EMAIL account) can hand these out.
const ROLES = ['user', 'partial', 'content', 'news', 'support', 'observer', 'admin'];
const ROLE_LABEL = { user: 'User', partial: 'Partial admin (HTML pages)', content: 'Files admin', news: 'News admin', support: 'Login-help admin', observer: 'Observer (read-only)', admin: 'Full admin' };
const can = {
  full: u => !!u && u.role === 'admin',
  pages: u => !!u && ['admin', 'partial', 'content'].includes(u.role),
  allKinds: u => !!u && ['admin', 'content'].includes(u.role),
  news: u => !!u && ['admin', 'news'].includes(u.role),
  support: u => !!u && ['admin', 'support'].includes(u.role),
  anyAdmin: u => !!u && ((ROLES.includes(u.role) && u.role !== 'user') || !!u.position_can_verify),
};
// What an admin posts is theirs: other admins (the central admin included) do not get the management side of it. Posts by students stay with the news admins,
// and anything uploaded before this rule existed (no recorded owner) stays with the full admins so nothing is left orphaned.
const staffAuthor = id => { if (!id) return false; const u = db.prepare('SELECT role FROM users WHERE id=?').get(id); return !!u && u.role !== 'user'; };
const mayManageNews = (me, n) => !n.author_id ? can.full(me) : staffAuthor(n.author_id) ? n.author_id === me.id : true;
const ownsAdminPage = (me, p) => p.author_id ? false : p.admin_id ? p.admin_id === me.id : can.full(me);
const NOT_YOURS = 'Only the admin who posted this can manage it.';
const guard = ok => (req, res, next) =>
  ok(req.user) ? next() : req.method === 'GET' ? res.redirect('/login?next=/admin') : res.sendStatus(403);
const admin = guard(can.full);
const adminish = guard(can.anyAdmin);
const pagesAdmin = guard(can.pages);
const filesAdmin = guard(can.allKinds);
const newsAdmin = guard(can.news);
const supportAdmin = guard(can.support);
const isCentral = u => !!u && u.email === ADMIN_EMAIL;
const central = (req, res, next) => isCentral(req.user) ? next() : res.sendStatus(403);
// Only the central admin, and the people the central admin appoints, can move students up a level. Nobody can change their own level.
const canPromote = u => !!u && (isCentral(u) || !!u.can_promote);
const promoter = (req, res, next) => canPromote(req.user) ? next() : req.method === 'GET' ? res.redirect('/login?next=/admin/levels') : res.sendStatus(403);

const SEARCHSEL_JS = String.raw`(function(){
var NAMES=/^(department|faculty|institution|university|dept_filter)$/;
function snap(s){var o=[];[].forEach.call(s.children,function(c){if(c.tagName==='OPTGROUP'){[].forEach.call(c.children,function(x){o.push({g:c.label,v:x.value,t:x.textContent})})}else o.push({g:'',v:c.value,t:c.textContent,b:c.value===''})});return o}
function fill(s,list,sel){s._busy=1;s.innerHTML='';var gm={};list.forEach(function(it){var p=s;if(it.g){p=gm[it.g];if(!p){p=document.createElement('optgroup');p.label=it.g;s.appendChild(p);gm[it.g]=p}}var o=document.createElement('option');o.value=it.v;o.textContent=it.t;if(it.v===sel)o.selected=true;p.appendChild(o)});s._busy=0;if(s._obs)s._obs.takeRecords()}
function enhance(s){
 if(s._ss||s.multiple)return;s._ss=1;
 var box=document.createElement('input');box.type='search';box.className='ss-in';box.placeholder='Type to search...';box.autocomplete='off';box.setAttribute('aria-label','Search the list');
 s.parentNode.insertBefore(box,s);
 var master=snap(s);
 function vis(){box.style.display=master.length>7?'':'none'}
 vis();
 box.addEventListener('input',function(){var q=box.value.trim().toLowerCase(),cur=s.value;fill(s,master.filter(function(it){return it.b||it.v===cur||it.t.toLowerCase().indexOf(q)>-1}),cur);if(q){var first=null;[].forEach.call(s.options,function(o){if(!first&&o.value&&o.textContent.toLowerCase().indexOf(q)>-1)first=o})}});
 s._obs=new MutationObserver(function(){if(s._busy)return;master=snap(s);box.value='';vis()});s._obs.observe(s,{childList:true,subtree:true});
}
function run(){[].forEach.call(document.querySelectorAll('select'),function(s){if(NAMES.test(s.name||'')||s.hasAttribute('data-search'))enhance(s)})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
})();`;
const FEEDBACK_CSS = `.ss-in{margin:4px 0!important}
.fbmin{display:flex;align-items:center;gap:10px;justify-content:space-between;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px 14px;margin:0 0 12px;cursor:pointer}.fbmin b{font-size:15px}
.fbsheet{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center}.fbbox{background:var(--bg);color:var(--fg);width:min(520px,100%);max-height:92vh;overflow:auto;border:1px solid var(--line);border-radius:18px 18px 0 0;padding:18px 18px calc(18px + env(safe-area-inset-bottom,0px))}
.fbbox h3{margin:0 0 4px}.fbbox textarea{width:100%;min-height:70px;font:inherit;padding:10px 12px;margin:4px 0 10px;color:var(--fg);background:rgba(8,10,22,.5);border:1px solid var(--line);border-radius:10px}.fbbox label.q{display:block;font-weight:600;margin-top:6px}
.fbstars{display:flex;gap:6px;margin:6px 0 10px}.fbstars button{font-size:26px;padding:6px 10px;background:transparent;border:1px solid var(--line);color:var(--fg);box-shadow:none;border-radius:12px;min-width:50px;min-height:50px}.fbstars button.on{border-color:var(--blue);background:rgba(56,176,248,.2)}
.fbrow{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-top:8px}.fbrow button{min-height:46px;padding:10px 18px}@media(min-width:700px){.fbsheet{align-items:center}.fbbox{border-radius:18px}}`;
const FEEDBACK_JS = String.raw`(function(){
var P=location.pathname;
if(/^\/(login|signup|welcome|call|forgot|reset|verify|pay|invite|chat\/)/.test(P))return;
var K='shFb',st={seen:[],loads:0,state:'',next:0};
try{st=Object.assign(st,JSON.parse(localStorage.getItem(K)||'{}'))}catch(e){}
function save(){try{localStorage.setItem(K,JSON.stringify(st))}catch(e){}}
var sec=P==='/'||P==='/dashboard'?'home':P.indexOf('/news')===0?'news':P.indexOf('/chat')===0?'chat':P.indexOf('/p/')===0?'files':P.indexOf('/settings')===0?'settings':P.indexOf('/u/')===0?'people':P.indexOf('/lecturer')===0?'lecturer':P.indexOf('/uni')===0?'uni':P.indexOf('/admin')===0?'admin':'';
if(sec&&st.seen.indexOf(sec)<0)st.seen.push(sec);
st.loads=(st.loads||0)+1;save();
if(st.state==='done'||Date.now()<(st.next||0))return;
if(st.seen.length<3||st.loads<4)return;
fetch('/api/feedback/status',{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){
 if(!j||!j.show){st.state='done';st.next=Date.now()+86400000*14;save();return}
 if(st.state==='min')strip();else open();
}).catch(function(){});
var ratingV=0,sheet=null,bar=null;
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function strip(){
 if(bar)return;var m=document.querySelector('main');if(!m)return;
 bar=el('div','fbmin');var b=el('b',null,'📝 Tell us what you think about Studies Hub');var o=el('span',null,'Open');o.style.color='var(--blue)';
 bar.appendChild(b);bar.appendChild(o);bar.onclick=function(){st.state='';save();bar.remove();bar=null;open()};
 m.insertBefore(bar,m.firstChild);
}
function ta(label,name,ph){var w=document.createDocumentFragment();w.appendChild(el('label','q',label));var t=document.createElement('textarea');t.name=name;t.maxLength=1000;t.placeholder=ph;w.appendChild(t);return w}
function open(){
 if(sheet)return;
 sheet=el('div','fbsheet');var box=el('div','fbbox');sheet.appendChild(box);
 box.appendChild(el('h3',null,'How is Studies Hub for you?'));
 box.appendChild(el('p','mut','A minute of your time helps us make it better. Everything goes straight to the site owner.'));
 box.appendChild(el('label','q','How would you rate the site?'));
 var stars=el('div','fbstars'),faces=['😞','😐','🙂','😀','🤩'];
 faces.forEach(function(f,i){var b=el('button',null,f);b.type='button';b.setAttribute('aria-label',(i+1)+' out of 5');b.onclick=function(){ratingV=i+1;[].forEach.call(stars.children,function(c,j){c.className=j===i?'on':''})};stars.appendChild(b)});
 box.appendChild(stars);
 box.appendChild(ta('What do you like about the site?','liked','The things that work well for you'));
 box.appendChild(ta('What would you like us to add or change?','suggest','Features, fixes, anything you wish it had'));
 box.appendChild(ta('Anything else you want to say?','other','A compliment, a complaint, a question'));
 var msg=el('p','mut','');msg.style.margin='0';box.appendChild(msg);
 var row=el('div','fbrow');
 var later=el('button','ghost','Not now');later.type='button';later.onclick=function(){st.next=Date.now()+86400000*3;st.state='';save();close()};
 var mini=el('button','ghost','Minimize');mini.type='button';mini.onclick=function(){st.state='min';save();close();strip()};
 var send=el('button',null,'Send');send.type='button';
 send.onclick=function(){
  var v=function(n){return (box.querySelector('textarea[name='+n+']')||{}).value||''};
  var body={rating:ratingV||null,liked:v('liked'),suggest:v('suggest'),other:v('other')};
  if(!body.rating&&!body.liked.trim()&&!body.suggest.trim()&&!body.other.trim()){msg.textContent='Please answer at least one question.';msg.style.color='#ff8080';return}
  send.disabled=true;msg.style.color='';msg.textContent='Sending…';
  fetch('/api/feedback',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})}).then(function(x){
   if(x.ok){st.state='done';st.next=Date.now()+86400000*14;save();box.innerHTML='';box.appendChild(el('h3',null,'Thank you! 💙'));box.appendChild(el('p','mut','Your feedback went straight to the site owner.'));var c=el('button',null,'Close');c.onclick=close;box.appendChild(c)}
   else{send.disabled=false;msg.style.color='#ff8080';msg.textContent=x.j&&x.j.error||'Could not send. Please try again.'}
  }).catch(function(){send.disabled=false;msg.style.color='#ff8080';msg.textContent='No connection. Please try again.'});
 };
 row.appendChild(later);row.appendChild(mini);row.appendChild(send);box.appendChild(row);
 document.body.appendChild(sheet);
}
function close(){if(sheet){sheet.remove();sheet=null}}
})();`;
const CSS = `:root{--bg:#12121c;--panel:rgba(32,48,96,.30);--line:rgba(56,176,248,.24);--fg:#eaf2ff;--mut:#93a0bd;--blue:#38b0f8;--blue2:#1c7fe0;--pink:#f000e8;color-scheme:dark;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
:root[data-theme="light"]{--bg:#f4f7fc;--panel:rgba(56,176,248,.08);--line:rgba(28,96,160,.22);--fg:#0e1a2b;--mut:#51607a;--blue:#1c7fe0;--blue2:#145fb0;--pink:#c400bc;color-scheme:light}
html{background:var(--bg);scroll-padding-top:env(safe-area-inset-top,0px)}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg);background:radial-gradient(900px 520px at 12% -8%,rgba(56,176,248,.22),transparent 62%),radial-gradient(700px 440px at 96% 4%,rgba(240,0,232,.13),transparent 60%),var(--bg);background-attachment:fixed}
a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}${FEEDBACK_CSS}
.autolink{text-decoration:underline}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:calc(10px + env(safe-area-inset-top,0px)) max(20px,calc((100% - 1000px)/2)) 10px;margin:calc(-1 * env(safe-area-inset-top,0px)) 0 0;position:sticky;top:0;z-index:40;background:var(--bg);border-bottom:1px solid var(--line);transition:transform .22s ease}.top.hide{transform:translateY(-110%)}.top[hidden]{display:none}.top .menu-btn{font-size:28px;padding:8px 12px;min-width:48px;min-height:48px}.top .brand{font-size:22px;font-weight:800;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
.brand{display:flex;align-items:center;gap:10px;color:var(--fg);font-weight:700;font-size:18px}.brand:hover{text-decoration:none}
.logo{width:22px;height:22px;border-radius:6px;background:linear-gradient(135deg,var(--blue),var(--pink));box-shadow:0 0 14px rgba(56,176,248,.7)}
nav{display:flex;align-items:center;gap:10px}nav form{margin:0}
main{max-width:1000px;margin:0 auto;padding:12px 20px 32px}
.btn,button{display:inline-block;font:inherit;font-weight:600;cursor:pointer;color:#04101f;background:linear-gradient(135deg,#5bc8ff,var(--blue) 55%,var(--blue2));border:0;border-radius:10px;padding:9px 18px;margin:6px 0;box-shadow:0 0 18px rgba(56,176,248,.35)}
.btn:hover,button:hover{filter:brightness(1.1);text-decoration:none}
.btn.ghost,button.ghost{background:transparent;color:var(--blue);border:1px solid var(--line);box-shadow:none}
button.link{background:none;color:var(--mut);box-shadow:none;padding:0;margin:0;font-weight:500}button.link:hover{color:var(--blue);filter:none}
input,textarea{font:inherit;width:100%;padding:11px 13px;margin:6px 0;color:var(--fg);background:rgba(8,10,22,.65);border:1px solid var(--line);border-radius:10px;outline:0}
#msgInput{resize:none;max-height:120px;overflow-y:auto;line-height:1.3}
input:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(56,176,248,.2)}
input::placeholder{color:#6b7794}input[type=checkbox]{width:auto}
.card{display:block;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px;margin:14px 0}
.row{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.mut{color:var(--mut);font-size:14px}.err{color:#ff7ab8}
h1{font-size:clamp(28px,6vw,44px);line-height:1.15;margin:.2em 0}h2,h3{margin:.8em 0 .3em}.sec{margin-top:28px}
.hero{text-align:center;padding:44px 0 24px}
.eyebrow{color:var(--blue);letter-spacing:3px;text-transform:uppercase;font-size:13px;margin:0}
.grad{background:linear-gradient(90deg,var(--blue),#8ad8ff 50%,var(--pink));-webkit-background-clip:text;background-clip:text;color:transparent}
.lead{color:var(--mut);max-width:520px;margin:12px auto 20px;font-size:18px}
.cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.tile{display:flex;flex-direction:column;gap:8px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px;color:var(--fg);transition:.2s}
.tile:hover{transform:translateY(-3px);border-color:var(--blue);box-shadow:0 0 24px rgba(56,176,248,.25);text-decoration:none}
.tile h3{margin:0;font-size:18px}.go{color:var(--blue);font-size:14px}
.chip{align-self:flex-start;font-size:12px;padding:2px 10px;border-radius:99px;border:1px solid var(--line);color:var(--blue)}
.chip.lock{color:#ff7cf5;border-color:rgba(240,0,232,.45)}
.chip.pay{color:#ffd166;border-color:rgba(255,209,102,.5)}
.auth{max-width:420px;margin:28px auto}.auth h1{font-size:30px;text-align:center}.auth>p{text-align:center}.auth .card button{width:100%}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line)}th{color:var(--mut);font-weight:500}
footer{text-align:center;color:var(--mut);font-size:13px;padding:20px}
body.has-footer{display:flex;flex-direction:column;min-height:100vh;min-height:100dvh}
body.has-footer main{flex:1 0 auto;width:100%;box-sizing:border-box}
.site-foot{margin-top:auto;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;padding:16px 20px calc(16px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--line);background:linear-gradient(to top,rgba(56,176,248,.08),transparent);color:var(--mut);font-size:13px}
.site-foot a{color:var(--blue);font-weight:600;text-decoration:none;padding:5px 14px;border:1px solid var(--line);border-radius:99px;transition:background .15s,border-color .15s}
.site-foot a:hover{background:rgba(56,176,248,.12);border-color:var(--blue)}
.gbtn{display:block;text-align:center;width:100%}
.stat{display:block;font-size:30px;font-weight:700;line-height:1.2}
.dash-hero{position:relative;overflow:hidden;border-radius:20px;padding:28px 24px;margin:16px 0 8px;border:1px solid var(--line);background:linear-gradient(160deg,rgba(56,176,248,.16),rgba(240,0,232,.08) 60%,rgba(18,18,28,.4));isolation:isolate}
.dash-hero::before,.dash-hero::after{content:'';position:absolute;border-radius:50%;filter:blur(38px);z-index:-1}
.dash-hero::before{width:220px;height:220px;background:radial-gradient(circle,var(--blue),transparent 70%);top:-90px;right:-60px;opacity:.55}
.dash-hero::after{width:180px;height:180px;background:radial-gradient(circle,var(--pink),transparent 70%);bottom:-80px;left:-40px;opacity:.4}
.dash-top{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.avatar{flex:none;width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;color:#04101f;background:linear-gradient(135deg,#5bc8ff,var(--blue) 55%,var(--pink));box-shadow:0 0 20px rgba(56,176,248,.45)}
.pill{display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:3px 11px;border-radius:99px;border:1px solid var(--line);color:var(--blue);background:rgba(56,176,248,.08)}
.pill.pending{color:#ff9f43;border-color:rgba(255,159,67,.4);background:rgba(255,159,67,.08)}
.ai-fab{position:fixed;right:16px;bottom:16px;margin-bottom:env(safe-area-inset-bottom,0px);z-index:20;border-radius:99px;padding:12px 18px}
.ai-box{position:fixed;right:16px;bottom:72px;margin-bottom:env(safe-area-inset-bottom,0px);z-index:20;width:min(360px,calc(100vw - 32px));height:min(460px,calc(100vh - 140px));display:flex;flex-direction:column;background:#161628;border:1px solid var(--line);border-radius:16px;box-shadow:0 0 30px rgba(56,176,248,.25)}
.ai-box[hidden]{display:none}
.ai-head{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line)}.ai-head button{font-size:22px;line-height:1}
.ai-log{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
.ai-m{max-width:85%;padding:8px 12px;border-radius:12px;font-size:15px;white-space:pre-wrap;overflow-wrap:anywhere}
.ai-m.me{align-self:flex-end;background:linear-gradient(135deg,#5bc8ff,var(--blue2));color:#04101f}.ai-m.bot{align-self:flex-start;background:var(--panel);border:1px solid var(--line)}
.ai-form{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line)}.ai-form input,.ai-form button{margin:0}
.menu-btn{background:none;border:0;color:var(--fg);font-size:22px;line-height:1;cursor:pointer;padding:4px 6px;box-shadow:none;width:auto}
.scrim{position:fixed;inset:0;background:rgba(0,0,0,.5);opacity:0;pointer-events:none;transition:opacity .2s;z-index:29}.scrim.show{opacity:1;pointer-events:auto}
.drawer{overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;position:fixed;top:0;bottom:0;left:0;width:min(280px,82vw);background:#0e0e18;border-right:1px solid var(--line);z-index:30;display:flex;flex-direction:column;transform:translateX(-100%);transition:transform .22s ease;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
.drawer.open{transform:translateX(0)}.drawer{align-items:stretch}.drawer>*{flex:none}.drawer-arrows{display:none}
@media (hover:hover) and (pointer:fine){.drawer-arrows.show{display:flex;flex-direction:column;gap:8px;position:fixed;z-index:31;top:50%;transform:translateY(-50%);left:calc(min(280px,82vw) - 52px)}.drawer-arrows button{margin:0;width:38px;height:38px;padding:0;border-radius:50%;font-size:15px;line-height:1;background:rgba(56,176,248,.18);color:var(--fg);border:1px solid var(--line);box-shadow:none;cursor:pointer}.drawer-arrows button:hover{background:rgba(56,176,248,.35)}.drawer{padding-right:2px}}
.drawer-top{display:flex;align-items:center;gap:10px;padding:16px 16px 10px}
.drawer-user{display:flex;align-items:center;gap:10px;padding:6px 16px 14px}
.drawer-av-img{width:40px;height:40px;border-radius:50%;object-fit:cover;flex:none}
.drawer-label{color:var(--mut);letter-spacing:2px;font-size:11px;text-transform:uppercase;padding:6px 16px;margin:6px 0 0}
.drawer-item{display:flex;align-items:center;gap:12px;padding:12px 16px;color:var(--fg);font-weight:500}
.drawer-item span{width:22px;text-align:center;font-size:17px}
.drawer-item:hover{background:rgba(56,176,248,.08);text-decoration:none}
.drawer-item.active{background:rgba(56,176,248,.14);color:var(--blue);border-right:3px solid var(--blue)}
.drawer-bottom{margin-top:auto;border-top:1px solid var(--line);padding:6px 0}
.news-card{display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:16px;overflow:hidden;margin:14px 0}
a.news-card{color:inherit;text-decoration:none;display:flex}
.ad-card{padding:10px 12px 12px;min-height:130px}.ad-label{font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:var(--mut);margin-bottom:6px}.ad-card ins{width:100%}
.news-img{width:100%;aspect-ratio:16/9;object-fit:cover;background:linear-gradient(135deg,rgba(56,176,248,.25),rgba(240,0,232,.18))}
.news-body{padding:14px 16px}
.news-body h3{margin:2px 0 6px;font-size:17px;line-height:1.3}
.news-body p, .news-full{white-space:pre-wrap;word-wrap:break-word}
.news-meta{color:var(--mut);font-size:12px;display:flex;gap:8px;align-items:center}
.chat-item{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:14px;color:var(--fg)}
.chat-item:hover{background:var(--panel);text-decoration:none}
.chat-item .av{position:relative;flex:none}
.chat-item .av .dot{position:absolute;right:-2px;bottom:-2px;width:11px;height:11px;border-radius:50%;border:2px solid var(--bg)}
.chat-item .meta{min-width:0;flex:1}
.chat-item .meta b{display:block}
.chat-item .meta span{display:block;font-size:12px;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chat-item .meta span span.tick{display:inline;overflow:visible;font-size:13px}.chat-item .meta span span.tick-un{color:#dc2626}.chat-item .meta span span.tick-read{color:#22c55e}.chat-item .meta span span.tick-queued{color:#93a0bd}
.chat-label{color:var(--mut);letter-spacing:2px;font-size:11px;text-transform:uppercase;margin:18px 0 6px}
.thread{display:flex;flex-direction:column;gap:8px;padding:6px 2px 90px}
body.msg-selecting .chat-head{display:none}
.thread [data-id]{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
.thread .msg-sel{outline:2px solid var(--blue);outline-offset:3px}
.react-bar{position:fixed;z-index:40;display:flex;gap:2px;padding:6px 8px;background:var(--bg);border:1px solid var(--line);border-radius:99px;box-shadow:0 6px 20px rgba(0,0,0,.45)}
.react-bar button{background:none;border:0;box-shadow:none;font-size:24px;padding:2px 5px;margin:0;cursor:pointer;border-radius:50%;line-height:1.2}
.to-btm{position:fixed;right:16px;bottom:84px;z-index:30;width:42px;height:42px;border-radius:50%;padding:0;margin:0;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--fg);border:1px solid var(--line);box-shadow:0 4px 14px rgba(0,0,0,.4)}
.to-btm .nbadge{position:absolute;top:-9px;right:-3px;margin:0}
.unread-div{align-self:center;background:var(--panel);border:1px solid var(--line);color:var(--mut);font-size:12px;padding:3px 12px;border-radius:99px;margin:6px 0}
.call-entry{align-self:center;display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--line);border-radius:99px;padding:6px 14px;font-size:13px}
.call-entry.missed{color:#f87171}
.call-entry time{display:inline;margin:0;font-size:11px;opacity:.65}
.fwd{font-size:12px;font-style:italic;opacity:.7;margin-bottom:3px}
.vspeed{display:block;margin:4px 0 0 auto;padding:2px 10px;border-radius:99px;font-size:12px;line-height:1.5;cursor:pointer}
.sheet{position:fixed;left:0;right:0;top:0;bottom:0;z-index:60;background:rgba(0,0,0,.55);align-items:flex-end;justify-content:center}
.sheet-box{background:var(--bg);width:100%;max-width:520px;max-height:80vh;overflow:auto;border-radius:18px 18px 0 0;padding:16px;border:1px solid var(--line);box-sizing:border-box}
.sheet-box>div>button{display:block;width:100%;margin:8px 0 0}
.fw-row{display:flex;align-items:center;gap:12px;padding:10px 4px;border-bottom:1px solid var(--line);cursor:pointer}
.fw-row input{width:auto;margin:0}
.toast{position:fixed;left:50%;transform:translateX(-50%);bottom:96px;z-index:70;background:rgba(17,24,39,.92);color:#fff;padding:8px 16px;border-radius:99px;font-size:14px}
.shsw{appearance:none!important;-webkit-appearance:none!important;display:block!important;flex:none!important;width:54px!important;min-width:54px!important;max-width:54px!important;height:32px!important;border-radius:16px!important;background:#000!important;box-shadow:inset 0 0 0 1.5px #3a3a48!important;position:relative!important;transition:background .2s;border:0!important;padding:0!important;margin:0!important;cursor:pointer}
.shsw::before{content:'';position:absolute;top:4px;left:4px;width:24px;height:24px;border-radius:50%;background:#fff;transition:transform .2s}
.shsw:checked{background:#6c63ff!important;box-shadow:none!important}.shsw:checked::before{transform:translateX(22px)}
.swrow{display:flex;align-items:center;gap:14px;cursor:pointer}.swrow>span{flex:1}
.msg-text{white-space:pre-wrap;overflow-wrap:anywhere}
.bubble{max-width:78%;padding:9px 13px;border-radius:16px;font-size:15px;line-height:1.4;word-wrap:break-word}
.bubble.me{align-self:flex-end;background:linear-gradient(135deg,#5bc8ff,var(--blue) 60%);color:#04101f;border-bottom-right-radius:4px}
.bubble.them{align-self:flex-start;background:var(--panel);border:1px solid var(--line);border-bottom-left-radius:4px}
.reply-preview{display:flex;align-items:stretch;gap:8px;margin:0 0 6px;border-radius:9px;overflow:hidden;background:rgba(255,255,255,.07);border-left:4px solid #a78bfa}
.bubble.me .reply-preview{background:rgba(4,16,31,.16);border-left-color:rgba(4,16,31,.6)}
.reply-preview .rp-body,.reply-bar .rp-body{flex:1;min-width:0;padding:6px 4px 6px 8px;display:flex;flex-direction:column;gap:1px;font-size:12.5px;line-height:1.35}
.reply-preview .rp-name,.reply-bar .rp-name{color:#c4b5fd;font-size:12.5px}
.bubble.me .reply-preview .rp-name{color:#04101f}
.reply-preview .rp-text,.reply-bar .rp-text{opacity:.85;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.rp-thumb{width:52px;height:52px;flex:none;object-fit:cover;background:rgba(0,0,0,.18)}
.rp-thumb.st{object-fit:contain;padding:4px}
.sticker-msg .reply-preview{align-self:stretch;background:var(--panel);border:1px solid var(--line);border-left:4px solid #a78bfa}
.reply-bar{margin-top:8px;border-radius:10px;overflow:hidden;background:var(--panel);border:1px solid var(--line);border-left:4px solid #a78bfa;align-items:center;gap:8px}
.reply-bar:not([hidden]){display:flex}
.reply-bar button{margin:0 8px 0 0}
.bubble time{display:block;text-align:right;font-size:11px;opacity:.65;margin-top:3px}
.chat-bar{position:fixed;left:0;right:0;bottom:0;display:flex;gap:8px;padding:10px 14px;padding-bottom:calc(10px + env(safe-area-inset-bottom,0px));background:var(--bg);border-top:1px solid var(--line);max-width:1000px;margin:0 auto}
.chat-bar input,.chat-bar textarea{margin:0;flex:1}.chat-bar button{margin:0}
.chat-head{display:flex;align-items:center;gap:10px;position:sticky;top:0;background:var(--bg);padding:calc(8px + env(safe-area-inset-top,0px)) 0 12px;z-index:5;font-size:17px}
.news-body p.news-snip{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin:0 0 8px}
.role-tag{display:inline-block;font-size:11px;padding:1px 8px;border-radius:99px;border:1px solid rgba(240,0,232,.45);color:#ff9cf7;margin-left:6px;vertical-align:middle;line-height:1.5}
.verified-badge{color:#5bc8ff;font-weight:700;margin-left:2px}
.doc-viewer{max-width:100%;overflow-wrap:break-word;line-height:1.55}.doc-viewer img{max-width:100%;height:auto;border-radius:8px}.doc-viewer table{width:100%;border-collapse:collapse;margin:10px 0}.doc-viewer td,.doc-viewer th{border:1px solid var(--line);padding:6px 8px}
.pv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px}
.pv{display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:16px;overflow:hidden;color:var(--fg);transition:.2s}
.pv:hover{transform:translateY(-3px);border-color:var(--blue);text-decoration:none}
.pv-img{width:100%;aspect-ratio:16/9;object-fit:cover;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,rgba(56,176,248,.25),rgba(240,0,232,.18))}
.pv-icon{font-size:40px}
.pv-body{padding:10px 12px}.pv-body h3{margin:6px 0 2px;font-size:15px;line-height:1.3}
.prof{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.bubble audio{display:block;width:230px;max-width:100%;height:38px}
.sticker-msg{max-width:60%;display:flex;flex-direction:column;gap:2px}
.sticker-msg.me{align-self:flex-end;align-items:flex-end}.sticker-msg.them{align-self:flex-start;align-items:flex-start}
.sticker-msg img{width:150px;max-width:100%;max-height:150px;object-fit:contain}
.bubble.img-msg img{display:block;max-width:220px;max-height:280px;width:100%;object-fit:cover;border-radius:10px;margin-bottom:2px}
.file-chip{display:flex;align-items:center;gap:6px;color:inherit;text-decoration:none;font-weight:600}
.file-chip{min-width:200px;padding:2px 0}.file-chip:hover{text-decoration:none}
a[href^="/p/"]{-webkit-touch-callout:none}
.shsheet{position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;justify-content:center}
.shbox{width:100%;max-width:520px;max-height:82vh;overflow:auto;background:var(--card,#111);color:var(--fg);border-radius:20px 20px 0 0;padding:10px 16px calc(16px + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.4);animation:shup .18s ease-out}@keyframes shup{from{transform:translateY(30px);opacity:0}}
.shgrip{width:40px;height:4px;border-radius:4px;background:var(--line);margin:0 auto 12px}.shtitle{display:block;font-size:17px}.shsub{font-size:13px;opacity:.7;margin:2px 0 10px}
.shopt{display:block;width:100%;text-align:left;margin:6px 0;padding:14px;border-radius:14px;font-size:16px;font-weight:600;background:var(--panel);color:var(--fg);border:1px solid var(--line);box-shadow:none;text-decoration:none;cursor:pointer}.shcancel{text-align:center;opacity:.8}
.shfind{width:100%;margin:0 0 8px}.shlist{display:flex;flex-direction:column;gap:2px}
.shrow{display:flex;align-items:center;gap:12px;width:100%;margin:0;padding:10px;border-radius:12px;background:none;color:var(--fg);border:0;box-shadow:none;text-align:left;font-size:16px;cursor:pointer}.shrow:hover,.shrow:active{background:var(--panel)}
.shav{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#38b0f8,#a78bfa);color:#fff;font-weight:700;flex:none}.shname{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.shtoast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:9999;display:flex;gap:12px;align-items:center;padding:12px 16px;border-radius:14px;background:#10172a;color:#fff;font-size:14px;box-shadow:0 8px 30px rgba(0,0,0,.4)}.shtoast a{color:#7dd3fc;font-weight:700;text-decoration:none}
.fc-ico{font-size:26px;line-height:1}.fc-main{display:flex;flex-direction:column;min-width:0;flex:1}.fc-main .file-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px}.fc-size{font-size:12px;opacity:.7;font-weight:500}.fc-dl{font-size:18px;opacity:.8}
.fc-bar{display:block;height:4px;border-radius:4px;background:rgba(127,127,127,.3);margin-top:4px;overflow:hidden}.fc-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#38b0f8,#a78bfa);transition:width .2s}
.rp-ico{width:52px;height:52px;flex:none;display:flex;align-items:center;justify-content:center;font-size:24px;background:rgba(0,0,0,.14)}
.mcard{position:relative;width:230px;max-width:100%;border-radius:14px;overflow:hidden;background:linear-gradient(135deg,rgba(56,176,248,.22),rgba(167,139,250,.22));border:1px solid var(--line)}
.mcard.mc-sticker{width:150px}
.mc-ph{height:160px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding-bottom:34px;background-size:cover;background-position:center}
.mc-sticker .mc-ph{height:120px}
.mc-ph.has-prev{filter:none;position:relative}.mc-ph.has-prev .mc-ico,.mc-ph.has-prev .mc-lbl{display:none}
.mc-ico{font-size:36px;line-height:1;display:flex}.mc-lbl{font-size:13px;opacity:.85;font-weight:600}
.mc-dl{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);margin:0;padding:7px 14px;border-radius:999px;font-size:13px;font-weight:700;white-space:nowrap;background:rgba(15,20,35,.72);color:#fff;border:1px solid rgba(255,255,255,.25);backdrop-filter:blur(6px);box-shadow:none}
.mc-state-idle,.mc-state-err{cursor:pointer}
.mc-prog{position:absolute;left:10px;right:10px;bottom:10px;display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:12px;background:rgba(15,20,35,.72);color:#fff;font-size:12px}
.mc-bar{flex:1;height:5px;border-radius:5px;background:rgba(255,255,255,.25);overflow:hidden}.mc-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#38b0f8,#a78bfa);transition:width .15s}
.mc-pct{white-space:nowrap;font-variant-numeric:tabular-nums}
.mc-cancel{margin:0;padding:0 4px;background:none;border:0;color:inherit;font-size:15px;box-shadow:none;cursor:pointer;line-height:1}
.mc-spin{display:inline-block;width:20px;height:20px;border-radius:50%;border:3px solid rgba(127,127,127,.35);border-top-color:#38b0f8;animation:mcspin .8s linear infinite}@keyframes mcspin{to{transform:rotate(360deg)}}
.mcard.done{background:none;border:0;border-radius:10px;overflow:visible}
.mc-img{display:block;width:100%;max-height:300px;object-fit:cover;border-radius:10px;cursor:zoom-in}
.mc-sticker .mc-img{object-fit:contain;max-height:150px;cursor:default}
.mc-vid{display:block;width:100%;max-height:300px;border-radius:10px;background:#000}
.mc-save{display:block;font-size:12px;padding:4px 2px 0;color:inherit;opacity:.8;text-decoration:none}
.mcard:not(.done)+.save-st{display:none}
.mviewer{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center}
.mviewer img{max-width:100%;max-height:100%;object-fit:contain}
.mv-bar{position:absolute;top:0;left:0;right:0;display:flex;justify-content:space-between;align-items:center;padding:calc(10px + env(safe-area-inset-top)) 14px 10px;background:linear-gradient(rgba(0,0,0,.6),transparent)}
.mv-x{margin:0;width:38px;height:38px;border-radius:50%;padding:0;background:rgba(255,255,255,.15);color:#fff;border:0;font-size:18px;box-shadow:none;cursor:pointer}
.mv-save{color:#fff;font-weight:700;font-size:14px;text-decoration:none;padding:8px 14px;border-radius:999px;background:rgba(255,255,255,.15)}
.file-name{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:bottom}
.sticker-msg time{font-size:11px;opacity:.65;align-self:flex-end;text-align:right}
.save-st{font-size:12px;color:var(--blue)}
.chat-bar[hidden],.chat-panel[hidden]{display:none}
.chat-bar .ic{padding:12px 14px;font-size:24px;line-height:1;min-width:50px;min-height:50px;background:transparent;border:1px solid var(--line);color:var(--fg);box-shadow:none}.chat-bar button:not(.ic):not(.ghost):not(.link){padding:12px 22px;font-size:17px;min-height:50px}.chat-bar input,.chat-bar textarea{font-size:17px;min-height:50px}.chat-head .link{font-size:30px!important;min-width:48px;min-height:48px;display:inline-flex;align-items:center;justify-content:center}.chat-head .avatar,.chat-head img{width:44px;height:44px}
label.ic{display:inline-flex;align-items:center;justify-content:center;cursor:pointer;margin:0}
.chat-bar.rec{align-items:center}.rec-dot{width:10px;height:10px;border-radius:50%;background:#ef4444;animation:blink 1s infinite}@keyframes blink{50%{opacity:.25}}
.chat-panel{position:fixed;left:0;right:0;bottom:calc(66px + env(safe-area-inset-bottom,0px));max-width:1000px;margin:0 auto;height:230px;display:flex;flex-direction:column;background:#161628;border-top:1px solid var(--line);z-index:6}
.ptabs{display:flex;gap:6px;padding:6px 10px;border-bottom:1px solid var(--line)}.ptabs button{margin:0;padding:5px 12px;font-size:14px}.ptabs button.on{background:rgba(56,176,248,.15)}
.pbody{flex:1;overflow-y:auto;padding:8px 10px}.pbody[hidden]{display:none}
.ecats{display:flex;gap:4px;margin-bottom:6px}.ecats button{background:none;box-shadow:none;padding:2px 8px;margin:0;font-size:20px;color:inherit}
.egrid{display:flex;flex-wrap:wrap;gap:2px}.egrid button{background:none;box-shadow:none;padding:4px;margin:0;font-size:26px;line-height:1.1;color:inherit}
.sgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:8px}
.st{position:relative}.st img{width:100%;aspect-ratio:1;object-fit:contain;background:rgba(255,255,255,.04);border-radius:10px;cursor:pointer}
.st-x{position:absolute;top:-4px;right:-4px;width:20px;height:20px;padding:0;margin:0;border-radius:50%;font-size:13px;line-height:20px;background:#2a2a44;color:#fff;box-shadow:none}
.st-add{display:inline-block;margin:0 0 8px;cursor:pointer}.st-add input{display:none}
body.panel-open .thread{padding-bottom:310px}
.logo-img{width:38px;height:38px;object-fit:contain;flex:none}
.menu-btn{position:relative}
.mbadge{position:absolute;top:-4px;right:-6px;min-width:18px;height:18px;padding:0 5px;border-radius:99px;background:#ef4444;color:#fff;font-size:11px;font-weight:700;line-height:18px;text-align:center}
.nbadge{margin-left:auto;min-width:22px;height:22px;padding:0 7px;border-radius:99px;background:#ef4444;color:#fff;font-size:12px;font-weight:700;line-height:22px;text-align:center}
.locked-field{padding:11px 13px;margin:6px 0;border-radius:12px;background:var(--panel);color:var(--fg);pointer-events:none;user-select:text;cursor:default}
.autolink.mention{font-weight:600}
.chat-search{width:100%;margin:0 0 10px;padding:10px 14px;border-radius:99px;box-sizing:border-box}
.chip-row{display:flex;gap:8px;overflow-x:auto;margin:0 0 8px;padding-bottom:2px}
.chip{flex:none;padding:6px 14px;border-radius:99px;border:1px solid var(--line);background:transparent;color:var(--mut);font-size:14px;font-weight:600;cursor:pointer}
.chip.on{background:var(--blue);border-color:var(--blue);color:#fff}
.chat-item{user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
.chat-item.sel{background:var(--panel);box-shadow:inset 3px 0 0 var(--blue)}
.ci-end{margin-left:auto;display:flex;align-items:center;gap:6px;flex:none}
.ci-end .nbadge{margin-left:0}
.ci-ic{font-size:13px;color:var(--mut)}
.nb-muted{background:#6b7280}
.nb-dot{min-width:12px;height:12px;padding:0;line-height:12px;background:#22c55e}
.arch-row .arch-ic{width:46px;text-align:center;font-size:22px}
.arch-head{margin:0 0 8px}
.sel-bar{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:4px;padding:8px 10px;margin:0 -10px 8px;background:var(--bg);border-bottom:1px solid var(--line)}
.sel-bar button{background:none;border:0;color:var(--fg);padding:8px;border-radius:50%;cursor:pointer;display:flex}
.sel-bar button:hover{background:var(--panel)}
.sel-bar b{font-size:18px;margin-left:4px}
.sel-sp{flex:1}
.sel-menu{position:absolute;right:10px;top:48px;min-width:190px;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:6px;box-shadow:0 8px 24px rgba(0,0,0,.4)}
.sel-menu button{display:block;width:100%;text-align:left;border-radius:8px;padding:10px 12px;font-size:15px}
.pushbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 12px;padding:10px 14px;border:1px solid var(--line);border-radius:14px;background:rgba(56,176,248,.10)}
.pushbar[hidden]{display:none}.pushbar span{flex:1;min-width:180px;font-size:14px}.pushbar button{margin:0}
select{font:inherit;width:100%;padding:11px 13px;margin:6px 0;color:var(--fg);background:rgba(8,10,22,.65);border:1px solid var(--line);border-radius:10px;outline:0}
.box{border:1px solid var(--line);border-radius:18px;padding:6px 16px 16px;margin:16px 0;background:rgba(32,48,96,.16)}
.box>h2{margin:.7em 0 .1em;font-size:20px}.box .count{color:var(--blue);font-weight:700}
.hint{font-size:12px;color:var(--mut);margin:-2px 0 6px}
.ok{color:#22c55e}
.tab-link{padding:10px 16px;color:var(--mut);font-weight:600;border-bottom:2px solid transparent}
.tab-link.active{color:var(--blue);border-color:var(--blue)}
.tick{opacity:.95;font-weight:700}.tick-un{color:#dc2626}.tick-read{color:#22c55e}.tick-queued{color:#93a0bd}
.bubble.deleted{font-style:italic;opacity:.75}
.reactions{display:flex;gap:4px;margin-top:4px;flex-wrap:wrap}
.rchip{background:rgba(255,255,255,.08);border-radius:99px;padding:1px 7px;font-size:12px}
.react-pick{display:flex;gap:4px;margin-top:6px;background:rgba(0,0,0,.25);border-radius:99px;padding:4px 6px;width:fit-content}
.react-pick button{background:none;box-shadow:none;padding:2px;margin:0;font-size:18px}
.sender-name{font-size:12px;font-weight:700;color:var(--blue);margin-bottom:2px}

/* ===== Phone and laptop are two different layouts ===== */
/* Phone: a simple bottom tab bar for the main places, plus the slide-out menu. */
.tabbar{display:none}
body.has-tabbar{padding-bottom:calc(66px + env(safe-area-inset-bottom,0px))}
body.has-tabbar .tabbar{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:35;background:rgba(14,14,24,.96);backdrop-filter:blur(10px);border-top:1px solid var(--line);padding:6px 6px calc(6px + env(safe-area-inset-bottom,0px))}
:root[data-theme="light"] body.has-tabbar .tabbar{background:rgba(244,247,252,.96)}
.ico{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none}
.tabbar a,.tabbar button{flex:1;display:flex;align-items:center;justify-content:center;margin:0;padding:0;height:46px;border:0;background:none;box-shadow:none;border-radius:12px;color:var(--mut);position:relative;cursor:pointer;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.tabbar .ico{width:27px;height:27px}
.tabbar a:hover,.tabbar button:hover{text-decoration:none;filter:none;color:var(--fg)}
.tabbar a.on{color:var(--blue)}.tabbar a.on .ico{stroke-width:2.4}
.tabbar .nbadge{position:absolute;top:2px;left:calc(50% + 6px);right:auto;margin:0;min-width:18px;height:18px;line-height:18px;font-size:11px;padding:0 5px}
.tabtip{position:fixed;z-index:70;background:rgba(17,24,39,.95);color:#fff;font:600 13px system-ui,sans-serif;padding:6px 12px;border-radius:99px;pointer-events:none;box-shadow:0 6px 18px rgba(0,0,0,.4)}
.drawer-item .ico{width:22px;height:22px}
.drawer-item span{display:flex;align-items:center;justify-content:center;flex:none}
.drawer-out{background:none!important;box-shadow:none!important;color:inherit}
a.drawer-user{color:var(--fg)}a.drawer-user:hover{text-decoration:none}
/* Phone: tapping Menu opens a full-screen menu page (profile first, Settings and Log out at the bottom) instead of a narrow slide-out. */
@media (max-width:1023px){
 .drawer{width:100vw;max-width:none;z-index:60;background:var(--bg);border-right:0}
 .scrim,.scrim.show{display:none}
 .drawer-arrows,.drawer-arrows.show{display:none!important}
 .drawer-top{position:sticky;top:0;z-index:2;background:var(--bg);border-bottom:1px solid var(--line);padding:14px 16px}
 .drawer-user{margin:14px 12px 6px;padding:14px;border:1px solid var(--line);border-radius:16px;background:var(--panel)}
 body.has-tabbar .menu-btn,body.has-tabbar .top>span{display:none}
 body.has-tabbar .top{justify-content:flex-start}
 .drawer-label{display:none}
 .drawer-item{margin:0 12px 2px;padding:16px;background:var(--panel);border-radius:14px;font-size:17px}
 .drawer-item.active{background:rgba(56,176,248,.16);border-right:0;color:var(--blue)}
 .drawer-item .ico{width:24px;height:24px}
 .drawer-bottom{margin:16px 0 0;border-top:0;padding:0 0 12px}
 .drawer-out{color:#ff8fa3}
}
body.has-tabbar .ai-fab{bottom:calc(76px + env(safe-area-inset-bottom,0px));margin-bottom:0}
body.has-tabbar .ai-box{bottom:calc(132px + env(safe-area-inset-bottom,0px));margin-bottom:0}
.chat-bar .ic{border-radius:12px}
@media (max-width:520px){.chat-bar{gap:5px;padding-left:8px;padding-right:8px}.chat-bar .ic{min-width:42px;min-height:46px;padding:8px 6px;font-size:21px}.chat-bar>button:not(.ic){padding:10px 14px}.chat-bar textarea,.chat-bar input{min-width:0}}
/* Laptop (wide screens, or a phone set to "desktop site"): the menu is always open down the left, the content gets room to breathe. */
@media (min-width:1024px){
 :root{--side:268px}
 body{padding-left:var(--side);font-size:17px}
 body.has-tabbar{padding-bottom:0}.tabbar,body.has-tabbar .tabbar{display:none}
 body.has-tabbar .ai-fab{bottom:16px}body.has-tabbar .ai-box{bottom:72px}
 .top{padding-left:28px;padding-right:28px}.top>span{display:none}
 .scrim,.scrim.show{display:none}
 .menu-btn,#drawerClose,.drawer-arrows,.drawer-arrows.show{display:none!important}
 .drawer{transform:none;width:var(--side);z-index:35;background:rgba(10,10,20,.97);padding-right:0}
 .drawer-top{padding:22px 22px 14px;font-size:19px}
 .drawer-top .logo-img{width:34px;height:34px;border-radius:9px}
 .drawer-user{margin:4px 14px 10px;padding:12px;border:1px solid var(--line);border-radius:14px;background:var(--panel)}
 .drawer-label{padding:10px 22px 4px}
 .drawer-item{margin:2px 12px;padding:11px 14px;border-radius:12px}
 .drawer-out{color:inherit}
 .drawer-item.active{border-right:0;background:rgba(56,176,248,.16)}
 .drawer-bottom{margin:auto 12px 0;padding:10px 0 14px}.drawer-bottom .drawer-item{margin:2px 0}
 main{max-width:1180px;padding:28px 44px 56px}
 .site-foot{padding-left:44px;padding-right:44px}
 h1{font-size:clamp(30px,3vw,42px)}
 .card{padding:22px;border-radius:18px}
 .grid{grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px}
 .tile{padding:22px}
 .dash-hero{padding:34px 34px;border-radius:24px}
 .dash-top{gap:20px}
 .hero{padding:64px 0 36px}.hero h1{font-size:clamp(40px,4.4vw,60px)}.lead{max-width:680px;font-size:20px}
 .auth{max-width:460px;margin:48px auto}
 .chat-bar,.chat-panel{left:var(--side);right:0;max-width:1100px}
 .ai-fab{right:28px;bottom:24px}.ai-box{right:28px}
 .to-btm{right:28px}
 .sheet{left:var(--side)}
 table{font-size:15px}td,th{padding:10px 8px}
}
html.embed{--side:0px!important}
.embed .drawer,.embed .pane,.embed .top,.embed .tabbar,.embed .scrim,.embed #drawerArrows,.embed .site-foot,.embed .pushbar{display:none!important}
.embed body{padding:0!important}.embed main{max-width:none}
.vtoggle{display:flex;gap:6px;margin:6px 0 4px}.vtoggle button{flex:1;min-height:44px;border-radius:12px;background:var(--panel);color:var(--mut);border:1px solid var(--line);font-weight:600;box-shadow:none}.vtoggle button.on{color:var(--blue);border-color:var(--blue);background:rgba(56,176,248,.14)}
html[data-pv="list"] .pv-grid{grid-template-columns:1fr;gap:6px}
html[data-pv="list"] .pv{flex-direction:row;align-items:center;gap:12px;padding:8px;border-radius:14px}
html[data-pv="list"] .pv-img{width:64px;height:64px;aspect-ratio:1;flex:none;border-radius:12px;font-size:26px}
html[data-pv="list"] .pv-body{padding:0;min-width:0}
/* laptop: WhatsApp-Web style — thin icon rail | list pane | reading area */
@media (min-width:1024px){
 :root{--rail:68px;--pane:380px;--side:68px}
 body.has-pane{--side:448px}
 .drawer{width:var(--rail);align-items:center;padding:0;overflow-x:hidden}
 .drawer-top,.drawer-label,.drawer-arrows,.drawer-user div{display:none!important}
 .drawer-user{margin:16px 0 8px;padding:0;border:0;background:none;display:flex;justify-content:center;font-size:0}
 .drawer-item{width:48px;height:48px;margin:4px auto;padding:0;justify-content:center;font-size:0;gap:0;position:relative}
 .drawer-item span{width:24px}
 .drawer-item .nbadge,.drawer-item b,.drawer-item .badge{font-size:11px!important;position:absolute;top:2px;right:0}
 .drawer-bottom{margin:auto 0 0;padding:10px 0 14px;width:100%}.drawer-bottom .drawer-item{margin:4px auto}
 .pane{display:none}
 body.has-pane .pane{display:flex;flex-direction:column;position:fixed;top:0;bottom:0;left:var(--rail);width:var(--pane);border-right:1px solid var(--line);background:var(--bg);z-index:20}
 .pane-head{padding:18px 20px 12px;font-size:24px;font-weight:800;flex:none}
 .pane-body{flex:1;overflow-y:auto;padding:0 12px 20px;font-size:15px}
 .pane-body h1,.pane-body .dash-hero h1{font-size:18px}
 .pane-body>h1:first-child{display:none}
 .pane-body .grid{grid-template-columns:1fr;gap:10px}
 .pane-body .card,.pane-body .tile{padding:14px}.pane-body .dash-hero{padding:16px;border-radius:16px}
 .pane-body table{display:block;overflow-x:auto}
 .pane-body a.cur,.pane-body .cur{background:rgba(56,176,248,.16);border-radius:12px}
 body.has-pane{padding-top:58px}
 body.has-pane .top{display:flex;position:fixed;top:0;left:var(--rail);right:0;height:58px;padding:0 26px;margin:0;z-index:36;align-items:center}
 body.has-pane .top.hide{transform:none}
 body.has-pane .pane{top:58px}.pane-head{display:none}
 .pane-body h1,body.has-pane main>h1:first-child{display:none}
 body.has-pane main{max-width:none;padding:20px 32px 56px}
 .pane-empty{min-height:65vh;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--mut);text-align:center}
 .pane-empty-ic{font-size:54px;opacity:.5}
 body.pane-index .site-foot{display:none}
 .dash-hero,.vtoggle{display:none!important}
 .pane-body .nl{display:block;padding:13px 14px;border-bottom:1px solid var(--line);color:var(--fg);font-weight:600;font-size:15px;line-height:1.35;border-radius:0}
 .pane-body .nl:hover{background:rgba(56,176,248,.08);text-decoration:none}
 .pane-body .nl-share{color:var(--blue)}
 .pane-body a.nl.cur{background:rgba(56,176,248,.16)}
 body.pane-index main>*:not(.pane-empty):not(#pushBar){display:none!important}
}
@media (min-width:1024px){
 .drawer-out,.drawer-bottom .drawer-item{font-size:0!important}
 .drawer-bottom .drawer-out{width:48px!important;height:48px;padding:0!important;display:flex;justify-content:center}
 .pane-body .dash-hero{display:none}
 .pane-body .pv-grid{grid-template-columns:1fr;gap:6px}
 .pane-body .pv{display:flex!important;flex-direction:row!important;align-items:center;gap:12px;padding:8px;border-radius:14px;text-align:left}
 .pane-body .pv-body{text-align:left}
 .pane-body .pv-img{width:64px;height:64px;aspect-ratio:1;flex:none;border-radius:12px;font-size:26px}
 .pane-body .pv-body{padding:0;min-width:0}
 .pane-body .pv:hover{background:rgba(56,176,248,.08)}
 iframe.reader{display:block;width:100%;height:calc(100vh - 66px);border:0;background:transparent}
 body.has-pane main:has(iframe.reader){padding:0}
 body.has-pane:has(iframe.reader) .site-foot{display:none}
}
/* laptops only (not phones, iPads or tablets): visitors get one person icon at the bottom of the strip, which shows the QR code */
.lap-only{display:none}
@media screen and (min-width:1024px){html[data-dev="laptop"] .drawer-bottom .ds-li,html[data-dev="laptop"] .drawer-bottom .ds-su{display:none!important}html[data-dev="laptop"] .drawer-bottom .lap-only{display:flex!important}}
/* accessibility polish: visible keyboard focus, calmer motion, comfortable touch targets, tablet width */
a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible,[tabindex]:focus-visible{outline:3px solid #fcc419;outline-offset:2px;border-radius:6px}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
@media (pointer:coarse){button,.btn,select,.chip,.tabbar a{min-height:44px}input:not([type=checkbox]):not([type=radio]),select{min-height:44px}}
@media (min-width:768px) and (max-width:1023px){.wrap,.container{max-width:760px;margin-left:auto;margin-right:auto}.grid{grid-template-columns:repeat(2,1fr)}}
`;
// Each device gets its own view. The laptop rules only apply when the device is NOT a phone (even if the phone is turned sideways
// or set to "desktop site"), and the phone rules are forced on for phones at any width.
const NOT_PHONE = 'html:not([data-dev="phone"])', IS_PHONE = 'html[data-dev="phone"]';
function cssBlocks(css, head) {
  const out = []; let i = 0;
  while ((i = css.indexOf(head, i)) >= 0) {
    const open = css.indexOf('{', i); let depth = 1, k = open + 1;
    while (depth && k < css.length) { const c = css[k++]; if (c === '{') depth++; else if (c === '}') depth--; }
    out.push({ start: i, end: k, inner: css.slice(open + 1, k - 1) }); i = k;
  }
  return out;
}
function prefixRules(inner, pre) {
  return inner.replace(/(^|\})\s*([^{}@][^{}]*)\{/g, (m, a, sel) => a + sel.split(',').map(x => { x = x.trim(); return x === ':root' || x === 'html' ? pre : pre + ' ' + x; }).join(',') + '{');
}
function deviceCss(css) {
  let out = css;
  for (const b of cssBlocks(css, '@media (min-width:1024px){').reverse()) out = out.slice(0, b.start) + '@media (min-width:1024px){' + prefixRules(b.inner, NOT_PHONE) + '}' + out.slice(b.end);
  const phoneBlock = cssBlocks(css, '@media (max-width:1023px){')[0];
  const forced = phoneBlock ? prefixRules(phoneBlock.inner, IS_PHONE) : '';
  const tabletBlock = cssBlocks(css, '@media (min-width:768px) and (max-width:1023px){')[0];
  return out + '\n/* phones keep the phone view at any width */\n' + forced
    + '\n';
}
const CSS_FINAL = deviceCss(CSS) + require('./lib/ui_theme').css;


const canLecturerAdmin = u => !!u && (isCentral(u) || (!!u.lp_inst && u.uni_role !== 'full'));
const navItems = (user, badge = 0, mode = '') => user ? (user.role === 'uniadmin' && mode !== 'lecturer-admin' ? [
  { href: '/uni', icon: '🏫', label: 'University home' },
  { href: '/uni?tab=students', icon: '🎓', label: 'Students' },
  { href: '/uni?tab=lecturers', icon: '👨‍🏫', label: 'Lecturers' },
  { href: '/uni?tab=positions', icon: '🎖️', label: 'Positions' },
  { href: '/uni/news', icon: '📰', label: 'University news' },
  { href: '/uni/uploads', icon: '📤', label: 'University uploads' },
  { href: '/uni/support', icon: '🛟', label: 'Login help' },
  { href: '/uni?tab=levels', icon: '📈', label: 'Level promotion' },
  { href: '/settings', icon: '⚙️', label: 'Settings' },
] : mode === 'lecturer-admin' ? [
  { href: '/lecturer/admin', icon: '🛠️', label: 'Lecturer admin' },
  { href: '/lecturer/admin?tab=lecturers', icon: '🎓', label: 'Lecturers' },
  { href: '/lecturer/admin?tab=uploads', icon: '📄', label: 'Uploads' },
  { href: '/dashboard', icon: '⬅️', label: user.role === 'uniadmin' ? 'Back to university home' : 'Back to student portal' },
] : user.is_lecturer ? [
  { href: '/lecturer', icon: '🏠', label: 'Home' },
  { href: '/lecturer/course', icon: '📚', label: 'Courses' },
  { href: '/lecturer/uploads', icon: '📄', label: 'Uploaded documents' },
] : [
  { href: '/dashboard', icon: '📊', label: 'Dashboard' },
  { href: '/news', icon: '📰', label: 'News' },
  { href: '/chat', icon: '💬', label: 'Chat', badge },
  ...(can.anyAdmin(user) || canPromote(user) ? [{ href: '/admin', icon: '🛠️', label: 'Admin' }] : []),
]) : [
  { href: '/', icon: '🏠', label: 'Home' },
  { href: '/lecturer/portal', icon: '🎓', label: 'Lecturer portal' },
];
// Plain outline icons (like Facebook / WhatsApp), used in the phone tab bar, the menu and the laptop sidebar.
const ICON_PATHS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V10"/>',
  news: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  chat: '<path d="M20 12a8 8 0 0 1-11.7 7.1L4 20l1-4A8 8 0 1 1 20 12z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  admin: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/>',
  uni: '<path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-6h6v6"/>',
  cap: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5.5a3 3 0 0 1 0 5.8M18 14.5c2 .7 3 2.6 3 5.5"/>',
  medal: '<circle cx="12" cy="9" r="5"/><path d="M9 14l-2 7 5-3 5 3-2-7"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  help: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M5.5 5.5l4 4M14.5 14.5l4 4M18.5 5.5l-4 4M9.5 14.5l-4 4"/>',
  chart: '<path d="M4 19V5M4 19h16"/><path d="M8 15l4-4 3 3 5-6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/>',
  logout: '<path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4"/><path d="M16 8l4 4-4 4M20 12H9"/>',
  login: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 8l-4 4 4 4M6 12h11"/>',
  signup: '<circle cx="10" cy="8" r="3.5"/><path d="M3 20c0-3.5 3-6 7-6s7 2.5 7 6"/><path d="M19 8v6M16 11h6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  docs: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  book: '<path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5C4.7 20 4 19.3 4 18.5z"/><path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H13v16h5.5c.8 0 1.5-.7 1.5-1.5z"/>',
  dot: '<circle cx="12" cy="12" r="3"/>',
};
const PREVIEW_JS = `(function(){
var css='#shpv{position:fixed;inset:0;z-index:2147483000;background:#0b0b10;color:#fff;display:flex;flex-direction:column;font:16px system-ui,sans-serif}#shpv .h{display:flex;align-items:center;gap:10px;padding:12px 14px;padding-top:calc(12px + env(safe-area-inset-top,0px))}#shpv .h button{background:none;border:0;color:#fff;font-size:26px;line-height:1;cursor:pointer;padding:0 6px}#shpv .h b{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}#shpv .m{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:10px}#shpv .m img,#shpv .m video{max-width:100%;max-height:100%;border-radius:10px;object-fit:contain}#shpv .doc{text-align:center;padding:30px 24px;border-radius:20px;background:#1b1b26;max-width:320px}#shpv .doc i{display:block;font-style:normal;font-size:72px}#shpv .doc em{display:inline-block;margin-top:8px;padding:2px 10px;border-radius:8px;background:#e5484d;font-style:normal;font-weight:700}#shpv .doc span{display:block;margin-top:10px;opacity:.7;font-size:14px;word-break:break-all}#shpv .f{display:flex;gap:10px;align-items:flex-end;padding:10px 12px;padding-bottom:calc(10px + env(safe-area-inset-bottom,0px))}#shpv .f textarea{flex:1;background:#262633;color:#fff;border:0;border-radius:22px;padding:11px 16px;font:inherit;resize:none;max-height:110px;outline:0}#shpv .f button{width:50px;height:50px;border-radius:50%;border:0;background:var(--accent,#6d5efc);color:#fff;font-size:22px;cursor:pointer;flex:none}.bgrow{border:1px solid rgba(127,127,127,.3);border-radius:14px;padding:12px 14px;margin:8px 0}.bgrow .bt{height:6px;border-radius:4px;background:rgba(127,127,127,.25);margin-top:8px;overflow:hidden}.bgrow .bt i{display:block;height:100%;width:0;background:var(--accent,#6d5efc);transition:width .2s}';
var st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
function sz(n){return n>1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB'}
window.shPreview=function(files,opts,cb){
  files=Array.prototype.slice.call(files||[]);if(!files.length)return;opts=opts||{};var i=0,url=null;
  var o=document.createElement('div');o.id='shpv';
  o.innerHTML='<div class="h"><button type="button" data-x aria-label="Close">&times;</button><b></b><button type="button" data-p aria-label="Previous">&lsaquo;</button><button type="button" data-n aria-label="Next">&rsaquo;</button></div><div class="m"></div><div class="f">'+(opts.caption?'<textarea rows="1" maxlength="1000" placeholder="Add a caption&hellip;"></textarea>':'<div style="flex:1"></div>')+'<button type="button" data-s aria-label="Send">&#10148;</button></div>';
  document.body.appendChild(o);
  var m=o.querySelector('.m'),nm=o.querySelector('b');
  function show(){
    if(url){URL.revokeObjectURL(url);url=null}
    var f=files[i];nm.textContent=f.name+(files.length>1?'  ('+(i+1)+'/'+files.length+')':'');
    o.querySelector('[data-p]').style.display=o.querySelector('[data-n]').style.display=files.length>1?'':'none';
    m.innerHTML='';var t=f.type||'';
    if(t.indexOf('image/')===0){url=URL.createObjectURL(f);var im=new Image();im.src=url;m.appendChild(im)}
    else if(t.indexOf('video/')===0){url=URL.createObjectURL(f);var v=document.createElement('video');v.src=url;v.controls=true;v.muted=true;v.playsInline=true;m.appendChild(v)}
    else{var e=(f.name.split('.').pop()||'file').slice(0,5).toUpperCase(),d=document.createElement('div');d.className='doc';d.innerHTML='<i>&#128196;</i><em></em><span></span>';d.querySelector('em').textContent=e;d.querySelector('span').textContent=f.name+' \\u00b7 '+sz(f.size);m.appendChild(d)}
  }
  function close(){if(url)URL.revokeObjectURL(url);if(o.parentNode)o.parentNode.removeChild(o)}
  o.addEventListener('click',function(e){var b=e.target.closest?e.target.closest('button'):null;if(!b)return;
    if(b.hasAttribute('data-x'))close();
    else if(b.hasAttribute('data-p')){i=(i+files.length-1)%files.length;show()}
    else if(b.hasAttribute('data-n')){i=(i+1)%files.length;show()}
    else if(b.hasAttribute('data-s')){var ta=o.querySelector('textarea'),cap=ta?ta.value.trim():'';close();cb(files,cap)}});
  show();
};
window.shNativeUp=function(file,o,onProg,onDone){
  var A=window.StudiesApp,id=o.id||('j'+Date.now()+Math.floor(Math.random()*1000000)),pos=0,CH=393216,dead=false,tm=null;
  A.upBegin(id);
  function poll(){if(dead)return;var s=String(A.upStatus(id)).split('|'),st=+s[0],p=+s[1]||0;
    if(st===3){onProg(100);onDone(true)}else if(st===4){onDone(false,s[2]||'')}else{onProg(p);tm=setTimeout(poll,500)}}
  function go(){var ok=A.upStart(id,o.url,JSON.stringify(o.fields||[]),o.afterUrl||'',o.afterJson||'',o.title||file.name,file.name,file.type||'');if(!ok){onDone(false);return}if(o.open&&A.upOpen){try{A.upOpen(id,o.open)}catch(e){}}poll()}
  function next(){if(dead)return;if(pos>=file.size){go();return}
    var r=new FileReader();r.onload=function(){var d=String(r.result),i=d.indexOf(',');if(!A.upChunk(id,d.slice(i+1))){onDone(false);return}pos+=CH;onProg(0);setTimeout(next,0)};r.onerror=function(){onDone(false)};r.readAsDataURL(file.slice(pos,pos+CH))}
  next();
  return {cancel:function(){dead=true;if(tm)clearTimeout(tm);try{A.upCancel(id)}catch(e){}},retry:function(){if(A.upRetry(id)){dead=false;poll();return true}return false}};
};
function bind(form){
  form.addEventListener('submit',function(e){
    var fi=form.querySelector('input[type=file]'),f=fi&&fi.files&&fi.files[0];if(!f||form.__sent)return;
    e.preventDefault();
    shPreview([f],{},function(){
      form.__sent=1;
      var list=document.querySelector(form.getAttribute('data-bglist')||'#upList'),row=document.createElement('div');row.className='bgrow';
      var ti=form.querySelector('input[name=title]');
      row.innerHTML='<b></b><div class="mut" style="font-size:13px">Uploading&hellip; 0%</div><div class="bt"><i></i></div>';
      row.querySelector('b').textContent=(ti&&ti.value.trim())||f.name;
      if(list)list.insertBefore(row,list.firstChild);else form.parentNode.insertBefore(row,form.nextSibling);
      var lbl=row.querySelector('.mut'),bar=row.querySelector('i');
      if(window.StudiesApp&&StudiesApp.upBegin){
        var fl=[],fe=new FormData(form);fe.forEach(function(v,k){if(typeof v==='string')fl.push([k,v])});fl.push(['__file',fi.name||'file']);
        var nu2=shNativeUp(f,{open:location.pathname,url:(form.getAttribute('action')||location.pathname),fields:fl,title:(ti&&ti.value.trim())||f.name},function(p){lbl.textContent=(p?'Uploading\\u2026 '+p+'%':'Getting ready\\u2026');bar.style.width=p+'%'},function(ok,why){if(ok){lbl.textContent='Done';location.reload()}else{lbl.textContent='Paused'+(why?' ('+why+')':'')+'. Tap here to retry.';row.style.cursor='pointer';row.onclick=function(){if(nu2.retry()){row.onclick=null;row.style.cursor='';lbl.textContent='Uploading\\u2026'}}}});
        lbl.textContent='Uploading \\u2014 you can leave this page, it keeps going.';
        return;
      }
      var x=new XMLHttpRequest();x.open('POST',form.getAttribute('action')||location.href);
      x.upload.onprogress=function(ev){if(ev.lengthComputable){var p=Math.round(ev.loaded*100/ev.total);lbl.textContent='Uploading\\u2026 '+p+'%';bar.style.width=p+'%'}};
      x.onload=function(){if(x.status>=200&&x.status<400){lbl.textContent='Done';bar.style.width='100%';location.href=x.responseURL||location.href}else{row.remove();form.__sent=0;alert('That upload did not go through. Please try again.')}};
      x.onerror=function(){row.remove();form.__sent=0;alert('That upload did not go through. Check your connection and try again.')};
      x.send(new FormData(form));
    });
  });
}
Array.prototype.forEach.call(document.querySelectorAll('form[data-bgup]'),bind);
})();`;
const ico = k => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[k] || ICON_PATHS.dot}</svg>`;
const iconKey = i => {
  const h = String(i.href || ''), l = String(i.label || '').toLowerCase();
  if (l.startsWith('back')) return 'back';
  if (h === '/dashboard' || h === '/') return 'home';
  if (h.startsWith('/uni/news') || h.startsWith('/news')) return 'news';
  if (h.startsWith('/chat')) return 'chat';
  if (h.startsWith('/uni/uploads') || h.includes('tab=uploads')) return 'upload';
  if (h.startsWith('/uni/support')) return 'help';
  if (h.includes('tab=students')) return 'cap';
  if (h.includes('tab=lecturers')) return 'people';
  if (h.includes('tab=positions')) return 'medal';
  if (h.includes('tab=levels')) return 'chart';
  if (h.startsWith('/uni')) return 'uni';
  if (h.startsWith('/lecturer/admin') || h.startsWith('/admin')) return 'admin';
  if (h.startsWith('/lecturer/portal')) return 'cap';
  if (h === '/lecturer') return 'home';
  if (h.startsWith('/lecturer/uploads')) return 'docs';
  if (h.startsWith('/lecturer')) return 'book';
  if (h.startsWith('/settings/profile')) return 'profile';
  if (h.startsWith('/settings')) return 'gear';
  return 'dot';
};
const badgeText = n => n > 15 ? '15+' : String(n);
const PUSH_CLIENT_JS = `(function(){
if(!('serviceWorker' in navigator))return;
var KEY=window.__VAPID||'';
function u8(b){var p='='.repeat((4-b.length%4)%4),s=(b+p).replace(/-/g,'+').replace(/_/g,'/'),r=atob(s),o=new Uint8Array(r.length);for(var i=0;i<r.length;i++)o[i]=r.charCodeAt(i);return o}
function save(sub){return fetch('/api/push/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sub.toJSON())})}
function fresh(reg){return reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:u8(KEY)}).then(save).then(function(){return true})}
function subscribe(reg){return reg.pushManager.getSubscription().then(function(ex){
  if(!ex)return fresh(reg);
  var same=true;try{var k=new Uint8Array(ex.options.applicationServerKey),n=u8(KEY);same=k.length===n.length;for(var i=0;same&&i<k.length;i++)if(k[i]!==n[i])same=false}catch(_){}
  if(same)return save(ex).then(function(){return true});
  return ex.unsubscribe().then(function(){return fresh(reg)})})}
window.enablePush=function(){
  if(!window.Notification||!window.PushManager)return Promise.resolve(false);
  return Notification.requestPermission().then(function(p){
    if(p!=='granted')return false;
    return navigator.serviceWorker.register('/sw.js').then(function(){return navigator.serviceWorker.ready}).then(subscribe)
  }).catch(function(){return false})};
// Inside the Android app the page loader is not used at all: it hides the app's identity from the site and gets in the way of the app's own offline pages.
if(window.StudiesApp){try{navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister()})}).catch(function(){});if(window.caches)caches.keys().then(function(ks){ks.forEach(function(k){caches.delete(k)})}).catch(function(){})}catch(e){}}
else navigator.serviceWorker.register('/sw.js').then(function(reg){
  if(window.Notification&&window.PushManager&&Notification.permission==='granted')subscribe(reg).catch(function(){})
  if('periodicSync' in reg&&navigator.permissions){
    navigator.permissions.query({name:'periodic-background-sync'}).then(function(status){
      if(status.state==='granted')reg.periodicSync.register('refresh-content',{minInterval:12*60*60*1000}).catch(function(){})
    }).catch(function(){})
  }
}).catch(function(){});
var bar=document.getElementById('pushBar'),dismissed=false;
try{dismissed=!!localStorage.getItem('pushDismissed')}catch(_){}
if(bar&&window.Notification&&window.PushManager&&Notification.permission==='default'&&!dismissed){
  bar.hidden=false;
  document.getElementById('pushYes').addEventListener('click',function(){window.enablePush().then(function(){bar.hidden=true})});
  document.getElementById('pushNo').addEventListener('click',function(){try{localStorage.setItem('pushDismissed','1')}catch(_){}bar.hidden=true})
}
})();`;
// The name shown at the top of each page (like WhatsApp): the page's own name, or "Studies Hub" on the home/dashboard.
function topTitle(title) {
  const t = String(title || '').replace(/\s*[|\-\u2013\u2014]\s*Studies Hub\s*$/i, '').trim();
  return !t || /^(dashboard|home|welcome|studies hub)$/i.test(t) ? 'Studies Hub' : t;
}
// Every page repeats the same big styles and scripts. They are served as files instead (the app carries a copy inside itself),
// so a page is only its own content, and the shared parts open instantly and are kept on the phone.
const layout = (...a) => externalize(layoutRaw(...a));
const layoutRaw = (title, body, user, opts = {}) => {
  const avatarBit = user
    ? (user.avatar_mime ? `<img src="/avatar/${user.id}" class="drawer-av-img" alt="">` : `<span class="avatar" style="width:40px;height:40px;font-size:15px">${esc((user.name || '?').trim().charAt(0).toUpperCase() || '?')}</span>`)
    : '';
  const badge = user ? chatBadge(user.id) : 0;
  const drawerNav = navItems(user, badge, opts.mode).map(i => `<a class="drawer-item" href="${i.href}"><span>${ico(iconKey(i))}</span>${esc(i.label)}${i.badge > 0 ? `<b class="nbadge">${badgeText(i.badge)}</b>` : ''}</a>`).join('');
  const drawerBottom = user
    ? `<a class="drawer-item" href="/settings"><span>${ico('gear')}</span>Settings</a><form method="post" action="/logout" style="margin:0"><button class="drawer-item drawer-out" style="width:100%;text-align:left;font:inherit;border:0;cursor:pointer"><span>${ico('logout')}</span>Log out</button></form>`
    : `<a class="drawer-item ds-li" href="/login"><span>${ico('login')}</span>Log in</a><a class="drawer-item ds-su" href="/signup"><span>${ico('signup')}</span>Sign up</a><a class="drawer-item lap-only" href="/login" aria-label="Log in with your phone"><span>${ico('profile')}</span>Log in</a>`;
  // Phones get a bottom tab bar for the main places (laptops use the always-open menu on the left instead).
  const tabItems = user && !opts.hideTop ? navItems(user, badge, opts.mode).filter(i => !i.href.includes('?')).slice(0, 3) : [];
  const tabbar = tabItems.length ? `<div class="tabbar" id="tabbar">${tabItems.map(i => `<a href="${i.href}" data-h="${i.href}" aria-label="${esc(i.label)}" data-tip="${esc(i.label)}">${ico(iconKey(i))}${i.badge > 0 ? `<b class="nbadge">${badgeText(i.badge)}</b>` : ''}</a>`).join('')}<button type="button" id="tabMenu" aria-label="Menu" data-tip="Menu">${ico('menu')}</button></div><script>(function(){var p=location.pathname,bar=document.getElementById('tabbar'),as=bar.querySelectorAll('a'),best=null;[].forEach.call(as,function(a){var h=a.getAttribute('data-h');if(p===h||(h.length>1&&p.indexOf(h+'/')===0))best=a});if(best)best.className='on';
var lp=false,t=null,tip=null;function hide(){if(tip){tip.remove();tip=null}}
function show(el){hide();tip=document.createElement('div');tip.className='tabtip';tip.textContent=el.getAttribute('data-tip');document.body.appendChild(tip);var r=el.getBoundingClientRect();tip.style.left=Math.min(Math.max(8,r.left+r.width/2-tip.offsetWidth/2),innerWidth-tip.offsetWidth-8)+'px';tip.style.bottom=(innerHeight-r.top+8)+'px';setTimeout(hide,1400)}
[].forEach.call(bar.children,function(el){el.addEventListener('pointerdown',function(){lp=false;clearTimeout(t);t=setTimeout(function(){lp=true;show(el)},420)});['pointerup','pointercancel','pointerleave'].forEach(function(n){el.addEventListener(n,function(){clearTimeout(t)})});el.addEventListener('contextmenu',function(e){e.preventDefault()});el.addEventListener('click',function(e){if(lp){e.preventDefault();e.stopPropagation();lp=false}},true)});
document.getElementById('tabMenu').onclick=function(){var o=document.getElementById('drawerOpen');if(o)o.click()}})()</script>` : '';
  const themeAttr = user && user.theme === 'light' ? ' data-theme="light"' : '';
  const descriptionMeta = opts.description ? `<meta name="description" content="${esc(opts.description)}">` : '';
  return `<!doctype html><html lang="en"${themeAttr}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><script>if(/StudiesHubApp/.test(navigator.userAgent))document.documentElement.setAttribute("data-inapp","1")</script><style>[data-inapp] a[href="/app"]{display:none!important}html:not([data-inapp]) a[href="/saved"]{display:none!important}</style><script>(function(){var d=document.documentElement,ua=navigator.userAgent||"",ud=navigator.userAgentData,tp=navigator.maxTouchPoints||0,sm=Math.min(screen.width,screen.height),os="Unknown",dev;
if(/iPhone|iPod/.test(ua))os="iOS";else if(/iPad/.test(ua)||(/Macintosh/.test(ua)&&tp>1))os="iPadOS";else if(/Android/.test(ua)||(ud&&ud.platform==="Android"))os="Android";else if(/CrOS/.test(ua))os="ChromeOS";else if(/Windows/.test(ua))os="Windows";else if(/Mac OS X|Macintosh/.test(ua))os="macOS";else if(/Linux|X11/.test(ua))os="Linux";
var mob=/Mobi|iPhone|iPod/.test(ua)||(ud&&ud.mobile===true);
if(os==="iOS")dev="phone";else if(os==="iPadOS")dev="tablet";else if(os==="Android")dev=(mob||sm<600)?"phone":"tablet";else if(tp>0&&sm<600)dev="phone";else if(tp>0&&sm<1100&&os==="Linux")dev="tablet";else dev="laptop";
d.setAttribute("data-dev",dev);d.setAttribute("data-os",os);if(/^\\/call/.test(location.pathname))d.setAttribute("data-nolock","1");
try{if(window.top===window.self){var ck=";path=/;max-age=31536000;SameSite=Lax";document.cookie="dev="+dev+ck;document.cookie="os="+os+ck;document.cookie="wide="+(innerWidth>=1024?1:0)+ck}}catch(e){}
try{if(window.parent!==window&&window.parent.document.getElementById("pane"))d.className+=" embed"}catch(e){}})()</script><title>${esc(title)}</title>${descriptionMeta}${opts.headExtra || ''}<link rel="icon" href="/icon-192.png?v=2"><link rel="apple-touch-icon" href="/icon-192.png?v=2"><link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="${user && user.theme === 'light' ? '#f4f7fc' : '#12121c'}"><style>${CSS_FINAL}</style></head><body${[opts.footer ? 'has-footer' : '', tabbar ? 'has-tabbar' : ''].filter(Boolean).length ? ` class="${[opts.footer ? 'has-footer' : '', tabbar ? 'has-tabbar' : ''].filter(Boolean).join(' ')}"` : ''}>
<div id="scrim" class="scrim"></div>${tabbar}
<nav id="drawer" class="drawer">
<div class="drawer-top"><img class="logo-img" src="/logo.png?v=2" alt=""><b>Studies Hub</b><button id="drawerClose" class="link" aria-label="Close menu" style="margin-left:auto;font-size:20px">&times;</button></div>
${user ? `<a class="drawer-user" href="/settings/profile">${avatarBit}<div><b>${esc(user.name)}</b><br><span class="mut" style="font-size:12px">${esc(user.email)}</span></div></a>` : ''}
<p class="drawer-label">MAIN MENU</p>
${drawerNav}
<div class="drawer-bottom">${drawerBottom}</div>
</nav>
<div id="drawerArrows" class="drawer-arrows"><button type="button" id="drawerUp" aria-label="Scroll the menu up" title="Scroll up">&#9650;</button><button type="button" id="drawerDown" aria-label="Scroll the menu down" title="Scroll down">&#9660;</button></div>
${user && !opts.hideTop ? '<aside id="pane" class="pane"><div class="pane-head" id="paneHead"></div><div class="pane-body" id="paneBody"></div></aside>' : ''}<header class="top"${opts.hideTop ? ' hidden' : ''}><button id="drawerOpen" class="menu-btn" aria-label="Open menu">&#9776;${badge > 0 ? `<span class="mbadge">${badgeText(badge)}</span>` : ''}</button><a class="brand" href="${user ? '/dashboard' : '/'}">${esc(topTitle(title))}</a><span style="width:40px"></span></header>
<main>${user && !opts.noPushBar ? '<div id="pushBar" class="pushbar" hidden><span>Turn on notifications to get incoming calls (even when the site is closed), new messages, open the correct conversation quickly, and see friend requests and new uploads.</span><button id="pushYes" type="button">Turn on</button><button id="pushNo" type="button" class="ghost">Not now</button></div>' : ''}${body}</main>${opts.footer ? `<footer class="site-foot"><span>&copy; ${new Date().getFullYear()} Studies Hub</span><span class="site-foot-links"><a href="/about">About</a><a href="/guides">Study guides</a><a href="/contact">Contact</a><a href="/privacy">Privacy Policy</a><a href="/terms">Terms &amp; Conditions</a></span></footer>` : ''}${user && AI && !opts.noAI ? CHAT_HTML : ''}
<script>(function(){if(innerWidth<1024||window.top!==window.self||document.documentElement.getAttribute('data-dev')==='phone')return;
document.querySelectorAll('.drawer-item').forEach(function(a){a.title=a.textContent.trim()});
var pane=document.getElementById('pane'),main=document.querySelector('main');if(!pane||!main)return;
var head=document.getElementById('paneHead'),pbody=document.getElementById('paneBody'),topEl=document.querySelector('header.top .brand'),cur=null,frame=null,lastLabel='';
var S=[[/^\\/(dashboard)?$|^\\/p\\//,'/dashboard','Studies Hub','Pick a course or file from the list.'],[/^\\/news/,'/news','News','Pick a post to read it here.'],[/^\\/chat/,'/chat','Chats','Select a chat to start messaging.'],[/^\\/settings/,'/settings','Settings','Choose a setting.'],[/^\\/admin/,'/admin','Admin','Choose a section.'],[/^\\/lecturer/,'/lecturer','Lecturer portal','Choose a section.'],[/^\\/uni/,'/uni','University','Choose a section.']];
function norm(p){return p.replace(/\\/+$/,'')||'/'}
function secOf(p){for(var i=0;i<S.length;i++)if(S[i][0].test(p))return S[i];return null}
function isIdx(sec,p,q){return (p===sec[1]||(sec[1]==='/dashboard'&&p==='/'))&&!/[?&]tab=|[?&]share=/.test(q||'')}
function simplify(sec){if(sec[1]!=='/news')return;var cs=[].slice.call(pbody.querySelectorAll('a.news-card')),h='<a class="nl nl-share" href="/news?share=1">+ Share something</a>';cs.forEach(function(a){var t=a.querySelector('h3');h+='<a class="nl" href="'+a.getAttribute('href')+'">'+(t?t.innerHTML:'News')+'</a>'});if(!cs.length)h+='<p class="mut" style="padding:8px 14px">No news yet.</p>';pbody.innerHTML=h}
function tt(t){t=(t||'').replace(/\\s*[|\\-\\u2013\\u2014]\\s*Studies Hub\\s*$/i,'').trim();return(!t||/^(dashboard|home|welcome|studies hub)$/i.test(t))?'Studies Hub':t}
function setTitle(t){if(topEl)topEl.textContent=tt(t);if(t)document.title=t}
function runScripts(root){root.querySelectorAll('script').forEach(function(o){var s=document.createElement('script');s.text=o.text;o.replaceWith(s)})}
function mark(){var P=norm(location.pathname);pbody.querySelectorAll('a.cur').forEach(function(a){a.classList.remove('cur')});pbody.querySelectorAll('a[href]').forEach(function(a){var h=a.getAttribute('href');if(h&&h.charAt(0)==='/'&&h.split('?')[0]===P&&!(cur&&isIdx(cur,P)))a.classList.add('cur')})}
function rail(sec){document.querySelectorAll('.drawer-item[href]').forEach(function(a){var h=a.getAttribute('href');a.classList.toggle('active',h===sec[1]||h===norm(location.pathname))})}
function loadPane(sec,done){if(cur===sec){if(done)done();return}cur=sec;head.textContent=sec[2];document.body.classList.add('has-pane');pbody.innerHTML='';
fetch(sec[1],{credentials:'same-origin'}).then(function(r){return r.text()}).then(function(h){if(cur!==sec)return;var d=new DOMParser().parseFromString(h,'text/html'),m=d.querySelector('main');if(!m)return;var pb=m.querySelector('#pushBar');if(pb)pb.remove();
[].slice.call(m.childNodes).forEach(function(n){pbody.appendChild(document.importNode(n,true))});runScripts(pbody);simplify(sec);mark();if(done)done()}).catch(function(){})}
function clearMain(){[].slice.call(main.children).forEach(function(n){if(n.id!=='pushBar')n.remove()})}
function showEmpty(sec){frame=null;clearMain();var e=document.createElement('div');e.className='pane-empty';e.innerHTML='<div class="pane-empty-ic">&#9776;</div><p>'+sec[3]+'</p>';main.appendChild(e);document.body.classList.add('pane-index');setTitle(sec[2])}
function onFrame(){try{var w=frame.contentWindow;if(!w||w.location.href==='about:blank')return;var p=norm(w.location.pathname),q=w.location.search.replace(/([?&])embed=1&?/,'$1').replace(/[?&]$/,''),sec=secOf(p);
var wt=w.document.title;if(wt)setTitle(wt);else if(lastLabel)setTitle(lastLabel);if(!sec)return;
if(isIdx(sec,p,q)){go(p+q);return}
var url=p+q;if(url!==location.pathname+location.search)history.pushState({},'',url);
if(cur!==sec)loadPane(sec,mark);else mark();rail(sec)}catch(e){}}
function showFrame(src){if(!frame){clearMain();frame=document.createElement('iframe');frame.className='reader';frame.addEventListener('load',onFrame);main.appendChild(frame)}document.body.classList.remove('pane-index');if(frame.getAttribute('src')!==src)frame.src=src}
function go(href,push,label){lastLabel=label||'';var u=new URL(href,location.href),p=norm(u.pathname),sec=secOf(p);if(!sec){location.href=href;return}
loadPane(sec,mark);
if(isIdx(sec,p,u.search)){showEmpty(sec)}else{showFrame(p+u.search+(u.search?'&':'?')+'embed=1')}
if(push!==false&&(p+u.search)!==(location.pathname+location.search))history.pushState({},'',p+u.search);rail(sec);mark()}
document.addEventListener('click',function(e){if(e.defaultPrevented||e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;var a=e.target.closest&&e.target.closest('a[href]');if(!a||(!a.closest('#pane')&&!a.closest('.drawer')))return;
var h=a.getAttribute('href')||'';if(!h||h.charAt(0)==='#'||(a.target&&a.target!=='_self')||a.hasAttribute('download'))return;var u=new URL(a.href,location.href);if(u.origin!==location.origin)return;
if(!secOf(norm(u.pathname))||/\\/raw$|\\.(csv|pdf|zip)$|\\/logout|\\/export/.test(u.pathname))return;e.preventDefault();var hh=a.querySelector('h3,b'),lb=((hh||a).textContent||'').replace(/\\s+/g,' ').trim().slice(0,80);go(u.href,true,lb)});
window.addEventListener('popstate',function(){go(location.href,false)});
// first load
var P0=norm(location.pathname),sec0=secOf(P0);if(!sec0)return;
cur=sec0;head.textContent=sec0[2];document.body.classList.add('has-pane');
var fr0=main.querySelector('iframe.reader');
if(isIdx(sec0,P0,location.search)){var keep=main.querySelector('#pushBar');[].slice.call(main.childNodes).forEach(function(n){if(n!==keep)pbody.appendChild(n)});simplify(sec0);showEmpty(sec0);mark()}
else{if(fr0){frame=fr0;frame.addEventListener('load',onFrame);document.body.classList.remove('pane-index')}
 cur=null;loadPane(sec0,mark)}
rail(sec0)})()</script>
<script>(function(){var d=document.getElementById('drawer'),s=document.getElementById('scrim'),o=document.getElementById('drawerOpen'),c=document.getElementById('drawerClose');function open(){d.classList.add('open');s.classList.add('show')}function close(){d.classList.remove('open');s.classList.remove('show')}o&&o.addEventListener('click',open);c&&c.addEventListener('click',close);s&&s.addEventListener('click',close);var path=location.pathname;document.querySelectorAll('.drawer-item[href]').forEach(function(a){if(a.getAttribute('href')===path)a.classList.add('active')})})()</script>
<script>(function(){var d=document.getElementById('drawer'),a=document.getElementById('drawerArrows'),u=document.getElementById('drawerUp'),dn=document.getElementById('drawerDown'),t=null;if(!d||!a)return;
function check(){a.classList.toggle('show',d.classList.contains('open')&&d.scrollHeight>d.clientHeight+4)}
function go(dy){d.scrollBy({top:dy,behavior:'smooth'})}
function hold(b,dy){b.addEventListener('mousedown',function(e){e.preventDefault();go(dy);clearInterval(t);t=setInterval(function(){d.scrollBy({top:dy/2})},90)});['mouseup','mouseleave'].forEach(function(n){b.addEventListener(n,function(){clearInterval(t)})})}
hold(u,-170);hold(dn,170);
new MutationObserver(check).observe(d,{attributes:true,attributeFilter:['class']});window.addEventListener('resize',check);check();
document.addEventListener('keydown',function(e){if(!d.classList.contains('open'))return;var tg=e.target&&e.target.tagName;if(tg==='INPUT'||tg==='TEXTAREA'||tg==='SELECT')return;var k=e.key,h=d.clientHeight;
if(k==='ArrowDown'){e.preventDefault();d.scrollBy({top:70})}else if(k==='ArrowUp'){e.preventDefault();d.scrollBy({top:-70})}else if(k==='PageDown'||k===' '){e.preventDefault();d.scrollBy({top:h-60,behavior:'smooth'})}else if(k==='PageUp'){e.preventDefault();d.scrollBy({top:60-h,behavior:'smooth'})}else if(k==='Home'){e.preventDefault();d.scrollTo({top:0})}else if(k==='End'){e.preventDefault();d.scrollTo({top:d.scrollHeight})}else if(k==='Escape'){var c=document.getElementById('drawerClose');if(c)c.click()}})})()</script>
<script>(function(){var P=location.pathname;if(/^\\/(login|signup|welcome|lecturer|call|chat\\/|forgot|reset|verify|pay)/.test(P))return;var main=document.querySelector('main');if(!main||main.querySelector('script'))return;var last=inner(main),busy=false;function inner(m){var c=m.cloneNode(true),pb=c.querySelector('#pushBar');if(pb)pb.remove();return c.innerHTML}function dirty(){var f=main.querySelectorAll('input,textarea,select');for(var i=0;i<f.length;i++){var e=f[i];if(e.type==='hidden'||e.type==='submit'||e.type==='button')continue;if(e.type==='checkbox'||e.type==='radio'){if(e.checked!==e.defaultChecked)return true}else if(e.tagName==='SELECT'){for(var j=0;j<e.options.length;j++)if(e.options[j].selected!==e.options[j].defaultSelected)return true}else if(e.value!==e.defaultValue)return true}var a=document.activeElement;return !!(a&&main.contains(a)&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))}function sync(sel,doc){var a=document.querySelectorAll(sel),b=doc.querySelectorAll(sel);if(a.length!==b.length)return;for(var i=0;i<a.length;i++)if(a[i].innerHTML!==b[i].innerHTML)a[i].innerHTML=b[i].innerHTML}function tick(){if(busy||document.hidden||document.getElementById('scrim')&&document.getElementById('scrim').classList.contains('show'))return;busy=true;fetch(location.href,{cache:'no-store',credentials:'same-origin',headers:{'X-Live':'1'}}).then(function(r){if(!r.ok||r.redirected||(r.headers.get('content-type')||'').indexOf('text/html')<0)return null;return r.text()}).then(function(h){if(!h)return;var d=new DOMParser().parseFromString(h,'text/html');sync('.menu-btn',d);sync('#drawer a.drawer-item',d);var m=d.querySelector('main');if(!m||m.querySelector('script'))return;var sel=window.getSelection&&String(window.getSelection());if(sel)return;var nw=inner(m);if(nw!==last&&nw!==inner(main)){if(dirty())return;var y=window.scrollY,pb=main.querySelector('#pushBar');main.innerHTML=nw;if(pb)main.insertBefore(pb,main.firstChild);window.scrollTo(0,y)}last=nw}).catch(function(){}).then(function(){busy=false})}setInterval(tick,4000);document.addEventListener('visibilitychange',function(){if(!document.hidden)tick()})})()</script>
${user ? `<script>(function(){var T=null,x0=0,y0=0,fired=false,sheet=null,ptype='';
function pageLink(n){var a=n&&n.closest?n.closest('a[href^="/p/"]'):null;if(!a)return null;var h=a.getAttribute('href')||'';return h.split('/').length===3&&h.indexOf('?')<0&&h.indexOf('#')<0&&h.length>3?a:null}
function titleOf(a){var h=a.querySelector('h1,h2,h3,h4'),t=(h?h.textContent:a.textContent)||'';return t.split(String.fromCharCode(10)).join(' ').split(' ').filter(Boolean).join(' ').slice(0,120)}
function mk(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e}
function close(){if(sheet){sheet.parentNode.removeChild(sheet);sheet=null}}
function toast(msg,href,label){var t=mk('div','shtoast',msg);if(href){var a=mk('a',null,label||'Open');a.href=href;t.appendChild(a)}document.body.appendChild(t);setTimeout(function(){if(t.parentNode)t.parentNode.removeChild(t)},4500)}
function shell(){close();sheet=mk('div','shsheet');sheet.addEventListener('click',function(e){if(e.target===sheet)close()});var box=mk('div','shbox');sheet.appendChild(box);document.body.appendChild(sheet);return box}
function menu(a){
  var href=a.getAttribute('href'),title=titleOf(a),box=shell();
  box.appendChild(mk('div','shgrip'));box.appendChild(mk('b','shtitle',title||'This page'));box.appendChild(mk('div','shsub','What would you like to do?'));
  var d=mk('button','shopt','💬  Discuss with someone');d.type='button';d.onclick=function(){pick(href,title)};box.appendChild(d);
  var o=mk('a','shopt','📖  Open');o.href=href;box.appendChild(o);
  var c=mk('button','shopt shcancel','Cancel');c.type='button';c.onclick=close;box.appendChild(c)}
function pick(href,title){
  var box=shell();box.appendChild(mk('div','shgrip'));box.appendChild(mk('b','shtitle','Discuss with…'));box.appendChild(mk('div','shsub',title));
  var q=mk('input','shfind');q.placeholder='Search your chats';q.type='search';box.appendChild(q);
  var list=mk('div','shlist',null);list.appendChild(mk('div','shsub','Loading…'));box.appendChild(list);var all=[];
  function draw(){var f=q.value.trim().toLowerCase();list.innerHTML='';var n=0;all.forEach(function(t){if(f&&t.name.toLowerCase().indexOf(f)<0)return;n++;var b=mk('button','shrow');b.type='button';b.appendChild(mk('span','shav',t.kind==='group'?'👥':(t.name.charAt(0)||'?').toUpperCase()));b.appendChild(mk('span','shname',t.name));b.onclick=function(){send(t,href,title)};list.appendChild(b)});if(!n)list.appendChild(mk('div','shsub',all.length?'No match.':'You have no friends or groups yet. Add a friend first.'))}
  q.addEventListener('input',draw);
  fetch('/api/chats/targets',{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){all=j.targets||[];draw()}).catch(function(){list.innerHTML='';list.appendChild(mk('div','shsub','Could not load your chats.'))});
  var c=mk('button','shopt shcancel','Cancel');c.type='button';c.onclick=close;box.appendChild(c)}
function send(t,href,title){
  var body={body:'📚 Let us discuss: '+title+String.fromCharCode(10)+location.origin+href};if(t.kind==='group')body.group=t.id;else body.to=t.id;
  close();
  fetch('/api/messages/send',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json()}).then(function(j){
    if(j&&j.id)toast('Sent to '+t.name+' ✓',t.kind==='group'?'/chat/group/'+t.id:'/chat/'+t.id,'Open chat');else toast((j&&j.error)||'Could not send.')
  }).catch(function(){toast('Could not send. Check your connection.')})}
document.addEventListener('pointerdown',function(e){ptype=e.pointerType||'';var a=pageLink(e.target);if(!a)return;fired=false;x0=e.clientX;y0=e.clientY;clearTimeout(T);T=setTimeout(function(){fired=true;if(navigator.vibrate)try{navigator.vibrate(15)}catch(x){}menu(a)},500)},true);
document.addEventListener('pointermove',function(e){if(T&&(Math.abs(e.clientX-x0)>10||Math.abs(e.clientY-y0)>10)){clearTimeout(T);T=null}},true);
['pointerup','pointercancel','scroll'].forEach(function(n){document.addEventListener(n,function(){clearTimeout(T);T=null},true)});
document.addEventListener('click',function(e){if(fired){e.preventDefault();e.stopPropagation();fired=false}},true);
document.addEventListener('contextmenu',function(e){var a=pageLink(e.target);if(a&&ptype==='touch')e.preventDefault()},true)})()</script>
` : ''}
${user ? `<script>(function(){var me='${user.id}',ov=null;
function close(){if(ov&&ov.parentNode)ov.parentNode.removeChild(ov);ov=null}
function mk(tag,css,txt){var e=document.createElement(tag);if(css)e.style.cssText=css;if(txt!=null)e.textContent=txt;return e}
var IC={chat:'<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'};
function btn(href,svg,label){var a=mk('a','display:flex;flex-direction:column;align-items:center;gap:6px;color:#fff;text-decoration:none;font:600 12px system-ui,sans-serif');a.href=href;
 var c=mk('span','width:46px;height:46px;border-radius:50%;background:rgba(255,255,255,.16);display:flex;align-items:center;justify-content:center');c.innerHTML='<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+svg+'</svg>';a.appendChild(c);a.appendChild(mk('span','',label));return a}
function open(t){var k=String(t.getAttribute('data-pv')).split(':'),kind=k[0],id=k[1],name=t.getAttribute('data-pn')||'',photo=t.getAttribute('data-ph')==='1';close();
 ov=mk('div','position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483000;background:rgba(0,0,0,.88);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:20px');
 ov.appendChild(mk('div','color:#fff;font:700 17px system-ui,sans-serif;max-width:80vw;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap',name));
 var mid=mk('div','display:flex;align-items:center;justify-content:center');
 if(photo){var im=mk('img','width:min(62vw,240px);height:min(62vw,240px);object-fit:cover;border-radius:18px;background:#222;transition:filter .4s;filter:blur(14px)');im.alt='';var fu=(kind==='g'?'/group-avatar/':'/avatar/')+id;im.src=t.currentSrc||t.src||fu;mid.appendChild(im);var big=new Image();big.onload=function(){im.src=fu;im.style.filter='none'};big.src=fu;if(t.complete&&t.naturalWidth&&(t.currentSrc||t.src).indexOf(fu)>-1)im.style.filter='none'}
 else{mid.appendChild(mk('div','width:min(62vw,240px);height:min(62vw,240px);border-radius:18px;background:#2a2a3a;color:#fff;display:flex;align-items:center;justify-content:center;font:700 min(26vw,96px) system-ui,sans-serif',kind==='g'?'👥':(name.trim().charAt(0)||'?').toUpperCase()))}
 ov.appendChild(mid);
 var bar=mk('div','display:flex;gap:34px;justify-content:center');
 var own=kind==='u'&&id===me;
 if(!own)bar.appendChild(btn(kind==='g'?'/chat/group/'+id:'/chat/'+id,IC.chat,'Chat'));
 bar.appendChild(btn(kind==='g'?'/chat/group/'+id+'/info':'/u/'+id,IC.info,'Info'));
 ov.appendChild(bar);
 ov.addEventListener('click',function(e){if(!e.target.closest('a'))close()});
 document.body.appendChild(ov)}
document.addEventListener('click',function(e){var t=e.target.closest&&e.target.closest('[data-pv][data-pn]');if(!t||t===document.documentElement||t.closest('label,form,[data-nopv]'))return;e.preventDefault();e.stopPropagation();open(t)},true);
document.addEventListener('keydown',function(e){if(e.key==='Escape')close()});
window.addEventListener('pagehide',close)})()</script>` : ''}
${user ? `<script>window.__VAPID='${VAPID_PUBLIC}'</script><script>${PUSH_CLIENT_JS}</script><script>${CALLING_CLIENT_JS}</script>` : ''}
${user ? `<script>${LIVE_CLIENT_JS}</script>` : ''}
<script>(function(){var h=document.querySelector('header.top');if(!h||h.hasAttribute('hidden'))return;var y=window.pageYOffset||0;window.addEventListener('scroll',function(){var n=window.pageYOffset||0;if(n<60)h.classList.remove('hide');else if(n>y+8)h.classList.add('hide');else if(n<y-4)h.classList.remove('hide');y=n},{passive:true})})()</script>
<script>(function(){if(!window.StudiesApp)return;function fail(m){var b=document.querySelector('a.gbtn');if(b)b.style.opacity='';if(m)alert(m)}window.studiesGoogleFail=fail;window.studiesGoogle=function(t,l){fetch('/auth/google/app',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:t,lecturer:!!l})}).then(function(r){return r.json()}).then(function(j){if(j.ok)location.href=j.url||'/';else fail(j.error)}).catch(function(){fail('No connection. Please try again.')})};document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a.gbtn');if(!a)return;e.preventDefault();a.style.opacity='.6';StudiesApp.google(/as=lecturer/.test(a.getAttribute('href')||''))},true)})()</script>
<script>(function(){window.studiesNote=function(ok){alert(ok?'Notifications are on for this device.':'Notifications are off. Turn them on in your phone settings for Studies Hub.')};if(window.StudiesApp)return;var native=window.alert;window.alert=function(m){try{var o=document.createElement('div');o.setAttribute('role','alertdialog');o.style.cssText='position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px';var b=document.createElement('div');b.style.cssText='max-width:420px;width:100%;background:var(--card,#1d1d2b);color:var(--text,#fff);border:1px solid var(--line,#333);border-radius:16px;padding:20px;font:16px/1.45 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.45)';var t=document.createElement('div');t.textContent=String(m);t.style.whiteSpace='pre-wrap';var k=document.createElement('button');k.type='button';k.textContent='OK';k.style.cssText='margin-top:16px;float:right;border:0;border-radius:10px;padding:10px 22px;background:#6c63ff;color:#fff;font:600 15px system-ui,sans-serif;cursor:pointer';k.onclick=function(){o.remove()};b.appendChild(t);b.appendChild(k);o.appendChild(b);document.body.appendChild(o);k.focus()}catch(e){native.call(window,m)}}})()</script>
${`<script>(function(){var A=window.StudiesApp;if(!A||!A.offUser)return;
try{A.offUser('${user ? user.id : 0}')}catch(e){}
var bar=null,tm=null,NOINET='No internet connection. Check your internet connection and try again.';
function toast(msg,kind){if(!bar){bar=document.createElement('div');bar.style.cssText='position:fixed;left:12px;right:12px;top:calc(10px + env(safe-area-inset-top,0px));z-index:2147482000;border-radius:14px;padding:12px 14px;font:600 14px system-ui,sans-serif;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.4);text-align:center';document.body.appendChild(bar)}
 bar.style.background=kind==='ok'?'#16a34a':kind==='err'?'#b91c1c':'#334155';bar.textContent=msg;bar.hidden=false;if(tm)clearTimeout(tm);tm=setTimeout(function(){bar.hidden=true},4000)}
window.__toast=toast;window.__noInet=function(){toast(NOINET,'err')};
// No "you are offline" notices. The app only remembers the state, tells the chat to send what is waiting once the internet is back, and shows an error only when something truly needs the internet.
function offPill(){var on=window.__netState==='offline',p=document.getElementById('shOffPill');if(on&&!p&&document.body){p=document.createElement('div');p.id='shOffPill';p.textContent='Offline';p.style.cssText='position:fixed;top:8px;right:10px;z-index:2147483000;background:rgba(60,60,70,.92);color:#fff;font:600 12px system-ui,sans-serif;padding:4px 10px;border-radius:999px;pointer-events:none';document.body.appendChild(p)}else if(!on&&p)p.remove()}
window.__net=function(s){window.__netState=s;offPill();if(s==='online'){try{window.dispatchEvent(new Event('shnet'))}catch(e){}}};
try{window.__netState=String(A.netState()||'online')}catch(e){}
offPill();document.addEventListener('DOMContentLoaded',offPill);
document.addEventListener('submit',function(e){var f=e.target;if(!f||f.tagName!=='FORM'||f.hasAttribute('data-offok'))return;var st='online';try{st=String(A.netState())}catch(x){}if(st!=='offline')return;if((f.getAttribute('method')||'get').toLowerCase()!=='post')return;e.preventDefault();e.stopImmediatePropagation();toast(NOINET,'err')},true);
function doRestore(d,cb){var n=0,l=d.items||[],p=d.prefs||{};
try{if(typeof p.auto==='boolean'&&A.offAuto)A.offAuto(p.auto);if(typeof p.wifi==='boolean'&&A.offWifi)A.offWifi(p.wifi);if(A.bkSet&&p.bkFreq)A.bkSet(String(p.bkFreq),p.bkWifi!==false)}catch(e){}
l.forEach(function(o){try{if(String(A.offStatus(o.slug))!=='saved'){A.offSave(o.slug,o.title||'',o.kind||'',o.course||'');n++}}catch(e){}});
cb(n?'Restoring '+n+' material'+(n===1?'':'s')+' to this phone. You can leave this page; the progress shows in your notifications.':'Everything in your backup is already on this phone.')}
window.__bkRestoreData=doRestore;
window.__bkRestore=function(cb){fetch('/api/backup/data',{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(d){if(!d.have){cb('No backup found for this account yet.',1);return}doRestore(d,cb)}).catch(function(){cb('Check your internet connection and try again.',1)})};
// A freshly installed app with nothing saved yet: if this account has a backup, offer to bring it back.
(function(){var uid='${user ? user.id : 0}';if(uid==='0'||!A.offList||!A.bkGet||window.top!==window.self)return;var key='bkq_'+uid;try{if(localStorage.getItem(key))return}catch(e){return}
setTimeout(function(){try{if(String(A.offList())!=='[]'||window.__netState==='offline')return}catch(e){return}
fetch('/api/backup',{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(b){if(!b.have||!b.items)return;
var o=document.createElement('div');o.style.cssText='position:fixed;inset:0;z-index:2147483100;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:24px';
var c=document.createElement('div');c.style.cssText='max-width:380px;width:100%;background:#14161f;color:#fff;border-radius:18px;padding:22px;font:15px/1.5 system-ui,sans-serif';
c.innerHTML='<b style="font-size:18px">Welcome back</b><p style="opacity:.8">We found a backup for <b>'+String(b.email||'').replace(/[<>&]/g,'')+'</b> from '+new Date(b.at).toLocaleDateString()+' with '+b.items+' saved material'+(b.items===1?'':'s')+'. Do you want to restore it to this phone?</p><p id="bkq" style="opacity:.8;margin:0 0 10px"></p><div style="display:flex;gap:10px"><button id="bkY" style="flex:1;padding:12px;border:0;border-radius:12px;background:#5bc8ff;color:#04101f;font-weight:700">Yes, restore</button><button id="bkN" style="flex:1;padding:12px;border:0;border-radius:12px;background:#2a2d3a;color:#fff">Not now</button></div>';
o.appendChild(c);document.body.appendChild(o);function done(){try{localStorage.setItem(key,'1')}catch(e){}}
c.querySelector('#bkN').onclick=function(){done();o.remove()};
c.querySelector('#bkY').onclick=function(){done();c.querySelector('#bkq').textContent='Starting…';window.__bkRestore(function(t,bad){c.querySelector('#bkq').textContent=t;c.querySelector('#bkY').remove();c.querySelector('#bkN').textContent='Close'})}}).catch(function(){})},2500)})();
var ob=document.getElementById('offBar');
if(ob){var slug=ob.getAttribute('data-slug'),ttl=ob.getAttribute('data-title')||'',kd=ob.getAttribute('data-kind')||'',crs=ob.getAttribute('data-course')||'',fl=ob.getAttribute('data-file')||'',tick=null;
 var st=document.createElement('style');st.textContent='@keyframes shspin{to{transform:rotate(360deg)}}.shdl{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0 12px}.shdl svg{flex:none}.shdl button{flex:1 1 150px;display:flex;align-items:center;justify-content:center;gap:8px;padding:12px 10px;border-radius:12px;border:1px solid var(--line,#444);background:transparent;color:inherit;font:600 14px system-ui,sans-serif;cursor:pointer;white-space:nowrap}.shdl .ok{flex:1 1 150px;display:flex;align-items:center;justify-content:center;padding:12px 14px;border-radius:12px;background:rgba(34,197,94,.15);color:#22c55e;font:600 15px system-ui,sans-serif}.shdl .busy{flex:1 1 100%;border:1px solid var(--line,#444);border-radius:12px;padding:12px 14px}.shdl .row{display:flex;align-items:center;gap:10px;font:600 15px system-ui,sans-serif}.shdl .ring{transform-origin:12px 12px;animation:shspin 1s linear infinite}.shdl .bar{height:6px;border-radius:99px;background:rgba(127,127,127,.3);margin-top:10px;overflow:hidden}.shdl .bar i{display:block;height:100%;width:0;background:#22c55e;border-radius:99px;transition:width .4s}';document.head.appendChild(st);
 var ARROW='<path d="M12 6v8m-3-3 3 3 3-3M7 18h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
 var ICON='<svg width="22" height="22" viewBox="0 0 24 24">'+ARROW+'</svg>',SPIN='<svg width="22" height="22" viewBox="0 0 24 24"><circle class="ring" cx="12" cy="12" r="10.5" fill="none" stroke="#22c55e" stroke-width="2" stroke-dasharray="16 50" stroke-linecap="round"/>'+ARROW+'</svg>';
 var box=document.createElement('div');box.className='shdl';ob.appendChild(box);
 function hideLinks(){Array.prototype.forEach.call(document.querySelectorAll('a[href*="/raw"]'),function(a){a.style.display='none'})}
 function viewOnly(){Array.prototype.forEach.call(document.querySelectorAll('video'),function(v){v.setAttribute('controlslist','nodownload')})}
 function sa(){try{return String(A.offStatus(slug))}catch(e){return 'none'}}
 function sp(){try{return String(A.dlStatus(slug))}catch(e){return 'none'}}
 function pc(s){return parseInt((s.split(':')[1]||'0'),10)||0}
 function busy(t,p,wait){box.innerHTML='<div class="busy"><div class="row">'+SPIN+'<span>'+t+'</span></div><div class="bar"><i style="width:'+(wait?6:p)+'%"></i></div></div>'}
 function chip(t){var d=document.createElement('div');d.className='ok';d.textContent=t;box.appendChild(d)}
 var msg='';function note(t){if(!t)return;var d=document.createElement('div');d.style.cssText='flex:1 1 100%;color:#ef4444;font:600 13px system-ui,sans-serif';d.textContent=t;box.appendChild(d)}
 function btn(t,fn){var b=document.createElement('button');b.type='button';b.innerHTML=ICON+'<span></span>';b.lastChild.textContent=t;b.onclick=fn;box.appendChild(b)}
 var wasBusy=false,okmsg='';
 function draw(){clearTimeout(tick);var a=sa(),p=sp();if(p==='done'&&wasBusy){wasBusy=false;okmsg='Downloaded successfully';setTimeout(function(){okmsg='';draw()},4000)}
  if(a==='queued'||a.indexOf('saving')===0){busy(a==='queued'?'Waiting to start…':'Saving to app… '+pc(a)+'%',pc(a),a==='queued');tick=setTimeout(draw,600);return}
  if(p==='pending'||p.indexOf('saving')===0){wasBusy=true;okmsg='';busy(p==='pending'?'Waiting to start…':'Downloading to phone… '+pc(p)+'%',pc(p),p==='pending');tick=setTimeout(draw,600);return}
  box.innerHTML='';hideLinks();var why=a.indexOf('error')===0?a.slice(6):p.indexOf('error')===0?p.slice(6):msg;
  if(a==='saved'){chip('✓ Saved in the app');viewOnly()}else btn(a.indexOf('error')===0?'Could not save. Tap to try again':'Save to app',function(){msg='';var ok=false;try{ok=A.offSave(slug,ttl,kd,crs)}catch(e){}if(!ok&&sa()==='none')msg='Could not start saving. Please update the Studies Hub app and try again.';draw()});
  btn(p.indexOf('error')===0?'Download failed. Tap to try again':'Download to phone',function(){msg='';var ok=false;try{ok=A.dlStart(slug,ttl,fl)}catch(e){}if(!ok&&sp()==='none')msg='Could not start the download. Please update the Studies Hub app and try again.';draw()});note(why);if(okmsg){var g=document.createElement('div');g.style.cssText='flex:1 1 100%;color:#22c55e;font:600 14px system-ui,sans-serif';g.textContent=okmsg;box.appendChild(g)}}
 draw()}
})()</script>`}${`<script>(function(){var A=window.StudiesApp;if(!A||!A.privatePage)return;var last=null;
function chk(){var p=location.pathname,v=/^\\/(settings\\/(profile|security|devices)|login|signup|forgot|reset|verify|welcome|pay|admin)(\\/|$)/.test(p);if(v!==last){last=v;try{A.privatePage(v)}catch(e){}}}
chk();setInterval(chk,600)})()</script>`}${user ? `<script>${SEARCHSEL_JS}</script><script>${PREVIEW_JS}</script>` : ''}
${user && !opts.hideTop && !opts.noAI && !opts.noFeedback ? `<script>${FEEDBACK_JS}</script>` : ''}
<script>(function(){try{var ua=navigator.userAgent||'';if(!/Android/i.test(ua)||/StudiesHubApp/.test(ua)||window.top!==window.self)return;if(matchMedia('(display-mode: standalone)').matches)return;if(location.pathname==='/app')return;if(sessionStorage.getItem('appAsk'))return;sessionStorage.setItem('appAsk','1');var t=+localStorage.getItem('appAskAt')||0;if(Date.now()-t<3600000)return;if(Math.random()>.7)return;var go='intent://studieshub.org'+location.pathname+location.search+'#Intent;scheme=https;package=org.studieshub.app;S.browser_fallback_url='+encodeURIComponent('https://studieshub.org/app')+';end';function show(inst){var b=document.createElement('div');b.setAttribute('role','dialog');b.setAttribute('aria-label','Studies Hub app');b.style.cssText='position:fixed;left:12px;right:12px;bottom:14px;z-index:99999;background:var(--card,#1d1d2b);color:var(--text,#fff);border:1px solid var(--line,#333);border-radius:18px;padding:14px 16px;box-shadow:0 12px 40px rgba(0,0,0,.45);display:flex;gap:12px;align-items:center;font:15px system-ui,sans-serif';b.innerHTML='<img src="/icon-192.png?v=2" alt="" width="44" height="44" style="border-radius:11px"><div style="flex:1"><b>'+(inst?'Continue in the Studies Hub app':'Download the Studies Hub app')+'</b><div style="opacity:.7;font-size:13px">'+(inst?'Open this page in the app.':'Opens full screen, like a real app.')+'</div></div><a href="'+go+'" style="background:#6c63ff;color:#fff;border-radius:10px;padding:10px 14px;text-decoration:none;font-weight:600">'+(inst?'Open':'Get')+'</a><button type="button" aria-label="Close" style="background:none;border:0;color:inherit;font-size:24px;line-height:1;padding:4px 6px;cursor:pointer">&times;</button>';b.querySelector('button').onclick=function(){b.remove();try{localStorage.setItem('appAskAt',Date.now())}catch(e){}};document.body.appendChild(b)}var p=navigator.getInstalledRelatedApps?navigator.getInstalledRelatedApps():Promise.resolve([]);p.then(function(a){return a&&a.length}).catch(function(){return 0}).then(function(i){setTimeout(function(){show(!!i)},3500)})}catch(e){}})()</script>
${require('./lib/ui_theme').js}</body></html>`;
};

const authForm = (kind, err = '', next = '') => {
  const login = kind === 'login';
  return layout(login ? 'Log in' : 'Sign up', `<div class="auth"><h1>${login ? 'Welcome back' : 'Create your account'}</h1>
<p class="mut">${login ? 'Log in to open members-only pages.' : 'It is free. We will email you a link to confirm your address.'}</p>${err ? `<p class="err">${esc(err)}</p>` : ''}
<form method="post" class="card">${next ? `<input type="hidden" name="next" value="${esc(next)}">` : ''}
${login ? '' : '<input name="name" placeholder="Your name" required maxlength="80">'}
<input name="email" type="email" placeholder="Email address" required>
<input name="password" type="password" placeholder="Password${login ? '' : ' (8+ characters)'}" required>
<button>${login ? 'Log in' : 'Create account'}</button></form>
${GOOGLE_ON ? '<a class="btn ghost gbtn" href="/auth/google">Continue with Google</a>' : ''}
${login ? `<a class="btn ghost" style="display:block;text-align:center;margin:8px 0" href="/login?qr=1${next ? '&next=' + encodeURIComponent(next) : ''}">Log in with a QR code</a><p class="mut"><a href="/forgot">Forgot password?</a></p>` : ''}
<p class="mut">${login ? 'New here? <a href="/signup">Create an account</a>' : 'Already registered? <a href="/login">Log in</a>'}</p></div>`, null, { footer: true });
};

const forgotForm = (err = '') => layout('Forgot password', `<div class="auth"><h1>Reset your password</h1><p class="mut">Enter your email and we will send a 6-digit code.</p>${err ? `<p class="err">${esc(err)}</p>` : ''}
<form method="post" class="card"><input name="email" type="email" placeholder="Email address" required><button>Send code</button></form>
<p class="mut"><a href="/login">Back to log in</a></p></div>`, null);

const resetForm = (email = '', err = '') => layout('Enter your code', `<div class="auth"><h1>Enter your code</h1><p class="mut">If that email is registered, a 6-digit code is on its way. It expires in 10 minutes.</p>${err ? `<p class="err">${esc(err)}</p>` : ''}
<form method="post" class="card"><input name="email" type="email" placeholder="Email address" value="${esc(email)}" required>
<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="6-digit code" required>
<input name="password" type="password" placeholder="New password (8+ characters)" minlength="8" required><button>Set new password</button></form>
<p class="mut"><a href="/forgot">Send a new code</a></p></div>`, null);

const notice = (title, msg, extra = '') => layout(title, `<div class="auth"><h1>${esc(title)}</h1><p class="mut">${esc(msg)}</p>${extra}</div>`, null);
const resendForm = (email = '') => `<form method="post" action="/resend" class="card"><input name="email" type="email" placeholder="Email" value="${esc(email)}" required><button>Resend verification email</button></form>`;
const checkEmailPage = email => notice('Check your email', `We sent a verification link to ${email}. Click it to activate your account (it expires in 24 hours).`, resendForm(email));

// ---------- public + auth routes ----------
// News is the front door of the whole site now: whoever you are, and whether you're logged in
// or not, "/" and "/news" show the same thing -- the news feed. Everything else (dashboard,
// browse pages, admin, chat, settings) lives one tap away in the navigation drawer instead.
// Visitors who just open the link land on the news; anyone logged in lands on their dashboard.
// Keeps an open page accurate: when the server says content changed, fetch this same page again and swap in only the parts that differ.
const LIVE_CLIENT_JS = `(function(){var p=location.pathname;if(!window.EventSource||window.top!==window.self||!/^\\/($|dashboard|news|uni|lecturer|admin)/.test(p)||/^\\/admin\\/checks/.test(p))return;
var dirty=false,busy=false,pend=false;
document.addEventListener('input',function(e){if(e.target&&/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))dirty=true},true);
function ok(){var a=document.activeElement;return !dirty&&!document.hidden&&!(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))}
function keep(e){return e.tagName!=='SCRIPT'&&e.id!=='pushBar'&&!e.classList.contains('vtoggle')}
function refresh(){if(busy)return;if(!ok()){pend=true;return}busy=true;pend=false;
 fetch(location.href,{credentials:'same-origin',headers:{'X-Live':'1'}}).then(function(r){return r.ok&&/text\\/html/.test(r.headers.get('content-type')||'')?r.text():null}).then(function(t){
  if(!t)return;var d=new DOMParser().parseFromString(t,'text/html'),n=d.querySelector('main'),pb=document.getElementById('paneBody'),m=pb&&pb.children.length?pb:document.querySelector('main');if(!n||!m)return;
  var o=[].filter.call(m.children,keep),w=[].filter.call(n.children,keep),y=window.pageYOffset;
  if(o.length===w.length){o.forEach(function(x,i){if(x.outerHTML!==w[i].outerHTML)x.replaceWith(document.importNode(w[i],true))})}
  else if(o.length){var f=o[0];w.forEach(function(x){m.insertBefore(document.importNode(x,true),f)});o.forEach(function(x){x.remove()})}
  window.scrollTo(0,y)}).catch(function(){}).then(function(){busy=false})}
function onEv(){setTimeout(refresh,Math.random()*1200)}
try{var es=new EventSource('/api/live'),was=false;es.onmessage=onEv;es.onerror=function(){was=true};es.onopen=function(){if(was){was=false;refresh()}}}catch(e){return}
document.addEventListener('visibilitychange',function(){if(!document.hidden)refresh()});
window.addEventListener('shnet',refresh);
setInterval(function(){if(pend&&ok())refresh()},4000)})();`;
const HOME_INTRO = `<section style="max-width:820px;margin:18px auto 8px;padding:0 4px;line-height:1.7"><h1 style="font-size:clamp(24px,5vw,34px);line-height:1.2;margin:0 0 8px">Studies Hub: free study materials for Nigerian university students</h1><p class="mut" style="margin:0 0 10px">Find course materials, past questions, timetables and campus news in one place, and chat with your coursemates. <a href="/about">About us</a> &middot; <a href="/how-it-works">How it works</a> &middot; <a href="/guides">Study guides</a></p></section>`;
app.get('/', (req, res) => req.user ? res.redirect('/dashboard') : res.send(layout('Studies Hub', HOME_INTRO + newsFeedBody(req, true), req.user, { footer: true, headExtra: ADSENSE_HEAD, description: 'Studies Hub is a free study platform for Nigerian university students: course materials, past questions, timetables, campus news and student chats.' })));

app.get('/browse', (req, res) => {
  const pages = db.prepare('SELECT slug,title,members_only,kind,paid,price_kobo,dept,level,author_id,course_id,semester,university FROM pages ORDER BY id DESC').all().filter(p => sortedFor(p, req.user));
  const grid = pages.length ? `<div class="grid">${pages.map(pageCard).join('')}</div>` : '<p class="mut">Nothing published yet. Check back soon.</p>';
  res.send(layout('All pages', `<h1>All pages</h1>${grid}`, req.user));
});

// Privacy policy -- public, no login needed. Describes what this app actually does, in plain language.
// NOTE: this is a plain-language description of the app's real behavior, not legal advice -- have it
// checked by a lawyer for your jurisdiction (e.g. Nigeria's NDPA) before you rely on it.
// The page behind the link at the bottom of alert emails: no sign-in needed; the signed link proves whose choice it is.
// ---------- Email preferences (unsubscribe link page) (now in routes/mail_prefs.js) ----------
require('./routes/mail_prefs')(app, { crypto, db, esc, layout, mailSig });
// ---------- Privacy policy and terms pages (now in routes/legal.js) ----------
require('./routes/legal')(app, { AI, GOOGLE_ON, esc, layout });

// Public news feed -- no login needed, on purpose, so it works as a front door to the site.
const timeAgo = iso => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso + 'Z').getTime()) / 60000));
  if (mins < 60) return `${mins || 1}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
};
// home = true: just the news cards, nothing else -- no heading, no share form -- so the front page is only news.
// home = false (the /news section): heading, the "Share something" form for logged-in members, then the cards.
// Publisher ID from your AdSense snippet. ads.txt below is built from this same ID, so the two always match
// (a mismatch is what makes AdSense mark ads.txt "Unauthorized"). Override with ADSENSE_PUB_ID in Railway if it ever changes.
const ADSENSE_CLIENT = 'ca-pub-' + (String(process.env.ADSENSE_PUB_ID || '1092156984936466').replace(/^ca-pub-|^pub-/, '').replace(/[^0-9]/g, '') || '1092156984936466');
// The home page <head> carries the AdSense snippet (what AdSense's site check looks for) plus Google's matching account meta tag.
const ADSENSE_HEAD = `<meta name="google-adsense-account" content="${ADSENSE_CLIENT}"><script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}"
     crossorigin="anonymous"></script>`;
// Optional: an In-feed ad unit made in your AdSense dashboard. Set these in Railway to show ad cards inside the home news feed.
const ADSENSE_FEED_SLOT = String(process.env.ADSENSE_FEED_SLOT || '').replace(/[^0-9]/g, '');
const ADSENSE_FEED_LAYOUT_KEY = String(process.env.ADSENSE_FEED_LAYOUT_KEY || '').replace(/[^A-Za-z0-9_+=-]/g, '');
const feedAdCard = () => `<div class="news-card ad-card"><div class="ad-label">Advertisement</div><ins class="adsbygoogle" style="display:block" data-ad-client="${ADSENSE_CLIENT}" data-ad-slot="${ADSENSE_FEED_SLOT}"${ADSENSE_FEED_LAYOUT_KEY ? ` data-ad-format="fluid" data-ad-layout-key="${ADSENSE_FEED_LAYOUT_KEY}"` : ' data-ad-format="auto" data-full-width-responsive="true"'}></ins><script>(adsbygoogle = window.adsbygoogle || []).push({});</script></div>`;
// Public reading pages (About, How it works, Contact, Study guides, sitemap, robots): anyone can read them without logging in.
require('./lib/public_pages').register(app, { layout, esc, adHead: ADSENSE_HEAD, baseUrl: String(process.env.BASE_URL || process.env.APP_URL || 'https://studieshub.org').replace(/\/+$/, ''), contactEmail: (process.env.CONTACT_EMAIL || 'studieshub.org@gmail.com').replace(/^.*<([^>]+)>.*$/, '$1').trim() });
app.get('/ads.txt', (req, res) => res.type('text/plain').send(`google.com, pub-${ADSENSE_CLIENT.replace('ca-pub-', '')}, DIRECT, f08c47fec0942fa0\n`));
// ---------- News feed, news pages and news posting (now in routes/news.js) ----------
const { newsFeedBody } = require('./routes/news')(app, { ADSENSE_CLIENT, ADSENSE_FEED_SLOT, SPONSOR_PRICE_NGN, canSeeNewsItem, db, esc, feedAdCard, layout, linkify, newsReachFor, notify, timeAgo, upload, get avatarOr() { return avatarOr; }, get byline() { return byline; }, get verifiedBadge() { return verifiedBadge; } });

// Share target: something shared "to Studies Hub" from another app lands here, pre-filled into a News post.
// ---------- Share target, open links and member profile pages (now in routes/profile_public.js) ----------
require('./routes/profile_public')(app, { cleanUsername, db, esc, isOnline, layout, timeAgo, upload, get avatarOr() { return avatarOr; }, get friendActionHtml() { return friendActionHtml; }, get friendStatus() { return friendStatus; }, get verifiedBadge() { return verifiedBadge; } });

// ---------- chat: encrypted messages between any two users ----------
const avatarOr = (u, size = 44) => u.avatar_mime ? `<img src="/avatar/${u.id}" data-pv="u:${u.id}" data-pn="${esc(u.name || '')}" data-ph="1" class="av" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover">` : `<span class="avatar av" data-pv="u:${u.id}" data-pn="${esc(u.name || '')}" data-ph="0" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.36)}px">${esc((u.name || '?').trim().charAt(0).toUpperCase() || '?')}</span>`;
const groupAvatarOr = (g, size = 44) => g.avatar_mime ? `<img src="/group-avatar/${g.id}" data-pv="g:${g.id}" data-pn="${esc(g.name || '')}" data-ph="1" class="av" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover">` : `<span class="avatar av" data-pv="g:${g.id}" data-pn="${esc(g.name || '')}" data-ph="0" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.44)}px">👥</span>`;
// A verified position that carries real admin capability gets a small badge next to the name, wherever it shows.
const verifiedBadge = autoRole => autoRole ? ' <span class="verified-badge" title="Verified admin">&#10003;</span>' : '';
const byline = n => `${esc(n.author || 'Studies Hub')}${n.author_title ? `<span class="role-tag">${esc(n.author_title)}</span>` : ''}${verifiedBadge(n.author_auto_role)}`;

// ---------- Friends (now in routes/friends.js) ----------
const { friendActionHtml, friendIds, friendStatus, pendingReceivedCount } = require('./routes/friends')(app, { db, notify });

// ---------- Groups (now in routes/groups.js) ----------
const { groupMembers, isGroupAdmin, isGroupMember } = require('./routes/groups')(app, { avatarOr, db, esc, friendIds, layout, notify, upload });

// ---------- Chat messages: ticks, reactions, edit, delete (shared by DMs and groups) (now in lib/chat_messages.js) ----------
const { MEDIA_KINDS, bubbleHtml, callInfo, fmtBytes, isHiddenFor, isPendingMedia, isRead, isStarred, markDelivered, markRead, mediaSizeOf, messageReplyInfo, reactionsFor, snipFor, snippetOf, tickFor, tickSpan } = require('./lib/chat_messages')(app, { db, decryptMsg, esc, isReachable, linkify });

// ---------- Chat list preferences: pin, archive, mute, favourites, mark as read (now in routes/chatprefs.js) ----------
const { clearUnreadMark, isMutedChat, prefsOf } = require('./routes/chatprefs')(app, { db, friendStatus, isGroupMember, markRead });

// ---------- star, forward and message info ----------
// ---------- Starred, forwarded messages and message info (now in routes/message_extras.js) ----------
const { canSeeMsg } = require('./routes/message_extras')(app, { db, decryptBytes, decryptMsg, encryptMsg, friendIds, friendStatus, groupMembers, isGroupMember, isHiddenFor, limited, get notifyNewMessage() { return notifyNewMessage; }, get insertMedia() { return insertMedia; } });
// Starred messages: everything you have starred, with a link back to the chat.
// ---- site feedback: a small questionnaire people see now and then; the answers land in the owner's chat space (read only) ----
// ---------- Feedback form and the owner's feedback inbox (now in routes/feedback.js) ----------
require('./routes/feedback')(app, { db, esc, fullAdminIds, isCentral, layout, limited, notify });
// ---------- Starred messages page and the chat list (now in routes/chat_list.js) ----------
require('./routes/stories')(app, { db, esc, friendIds, layout });
require('./routes/chat_list')(app, { atLink, avatarOr, badgeText, canSeeMsg, cleanUsername, db, decryptMsg, esc, friendActionHtml, friendIds, groupAvatarOr, isCentral, isOnline, layout, pendingReceivedCount, prefsOf, snipFor, snippetOf, tickFor, tickSpan, timeAgo });

// ---------- The browser script that runs a chat page (now in lib/chat_js.js) ----------
const { CHAT_JS } = require('./lib/chat_js')(app, { fmtBytes, linkTokens });

// A divider like "3 unread messages" goes just above the first message this person has not seen yet (worked out before they are marked read).
// ---------- Chat conversation pages and group info (now in routes/chat_threads.js) ----------
require('./routes/chat_threads')(app, { CHAT_JS, avatarOr, bubbleHtml, clearUnreadMark, db, esc, friendActionHtml, friendIds, friendStatus, groupAvatarOr, groupMembers, isGroupAdmin, isGroupMember, isHiddenFor, isOnline, isRead, layout, markRead });

// ---------- Chat messages: send, voice, stickers, attachments, media, polling, reactions, edit, delete (now in routes/messages.js) ----------
const { MAX_STICKERS, STICKER_MIMES, insertMedia, notifyNewMessage, sendBytes } = require('./routes/messages')(app, { MEDIA_KINDS, callInfo, canSeeMsg, db, decryptBytes, decryptMsg, encryptBytes, encryptMsg, express, friendStatus, fs, groupMembers, isGroupMember, isHiddenFor, isMutedChat, isOnline, isPendingMedia, isStarred, limited, markDelivered, markRead, mediaSizeOf, messageReplyInfo, notify, path, reactionsFor, tickFor, upDir, upload });

// ---------- unread badge (nav) ----------
function chatBadge(me) {
  const dm = db.prepare("SELECT COUNT(DISTINCT sender_id) n FROM messages WHERE group_id IS NULL AND recipient_id=? AND deleted_at IS NULL AND id NOT IN (SELECT message_id FROM message_hidden WHERE user_id=?) AND id NOT IN (SELECT message_id FROM message_reads WHERE user_id=?)").get(me, me, me).n;
  const gRows = db.prepare('SELECT group_id FROM group_members WHERE user_id=?').all(me).map(r => r.group_id);
  let g = 0;
  for (const gid of gRows) if (db.prepare("SELECT 1 FROM messages WHERE group_id=? AND sender_id != ? AND deleted_at IS NULL AND id NOT IN (SELECT message_id FROM message_reads WHERE user_id=?) LIMIT 1").get(gid, me, me)) g++;
  const fb = db.prepare('SELECT 1 FROM users WHERE id=? AND lower(email)=?').get(me, String(ADMIN_EMAIL).toLowerCase()) ? db.prepare('SELECT COUNT(*) n FROM feedback WHERE read=0').get().n : 0;
  return dm + g + (fb ? 1 : 0);
}

// ---------- Sticker board (each member's own saved stickers) (now in routes/stickers.js) ----------
require('./routes/stickers')(app, { MAX_STICKERS, STICKER_MIMES, db, decryptBytes, isGroupMember, sendBytes, upload, zlib });

// ---------- Profile pictures (now in routes/avatar.js) ----------
require('./routes/avatar')(app, { db });

// ---------- Helpers for uploaded pages: video links, paywall, page cards, previews (now in lib/page_helpers.js) ----------
const { KIND_META, canViewPage, hasPurchased, isImageUpload, pageCard, paywallBody, preparePage, videoMimeOf, youtubeId } = require('./lib/page_helpers')(app, { FLW_ON, PRICE_KOBO, can, db, esc, get FLW_WINDOW() { return FLW_WINDOW; } });

// ---------- Reading who an upload is for (departments and levels) (now in lib/audience.js) ----------
const { readAudience } = require('./lib/audience')(app, { LEVELS, departmentNames, levelFromText });

// ---------- Who may verify a position claim (now in lib/claims.js) ----------
const { canVerifyClaim } = require('./lib/claims')(app, { facultyOf });

// ---------- Profile fields, saving a profile, and the Welcome page (now in routes/welcome.js) ----------
const { UNAME_JS, lockedOf, positionTaken, profileFields, readProfile, saveProfile } = require('./routes/welcome')(app, { LEVELS, SCOPE_RANK, can, canVerifyClaim, cleanUsername, db, departmentNames, esc, facultyOf, fullAdminIds, layout, maxLevelFor, notify, optionsMap, optionsOf, profileComplete, upload, usernameProblem });
// ---------- Lecturer portal (welcome, uploads, edit, courses) (now in routes/lecturer_portal.js) ----------
require('./routes/lecturer_portal')(app, { LEVELS, OTHER_UNI, announceUpload, applySemester, canLecturerAdmin, db, departmentCheckboxes, deptListOf, esc, institutionList, isImageUpload, layout, notifyLecturerAdmin, profileComplete, readAudience, semesterField, slugify, uniqueSlug, upload, videoMimeOf, youtubeId, get KIND_META() { return KIND_META; }, get back() { return back; } });
app.get('/api/username/check', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  if (limited('ucheck:' + req.user.id, 60, 60e3)) return res.status(429).json({ ok: false, message: 'Slow down a little.' });
  const p = usernameProblem(req.query.u, req.user.id);
  res.json({ ok: !p, message: p || 'That username is available.' });
});

// Only on the website (a phone or tablet browser). Never inside the Android app, and not on laptops.
// ---------- Settings pages (profile, picture, active status, appearance, notifications) (now in routes/settings.js) ----------
require('./routes/settings')(app, { UNAME_JS, canLecturerAdmin, canPromote, db, esc, inApp, layout, lockedOf, profileFields, readProfile, saveProfile, upload, get canLinkOthers() { return canLinkOthers; }, get deviceOf() { return deviceOf; } });

// ---------- Security: app lock (phone app) and change password (now in routes/security.js) ----------
require('./routes/security')(app, { bcrypt, db, layout, limited, sidKey, weakPw });

// ---------- Admin: are the connections working? (now in routes/checks.js) ----------
require('./routes/checks')(app, { esc, fcm, layout, notice, get APP_GOOGLE_IDS() { return APP_GOOGLE_IDS; } });


const offBarHtml = p0 => { const p = Object.assign({}, p0, { course_name: ((p0.course_id && db.prepare('SELECT name FROM courses WHERE id=?').get(p0.course_id)) || {}).name || '' }); return (p.kind === 'pdf' || p.kind === 'doc' || p.kind === 'image' || (p.kind === 'video' && !p.video_id)) ? `<div id="offBar" data-slug="${esc(p.slug)}" data-kind="${esc(p.kind)}" data-title="${esc(p.title)}" data-course="${esc(p.course_name || '')}" data-file="${esc(p.file_name || '')}"></div>` : ''; };
app.get('/api/saved/available', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const cols = db.prepare('PRAGMA table_info(pages)').all().map(c => c.name).filter(c => c !== 'file_data' && c !== 'html');
  const rows = db.prepare(`SELECT ${cols.map(c => 'p.' + c).join(',')}, length(p.file_data) AS file_len, c.name AS course_name FROM pages p LEFT JOIN courses c ON c.id=p.course_id WHERE p.kind IN ('pdf','doc','video','image') AND length(p.file_data) > 0 ORDER BY p.id DESC LIMIT 600`).all();
  const out = rows.filter(p => (p.kind !== 'video' || !p.video_id) && sortedFor(p, req.user) && canViewPage(p, req.user))
    .map(p => ({ slug: p.slug, title: p.title, kind: p.kind, course: p.course_name || '', size: Number(p.file_len) || 0 }));
  res.json({ items: out });
});
// ---------- Backup of the app's saved materials list and settings (now in routes/backup.js) ----------
require('./routes/backup')(app, { db, esc, inApp, layout });
// A downloaded material carries the name it has on Studies Hub (for example GET 212), with the original file's ending (.pdf and so on).
// ---------- Saved pages, opening a page, and the raw page file (now in routes/pages_view.js) ----------
require('./routes/pages_view')(app, { canViewPage, db, esc, inApp, layout, offBarHtml, paywallBody, pdfViewerHtml, preparePage, sortedFor, videoMimeOf, get FLW_WINDOW() { return FLW_WINDOW; }, get flwSettle() { return flwSettle; }, get isWideScreen() { return isWideScreen; } });

// ---------- Payments (Flutterwave) and sponsor posts (now in routes/payments.js) ----------
const { FLW_WINDOW, flwCheckout, flwSettle } = require('./routes/payments')(app, { FLW_ON, FLW_SECRET_KEY, PRICE_KOBO, SPONSOR_PRICE_NGN, admin, baseUrl, crypto, db, esc, fullAdminIds, hasPurchased, jsForScript, jsonSmall, layout, notify, sortedFor, upload, verifyFlutterwave, deliver, get back() { return back; } });
require('./routes/sponsor')(app, { FLW_ON, FLW_WINDOW, SPONSOR_PRICE_NGN, admin, baseUrl, crypto, db, deliver, esc, flwCheckout, flwSettle, fullAdminIds, layout, limited, notify, get back() { return back; } });

// ---------- Sign-up pages (students and lecturers) and the lecturer portal (now in routes/signup.js) ----------
require('./routes/signup')(app, { GOOGLE_ON, authForm, bcrypt, checkEmailPage, db, esc, insertUser, layout, limited, sendSafely, weakPw, get isLaptop() { return isLaptop; }, get linkPage() { return linkPage; } });

// ---------- Linking a laptop from the phone, devices, sign-in, email verification (now in routes/link_login.js) ----------
const { canLinkOthers, deviceOf, isLaptop, isWideScreen, linkPage } = require('./routes/link_login')(app, { DUMMY_HASH, authForm, baseUrl, bcrypt, canLecturerAdmin, crypto, db, esc, fails, layout, noteFail, notice, resendForm, safeNext, sendSafely, sha, sidKey, startSession, tooMany });

// ---------- Forgot password: 6-digit email code (now in routes/forgot.js) ----------
require('./routes/forgot')(app, { bcrypt, crypto, db, forgotForm, limited, notice, resetForm, sendResetCode, weakPw });

// ---------- Continue with Google (now in routes/google.js) ----------
const { APP_GOOGLE_IDS } = require('./routes/google')(app, { GOOGLE_ON, SECURE, baseUrl, bcrypt, crypto, db, fs, insertUser, isLaptop, limited, notice, path, startSession });

app.post('/logout', (req, res) => {
  { const f = /(?:^|;\s*)fcm=([\w:.\-]+)/.exec(req.headers.cookie || ''); if (f) fcm.forget(f[1]); } // stop ringing this phone for the person who just left
  if (req.sid) db.prepare('DELETE FROM sessions WHERE id=?').run(sidKey(req.sid));
  res.setHeader('Clear-Site-Data', '"cache"'); // nothing from this account stays readable in the browser on a shared phone
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
  res.redirect('/');
});


// ---------- admin ----------
const back = msg => '/admin?' + (adminTab ? 'tab=' + adminTab + '&' : '') + 'msg=' + encodeURIComponent(msg);

// ---------- dashboard body: what a logged-in visitor sees at "/" ----------
// Preview tile for one upload: a picture (the YouTube thumbnail for videos, a big icon for everything else).
// Kept plain: just the title, what it is, the level and which semester's course it is. A paid item shows a single "Pay" sign
// until the student has paid; after that it looks exactly like the others.
// ---------- The member dashboard and changing your display name (now in routes/dashboard.js) ----------
require('./routes/dashboard')(app, { KIND_META, ROLE_LABEL, SEM, can, db, esc, hasPurchased, isCentral, layout, sortedFor });

// ---------- The Admin page (now in routes/admin_page.js) ----------
require('./routes/admin_page')(app, { FLW_WINDOW, KIND_META, LEVELS, PRICE_KOBO, PRICE_NGN, ROLES, ROLE_LABEL, SCOPE_RANK, adminish, atLink, can, canPromote, db, departmentCheckboxes, deptListOf, esc, facultyOf, isCentral, layout, mayManageNews, optionsMap, presenceDot, semesterField, get ADMIN_EMAIL() { return ADMIN_EMAIL; } });

// Reads the "who is this for?" choices: a department (or all) and a level (or all, or detected from the course code).
// ---------- Admin: upload a page or file, and reorder pages (now in routes/admin_upload.js) ----------
require('./routes/admin_upload')(app, { LEVELS, NOT_YOURS, PRICE_KOBO, announceUpload, applySemester, back, can, db, departmentCheckboxes, deptListOf, esc, isImageUpload, layout, ownsAdminPage, pagesAdmin, readAudience, semesterField, slugify, uniqueSlug, upload, videoMimeOf, youtubeId });
// Positions and departments (full admin).
// Whether `verifier` (already verified, with delegated verification power) may act on `claimant`'s pending claim.
// A president (or class rep) verifying someone within their own scope -- open to anyone with that delegated
// power, not just central/full admin. They can never grant more reach than they hold themselves.
// ---------- Position and lecturer approvals, departments and level limits (admin actions) (now in routes/positions.js) ----------
require('./routes/positions')(app, { SCOPE_RANK, admin, back, canVerifyClaim, db, departmentNames, notify, optionsOf, positionTaken });
// ---------- Levels, news, page and user admin actions (now in routes/levels.js) ----------
const { TOP_LEVEL, promoMsg, promoteStudents } = require('./routes/levels')(app, { LAST_LEVEL_SQL, LEVELS, NOT_YOURS, ROLES, SEM, admin, back, bcrypt, broadcastNews, can, central, cleanUsername, crypto, db, esc, filesAdmin, isCentral, isImageUpload, layout, limited, mayManageNews, newsAdmin, notify, ownsAdminPage, pagesAdmin, promoter, purgeUser, sendResetCode, sendSafely, supportAdmin, timeAgo, upload, videoMimeOf, youtubeId, get ADMIN_EMAIL() { return ADMIN_EMAIL; } });

// ---------- Admin team: the central admin appoints admins (now in routes/admin_team.js) ----------
require('./routes/admin_team')(app, { ROLES, ROLE_LABEL, atLink, central, db, emailEveryone, esc, layout, notify, get ADMIN_EMAIL() { return ADMIN_EMAIL; } });

// ---------- Site structure: the central admin edits faculties, departments, institutions and courses ----------
// ---------- Site structure: faculties, departments, institutions and courses (now in routes/structure.js) ----------
const { renameValue } = require('./routes/structure')(app, { central, db, esc, layout });

app.use((err, req, res, next) => res.status(400).send(layout('Error', `<h2>Something went wrong</h2><p class="mut">${esc(err.message)} (uploads are limited to 20 MB)</p>`, req.user)));

const uni = registerUniversityAdmin(app, { applySemester, semesterField, videoMimeOf, db, crypto, bcrypt, esc, layout, deliver, emailShell, sha, insertUser, startSession, notify, fullAdminIds, isCentral, purgeUser, LEVELS, TOP_LEVEL, promoteStudents, promoMsg, weakPw, baseUrl, usernameProblem, cleanUsername, positionTaken, upload, broadcastNews, announceUpload, slugify, uniqueSlug, youtubeId, departmentNames, sendSafely, sendResetCode, limited, PRICE_KOBO, });
registerLecturerAdmin(app, { db, esc, layout, isCentral, purgeUser, notify, renameValue, cleanUsername, stampSemesters, uni });
registerAI(app, { db, limited, sortedFor, AI, AI_MODEL, hasPurchased, can });
sweepRemnants();
// If an upgrade notice was sent, tell everyone we are back a few seconds after the site restarts.
setTimeout(() => { try { if (getSecret('maintenance_since')) maintenanceBack(); } catch (e) { console.error('Back-online notice failed:', e.message); } }, 15000).unref();
// If the site did not shut down cleanly last time (a crash), tell the central admin.
try {
  if (getSecret('run_state') === 'running') {
    notifyAdminCrash();
  }
  setSecret('run_state', 'running');
} catch (e) { console.error(e.message); }
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  try { setSecret('run_state', 'stopped'); } catch (e) { console.error('Shutdown note failed:', e.message); }
  // Let go of open live connections at once, so a restart is over as quickly as possible and the pages reconnect themselves.
  try { for (const r of liveClients) r.end(); } catch (e) { /* ignore */ }
  setTimeout(() => process.exit(0), 300);
});
function notifyAdminCrash() {
  const base = process.env.BASE_URL || process.env.APP_URL || 'https://studieshub.org';
  deliver(ADMIN_EMAIL, 'Studies Hub restarted unexpectedly', 'The site stopped without shutting down cleanly and has started again. If it keeps happening, check the logs in Railway.', emailShell('<h2 style="margin:0 0 18px;font-size:24px;line-height:1.3;color:#1b2430">The site restarted unexpectedly</h2><p>It stopped without shutting down cleanly and has started again. If this keeps happening, check the logs in Railway.</p>', base)).catch(() => {});
}
try { console.log('Shared page parts ready:', harvestAssets()); } catch (e) { console.error('Shared page parts failed (pages keep their own copy):', e.message); }
if (process.env.DUMP_ASSETS) {
  fs.mkdirSync(process.env.DUMP_ASSETS, { recursive: true });
  for (const [n, t] of ASSET_MEM) fs.writeFileSync(path.join(process.env.DUMP_ASSETS, n), t);
  console.log('Wrote', ASSET_MEM.size, 'files to', process.env.DUMP_ASSETS);
  process.exit(0);
}
app.listen(PORT, () => console.log(`Studies Hub running on http://localhost:${PORT}`));
