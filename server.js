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
db.exec('PRAGMA journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', created_at TEXT DEFAULT CURRENT_TIMESTAMP, verified INTEGER NOT NULL DEFAULT 0, verify_hash TEXT, verify_expires INTEGER, verify_sent INTEGER);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS pages(id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, html TEXT NOT NULL, members_only INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS purchases(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, page_id INTEGER NOT NULL, reference TEXT UNIQUE NOT NULL, amount INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, page_id));
CREATE TABLE IF NOT EXISTS courses(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS lecturer_courses(lecturer_id INTEGER NOT NULL, course_id INTEGER NOT NULL, PRIMARY KEY(lecturer_id, course_id));
`);
// Upgrade older databases that predate email verification
const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
for (const [c, def] of [['can_promote', 'INTEGER NOT NULL DEFAULT 0'], ['verified', 'INTEGER NOT NULL DEFAULT 0'], ['verify_hash', 'TEXT'], ['verify_expires', 'INTEGER'], ['verify_sent', 'INTEGER'], ['reset_hash', 'TEXT'], ['reset_expires', 'INTEGER'], ['reset_attempts', 'INTEGER NOT NULL DEFAULT 0'], ['last_seen', 'INTEGER'], ['avatar_data', 'BLOB'], ['avatar_mime', 'TEXT'], ['department', 'TEXT'], ['university', 'TEXT'], ['course', 'TEXT'], ['title', 'TEXT'], ['can_set_title', 'INTEGER NOT NULL DEFAULT 0'], ['username', 'TEXT'], ['level', 'INTEGER'], ['position', 'TEXT'], ['position_status', 'TEXT'],
  // A verified position can carry real reach and capability: how far their news posts travel (their own
  // department+level, their whole faculty, or the whole school), what admin capability it grants automatically,
  // and -- for positions that need a specific person's sign-off rather than the general news queue -- who that is.
  ['position_scope', 'TEXT'], ['position_auto_role', 'TEXT'], ['position_approver_id', 'INTEGER'], ['position_can_verify', 'INTEGER NOT NULL DEFAULT 0'],
  // Lecturers are a separate account type entirely -- their own signup link, their own verification
  // (by a full admin, shown which institution they claimed), their own interface. is_lecturer marks the
  // account type; lecturer_status tracks pending/approved/rejected; lecturer_reg_no is optional.
  ['is_lecturer', 'INTEGER NOT NULL DEFAULT 0'], ['lecturer_status', 'TEXT'], ['lecturer_reg_no', 'TEXT'],
  ['theme', 'TEXT'], ['hide_active', 'INTEGER NOT NULL DEFAULT 0'], ['email_notify', 'INTEGER NOT NULL DEFAULT 1']])
  if (!userCols.includes(c)) db.exec(`ALTER TABLE users ADD COLUMN ${c} ${def}`);
// Upgrade older databases that predate paid/media pages
const pageCols = db.prepare('PRAGMA table_info(pages)').all().map(c => c.name);
for (const [c, def] of [['kind', "TEXT NOT NULL DEFAULT 'html'"], ['paid', 'INTEGER NOT NULL DEFAULT 0'], ['price_kobo', 'INTEGER'], ['file_data', 'BLOB'], ['file_mime', 'TEXT'], ['file_name', 'TEXT'], ['admin_id', 'INTEGER'], ['video_id', 'TEXT'], ['dept', 'TEXT'], ['level', 'INTEGER'], ['author_id', 'INTEGER'], ['course_id', 'INTEGER']])
  if (!pageCols.includes(c)) db.exec(`ALTER TABLE pages ADD COLUMN ${c} ${def}`);
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
for (const [c, def] of [['scope_type', 'TEXT'], ['scope_department', 'TEXT'], ['scope_level', 'INTEGER'], ['scope_faculty', 'TEXT'], ['approver_id', 'INTEGER'], ['approver_status', 'TEXT']])
  if (!newsCols.includes(c)) db.exec(`ALTER TABLE news ADD COLUMN ${c} ${def}`);
// Paid promotional posts from businesses/services -- shown in News, separately from regular submissions.
db.exec(`CREATE TABLE IF NOT EXISTS sponsor_posts(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, contact TEXT, image_data BLOB, image_mime TEXT, reference TEXT UNIQUE NOT NULL, amount_kobo INTEGER NOT NULL, duration_days INTEGER NOT NULL DEFAULT 30, status TEXT NOT NULL DEFAULT 'pending_payment', created_at TEXT DEFAULT CURRENT_TIMESTAMP, expires_at TEXT)`);
const sponsorCols = db.prepare('PRAGMA table_info(sponsor_posts)').all().map(c => c.name);
if (!sponsorCols.includes('duration_days')) db.exec("ALTER TABLE sponsor_posts ADD COLUMN duration_days INTEGER NOT NULL DEFAULT 30");
// ---- usernames, departments, friends, groups, receipts, reactions, push subscriptions ----
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users(lower(username))');
db.exec(`
CREATE TABLE IF NOT EXISTS level_log(id INTEGER PRIMARY KEY, by_user INTEGER NOT NULL, department TEXT, from_level INTEGER, moved INTEGER NOT NULL, at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS departments(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, faculty TEXT NOT NULL DEFAULT 'Other');
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
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'donryscott28@gmail.com').toLowerCase();
const existingAdmin = db.prepare("SELECT id,email FROM users WHERE role='admin'").get();
if (!existingAdmin) {
  const generated = !process.env.ADMIN_PASSWORD;
  const pass = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  db.prepare('INSERT INTO users(name,email,hash,role,verified) VALUES(?,?,?,?,1)').run('Admin', ADMIN_EMAIL, bcrypt.hashSync(pass, 12), 'admin');
  console.log(`Admin account created: ${ADMIN_EMAIL}` + (generated ? `  password: ${pass}  (set ADMIN_PASSWORD to choose your own)` : ''));
} else {
  if (existingAdmin.email !== ADMIN_EMAIL) {
    db.prepare('UPDATE users SET email=? WHERE id=?').run(ADMIN_EMAIL, existingAdmin.id);
    console.log(`Admin email updated to ${ADMIN_EMAIL}`);
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
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(self), usb=(), serial=()');
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
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '20kb' }));

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
const FLW_PUBLIC_KEY = process.env.FLUTTERWAVE_PUBLIC_KEY || '';
const FLW_SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY || '';
const FLW_ON = !!(FLW_PUBLIC_KEY && FLW_SECRET_KEY);
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

// ---------- brand assets (the Studies logo, embedded so the whole site stays one file) ----------
const LOGO_PNG = Buffer.from('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', 'base64');
const ICON_192 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAMAAABlApw1AAABgFBMVEX//Lr976j65Jjx4pz02ojx0nXo1IzizILiw43fw2vctYDXtFnMvIDOs1zQsFPHr2rQqIvJn7TQp2fMoGjNrUvJqkrGp0nGoku2pne0m4DBpE66nk++oEa6nka2mkXAlL68jLq2kn2yjmK9kU2vlEeqkkinjUO4h7azgLKvgpqrhFKuea2oeJ+qcqimcp+ejVaah1KehEqVgk+WfXOVfFCUfT6Qej2fcp6fbZ6XcnORdEV/cV+CcEmJdTuBbjqeZ52YZZiTZpKNZ3J7ZWN6ZkF4Zzd1YjaQXJGFXH90XF1vXjeCVINxVGZ2TndySHNoXkNlVzlhU0hhUzNkS2RgTjZVSzxXSy9kRWdjP2dYREtYPVpPRDNJQjRMPUBEPTBZOF1MOE1COTRANyhMMlFBMUJFLUtBKUc7NC03MC43LjEzLSY4Kj8zKi02Jj0zIzouKigsJykrJSkpJCorITQnISkjICUiHyEnHDAjHCsgGyYdGyIcGiEcGSEbFyUdEigSEhyV7IqcAAAXAklEQVR42u2diV9h3f/AqXkiY1psabKFUJJMRJN1piKyRGGoiNBDqMfYKt/zr//OobTdyyVp5vXrvGamGnI/73M++7kLCfzlg/QB8AHwAfAB8AHwAfAB8AHwAfAB8AHwAfBGo3x+dOhzbpnR2HL6oifFyt8CUIxurc59GR//58kYH//yVW30nlb+aICbU696koKknfwyNydd0MAhW5BK575++XwHRBcbo+U/E6DoFdPHPn2ijE9Ofv0Cx+fPnyfg+PLl69c5tXp1VS2emxz/5xMcFLG3+KcBnBu5FChaW1/GvyDBJyY+3888XJRJsVr7TTxJaTJw96//HID/vNyxkREk1/gk1PNoIntVuUEv3Fausomgz4hsAs39P5RJsdb4jUsZGRkhb/4pAEdqKP0ImlTjIa5mVDI+7dydAnE3vUb6JzK3+EcA7HNHySMjY/Rvh91Nsxw1QgWCtGPq8tEqZYR7+O4AXjqZTB6lG08J/8aFt6lAcPbL8Jfp3ncFOKKTSWTK6lGPv3YJTYaiPUcfwCWPed8N4N9ZKD7d25dTz6yOjXAR+CmXTN1/H4BNKP5rlNhLJdMPmwgk+tHwAfapJPLs6es+4xDawFHzK2n293AByrMk0mvFbyGQuMgWdslk7zAB9kdJ9OPBeGHvGHkNhuTfsyTuf8MCKK+RRncHF8Y3yaP7zUkh778VQDzyZNmppNn/wADHBZc0C11ZmUtaexuApFKRevhprQ917aqS5FHkjzZJ9P/eBMCqyrWTTi6JegoGPn63Zv9odPR00AC5AACx6oP6kLll8BYDzv4lBKETNwRiAAXhtKNaAo7l5hpsjpLXwBuN09FRFBPmybsDBYgIFe5cI6yQO5D6j45ugjcbZW7TuDaJ1gnEABpueykNIiqVG1xzR8Z2wVuONdJmDwQEbaBRA4VqMuRplLmfxrzgbcdmU0N3RzYHCFDNgXSqhsxr7M3lh3G5SeAd2R0cQC1fDdVtjkvuMORH8RgRbI7sDwggECmdRepJlZ5OoWyCYYzDFsGn44EAxEWigPsM5EJTFIoWDGfsNy1ATD0fBEBKZQ25QammplDEYFjDO4J0lUu/GYQKedLpHChpxyZptqEBwHAJE6MrmnoQAA2QAqlNCo02vTw8AKCmXsC8qJvT6AaQayAnWjgr7NJotK14bogAgMu9BcCIMPoGqNoU9joA9XTsbJI2rgbDHUWqtonxCoCk0iqHk14NxdQUxuTvIQPArBeawTltq3+AgtWC0rd62Dg+OX4Ihj60NJhcb9HO+7eBXBiGAXdpj8ZkrA5ffnA7ifw2V9wnwNkZTCFARCTUixliRvEdAMAp6ted0g77AghMT0dqKeBQKlemVhle8C5DS4OWp2be9gOgEIpspRRwqwyWjYUOH/Gmo0KDnuiC5u0DoKGUr3jqKZCz2zeMjEPwTmOfloHrwLzuYwXidlsBpEHyF9O4JAbvNpAJX+IvQScjrhdAo5RLfWf63m8BAIjSYJVvZN7040YLNZCMZRb14iUiR7qpvI2diMXICvb7AaimQCi3q1z87Osa9f2mBd4MX5d9A4AjtASr4r4CWaQRS4jt4rnOSXnFL2Ozpes7TrNg5i0IxGpEcdI7QA3E40kz8xdjKx/Af1d2m8eS+VqCV/jrb5ESIUck1vYKUNIr3Tn32dzmwcSpTWTH0x0zm2NKtH80S9/CCphQeC+j3CNARK5URRxOxi/NUsqqEJ5hKs82h7P9OMdYF7wFwBazDK4Yvh4BciqDK+2WiY9ntko2oaiE8RY/n2V+miKdRO+/05nxBbqUmnsrDJDwanGvNhCyJGu7M5tbM1cgF8hjKL+GpcvgGjZnG/+T11myHqtLKPwB45I4QC0E02gYhatrTMfSUgPzPX4OP4h/yBNWAv81Dk/XoxkzLsBvbB3CBnAo5CGYDTUKTO2pZB7LgMs61nqnLYJtHv5pNDqBoDcVAmUmTCWWVokDWC2qPZRLnM3/OpgRGV6+ISHg+DseUoY/x1mOqdPaYWfVUIe8zAphgIjdVQMBW3x/Mf1dEqi+eD3IlnaOWGWOE/e1Hf7OTK/V0QGspzKMI+JGnMvBSky0onXcYjmMnQldl5P2jjqYgHR9vUcbBi0nytwiClACtTRwK5V68V525uVqmye2ux1wm4dLmGD7BM7e0wltS4+IANSWhY5GEkRUhg2xJ/gyuzFPdD9+BxPYFvjYmT5i2S22EWAARKaFinyqAdyuJWnsu+T2hf5gyV8uXxWz2WwikTg5iUaDPJ3f6dzZ2d42m80mk2m9NUwms3lHoNP1rEFQJxkZcMrIEALYEypXcoUSiAGNrrb0fCr9EzsYn29mzXDYcLDYzcHh89DgCwRSqXRhYUF2P6RSPo/P7l2DoCP1gd9MHyGAks3gArVSPgUkfiB5Jm6ChZlvJpz+YDAYPTlJJDLZbNHMy1YqN5hJuJNn4vSuQdAIvsO/RoJGnC/Av7Haz5mfvyUHT19aEBA5z7ODkuhk631oEADfoQVrl4i60VIBJCO1DYntWPLUHfpZJwQOds3DdVOwYuA7+wHwwYx0i0k4DiRBKg60knBw5sku1a2AUBKTYEVxjXFGx+urajuBFnzAvCIcyFKpM/B9CfglcteTFI3IAsA8DzdN2uEJdP3IDy6ZB00Ioul0JFQAMhPYljwpZXZ4hM507qDlGh4n2BcAisMXjCgxALfefeaoA4mzoRMLRYWHF0zEKkb8ZLMs4EmfzQHRk79hLC5j+FEsgJxcqYjZGhWJt6TTPClltvlEDpVl407yCY/zzC87+SaCCekSZjaEBVBVGay5UCM7cwBk28/KlCiBQwXZuGbq5PBhIprIPoqAAj6xqzmMYsxAgKlCERjJkv9LSI4Dz+MYIRdixq/sdSyoXcHPbTsOspyP0qbEjmkbN4v1Mm+weivYRlxIgWTtQPJDJHmmdGUpx9l1wrAzuazTWQZSDpyAE/P9LFR4Jl878b4xsXgyjga3JGD+BktEAUAdnBW2JA6l5HndVYFHMXcpZmawilcnm8eWJdimZ1m3k739sDr+CqjgTs8hswhWlwi70VIhtiW5OpO8LBwTphmWJnjdKYxhqMH2hLlyxNFwnrxUEUg5uocgH+2Sj55j5RJ4ANWqZwN6cwlW5Vv2y1iCbbxlKOqQVVaeQgRRDp7l8aQowXNm2wGPo7t9KNSeOaxnueAp47QXAJCLbchubyU4femEicPWYZ5sHuSz0KSa+E+1qjnRsuZ8ZyaCbaVZb8sfZQWflR3Pom6GcdITQC2mRSuAm3hdOqUsmf95xnxtZun40NFcNd194l6/1zmoik/wm//r51zetyceJr0o4DzJUg5elB2opu8FAJS00lsg7ZQ5RjUswVOEzALLX0S5gp8NhbwSsLJ3zrIZmmWtNOI+nN/IHsULGW/G/yTgvCg7ziHAElGAJMp//BLwPJC90CQdS/Bo5f1sQaIVxppC6jiCZvvkUtC0XR/H1Iwi917WxF64fohnJzLN49aR7MVuD1Ihom7UrZBHkOO9AJpuLTSIoLtr8lTWJ0yVuzCm06GoK11oqTpbBtcpy9p28tB68VuTss3mP3igCR/0QtmHjEnwMp3NQCMmGMhqKqvKAUpK0XLa9L174sCfibaadWx/O4zBkiw4sdPKSrc5TUll/JtmoVb56msZqV9mahswnKfr9ubIrYyD4eJQSU80lXAZrEkQEilV9u8aAvW2DjkQP2sh26rGkNn42CaoxbL11uxq0HpMnLSy1MpX/11v5r5nFm36rYdqz4RZdUQZF0STOdScLoGIUrViNxKqX9fZJ+YJ081dGENHv15HVaXU1DJgjab55arVTxWYQELG8reNIci6UyWZ9M6B+rEjcblCMJ2GoxEDVbvFEjqQEEoVZZy2D/Fzrh4nRX7kTpxsHfpyF6J3WFKWNNHuYO+0HU6C5WzGvG2covi2SLSgAQ2QS4N/N0IgQWjbMSh4KLMe1zzbHFnTgd6Yms3EezafKXjna3QnQRnrQd5t6MBOWOt4vTnMzha2F5I70NUCG7/A8QyBInibpeO1V1326Phlky7aKc2O8lls2aN3QDu+4slucPsqRIv6+LRQHoBK9MOblEu69kAqOrjyvJ12Xx1/U1zzwiNcJ54usG9GysfrvMMgRrStEheKDDZQyu0ZQ0rJdxDX6+Md6kcBJwrF9ndKRbuWyg/pKeekQ2tulWBjqyaXq0KwqvFoz6xiHXApsfcoW1rAQVsdDztiPvyOylWXTZ3mp+H2XCpML/HWYiEUyUORY+Ji3ii5iayIsHeJm75bUwGPd8RMCx3qhG72VBZwcN32OSN6y/ABom60WVWW5hNgfyZT8OjxzjQwT7S0QtqeOKmpQ61f7NZSFZgEeG77kHGJkokestFCqLThA8eSrSreO27W77YKHlqJ5Q5q0rUnE5yIOnl4L0ID9jLLvQCAWmDDCPJLuCfcl2X3Nci64JaADXfb16jAlAn/PVox4S2m+x57PKdfA1Wt7De2BV9KOXclWYbV1s0ONgwW1ruFkyLg4zoqphH96QEgrhQ6kovFxqZkTRHBdJ+8RFt1bwj0Hm94Ox3lv+KYYVqHd030BeOwSIv2AmBTrFh/bRyDPcm8EOOqgSyfl2mrbpDILBe7dHV3YKIhw+U/ZFz5GL97AYgoDPa4JgDS62J7GkN+frYt2IPvrsw4+/aiMEnt0Fn5zgTYp07i20Dc7iqZN0q5rZmXZ4kUBe0W442MVyYkZJSd7dwRPolOmDv0pq8ZW70BwPE/HzOUPJ45eOEvFmbaaeH6Y5nbDQesmDfT8frRDFvGwt/6gCZwRMv0DADyYqM99zIH07ETD6HMT6ytC5y8zmdl7sg6ZBpeRlnb8wlPzZ62MRn2Pz9x3fzQg3q2a6/RdTJSXbcrkvDH0lIZW4O6AfiZv8J7X59aZrTdc7rWPdu1F3Towjg/a/qW/4rhO8S5DAIXoBSIwAB2xXSWwmLJ04B5Hy2zC6ynq37ZyVMWzcW+AXyMIs4pc7gAOblIZYUEGpiCH35+HF527vs3fg7/mc/pdJ7Zq4Z46ZzmIwxQSzUAcIgUBosbRikGlEmy+rDRd3O3p5XQsHTPC7zHBf0gxwXtcItRIQqQN8j1NRCQq1YsaIt47jtMpBiL+vuEKNsMNol1FsZpY2bB2yyAkZnBzIOwAdwKqzIMqlaVwZIEILnIrOSXv84K3e1OucxplrL4WDtN64I3WYFbpnGfdkEYIKSwW8IAVD0eTwFEhErrft06z5gOPPRQvgp0QcwF1bH8bwFwSDtC538TBag5VlyxJKpiqh7gkdvt8zf5H4z5RyePVvD7W2+yAmL1Pu2UOACsxeqgEIuhojjXsBscjAOQ1zKI3Eci8SZO6Ii2L8a/BAY/DsQihUa4UYik4G/nLxhG8F5DLPbiLwAOQHzZdgZq6XTYA38I0A5KYGs8807yn9K2mGrQG0BVOK1UoWZWwROC//4QnzVOadzcey2AsdPFlJgA8WmhwtDym2HofU6mftQjU+M/30X+Q5qR1ulGBJgA9WWhXOXOpVLxeMEDC2L1VLzmoDGv3wOAKxZPlnsFQJefeGoANEqpUEDvaGRpP0B6f/w97NhLW6V1vLsEnheq3X1txJNud9U4VUoBI+V06PJf0cS0zlcRdqkHSkq5q1YKBybX8uB6cnLoSrRK49IuXwPglq+ooDWnf8w7UuB0aLfFeLDgyW43AOwCYJMrrfZQvAF+LlojNeMn9Gml/LDk/z1Jo3absy4AeZtKKVeqbMnTqbWk28OlnDccCpG+MBwANZXKvX4dAAARkRwm1rbqMW2tVP2XxrUJFSLhcG7w4aVSqV3jf1eAgEipUFlhaaD9dAgLeuqKTT4kgFMof/fLgDsB5NG+TFykVK1YLfDb+WlbBHgX7dZlYWAYHpROJXIvrE4Xwinlthq6JGvFooJJXUklN9gjYHPK4XIPJQSPjRG5l1GH84WUKoMCiRqy20OePEiJFHY7BBFP7Q5D/rWxUUL3gsMHOFMarNb7M78LrjpwwJ/RZ/6kDuEuT5ujo/PgdQBVlQoCxHKtpCLlATWP3U1dBeB/s+RNUH1z+WfBKwFAymqwlwrJcDhVgAVxDGpPFQSmNmF6xCXrVfp7hJDN5igNXH4yQfk7u9FSvbkUkCGWqzarM2jDuyBVXxMqhI5W0mcTCYVCxWAXZJNM/F6IXeNA4wyF3VohlXS70ESvUX/mcsCmVLZckUOoVApFwr2B2i+5h/uZdwMoKYVKR6uYrMdsqMxUk9cCsNZcnDptRgmFHC2BY4Dyz5JGvWBgALZpoWHFcFcdVB17dbTA03mQ3B1FN6TcUxqUcoVcPrjQXKSTxnq5kW83AIVQKDIYItV8OhmJnKUc6KwDL3nx33T1nEqavU6qXHaDxSAaWGg+HCVxLwEY6ArIly2xQr5UKORCBpvdAguDI+rUjwK6LeXoftigsrtWBhaaN0mkHoNMN4CaXig0eO6qm2WFymYPx9zJ09npUCFe2B8lrf0KeVypQaVvdBK917K1+33mAo67jXqHUC5XWG2GVD0cDixaDAa7O7+GDC49mDBQXiOTeo/xxG8aHBDKFUqVxW5HBltwr1gsLqsruUsl0XdjLS/VRu1Pe8b6uvk6cQCHCAIoDXaXPVkqVV3KFfitNY2iJomK3EbdJhL17069dFJ/D7PoBUCFAKw2e6FaQKWm0urSozuv/7cGPcchSMOQphCd9VX7btJJJG5/TZteVEiphBm2oZWhhkSGFavdRibPngNwCbWXviZSKJT9+NPMKhX++n6fS9fDrcttIhU0AYPB5UaROWR1WezhvanRUe4JpJunkEep03ZLutfJ93LHyORXJOg9ANQcKjgMyVrIjnrW1Yg7iTK9H1PU+UMQKxxyP42MzfZkhr/3xZQRJP4r7sJNBKAWD7X6KKWIJ4LyzrTL9aixUt2bHZ1dg77pPyN9ZISi3icUSW9Ot8TNR6HQd1/V7yMAkFqRi+RPdbsWdnkeIVzsTlGp+uMySO954Tp8oqu9mU5SFaNbYjrlExR/jPva2491B6gaoO2q5J5n/xt2uR936I7XFhfp3F30riPt5NjIJ8qk2nhwki0/PsHj5ioTdWrFk+P/oEfpjIzRN88BeHOApEKltFrsrodwW6/WSoV82GW1RR7F4HLcQR2Z31Dvo53KjPfb5HjzmUzjX758nZuT3j0Kqzm+jFOaDwwaSLObAIByZcVqtbg8nnA47Al53G63JwZHMpXy2FW2wMPOUz2kn3dMjaG5P64Wksl45uRgy/hNLUWP9FrQaHS6bxo1ehQWBerYxYDyp+4AJZg/WKx2ayqVSqdSyVS6VWi2RE57bAa9bS9ebW0jV5Meu3V5cXFDb7VOTaq/bfnQ3RqCQb/PadYtoMerjY/Pab2D3C8kYMRuOfT/FheOhzoLLEMTsbrgCkWS6bTHYLV7UilHzIvmevz+qV7j45+/fF3Qbh0O/DZuRNyoxwBnueV0apFkrtae/7jbZrXZ3OFYKl9IJ0OekMsdytfgm1CEQKNylc1kMtns/XO93mAQCmT1wp3WRBQilf7uVPCzkMsVQqck1Kv1JyoXcccaYGijp8e4nAmFcr1Nr4SBOB8KpZty1x0Kgz10b8n1VCScBMMcPQE4poVCmwGqTTKcuu8E2YQKpXXFFa6BRjUXiaRrAPy5AMsQAJbIVkvs0aIoVCsWm93lSSZThWFL3yuAvgkAC4GH+HWmQDm2xYXnpf4sgAACEC3b3Y+jBCxjYKBTRf4GAFjXC4XTQtujPK4kgpmGCj1d5K8AACW3fvlpL9ojlysUtiT4SwAwRiESitfBXwzwzuMD4APgA+AD4APgA+AD4APgA+AD4APg/y/A/wGzSI6gq92uXwAAAABJRU5ErkJggg==', 'base64');
const ICON_512 = Buffer.from('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', 'base64');

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
const mailQueue = []; let mailBusy = false, mailDay = '', mailCount = 0;
function emailAlso(ids, p) {
  if (!MAIL_ALERT_TAGS.has(p.tag) || process.env.MAIL_ALERTS_OFF === '1') return;
  const rows = db.prepare(`SELECT id,email,name FROM users WHERE id IN (${ids.map(() => '?').join(',')}) AND verified=1 AND email_notify=1`).all(...ids);
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
      const text = `Hi ${String(u.name || '').trim().split(/\s+/)[0] || 'there'},\n\n${p.title}${p.body ? '\n' + p.body : ''}\n\nOpen it: ${link}\n\nYou get this because email alerts are on for your Studies Hub account. Turn them off: ${base}/settings/notifications`;
      const html = emailShell(`<h2 style="margin:0 0 8px;font-size:20px">${esc(p.title)}</h2><p style="margin:0 0 6px">Hi ${first},</p>${p.body ? `<p style="margin:0 0 16px">${esc(p.body)}</p>` : ''}<p style="margin:0 0 20px"><a href="${esc(link)}" style="background:#1a73e8;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;display:inline-block;font-weight:600">Open on Studies Hub</a></p><p style="color:#7a8593;font-size:12px;margin:0">You get this because email alerts are on for your account. <a href="${esc(base)}/settings/notifications" style="color:#7a8593">Turn them off</a>.</p>`, base);
      mailCount++;
      try { await deliver(u.email, p.title, text, html); } catch (e) { console.error('Alert email failed:', e.message); }
      await new Promise(r => setTimeout(r, 700));
    }
  } finally { mailBusy = false; }
}
// Send a notification to these people (all their devices). Never throws and is never awaited by callers.
function notify(userIds, payload) {
  const ids = [...new Set((userIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return Promise.resolve();
  const p = { icon: '/icon-192.png', ...payload, body: String(payload.body || '').slice(0, 140), title: String(payload.title || 'Studies Hub').slice(0, 80) };
  try { emailAlso(ids, p); } catch (e) { console.error('Email alert failed:', e.message); }
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
  return `<div style="background:#f3f5f9;padding:24px 12px"><div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;color:#1b2430;border:1px solid #e3e8ef"><div style="padding:18px 22px;border-bottom:1px solid #e3e8ef"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:10px"><img src="${base}/logo.png" width="40" height="40" alt="Studies Hub" style="display:block;border-radius:9px;border:0"></td><td style="font-size:18px;font-weight:700">Studies Hub</td></tr></table></div><div style="padding:22px;line-height:1.55">${inner}</div></div><p style="text-align:center;color:#7a8593;font:12px system-ui,Arial,sans-serif;margin:14px 0 0">${base.replace(/^https?:\/\//, '')}</p></div>`;
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
    emailShell(`<p style="margin:0 0 12px">Hi ${esc(user.name)},</p><p style="margin:0 0 16px">Confirm your email to activate your account.</p><p style="margin:0 0 16px"><a href="${link}" style="background:#1a73e8;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600">Confirm your email</a></p><p style="color:#5b6675;font-size:13px;margin:0">This link expires in 24 hours. If you did not sign up, ignore this email.</p>`, base));
  if (!sent) console.log(`[email not configured] Verification link for ${user.email}: ${link}`);
}

async function sendResetCode(email, code) {
  const sent = await deliver(email, 'Your Studies Hub password reset code',
    `Your password reset code is ${code}. It expires in 10 minutes. If you did not ask for it, ignore this email.`,
    emailShell(`<p style="margin:0 0 8px">Your password reset code is:</p><p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:0 0 14px">${code}</p><p style="color:#5b6675;font-size:13px;margin:0">It expires in 10 minutes. If you did not ask for it, ignore this email.</p>`));
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
}

app.get('/health', (req, res) => res.type('text').send('ok'));

app.use((req, res, next) => {
  const c = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('sid='));
  req.sid = c && /^[0-9a-f]{48,64}$/.test(c.slice(4)) ? c.slice(4) : null;
  req.user = req.sid
    ? db.prepare('SELECT u.id,u.name,u.email,u.role,u.verified,u.created_at,u.last_seen,u.avatar_mime,u.department,u.university,u.course,u.title,u.can_set_title,u.username,u.level,u.position,u.position_status,u.position_scope,u.position_auto_role,u.position_approver_id,u.position_can_verify,u.is_lecturer,u.lecturer_status,u.lecturer_reg_no,u.theme,u.hide_active,u.can_promote FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires>?').get(sidKey(req.sid), Date.now()) || null
    : null;
  // Presence: stamp last_seen at most once every 20s per user, so the online/offline dot in
  // /admin has real data without writing to the database on every single request.
  if (req.user && Date.now() - (req.user.last_seen || 0) > 20000) {
    db.prepare('UPDATE users SET last_seen=? WHERE id=?').run(Date.now(), req.user.id);
    req.user.last_seen = Date.now();
    markDelivered(req.user.id);
  }
  next();
});

// LiveKit calling module; credentials stay in server-side environment variables.
const { registerCalling, clientScript: CALLING_CLIENT_JS } = require('./calling');
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
    ids = db.prepare('SELECT id FROM users WHERE verified=1 AND id != ?').all(exceptId || 0).map(r => r.id);
  } else if (n.scope_type === 'own') {
    ids = db.prepare('SELECT id FROM users WHERE verified=1 AND id != ? AND department=? AND level=?').all(exceptId || 0, n.scope_department, n.scope_level).map(r => r.id);
  } else if (n.scope_type === 'department') {
    ids = db.prepare('SELECT id FROM users WHERE verified=1 AND id != ? AND department=?').all(exceptId || 0, n.scope_department).map(r => r.id);
  } else {
    const depts = db.prepare('SELECT name FROM departments WHERE faculty=?').all(n.scope_faculty).map(d => d.name);
    ids = depts.length ? db.prepare(`SELECT id FROM users WHERE verified=1 AND id != ? AND department IN (${depts.map(() => '?').join(',')})`).all(exceptId || 0, ...depts).map(r => r.id) : [];
  }
  notify(ids, { title: 'New on Studies Hub', body: n.title, url: '/news/' + newsId, tag: 'news' });
}
function announceUpload(page) {
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
function levelFromText(text) {
  const m = /\b[A-Za-z]{2,5}[\s_-]?([1-6])\d{2}\b/.exec(String(text || ''));
  return m ? Number(m[1]) * 100 : null;
}
const departmentNames = () => db.prepare('SELECT name FROM departments ORDER BY name').all().map(r => r.name);
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
  return Object.keys(groups).map(f => `<p class="chat-label">${esc(f)}</p>${groups[f].map(box).join('')}`).join('');
}
// An upload is either general (no department, no level), or aimed at one or more departments and/or one level.
function sortedFor(page, user) {
  if (can.pages(user)) return true;
  // A lecturer sees only lecturer uploads: their own and those of colleagues teaching the same course. Anything a
  // student (or the admin acting as a student) uploads is never shown in the lecturer portal.
  if (user && user.is_lecturer) {
    if (page.author_id != null && page.author_id === user.id) return true;
    return page.course_id != null && user.lecturer_status === 'approved' && !!db.prepare('SELECT 1 FROM lecturer_courses WHERE lecturer_id=? AND course_id=?').get(user.id, page.course_id);
  }
  if (page.dept == null && page.level == null) return true;
  if (!user) return false;
  if (page.dept != null && !deptListOf(page).includes(user.department)) return false;
  if (page.level != null && Number(page.level) !== Number(user.level)) return false;
  return true;
}
// Everyone who should be told about a new upload.
function audienceFor(page) {
  const where = ["role='user'", 'verified=1', 'is_lecturer=0'], args = [];
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
  if (item.scope_type === 'own') return viewer.department === item.scope_department && Number(viewer.level) === Number(item.scope_level);
  if (item.scope_type === 'department') return viewer.department === item.scope_department;
  if (item.scope_type === 'faculty') return !!item.scope_faculty && facultyOf(viewer.department) === item.scope_faculty;
  return true;
}
// Members finish their details (username, university, department, level) before anything else; staff only need a username.
const profileComplete = u => u.is_lecturer
  ? !!u.name && !!u.university && !!u.lecturer_status
  : !!u.username && !!u.name && (u.role !== 'user' || (!!u.department && !!u.level && !!u.university));
let adminTab = '';
const TAB_OF = p => /^\/admin\/(payments|sponsors)/.test(p) ? 'payments' : /^\/admin\/(upload|pages)/.test(p) ? 'pages' : /^\/admin\/lecturers/.test(p) ? 'lecturers' : /^\/(admin\/positions|positions|admin\/departments)/.test(p) ? 'positions' : /^\/admin\/news/.test(p) ? 'news' : /^\/admin\/users/.test(p) ? 'users' : '';
app.use((req, res, next) => { adminTab = TAB_OF(req.path); next(); });
const GATE_OPEN = ['/welcome', '/lecturer/welcome', '/logout', '/privacy', '/terms', '/health', '/sw.js', '/offline.html', '/manifest.webmanifest', '/logo.png', '/icon-192.png', '/icon-512.png', '/favicon.ico'];
app.use((req, res, next) => {
  if (req.user && req.method === 'GET' && !profileComplete(req.user) && !GATE_OPEN.includes(req.path) && !req.path.startsWith('/api/') && !req.path.startsWith('/avatar/')) return res.redirect(req.user.is_lecturer ? '/lecturer/welcome' : '/welcome');
  next();
});

// ---------- logo, app icons, install manifest and the notification service worker ----------
const sendAsset = (res, buf, type) => { res.setHeader('Content-Type', type); res.setHeader('Cache-Control', 'public, max-age=86400'); res.send(buf); };
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
    icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
    // Shortcuts: long-press the installed icon to jump straight to a section.
    shortcuts: [
      { name: 'Dashboard', url: '/dashboard', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
      { name: 'Chat', url: '/chat', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
      { name: 'News', url: '/news', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
      { name: 'Settings', url: '/settings', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
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
      screenshots: [{ src: '/icon-512.png', sizes: '512x512', label: 'Studies Hub News widget' }],
      icons: [{ src: '/icon-192.png', sizes: '192x192' }],
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
<body><div class="card"><img src="/icon-192.png" alt="Studies Hub"><h1>You're offline</h1>
<p>This page needs a connection. Reconnect and try again -- anything you already opened recently may still work.</p>
<button onclick="location.reload()">Try again</button></div></body></html>`;
app.get('/offline.html', (req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.send(OFFLINE_HTML); });
const UPLOAD_QUEUED_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Saved - Studies Hub</title>
<style>body{margin:0;background:#04101f;color:#eaf2ff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px;box-sizing:border-box}
.card{max-width:360px}.tick{font-size:48px;margin-bottom:12px}
h1{font-size:1.25rem;margin:0 0 8px}p{color:#93a0bd;line-height:1.5;margin:0 0 20px}
a.btn{display:inline-block;background:#5bc8ff;color:#04101f;border:none;border-radius:10px;padding:12px 22px;font-size:1rem;font-weight:600;text-decoration:none}</style></head>
<body><div class="card"><div class="tick">💾</div><h1>Saved on your device</h1>
<p>No connection right now, so this is waiting on your phone. It'll upload itself as soon as you're back online -- no need to try again.</p>
<a class="btn" href="/admin">Back to Admin</a></div></body></html>`;
const SW_JS = `var OFFLINE_CACHE='studies-hub-offline-v1',UPLOAD_PATHS=['/admin/upload'];
self.addEventListener('install',function(e){self.skipWaiting();e.waitUntil(caches.open(OFFLINE_CACHE).then(function(c){return c.add('/offline.html')}))});
self.addEventListener('fetch',function(e){
  if(e.request.mode!=='navigate')return;
  var pathname=new URL(e.request.url).pathname;
  if(e.request.method==='POST'&&UPLOAD_PATHS.indexOf(pathname)>-1){e.respondWith(handleUploadNav(e.request,pathname));return}
  if(e.request.method!=='GET'){e.respondWith(fetch(e.request).catch(function(){return caches.open(OFFLINE_CACHE).then(function(c){return c.match('/offline.html')})}));return}
  // A normal page visit: try the network and remember the result, so the same page can still open with no connection later.
  e.respondWith(fetch(e.request).then(function(res){var copy=res.clone();caches.open(OFFLINE_CACHE).then(function(c){c.put(e.request,copy)});return res})
    .catch(function(){return caches.open(OFFLINE_CACHE).then(function(c){return c.match(e.request).then(function(cached){return cached||c.match('/offline.html')})})}));
});
self.addEventListener('activate',function(e){e.waitUntil(self.clients.claim())});
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
    e.waitUntil(self.registration.showNotification(d.title||'Call ended',{tag:d.tag,silent:true,icon:'/icon-192.png',badge:'/icon-192.png'}).then(function(){return new Promise(function(r){setTimeout(r,700)})}).then(function(){return self.registration.getNotifications({tag:d.tag})}).then(function(list){list.forEach(function(n){n.close()})}));
    return;
  }
  if(d.ring){
    e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(cs){
      for(var i=0;i<cs.length;i++){if(cs[i].visibilityState==='visible')return}
      return self.registration.showNotification(d.title||'Incoming call',{body:d.body||'Incoming call',icon:d.icon||'/icon-192.png',badge:'/icon-192.png',tag:d.tag,renotify:true,requireInteraction:true,silent:false,vibrate:[500,250,500,250,500,250,500,250,500,250,500],actions:[{action:'answer',title:'Answer'},{action:'decline',title:'Decline'}],data:{url:'/chat',call:d.ring}});
    }));
    return;
  }
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(cs){
    var url=d.url||'/';
    for(var i=0;i<cs.length;i++){var c=cs[i];if(c.visibilityState==='visible'&&c.focused&&new URL(c.url).pathname===url.split('?')[0])return}
    var replyTo=d.quickReply&&d.quickReply.reply_to_id;
    var options={body:d.body||'',icon:d.icon||'/icon-192.png',badge:'/icon-192.png',tag:d.tag||undefined,renotify:!!d.tag,data:{url:url,replyTo:replyTo||null}};
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

const ONLINE_MS = 2 * 60 * 1000; // a user counts as "online" if seen in the last 2 minutes
const isOnline = u => !!u.last_seen && Date.now() - u.last_seen < ONLINE_MS && !u.hide_active;
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

const CSS = `:root{--bg:#12121c;--panel:rgba(32,48,96,.30);--line:rgba(56,176,248,.24);--fg:#eaf2ff;--mut:#93a0bd;--blue:#38b0f8;--blue2:#1c7fe0;--pink:#f000e8;color-scheme:dark;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
:root[data-theme="light"]{--bg:#f4f7fc;--panel:rgba(56,176,248,.08);--line:rgba(28,96,160,.22);--fg:#0e1a2b;--mut:#51607a;--blue:#1c7fe0;--blue2:#145fb0;--pink:#c400bc;color-scheme:light}
html{background:var(--bg);scroll-padding-top:env(safe-area-inset-top,0px)}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg);background:radial-gradient(900px 520px at 12% -8%,rgba(56,176,248,.22),transparent 62%),radial-gradient(700px 440px at 96% 4%,rgba(240,0,232,.13),transparent 60%),var(--bg);background-attachment:fixed}
a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}
.autolink{text-decoration:underline}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 20px;max-width:1000px;margin:0 auto}
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
.chat-head{display:flex;align-items:center;gap:10px;position:sticky;top:0;background:var(--bg);padding:6px 0 12px;z-index:5}
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
.chat-bar .ic{padding:9px 12px;font-size:18px;line-height:1;background:transparent;border:1px solid var(--line);color:var(--fg);box-shadow:none}
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
`;

const navItems = (user, badge = 0) => user ? (user.is_lecturer ? [
  { href: '/lecturer', icon: '🎓', label: 'My courses' },
  { href: '/settings/profile', icon: '👤', label: 'Lecturer profile' },
] : [
  { href: '/dashboard', icon: '📊', label: 'Dashboard' },
  { href: '/news', icon: '📰', label: 'News' },
  { href: '/chat', icon: '💬', label: 'Chat', badge },
  ...(can.anyAdmin(user) || canPromote(user) ? [{ href: '/admin', icon: '🛠️', label: 'Admin' }] : []),
]) : [
  { href: '/', icon: '🏠', label: 'Home' },
  { href: '/lecturer/portal', icon: '🎓', label: 'Lecturer portal' },
];
const badgeText = n => n > 15 ? '15+' : String(n);
const PUSH_CLIENT_JS = `(function(){
if(!('serviceWorker' in navigator))return;
var KEY='__KEY__';
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
navigator.serviceWorker.register('/sw.js').then(function(reg){
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
const layout = (title, body, user, opts = {}) => {
  const avatarBit = user
    ? (user.avatar_mime ? `<img src="/avatar/${user.id}" class="drawer-av-img" alt="">` : `<span class="avatar" style="width:40px;height:40px;font-size:15px">${esc((user.name || '?').trim().charAt(0).toUpperCase() || '?')}</span>`)
    : '';
  const badge = user ? chatBadge(user.id) : 0;
  const drawerNav = navItems(user, badge).map(i => `<a class="drawer-item" href="${i.href}"><span>${i.icon}</span>${esc(i.label)}${i.badge > 0 ? `<b class="nbadge">${badgeText(i.badge)}</b>` : ''}</a>`).join('');
  const drawerBottom = user
    ? `<a class="drawer-item" href="/settings"><span>⚙️</span>Settings</a><form method="post" action="/logout" style="margin:0"><button class="drawer-item" style="width:100%;text-align:left;background:none;color:inherit;box-shadow:none;font:inherit;border:0;cursor:pointer"><span>🚪</span>Log out</button></form>`
    : `<a class="drawer-item" href="/login"><span>🔑</span>Log in</a><a class="drawer-item" href="/signup"><span>✨</span>Sign up</a>`;
  const themeAttr = user && user.theme === 'light' ? ' data-theme="light"' : '';
  const descriptionMeta = opts.description ? `<meta name="description" content="${esc(opts.description)}">` : '';
  return `<!doctype html><html lang="en"${themeAttr}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${esc(title)}</title>${descriptionMeta}${opts.headExtra || ''}<link rel="icon" href="/icon-192.png"><link rel="apple-touch-icon" href="/icon-192.png"><link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="${user && user.theme === 'light' ? '#f4f7fc' : '#12121c'}"><style>${CSS}</style></head><body${opts.footer ? ' class="has-footer"' : ''}>
<div id="scrim" class="scrim"></div>
<nav id="drawer" class="drawer">
<div class="drawer-top"><img class="logo-img" src="/logo.png" alt=""><b>Studies Hub</b><button id="drawerClose" class="link" aria-label="Close menu" style="margin-left:auto;font-size:20px">&times;</button></div>
${user ? `<div class="drawer-user">${avatarBit}<div><b>${esc(user.name)}</b><br><span class="mut" style="font-size:12px">${esc(user.email)}</span></div></div>` : ''}
<p class="drawer-label">MAIN MENU</p>
${drawerNav}
<div class="drawer-bottom">${drawerBottom}</div>
</nav>
<div id="drawerArrows" class="drawer-arrows"><button type="button" id="drawerUp" aria-label="Scroll the menu up" title="Scroll up">&#9650;</button><button type="button" id="drawerDown" aria-label="Scroll the menu down" title="Scroll down">&#9660;</button></div>
<header class="top"><button id="drawerOpen" class="menu-btn" aria-label="Open menu">&#9776;${badge > 0 ? `<span class="mbadge">${badgeText(badge)}</span>` : ''}</button><a class="brand" href="${user ? '/dashboard' : '/'}"><img class="logo-img" src="/logo.png" alt="">Studies Hub</a><span style="width:40px"></span></header>
<main>${user && !opts.noPushBar ? '<div id="pushBar" class="pushbar" hidden><span>Turn on notifications to get incoming calls (even when the site is closed), new messages, open the correct conversation quickly, and see friend requests and new uploads.</span><button id="pushYes" type="button">Turn on</button><button id="pushNo" type="button" class="ghost">Not now</button></div>' : ''}${body}</main>${opts.footer ? `<footer class="site-foot"><span>&copy; ${new Date().getFullYear()} Studies Hub</span><span class="site-foot-links"><a href="/privacy">Privacy Policy</a><a href="/terms">Terms &amp; Conditions</a></span></footer>` : ''}${user && AI && !opts.noAI ? CHAT_HTML : ''}
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
${user ? `<script>${PUSH_CLIENT_JS.replace('__KEY__', VAPID_PUBLIC)}</script><script>${CALLING_CLIENT_JS}</script>` : ''}
</body></html>`;
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
${login ? '<p class="mut"><a href="/forgot">Forgot password?</a></p>' : ''}
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
app.get('/', (req, res) => req.user ? res.redirect('/dashboard') : res.send(layout('Studies Hub', newsFeedBody(req, true), req.user, { footer: true, headExtra: ADSENSE_HEAD })));

app.get('/browse', (req, res) => {
  const pages = db.prepare('SELECT slug,title,members_only,kind,paid,price_kobo,dept,level,author_id,course_id FROM pages ORDER BY id DESC').all().filter(p => sortedFor(p, req.user));
  const grid = pages.length ? `<div class="grid">${pages.map(pageCard).join('')}</div>` : '<p class="mut">Nothing published yet. Check back soon.</p>';
  res.send(layout('All pages', `<h1>All pages</h1>${grid}`, req.user));
});

// Privacy policy -- public, no login needed. Describes what this app actually does, in plain language.
// NOTE: this is a plain-language description of the app's real behavior, not legal advice -- have it
// checked by a lawyer for your jurisdiction (e.g. Nigeria's NDPA) before you rely on it.
app.get('/privacy', (req, res) => {
  const updated = new Date().toISOString().slice(0, 10);
  const contactEmail = (process.env.CONTACT_EMAIL || 'donryscott28@gmail.com').replace(/^.*<([^>]+)>.*$/, '$1').trim();
  const emailProviders = [
    process.env.GOOGLE_REFRESH_TOKEN ? 'Google (Gmail)' : null,
    process.env.RESEND_API_KEY ? 'Resend' : null,
    process.env.BREVO_API_KEY ? 'Brevo' : null,
    process.env.SMTP_HOST ? 'our email server' : null,
  ].filter(Boolean);
  const aiProvider = AI === 'groq' ? 'Groq' : AI === 'claude' ? 'Anthropic' : null;
  const body = `<main class="auth privacy-policy" style="max-width:860px;width:100%;margin:24px auto;padding:clamp(18px,4vw,36px);border:1px solid var(--line);border-radius:22px;background:var(--card);box-shadow:0 12px 40px rgba(0,0,0,.12)"><style>.privacy-policy{line-height:1.7}.privacy-policy h1{font-size:clamp(28px,5vw,38px);line-height:1.15;margin:8px 0}.privacy-policy h2{font-size:19px;margin:28px 0 8px;padding-top:18px;border-top:1px solid var(--line)}.privacy-policy p{line-height:1.75}.privacy-policy li{margin:9px 0;padding-left:3px}.privacy-policy ul{padding-left:22px}.privacy-policy a{overflow-wrap:anywhere}.privacy-kicker{font-size:12px;letter-spacing:1.5px;font-weight:800;color:var(--accent,#64748b)}.privacy-contact{padding:16px;border:1px solid var(--line);border-radius:14px;background:var(--bg);overflow-wrap:anywhere}</style><header style="padding:4px 0 18px;border-bottom:1px solid var(--line);margin-bottom:18px"><p class="privacy-kicker">STUDIES HUB · PRIVACY & DATA</p><h1>Privacy Policy</h1><p class="mut" style="margin:0">Last updated ${updated}</p></header>

<p>This page explains, in plain language, what Studies Hub collects and why. It covers what this site actually does today -- nothing more, nothing hidden.</p>

<h2>What we collect</h2>
<ul>
<li><b>Account details:</b> your name and email address, and a password (we never store your actual password -- only a one-way scrambled/hashed version that can't be reversed).</li>
<li>${GOOGLE_ON ? '<b>Google sign-in:</b> if you use "Continue with Google," Google shares your name, email address, and whether Google has verified that email -- we don\'t see or store your Google password.' : ''}</li>
<li><b>A username</b> (like @yourname) that other members use to find and add you as a friend. It is visible to any logged-in member.</li>
<li><b>Student details:</b> your university, department and level, so we can show you the pages and CBT practice meant for your course. If you tell us you hold a position (like "Director of Socials"), that claim is checked by a school-authority admin before it shows beside your name.</li>
<li><b>Lecturer details:</b> if you register as a lecturer, we collect your institution and the courses you select, plus an optional staff/registration number. A full admin reviews your lecturer details before upload permissions are enabled.</li>
<li><b>Educational materials:</b> files or HTML learning materials you upload, their titles, course links, and the department/level audience you select.</li>
<li><b>Profile details you choose to add:</b> a profile picture, from the Settings page. Other logged-in members can see your profile (picture, username, university, department, level, verified position) and your online/offline status.</li>
<li><b>Activity used to run the site:</b> when you were last active, and, if you submit news or a payment claim, that submission and its status (pending/approved/rejected).</li>
<li><b>Friends and groups:</b> who you have sent or received a friend request with, who you are friends with, and any group you create or are added to (its name and member list).</li>
<li><b>Messages:</b> if you chat with a friend or in a group, your text messages, voice notes and stickers are stored so the conversation can be shown to the people in it -- including whether a message has been delivered or read, any reactions, edits, and deletions. If you build a sticker board, the pictures you add to it are stored for you.</li>
<li><b>Push notifications:</b> if you turn notifications on, your browser gives us a subscription address so we can alert your device about messages, friend requests, new uploads and similar activity. We never see the notification after it leaves our server -- only your browser can read what it says.</li>
</ul>

<h2>How we use it</h2>
<ul>
<li>To create and secure your account, verify your email, and let you reset your password.</li>
<li>To personalize your dashboard and show you educational materials sorted for your department and level.</li>
<li>To verify lecturer accounts, link lecturers to their selected courses, and publish the learning materials they choose to upload.</li>
<li>To show your name, photo, profile details and online/offline status to other logged-in members -- not to the public.</li>
<li>To let you find and message friends, and to run groups you are part of.</li>
<li>To send you a notification (if you turned them on) about things like a new message, friend request or upload.</li>
<li>To review content before it goes public: news you submit, a claimed school position, and payment claims are checked by an admin before they're approved. Some admins only handle one job (files, news, positions and departments, or helping people who can't log in); helping with login can include sending you a verification link or a password-reset code by email, or signing you out of your devices.</li>
</ul>

<h2>Payments</h2>
<p>Studies Hub does not use a card payment processor and does not collect your card or bank details. Some content is unlocked via manual bank transfer: we show our own account details, you pay directly through your own bank, and an admin manually confirms and unlocks the content. We don't see your banking information at any point in that process.</p>

<h2>Chat and messages</h2>
<p>You can only message someone once you are friends, or in a group you both belong to. Text messages, voice notes and stickers are stored encrypted (scrambled so a stolen copy of our database would be unreadable) -- but this is not "end-to-end" encryption. The site itself is still able to decrypt and read messages when needed, for example to look into abuse reports. Please don't send anything in chat you wouldn't want anyone but the people in that conversation to ever see. A group has its own admin, chosen by whoever creates it, who can add or remove members and rename the group.</p>

${aiProvider ? `<h2>The "Ask AI" assistant</h2><p>If you use the Ask AI assistant, your question and Studies Hub's reply are sent to ${aiProvider}, an outside AI provider, purely to generate that reply. We don't send your email, password, or profile details to them -- just the conversation you type.</p>` : ''}

<h2>Cookies</h2>
<p>We use one cookie to keep you logged in between visits. We don't use advertising or tracking cookies, and there are currently no ads on this site.</p>

<h2>Who else sees your data</h2>
<p>We share information only with the outside services that make the site work${emailProviders.length ? `, such as ${emailProviders.join(' and/or ')} for sending verification and password-reset emails` : ''}${GOOGLE_ON ? ', and Google for sign-in' : ''}${aiProvider ? `, and ${aiProvider} for the AI assistant` : ''}, plus our hosting provider, which stores the site's data on our behalf. We do not sell your data to anyone.</p>


<h2>Google API data and email sending</h2>
${process.env.GOOGLE_REFRESH_TOKEN ? `<p>When Studies Hub uses the Gmail API with the <code>gmail.send</code> permission, it uses that permission to send account-related emails such as verification links or password-reset messages. This permission does not allow Studies Hub to read, search, or delete Gmail messages. Google user data is used only for the feature disclosed to you and is not sold or used for targeted advertising.</p><p>Studies Hub does not use Google API data to train generalized AI or machine-learning models. Data received from Google APIs is handled in accordance with the Google API Services User Data Policy, including its Limited Use requirements.</p>` : `<p>When Google API services are enabled, Studies Hub will describe the specific Google data accessed, the purpose, and the permission requested before use. We do not request access to Gmail messages for reading or searching as part of the email-sending feature.</p>`}

<h2>Data protection and security</h2>
<ul>
<li><b>Password protection:</b> account passwords are stored as bcrypt hashes rather than in readable form.</li>
<li><b>Encrypted messages:</b> chat text, voice notes and sticker media are encrypted by the application using AES-256-GCM while stored. This is not end-to-end encryption; the application can decrypt messages to provide the service.</li>
<li><b>Secure transmission:</b> use the HTTPS version of Studies Hub to protect information sent between your device and the website.</li>
<li><b>Access controls:</b> account areas and administrative actions are restricted by sign-in and role checks within the application.</li>
<li><b>Limited collection and use:</b> information is used to operate the features described in this policy and shared with service providers only where needed to operate those features.</li>
</ul>
<p>We review and maintain safeguards appropriate to the information we handle. No online service can guarantee absolute security. Protection of stored data also depends on the security of the hosting environment, database access, and any configured encryption-key management.</p>

<h2>How long we keep it</h2>
<p>We keep your account and its data for as long as your account exists. We don't currently have an automatic "delete my account" button -- if you'd like your data reviewed, corrected, or removed, contact us (below) and we'll handle it by hand.</p>

<h2>Children</h2>
<p>Studies Hub is intended for students old enough to independently create an account and is not directed at young children.</p>

<h2>Changes to this policy</h2>
<p>If how we handle your data changes meaningfully, we'll update this page and change the date above.</p>

<h2>Contact us</h2>
<div class="privacy-contact"><b>Questions or data requests?</b><p style="margin:6px 0 0">To ask about your data or request a correction or deletion, email <a href="mailto:${esc(contactEmail)}">${esc(contactEmail)}</a>.</p></div>
</main>`;
  res.send(layout('Privacy Policy', body, req.user));
});


 
// Terms & Conditions -- separate public page; uses the existing layout and styling.
app.get('/terms', (req, res) => {
  const updated = new Date().toISOString().slice(0, 10);
  const contactEmail = (process.env.CONTACT_EMAIL || 'donryscott28@gmail.com').replace(/^.*<([^>]+)>.*$/, '$1').trim();
  const body = `<main class="auth privacy-policy" style="max-width:860px;width:100%;margin:24px auto;padding:clamp(18px,4vw,36px);border:1px solid var(--line);border-radius:22px;background:var(--card);box-shadow:0 12px 40px rgba(0,0,0,.12)"><style>.privacy-policy{line-height:1.7}.privacy-policy h1{font-size:clamp(28px,5vw,38px);line-height:1.15;margin:8px 0}.privacy-policy h2{font-size:19px;margin:28px 0 8px;padding-top:18px;border-top:1px solid var(--line)}.privacy-policy p{line-height:1.75}.privacy-policy li{margin:9px 0;padding-left:3px}.privacy-policy ul{padding-left:22px}.privacy-policy a{overflow-wrap:anywhere}</style><header style="padding:4px 0 18px;border-bottom:1px solid var(--line);margin-bottom:18px"><p class="privacy-kicker">STUDIES HUB · TERMS</p><h1>Terms &amp; Conditions</h1><p class="mut" style="margin:0">Last updated ${updated}</p></header>
<p>These Terms &amp; Conditions govern your access to and use of Studies Hub at studieshub.org. By creating an account or using the service, you agree to these terms. If you do not agree, do not use the service.</p>
<h2>1. About Studies Hub</h2><p>Studies Hub is an educational platform for students and lecturers to access, share and discuss learning materials, practice CBT-style exercises, publish approved news, and communicate with other members.</p>
<h2>2. Eligibility and accounts</h2><p>You must provide accurate information, keep your login details confidential, and use only your own account. You are responsible for activity carried out through your account and must notify us if you suspect unauthorized access.</p>
<h2>3. Student accounts</h2><p>Students must provide truthful details, including university, department, level and username where requested. Do not impersonate another student or misrepresent your academic status.</p>
<h2>4. Lecturer accounts</h2><p>Lecturer registration and upload privileges may require review and approval by a Studies Hub administrator. Registration does not guarantee verification or approval. Lecturers must provide accurate institutional and course information.</p>
<h2>5. Educational materials and accuracy</h2><p>Materials may be uploaded by users and may be incomplete, outdated, or inaccurate. Studies Hub does not guarantee that every file, answer, course label, or CBT question is correct. Use materials as learning aids and confirm important academic information with your institution or lecturer.</p>
<h2>6. User uploads and responsibility</h2><p>You are responsible for materials you upload, including their legality, accuracy, and suitability for the audience selected. Do not upload malware, unlawful material, private information about others without permission, or content that infringes another person's rights.</p>
<h2>7. Intellectual property</h2><p>You retain rights you hold in content you create. By uploading content, you give Studies Hub permission to host, store, display, and distribute it as needed to operate the features you choose. You must have permission to share third-party content. Respect copyright, school rules, and any applicable licences.</p>
<h2>8. CBT and assessments</h2><p>CBT features are for practice and learning unless a page explicitly states otherwise. Do not use the platform to cheat, impersonate another candidate, distribute confidential examination materials, or interfere with an assessment.</p>
<h2>9. News and public submissions</h2><p>News and other submissions may be reviewed before publication. Studies Hub may decline, restrict, or remove content that violates these terms, applicable law, or platform safety requirements.</p>
<h2>10. Messaging, stickers and voice notes</h2><p>Use chat respectfully and only to communicate with permitted friends or group members. Do not harass, threaten, defraud, impersonate, or share unlawful or non-consensual content. Messages are encrypted in storage but are not end-to-end encrypted; do not treat chat as a private vault.</p>
<h2>11. Groups and communities</h2><p>Group creators and authorized group administrators may manage membership and group details. Members must follow these terms and respect the privacy and rights of other participants.</p>
<h2>12. Payments and paid content</h2><p>Where paid content is offered, follow the payment instructions shown on the platform and submit truthful payment information. Access may be granted after manual confirmation or provider verification, as applicable. Do not submit false receipts or attempt to bypass payment controls. Any displayed price and refund arrangement shown for a particular transaction applies to that transaction.</p>
<h2>13. Third-party services</h2><p>Some features rely on third-party services such as email, hosting, authentication, AI, or calling providers. Their services may have separate terms and privacy practices. Studies Hub is not responsible for independent third-party systems beyond its reasonable control.</p>
<h2>14. Privacy</h2><p>Your use of Studies Hub is also governed by our <a href="/privacy">Privacy Policy</a>, which explains what information is handled, why it is used, and how to make a privacy request.</p>
<h2>15. Prohibited activities</h2><p>You must not attempt unauthorized access, disrupt the service, exploit vulnerabilities, reverse engineer or bypass access controls unlawfully, send spam, scrape personal information, upload malicious code, manipulate payment or verification processes, or use Studies Hub for unlawful activity.</p>
<h2>16. Moderation and enforcement</h2><p>Studies Hub may investigate reports, review content, restrict features, remove material, suspend accounts, or terminate access when reasonably necessary to protect users, comply with law, or enforce these terms.</p>
<h2>17. Availability and changes</h2><p>We aim to keep Studies Hub available but do not guarantee uninterrupted service. Features may be changed, suspended, or discontinued for maintenance, security, operational, or other legitimate reasons.</p>
<h2>18. Disclaimer</h2><p>To the extent permitted by applicable law, Studies Hub is provided on an “as available” basis. We do not guarantee that the service will always be error-free, that user content is accurate, or that every feature will meet every user's needs.</p>
<h2>19. Limitation of liability</h2><p>To the extent permitted by applicable law, Studies Hub and its operators are not liable for indirect or consequential losses arising from use of the service, reliance on user-uploaded materials, service interruption, or unauthorized activity beyond reasonable control. Nothing in these terms excludes liability that cannot legally be excluded.</p>
<h2>20. Your responsibility for claims</h2><p>You agree not to misuse the platform or violate another person's rights. Where permitted by law, you may be responsible for losses or claims caused by your unlawful conduct or material breach of these terms.</p>
<h2>21. Suspension and termination</h2><p>You may stop using Studies Hub at any time. We may suspend or terminate access for serious or repeated violations, security concerns, legal requirements, or misuse of the service. Data handling after account closure is described in the Privacy Policy and applicable law.</p>
<h2>22. Governing law</h2><p>These terms are intended to be governed by the laws of the Federal Republic of Nigeria, subject to any mandatory legal protections that apply to a user.</p>
<h2>23. Disputes and severability</h2><p>If a concern arises, contact us first so we can try to resolve it. If any provision of these terms is found unenforceable, the remaining provisions continue to apply to the extent permitted by law.</p>
<h2>24. Changes and contact</h2><p>We may update these terms when the service or legal requirements change. The updated date above indicates the latest version. Continued use after an update means you accept the revised terms where permitted by law.</p><p>Questions about these terms? Email <a href="mailto:${esc(contactEmail)}">${esc(contactEmail)}</a>.</p>
</main>`;
  res.send(layout('Terms & Conditions', body, req.user));
});

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
const ADSENSE_CLIENT = 'ca-pub-4280454885902185';
// The home page <head> carries the AdSense snippet (what AdSense's site check looks for) plus Google's matching account meta tag.
const ADSENSE_HEAD = `<meta name="google-adsense-account" content="${ADSENSE_CLIENT}"><script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}"
     crossorigin="anonymous"></script>`;
// Optional: an In-feed ad unit made in your AdSense dashboard. Set these in Railway to show ad cards inside the home news feed.
const ADSENSE_FEED_SLOT = String(process.env.ADSENSE_FEED_SLOT || '').replace(/[^0-9]/g, '');
const ADSENSE_FEED_LAYOUT_KEY = String(process.env.ADSENSE_FEED_LAYOUT_KEY || '').replace(/[^A-Za-z0-9_+=-]/g, '');
const feedAdCard = () => `<div class="news-card ad-card"><div class="ad-label">Advertisement</div><ins class="adsbygoogle" style="display:block" data-ad-client="${ADSENSE_CLIENT}" data-ad-slot="${ADSENSE_FEED_SLOT}"${ADSENSE_FEED_LAYOUT_KEY ? ` data-ad-format="fluid" data-ad-layout-key="${ADSENSE_FEED_LAYOUT_KEY}"` : ' data-ad-format="auto" data-full-width-responsive="true"'}></ins><script>(adsbygoogle = window.adsbygoogle || []).push({});</script></div>`;
app.get('/ads.txt', (req, res) => res.type('text/plain').send(`google.com, pub-${ADSENSE_CLIENT.replace('ca-pub-', '')}, DIRECT, f08c47fec0942fa0\n`));
function newsFeedBody(req, home = false) {
  const all = db.prepare("SELECT n.*, u.name AS author, u.title AS author_title, u.position_auto_role AS author_auto_role FROM news n LEFT JOIN users u ON u.id = n.author_id WHERE n.status='approved' ORDER BY n.id DESC").all();
  const items = all.filter(n => canSeeNewsItem(n, req.user));
  const newsImg = n => n.image_data ? `<img class="news-img" src="/news-image/${n.id}" alt="">` : n.image_url ? `<img class="news-img" src="${esc(n.image_url)}" alt="">` : '<div class="news-img"></div>';
  const cardList = items.map(n => `<a class="news-card" href="/news/${n.id}">${newsImg(n)}<div class="news-body"><h3>${esc(n.title)}</h3><p class="mut news-snip">${esc(n.body)}</p><div class="news-meta"><span>${byline(n)}</span><span>&middot;</span><span>${timeAgo(n.created_at)}</span></div></div></a>`);
  const cards = cardList.join('');
  const empty = '<p class="mut">No news yet. Check back soon.</p>';
  if (home) return ADSENSE_FEED_SLOT && cardList.length ? cardList.flatMap((c, i) => i === 0 || i % 4 === 3 ? [c, feedAdCard()] : [c]).join('') : (cards || empty);
  // News section only (not the home page): the sponsor-ad script, any active paid promotional posts, and the
  // link to buy one.
  const adScript = `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}" crossorigin="anonymous"></script>`;
  const sponsors = db.prepare("SELECT * FROM sponsor_posts WHERE status='approved' AND expires_at > datetime('now') ORDER BY id DESC LIMIT 3").all();
  const sponsorCards = sponsors.map(s => `<div class="card" style="border-color:#ffd166"><p class="pill" style="background:#ffd16622;border-color:#ffd16655;color:#ffd166">Sponsored</p>${s.image_data ? `<img class="news-img" src="/sponsor-image/${s.id}" alt="" style="margin-bottom:8px">` : ''}<h3 style="margin:4px 0">${esc(s.title)}</h3><p class="mut" style="white-space:pre-wrap">${linkify(s.body)}</p>${s.contact ? `<p class="mut" style="margin:4px 0 0">${linkify(s.contact)}</p>` : ''}</div>`).join('');
  const submitForm = req.user
    ? `<details class="card" style="margin-bottom:16px"><summary style="cursor:pointer;font-weight:600">Share something</summary><form method="post" action="/news" enctype="multipart/form-data" style="margin-top:10px"><input name="title" placeholder="Headline" required maxlength="140"><input type="file" name="image" accept="image/*" style="padding:9px 0"><textarea name="body" placeholder="What's happening?" required maxlength="2000000" style="width:100%;min-height:70px;font:inherit;padding:11px 13px;margin:6px 0;color:var(--fg);background:rgba(8,10,22,.65);border:1px solid var(--line);border-radius:10px"></textarea><button>Submit for review</button></form><p class="mut" style="margin:6px 0 0">An admin checks it before it goes live.</p></details>`
    : '<p class="mut"><a href="/login?next=/news">Log in</a> to share something.</p>';
  const approverQueue = req.user ? (() => {
    const waiting = db.prepare("SELECT n.*, u.name AS author FROM news n JOIN users u ON u.id=n.author_id WHERE n.status='pending_approver' AND n.approver_id=?").all(req.user.id);
    if (!waiting.length) return '';
    return `<h3>Waiting for your approval (${waiting.length})</h3>${waiting.map(n => `<div class="card"><b>${esc(n.author)}</b> wrote: <b>${esc(n.title)}</b><p class="mut">${esc(n.body.slice(0, 200))}${n.body.length > 200 ? '…' : ''}</p><div class="row" style="gap:6px"><form method="post" action="/news/${n.id}/approver-approve"><button>Approve</button></form><form method="post" action="/news/${n.id}/approver-reject"><button class="link">Reject</button></form></div></div>`).join('')}`;
  })() : '';
  const sponsorLink = req.user ? `<p class="mut" style="margin:0 0 16px"><a href="/sponsor">Advertise your business or service here -- ₦2000/month &rarr;</a></p>` : '';
  return `${adScript}<h1>News</h1>${req.query.msg ? `<p class="mut">${esc(req.query.msg)}</p>` : ''}${approverQueue}${submitForm}${sponsorLink}${sponsorCards}${cards || empty}`;
}
app.get('/news', (req, res) => res.send(layout('News', newsFeedBody(req), req.user)));
app.get('/news-image/:id', (req, res) => {
  const row = db.prepare('SELECT image_data, image_mime FROM news WHERE id=?').get(req.params.id);
  if (!row || !row.image_data) return res.sendStatus(404);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Content-Type', row.image_mime || 'application/octet-stream');
  res.send(Buffer.from(row.image_data));
});
// The bigger, tap-through view of one news item: full picture, and the text exactly as it was
// typed or pasted -- real line breaks kept (via the .news-full CSS rule), nothing squashed together.
app.get('/news/:id', (req, res) => {
  const n = db.prepare("SELECT n.*, u.id AS author_uid, u.name AS author, u.title AS author_title, u.position_auto_role AS author_auto_role, u.avatar_mime FROM news n LEFT JOIN users u ON u.id = n.author_id WHERE n.id=? AND n.status='approved'").get(req.params.id);
  if (!n || !canSeeNewsItem(n, req.user)) return res.status(404).send(layout('Not found', '<h2>News item not found</h2><p><a href="/news">Back to News</a></p>', req.user));
  const img = n.image_data ? `<img src="/news-image/${n.id}" style="width:100%;border-radius:14px;margin-bottom:16px">` : n.image_url ? `<img src="${esc(n.image_url)}" style="width:100%;border-radius:14px;margin-bottom:16px">` : '';
  const who = n.author_uid ? avatarOr({ id: n.author_uid, name: n.author, avatar_mime: n.avatar_mime }, 40) : '';
  const nameHtml = n.author_uid && req.user ? `<a href="/u/${n.author_uid}"><b>${esc(n.author)}</b></a>` : `<b>${esc(n.author || 'Studies Hub')}</b>`;
  const posted = `<div class="row" style="justify-content:flex-start;gap:10px;margin-top:16px">${who}<div>${nameHtml}${n.author_title ? `<span class="role-tag">${esc(n.author_title)}</span>` : ''}${verifiedBadge(n.author_auto_role)}<br><span class="mut" style="font-size:12px">${timeAgo(n.created_at)} ago</span></div></div>`;
  const adScript = `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}" crossorigin="anonymous"></script>`;
  res.send(layout(n.title, `${adScript}<p class="mut" style="margin:0 0 12px"><a href="/news">&larr; Back to News</a></p><div class="card">${img}<h1 style="margin-top:0">${esc(n.title)}</h1><p class="news-full">${linkify(n.body)}</p>${posted}</div>`, req.user));
});
app.post('/news', upload.single('image'), (req, res) => {
  if (!req.user) return res.redirect('/login?next=/news');
  const title = String(req.body.title || '').trim().slice(0, 140);
  const body = String(req.body.body || '').trim().slice(0, 2000000);
  if (!title || !body) return res.redirect('/news?msg=' + encodeURIComponent('Enter a headline and a summary.'));
  if (req.file && !/^image\//.test(req.file.mimetype)) return res.redirect('/news?msg=' + encodeURIComponent('That file is not an image.'));
  const reach = newsReachFor(req.user);
  const hasApprover = req.user.position_status === 'approved' && req.user.position_approver_id;
  const status = hasApprover ? 'pending_approver' : 'pending';
  db.prepare("INSERT INTO news(title,body,image_data,image_mime,author_id,status,scope_type,scope_department,scope_level,scope_faculty,approver_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run(title, body, req.file ? req.file.buffer : null, req.file ? req.file.mimetype : null, req.user.id, status, reach.scope_type, reach.scope_department, reach.scope_level, reach.scope_faculty, hasApprover ? req.user.position_approver_id : null);
  if (hasApprover) notify([req.user.position_approver_id], { title: 'News to review', body: `${req.user.name}: ${title}`, url: '/news', tag: 'news-review' });
  else notify(db.prepare("SELECT id FROM users WHERE role IN ('admin','news')").all().map(r => r.id), { title: 'News to review', body: `${req.user.name}: ${title}`, url: '/admin#pending-news', tag: 'news-review' });
  res.redirect('/news?msg=' + encodeURIComponent("Thanks -- we'll review it shortly."));
});

// Share target: something shared "to Studies Hub" from another app lands here, pre-filled into a News post.
app.post('/share-target', upload.single('photo'), (req, res) => {
  if (!req.user) return res.redirect('/login?next=/news');
  const title = String(req.body.title || '').trim().slice(0, 140);
  const text = String(req.body.text || '').trim();
  const url = String(req.body.url || '').trim();
  const body = [text, url].filter(Boolean).join('\n').trim().slice(0, 2000000);
  const img = req.file && /^image\//.test(req.file.mimetype);
  const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  const imgTag = img ? `<p class="mut" style="margin:10px 0 2px">Photo you shared:</p><img id="shareImgPreview" src="data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}" style="max-width:100%;border-radius:12px;margin-bottom:10px">
<input type="file" name="image" id="shareImg" accept="image/*" style="display:none">
<script>fetch(document.getElementById('shareImgPreview').src).then(function(r){return r.blob()}).then(function(b){var f=new File([b],'shared.${EXT[req.file.mimetype] || 'jpg'}',{type:'${req.file.mimetype}'});var dt=new DataTransfer();dt.items.add(f);document.getElementById('shareImg').files=dt.files})</script>` : '';
  res.send(layout('Share to News', `<p class="mut"><a href="/news">&larr; Back</a></p><h1 style="font-size:24px">Share to News</h1>
<p class="mut">Finish this up and it'll go to a news admin for approval, same as posting from the News page.</p>
<form class="card" method="post" action="/news" enctype="multipart/form-data">
<input name="title" placeholder="Headline" required maxlength="140" value="${esc(title)}">
<textarea name="body" required maxlength="2000000" style="width:100%;min-height:100px;font:inherit;padding:11px 13px;margin:6px 0;color:var(--fg);background:rgba(8,10,22,.65);border:1px solid var(--line);border-radius:10px">${esc(body)}</textarea>
${imgTag}
<button>Submit for review</button></form>`, req.user));
});
// Protocol handler target: web+studieshub://... links land here and get redirected to the matching page.
app.get('/open', (req, res) => {
  const raw = String(req.query.u || '');
  const m = raw.match(/^web\+studieshub:\/\/(.*)$/i);
  let dest = m ? '/' + m[1].replace(/^\/+/, '') : raw;
  if (!dest.startsWith('/') || dest.startsWith('//') || dest.includes('://')) dest = '/dashboard';
  res.redirect(dest);
});

// A member's profile: what they've chosen to share (university, department, level, their verified position) plus their approved news.
// /@username opens that member's profile (this is where every tapped @username in chat, news and posts leads).
app.get('/@:username', (req, res) => {
  if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  const u = db.prepare('SELECT id FROM users WHERE lower(username)=?').get(cleanUsername(req.params.username));
  if (!u) return res.status(404).send(layout('Not found', `<p class="mut"><a href="javascript:history.back()">&larr; Back</a></p><h2>No member with that username</h2><p class="mut">@${esc(cleanUsername(req.params.username))} does not exist (or has not finished signing up).</p>`, req.user));
  res.redirect('/u/' + u.id);
});
app.get('/u/:id', (req, res) => {
  if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  const u = db.prepare('SELECT id,name,title,position_auto_role,avatar_mime,username,department,university,level,last_seen,hide_active FROM users WHERE id=?').get(Number(req.params.id));
  if (!u) return res.status(404).send(layout('Not found', '<h2>Member not found</h2>', req.user));
  const facts = [['University', u.university], ['Department', u.department], ['Level', u.level ? u.level + ' level' : null]].filter(r => r[1])
    .map(r => `<tr><td class="mut">${r[0]}</td><td>${esc(String(r[1]))}</td></tr>`).join('');
  const posts = db.prepare("SELECT id,title,created_at FROM news WHERE author_id=? AND status='approved' ORDER BY id DESC LIMIT 5").all(u.id);
  const me = u.id === req.user.id, areFriends = !me && friendStatus(req.user.id, u.id) === 'friends';
  const action = me ? '<a class="btn ghost" href="/settings/profile">Edit my profile</a>'
    : areFriends ? `<a class="btn" href="/chat/${u.id}">Message ${esc(u.name.split(' ')[0])}</a>`
    : friendActionHtml(req.user.id, u.id);
  res.send(layout(u.name, `<p class="mut" style="margin:0 0 12px"><a href="javascript:history.back()">&larr; Back</a></p>
<div class="card"><div class="prof">${avatarOr(u, 88)}<div><h1 style="margin:0;font-size:26px">${esc(u.name)}</h1><p class="mut" style="margin:2px 0 0">${u.username ? `@${esc(u.username)}` : ''}</p>${u.title ? `<span class="role-tag" style="margin:4px 0 0">${esc(u.title)}</span>${verifiedBadge(u.position_auto_role)}` : ''}<div class="mut" style="margin-top:6px">${presenceDot(u)}${isOnline(u) ? 'Online now' : 'Offline'}</div></div></div>
${facts ? `<table style="margin-top:14px">${facts}</table>` : '<p class="mut" style="margin:14px 0 0">No department, university or level added yet.</p>'}
<p style="margin:14px 0 0">${action}</p></div>
${posts.length ? `<h3>News from ${esc(u.name.split(' ')[0])}</h3>${posts.map(p => `<div class="card row"><a href="/news/${p.id}">${esc(p.title)}</a><span class="mut">${timeAgo(p.created_at)}</span></div>`).join('')}` : ''}`, req.user));
});

// ---------- chat: encrypted messages between any two users ----------
const avatarOr = (u, size = 44) => u.avatar_mime ? `<img src="/avatar/${u.id}" class="av" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover">` : `<span class="avatar av" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.36)}px">${esc((u.name || '?').trim().charAt(0).toUpperCase() || '?')}</span>`;
const groupAvatarOr = (g, size = 44) => g.avatar_mime ? `<img src="/group-avatar/${g.id}" class="av" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover">` : `<span class="avatar av" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.44)}px">👥</span>`;
// A verified position that carries real admin capability gets a small badge next to the name, wherever it shows.
const verifiedBadge = autoRole => autoRole ? ' <span class="verified-badge" title="Verified admin">&#10003;</span>' : '';
const byline = n => `${esc(n.author || 'Studies Hub')}${n.author_title ? `<span class="role-tag">${esc(n.author_title)}</span>` : ''}${verifiedBadge(n.author_auto_role)}`;

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
function friendActionHtml(viewerId, otherId) {
  const st = friendStatus(viewerId, otherId);
  if (st === 'friends') return `<a class="btn" href="/chat/${otherId}">Message</a>`;
  if (st === 'sent') return '<span class="pill">Friend request sent</span>';
  if (st === 'received') return `<form method="post" action="/api/friends/${otherId}/accept" style="display:inline"><button>Accept friend request</button></form>`;
  return `<form method="post" action="/api/friends/${otherId}/request" style="display:inline"><button class="ghost">Add friend</button></form>`;
}
app.post('/api/friends/:id/request', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const otherId = Number(req.params.id);
  if (!otherId || otherId === req.user.id || !db.prepare('SELECT 1 FROM users WHERE id=?').get(otherId)) return res.status(400).json({ error: 'User not found.' });
  const st = friendStatus(req.user.id, otherId);
  if (st === 'received') { db.prepare("UPDATE friendships SET status='friends' WHERE requester_id=? AND addressee_id=?").run(otherId, req.user.id); }
  else if (st === 'none') {
    db.prepare("INSERT INTO friendships(requester_id,addressee_id,status) VALUES(?,?,'pending')").run(req.user.id, otherId);
    notify([otherId], { title: 'New friend request', body: `${req.user.name} wants to add you`, url: '/chat?tab=find', tag: 'friend-request' });
  }
  res.redirect('back' in req.body ? req.body.back : ('/u/' + otherId));
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

// ---------- groups ----------
const isGroupMember = (gid, uid) => !!db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(gid, uid);
const isGroupAdmin = (gid, uid) => { const r = db.prepare('SELECT role FROM group_members WHERE group_id=? AND user_id=?').get(gid, uid); return !!r && r.role === 'admin'; };
const groupMembers = gid => db.prepare('SELECT u.id,u.name,u.avatar_mime,u.last_seen,gm.role FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.group_id=? ORDER BY gm.role DESC, u.name').all(gid);
app.get('/chat/group/new', (req, res) => {
  if (!req.user) return res.redirect('/login?next=/chat/group/new');
  const friends = db.prepare('SELECT id,name,avatar_mime FROM users WHERE id IN (' + (friendIds(req.user.id).join(',') || '0') + ') ORDER BY name').all();
  if (!friends.length) return res.send(layout('New group', '<p class="mut"><a href="/chat">&larr; Chat</a></p><h1>New group</h1><p class="mut">Add some friends first -- a group is made from your friends list.</p>', req.user));
  res.send(layout('New group', `<p class="mut"><a href="/chat">&larr; Chat</a></p><h1>New group</h1>
<form method="post" action="/chat/group/new" class="card"><input name="name" placeholder="Group name" required maxlength="60">
${friends.map(f => `<label class="row" style="justify-content:flex-start;gap:10px"><input type="checkbox" name="member" value="${f.id}" style="width:auto">${avatarOr(f, 32)}${esc(f.name)}</label>`).join('')}
<button>Create group</button></form>`, req.user));
});
app.post('/chat/group/new', (req, res) => {
  if (!req.user) return res.redirect('/login?next=/chat/group/new');
  const name = String(req.body.name || '').trim().slice(0, 60);
  const picked = (Array.isArray(req.body.member) ? req.body.member : req.body.member ? [req.body.member] : []).map(Number).filter(id => friendIds(req.user.id).includes(id));
  if (!name || !picked.length) return res.redirect('/chat/group/new');
  const info = db.prepare('INSERT INTO groups(name,created_by) VALUES(?,?)').run(name, req.user.id);
  const gid = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO group_members(group_id,user_id,role) VALUES(?,?,'admin')").run(gid, req.user.id);
  const addMember = db.prepare("INSERT INTO group_members(group_id,user_id,role) VALUES(?,?,'member')");
  for (const uid of picked) addMember.run(gid, uid);
  notify(picked, { title: 'Added to a group', body: `${req.user.name} added you to "${name}"`, url: '/chat/group/' + gid, tag: 'group' });
  res.redirect('/chat/group/' + gid);
});
app.post('/chat/group/:id/add', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const gid = Number(req.params.id);
  if (!isGroupAdmin(gid, req.user.id)) return res.sendStatus(403);
  const uid = Number(req.body.user_id);
  if (!friendIds(req.user.id).includes(uid)) return res.redirect(`/chat/group/${gid}?msg=` + encodeURIComponent('Only your friends can be added.'));
  db.prepare("INSERT OR IGNORE INTO group_members(group_id,user_id,role) VALUES(?,?,'member')").run(gid, uid);
  const g = db.prepare('SELECT name FROM groups WHERE id=?').get(gid);
  notify([uid], { title: 'Added to a group', body: `You were added to "${g.name}"`, url: '/chat/group/' + gid, tag: 'group' });
  res.redirect('/chat/group/' + gid);
});
app.post('/chat/group/:id/remove/:uid', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const gid = Number(req.params.id), uid = Number(req.params.uid);
  if (!isGroupAdmin(gid, req.user.id) || uid === req.user.id) return res.sendStatus(403);
  db.prepare('DELETE FROM group_members WHERE group_id=? AND user_id=?').run(gid, uid);
  res.redirect('/chat/group/' + gid);
});
app.post('/chat/group/:id/leave', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const gid = Number(req.params.id);
  const wasAdmin = isGroupAdmin(gid, req.user.id); // must check BEFORE deleting -- the row won't exist after
  db.prepare('DELETE FROM group_members WHERE group_id=? AND user_id=?').run(gid, req.user.id);
  if (wasAdmin) {
    const next = db.prepare('SELECT user_id FROM group_members WHERE group_id=? ORDER BY added_at, user_id LIMIT 1').get(gid);
    if (next) db.prepare("UPDATE group_members SET role='admin' WHERE group_id=? AND user_id=?").run(gid, next.user_id);
  }
  if (!db.prepare('SELECT 1 FROM group_members WHERE group_id=?').get(gid)) db.prepare('DELETE FROM groups WHERE id=?').run(gid);
  res.redirect('/chat');
});
app.post('/chat/group/:id/rename', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const gid = Number(req.params.id);
  if (!isGroupAdmin(gid, req.user.id)) return res.sendStatus(403);
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (name) db.prepare('UPDATE groups SET name=? WHERE id=?').run(name, gid);
  res.redirect('/chat/group/' + gid);
});
// A group can have more than one admin -- any admin can make another member an admin too.
app.post('/chat/group/:id/promote/:uid', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const gid = Number(req.params.id), uid = Number(req.params.uid);
  if (!isGroupAdmin(gid, req.user.id) || !isGroupMember(gid, uid)) return res.sendStatus(403);
  db.prepare("UPDATE group_members SET role='admin' WHERE group_id=? AND user_id=?").run(gid, uid);
  notify([uid], { title: 'You are now a group admin', body: db.prepare('SELECT name FROM groups WHERE id=?').get(gid).name, url: '/chat/group/' + gid, tag: 'group' });
  res.redirect('/chat/group/' + gid);
});
app.post('/chat/group/:id/demote/:uid', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const gid = Number(req.params.id), uid = Number(req.params.uid);
  if (!isGroupAdmin(gid, req.user.id)) return res.sendStatus(403);
  const adminCount = db.prepare("SELECT COUNT(*) n FROM group_members WHERE group_id=? AND role='admin'").get(gid).n;
  if (adminCount <= 1) return res.redirect(`/chat/group/${gid}?msg=` + encodeURIComponent('A group needs at least one admin.'));
  db.prepare("UPDATE group_members SET role='member' WHERE group_id=? AND user_id=?").run(gid, uid);
  res.redirect('/chat/group/' + gid);
});
app.post('/chat/group/:id/avatar', upload.single('file'), (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const gid = Number(req.params.id);
  if (!isGroupAdmin(gid, req.user.id)) return res.sendStatus(403);
  if (!req.file || !/^image\/(png|jpeg|webp)$/.test(req.file.mimetype)) return res.redirect(`/chat/group/${gid}?msg=` + encodeURIComponent('Choose a PNG, JPEG or WebP picture.'));
  db.prepare('UPDATE groups SET avatar_data=?, avatar_mime=? WHERE id=?').run(req.file.buffer, req.file.mimetype, gid);
  res.redirect('/chat/group/' + gid);
});
app.get('/group-avatar/:id', (req, res) => {
  const g = db.prepare('SELECT avatar_data, avatar_mime FROM groups WHERE id=?').get(req.params.id);
  if (!g || !g.avatar_data) return res.sendStatus(404);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Content-Type', g.avatar_mime || 'application/octet-stream');
  res.send(Buffer.from(g.avatar_data));
});

// ---------- messages: ticks, reactions, edit, delete (shared by DMs and groups) ----------
const lastMessageWith = (me, other) => db.prepare('SELECT * FROM messages WHERE group_id IS NULL AND ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)) ORDER BY id DESC LIMIT 1').get(me, other, other, me);
const lastGroupMessage = gid => db.prepare('SELECT * FROM messages WHERE group_id=? ORDER BY id DESC LIMIT 1').get(gid);
const isRead = (mid, uid) => !!db.prepare('SELECT 1 FROM message_reads WHERE message_id=? AND user_id=?').get(mid, uid);
const isHiddenFor = (mid, uid) => !!db.prepare('SELECT 1 FROM message_hidden WHERE message_id=? AND user_id=?').get(mid, uid);
// Delivered is permanent: the first time the recipient is online after a message was sent, it is stamped on the message, so the
// double tick never goes back to a single tick when they go offline again (or when the page is refreshed).
function markDelivered(recipientId) {
  db.prepare('UPDATE messages SET delivered_at=CURRENT_TIMESTAMP WHERE recipient_id=? AND group_id IS NULL AND delivered_at IS NULL').run(recipientId);
}
function tickFor(m, recipientId) {
  if (isRead(m.id, recipientId)) return 'read';
  if (m.delivered_at) return 'delivered';
  const other = db.prepare('SELECT last_seen FROM users WHERE id=?').get(recipientId);
  if (other && isOnline(other)) { markDelivered(recipientId); return 'delivered'; }
  return 'sent';
}
const fmtCallSecs = n => n >= 60 ? `${Math.floor(n / 60)} min${n % 60 ? ` ${n % 60} sec` : ''}` : `${n} sec`;
function callInfo(m, meId) {
  let d = {}; try { d = JSON.parse(decryptMsg(m.body_enc, m.iv)); } catch (e) { /* unreadable log line */ }
  const video = d.k === 'video', name = video ? 'Video call' : 'Voice call', mine = m.sender_id === meId;
  const out = { icon: video ? '📹' : '📞', bad: false };
  if (d.s === 'ended') out.text = `${name} · ${fmtCallSecs(d.d || 1)}`;
  else if (d.s === 'declined') out.text = `${name} · Declined`;
  else if (mine) out.text = `${name} · No answer`;
  else { out.text = `Missed ${video ? 'video' : 'voice'} call`; out.bad = true; }
  return out;
}
const snipFor = (m, me) => m.kind === 'call' ? (c => c.icon + ' ' + c.text)(callInfo(m, me)) : snippetOf(m);
const isStarred = (mid, uid) => !!db.prepare('SELECT 1 FROM message_stars WHERE message_id=? AND user_id=?').get(mid, uid);
const tickSpan = st => ({ read: '<span class="tick tick-read">&#10003;&#10003;</span>', delivered: '<span class="tick tick-un">&#10003;&#10003;</span>', sent: '<span class="tick tick-un">&#10003;</span>' })[st] || '';
function reactionsFor(mid) {
  const rows = db.prepare('SELECT emoji, COUNT(*) n FROM message_reactions WHERE message_id=? GROUP BY emoji').all(mid);
  const out = {}; for (const r of rows) out[r.emoji] = r.n; return out;
}
function markRead(rows, viewerId) {
  const ins = db.prepare('INSERT OR IGNORE INTO message_reads(message_id,user_id) VALUES(?,?)');
  for (const m of rows) if (m.sender_id !== viewerId && !isRead(m.id, viewerId)) ins.run(m.id, viewerId);
}
const clock = iso => new Date(iso + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function fmtBytes(n) { n = Number(n) || 0; if (n < 1024) return n + ' B'; if (n < 1048576) return Math.max(1, Math.round(n / 1024)) + ' KB'; if (n < 1073741824) return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB'; return (n / 1073741824).toFixed(1) + ' GB'; }
const MEDIA_KINDS = ['image', 'video', 'file'];
const mediaSizeOf = m => m.media_size || (m.media_enc ? Math.max(0, m.media_enc.length - 16) : 0);
const isPendingMedia = m => MEDIA_KINDS.includes(m.kind) && !m.media_enc && !m.deleted_at;
const MEDIA_ICON = { image: '&#128444;&#65039;', video: '&#127916;', sticker: '&#128512;' };
const MEDIA_LABEL = { image: 'Photo', video: 'Video', sticker: 'Sticker' };
const fmtDur = ms => { const t = Math.round((ms || 0) / 1000); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
const fmtSize = b => b == null ? '' : b < 1024 * 1024 ? Math.round(b / 1024) + ' KB' : (b / (1024 * 1024)).toFixed(1) + ' MB';
const snippetOf = m => m.deleted_at ? 'Message deleted' : m.kind === 'call' ? '📞 Call' : m.kind === 'voice' ? '🎤 Voice note' : m.kind === 'sticker' ? 'Sticker' : m.kind === 'image' ? '📷 Photo' : m.kind === 'video' ? '🎬 Video' : m.kind === 'file' ? `📄 ${m.media_name || 'File'}` : decryptMsg(m.body_enc, m.iv).slice(0, 40);
function messageReplyInfo(m, viewerId, isGroup) {
  if (!m.reply_to_id || m.deleted_at) return null;
  const parent = db.prepare('SELECT * FROM messages WHERE id=?').get(m.reply_to_id);
  if (!parent || parent.deleted_at) return null;
  const sameConversation = isGroup
    ? !!m.group_id && parent.group_id === m.group_id
    : !m.group_id && !parent.group_id && (
        (parent.sender_id === m.sender_id && parent.recipient_id === m.recipient_id) ||
        (parent.sender_id === m.recipient_id && parent.recipient_id === m.sender_id)
      );
  if (!sameConversation || isHiddenFor(parent.id, viewerId)) return null;
  const author = db.prepare('SELECT name FROM users WHERE id=?').get(parent.sender_id);
  return {
    id: parent.id,
    from_name: parent.sender_id === viewerId ? 'You' : (author ? author.name : 'Member'),
    text: parent.kind === 'voice' ? '🎤 Voice note · ' + fmtDur(parent.media_ms) : snippetOf(parent),
    kind: parent.kind || 'text'
  };
}
function replyPreviewHtml(m, viewerId, isGroup) {
  const reply = messageReplyInfo(m, viewerId, isGroup);
  if (!reply) return '';
  const thumb = MEDIA_ICON[reply.kind] ? `<span class="rp-ico">${MEDIA_ICON[reply.kind]}</span>` : '';
  return `<div class="reply-preview" data-reply-to="${reply.id}"><div class="rp-body"><b class="rp-name">${esc(reply.from_name)}</b><span class="rp-text">${esc(reply.text)}</span></div>${thumb}</div>`;
}
function bubbleHtml(m, meId, isGroup) {
  const side = m.sender_id === meId ? 'me' : 'them';
  if (m.kind === 'call') { const c = callInfo(m, meId); return `<div class="call-entry${c.bad ? ' missed' : ''}" data-id="${m.id}" data-kind="call"><span>${c.icon}</span><span>${esc(c.text)}</span><time data-t="${esc(m.created_at)}">${clock(m.created_at)}</time></div>`; }
  const reactions = reactionsFor(m.id);
  const reactHtml = Object.keys(reactions).length ? `<div class="reactions">${Object.entries(reactions).map(([e, n]) => `<span class="rchip">${e} ${n}</span>`).join('')}</div>` : '';
  const senderTag = isGroup && side === 'them' ? `<div class="sender-name">${esc(m.sender_name || '')}</div>` : '';
  const tick = side === 'me' && !isGroup ? `<span class="tickwrap" data-tick="1">${(() => { const html = { read: ' <span class="tick tick-read">&#10003;&#10003;</span>', delivered: ' <span class="tick tick-un">&#10003;&#10003;</span>', sent: ' <span class="tick tick-un">&#10003;</span>' }; return html[tickFor(m, m.recipient_id)] || ''; })()}</span>` : '';
  const fwd = m.forwarded ? '<div class="fwd">&#8618; Forwarded</div>' : '';
  const starred = isStarred(m.id, meId), starAttr = starred ? ' data-starred="1"' : '', starMark = starred ? '<span class="starmark"> &#9733;</span>' : '';
  if (m.deleted_at) return `<div class="bubble ${side} deleted" data-id="${m.id}"${starAttr} data-kind="${m.kind}">${senderTag}<span class="mut">This message was deleted</span><time data-t="${esc(m.created_at)}">${clock(m.created_at)}</time></div>`;
  if (m.kind === 'voice') return `<div class="bubble ${side}" data-id="${m.id}"${starAttr} data-kind="voice">${senderTag}${fwd}${replyPreviewHtml(m, meId, isGroup)}<audio controls preload="none" src="/api/messages/media/${m.id}"></audio>${reactHtml}<time data-t="${esc(m.created_at)}" data-pre="🎤 ${fmtDur(m.media_ms)} &middot; ">🎤 ${fmtDur(m.media_ms)} &middot; ${clock(m.created_at)}${starMark}${tick}</time></div>`;
  const mcard = `<div class="mcard mc-${m.kind}" data-mid="${m.id}" data-mk="${m.kind}" data-size="${mediaSizeOf(m)}" data-name="${esc(m.media_name || '')}"${isPendingMedia(m) ? ' data-pending="1"' : ''}><div class="mc-ph"><span class="mc-ico">${MEDIA_ICON[m.kind] || ''}</span><span class="mc-lbl">${MEDIA_LABEL[m.kind] || ''} &middot; ${fmtBytes(mediaSizeOf(m))}</span></div></div>`;
  const stamp = `<time data-t="${esc(m.created_at)}">${clock(m.created_at)}${starMark}${tick}</time>`;
  if (m.kind === 'sticker') return `<div class="sticker-msg ${side}" data-id="${m.id}"${starAttr} data-kind="sticker">${senderTag}${fwd}${replyPreviewHtml(m, meId, isGroup)}${mcard}${side === 'them' ? `<button type="button" class="link save-st" data-save="${m.id}">+ Save sticker</button>` : ''}${reactHtml}${stamp}</div>`;
  if (m.kind === 'image' || m.kind === 'video') return `<div class="bubble ${side} img-msg" data-id="${m.id}"${starAttr} data-kind="${m.kind}">${senderTag}${fwd}${replyPreviewHtml(m, meId, isGroup)}${mcard}${reactHtml}${stamp}</div>`;
  if (m.kind === 'file') {
    const nm = esc(m.media_name || 'File'), sz = fmtBytes(mediaSizeOf(m));
    const chip = isPendingMedia(m)
      ? `<div class="file-chip pending" data-fid="${m.id}"><span class="fc-ico">&#128196;</span><span class="fc-main"><span class="file-name">${nm}</span><span class="fc-size">${sz} &middot; Sending&hellip;</span></span><span class="mc-spin"></span></div>`
      : `<a class="file-chip" href="/api/messages/media/${m.id}?dl=1" download="${nm}"><span class="fc-ico">&#128196;</span><span class="fc-main"><span class="file-name">${nm}</span><span class="fc-size">${sz}</span></span><span class="fc-dl">&#11015;</span></a>`;
    return `<div class="bubble ${side}" data-id="${m.id}"${starAttr} data-kind="file">${senderTag}${fwd}${chip}${reactHtml}${stamp}</div>`;
  }
  return `<div class="bubble ${side}" data-id="${m.id}"${starAttr} data-kind="text">${senderTag}${fwd}${replyPreviewHtml(m, meId, isGroup)}<span class="msg-text">${linkify(decryptMsg(m.body_enc, m.iv))}</span>${m.edited_at ? '<span class="mut"> (edited)</span>' : ''}${reactHtml}<time data-t="${esc(m.created_at)}">${clock(m.created_at)}${starMark}${tick}</time></div>`;
}

// ---------- chat list preferences: pin (max 3), archive, mute, favourites, mark as unread, clear chat ----------
const prefsOf = uid => { const m = {}; for (const p of db.prepare('SELECT * FROM chat_prefs WHERE user_id=?').all(uid)) m[p.kind + ':' + p.target_id] = p; return m; };
const isMutedChat = (uid, kind, target) => !!db.prepare('SELECT 1 FROM chat_prefs WHERE user_id=? AND kind=? AND target_id=? AND muted=1').get(uid, kind, target);
const setChatPref = (uid, kind, target, col, val) => {
  if (!['pinned_at', 'archived_upto', 'muted', 'favorite', 'unread_mark'].includes(col)) return;
  db.prepare('INSERT OR IGNORE INTO chat_prefs(user_id,kind,target_id) VALUES(?,?,?)').run(uid, kind, target);
  db.prepare(`UPDATE chat_prefs SET ${col}=? WHERE user_id=? AND kind=? AND target_id=?`).run(val, uid, kind, target);
};
const clearUnreadMark = (uid, kind, target) => db.prepare('UPDATE chat_prefs SET unread_mark=0 WHERE user_id=? AND kind=? AND target_id=? AND unread_mark=1').run(uid, kind, target);
const convMessages = (uid, kind, target) => kind === 'group'
  ? db.prepare('SELECT * FROM messages WHERE group_id=?').all(target)
  : db.prepare('SELECT * FROM messages WHERE group_id IS NULL AND ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?))').all(uid, target, target, uid);
app.post('/api/chats/prefs', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const me = req.user.id, action = String((req.body && req.body.action) || '');
  const items = (Array.isArray(req.body && req.body.items) ? req.body.items : []).slice(0, 50).map(i => ({ kind: i && i.kind === 'group' ? 'group' : (i && i.kind === 'dm' ? 'dm' : ''), id: Number(i && i.id) })).filter(i => i.kind && Number.isSafeInteger(i.id) && i.id > 0)
    .filter(i => i.kind === 'group' ? isGroupMember(i.id, me) : (i.id !== me && friendStatus(me, i.id) === 'friends'));
  if (!items.length) return res.status(400).json({ error: 'Choose a chat first.' });
  if (action === 'pin') {
    const already = db.prepare('SELECT kind,target_id FROM chat_prefs WHERE user_id=? AND pinned_at IS NOT NULL').all(me).filter(p => !items.some(i => i.kind === p.kind && i.id === p.target_id)).length;
    if (already + items.length > 3) return res.status(400).json({ error: 'You can pin up to 3 chats.' });
  }
  const now = Date.now();
  for (const it of items) {
    if (action === 'pin') setChatPref(me, it.kind, it.id, 'pinned_at', now);
    else if (action === 'unpin') setChatPref(me, it.kind, it.id, 'pinned_at', null);
    else if (action === 'archive') { const last = convMessages(me, it.kind, it.id).reduce((n, m) => Math.max(n, m.id), 0); setChatPref(me, it.kind, it.id, 'archived_upto', last); setChatPref(me, it.kind, it.id, 'pinned_at', null); }
    else if (action === 'unarchive') setChatPref(me, it.kind, it.id, 'archived_upto', null);
    else if (action === 'mute') setChatPref(me, it.kind, it.id, 'muted', 1);
    else if (action === 'unmute') setChatPref(me, it.kind, it.id, 'muted', 0);
    else if (action === 'favorite') setChatPref(me, it.kind, it.id, 'favorite', 1);
    else if (action === 'unfavorite') setChatPref(me, it.kind, it.id, 'favorite', 0);
    else if (action === 'mark_unread') setChatPref(me, it.kind, it.id, 'unread_mark', 1);
    else if (action === 'mark_read') { setChatPref(me, it.kind, it.id, 'unread_mark', 0); markRead(convMessages(me, it.kind, it.id), me); }
    else if (action === 'clear') { // clear chat = hide every message for this person only (the other side keeps theirs)
      const msgs = convMessages(me, it.kind, it.id), hide = db.prepare('INSERT OR IGNORE INTO message_hidden(message_id,user_id) VALUES(?,?)');
      for (const m of msgs) hide.run(m.id, me);
      markRead(msgs, me); setChatPref(me, it.kind, it.id, 'unread_mark', 0);
    } else return res.status(400).json({ error: 'Unknown action.' });
  }
  res.json({ ok: true });
});

// ---------- star, forward and message info ----------
const canSeeMsg = (uid, m) => !!m && !isHiddenFor(m.id, uid) && (m.group_id ? isGroupMember(m.group_id, uid) : (m.sender_id === uid || m.recipient_id === uid));
const cleanIds = (v, max) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter(n => Number.isSafeInteger(n) && n > 0))].slice(0, max);
app.post('/api/messages/star', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const on = !!(req.body && req.body.on), me = req.user.id;
  let n = 0;
  for (const id of cleanIds(req.body && req.body.ids, 50)) {
    const m = db.prepare('SELECT * FROM messages WHERE id=?').get(id);
    if (!canSeeMsg(me, m) || m.deleted_at || m.kind === 'call') continue;
    if (on) db.prepare('INSERT OR IGNORE INTO message_stars(user_id,message_id) VALUES(?,?)').run(me, id);
    else db.prepare('DELETE FROM message_stars WHERE user_id=? AND message_id=?').run(me, id);
    n++;
  }
  res.json({ ok: true, count: n });
});
app.get('/api/chats/targets', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const me = req.user.id;
  const dms = db.prepare('SELECT id,name FROM users WHERE id IN (' + (friendIds(me).join(',') || '0') + ') ORDER BY name').all().map(u => ({ kind: 'dm', id: u.id, name: u.name }));
  const groups = db.prepare('SELECT g.id,g.name FROM groups g JOIN group_members gm ON gm.group_id=g.id WHERE gm.user_id=? ORDER BY g.name').all(me).map(g => ({ kind: 'group', id: g.id, name: g.name }));
  res.json({ targets: groups.concat(dms) });
});
app.post('/api/messages/forward', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const me = req.user.id;
  if (limited('fwd:' + me, 10, 60e3)) return res.status(429).json({ error: 'Slow down a little.' });
  const targets = (Array.isArray(req.body && req.body.targets) ? req.body.targets : []).slice(0, 5).map(t => t && t.kind === 'group'
    ? (isGroupMember(Number(t.id), me) ? { recipient_id: 0, group_id: Number(t.id) } : null)
    : (t && Number(t.id) !== me && friendStatus(me, Number(t.id)) === 'friends' ? { recipient_id: Number(t.id), group_id: null } : null)).filter(Boolean);
  const msgs = cleanIds(req.body && req.body.ids, 10).map(id => db.prepare('SELECT * FROM messages WHERE id=?').get(id)).filter(m => canSeeMsg(me, m) && !m.deleted_at).sort((a, b) => a.id - b.id);
  if (!targets.length || !msgs.length) return res.status(400).json({ error: 'Choose who to forward to.' });
  let count = 0;
  for (const t of targets) for (const m of msgs) {
    let newId = 0, preview = '';
    if (m.kind === 'text' || !m.kind) {
      const text = decryptMsg(m.body_enc, m.iv), enc = encryptMsg(text);
      newId = Number(db.prepare('INSERT INTO messages(sender_id,recipient_id,group_id,body_enc,iv,forwarded) VALUES(?,?,?,?,?,1)').run(me, t.recipient_id, t.group_id, enc.body_enc, enc.iv).lastInsertRowid);
      preview = text.slice(0, 120);
    } else if (m.media_enc) {
      const buf = decryptBytes(m.media_enc, m.media_iv);
      if (!buf) continue;
      newId = insertMedia(me, t, m.kind, buf, m.media_mime, m.media_ms, m.media_name, null).id;
      db.prepare('UPDATE messages SET forwarded=1 WHERE id=?').run(newId);
      preview = m.kind === 'voice' ? '🎤 Voice note' : m.kind === 'sticker' ? 'Sticker' : m.kind === 'image' ? '📷 Photo' : m.kind === 'video' ? '🎬 Video' : `📄 ${(m.media_name || 'File').slice(0, 60)}`;
    } else continue;
    count++;
    notifyNewMessage(req.user, t, '↪ ' + preview, newId);
  }
  res.json({ ok: true, count });
});
// Message info: who has received / read a message you sent.
app.get('/api/messages/:id/info', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const me = req.user.id, m = db.prepare('SELECT * FROM messages WHERE id=?').get(Number(req.params.id));
  if (!canSeeMsg(me, m) || m.sender_id !== me || m.deleted_at) return res.sendStatus(404);
  if (m.group_id) {
    const reads = Object.fromEntries(db.prepare('SELECT user_id,read_at FROM message_reads WHERE message_id=?').all(m.id).map(r => [r.user_id, r.read_at]));
    const others = groupMembers(m.group_id).filter(u => u.id !== me);
    return res.json({ group: true, sent: m.created_at, read: others.filter(u => reads[u.id]).map(u => ({ name: u.name, at: reads[u.id] })), waiting: others.filter(u => !reads[u.id]).map(u => u.name) });
  }
  const r = db.prepare('SELECT read_at FROM message_reads WHERE message_id=? AND user_id=?').get(m.id, m.recipient_id);
  res.json({ group: false, sent: m.created_at, delivered: m.delivered_at || (r ? r.read_at : null), read: r ? r.read_at : null });
});
// Starred messages: everything you have starred, with a link back to the chat.
app.get('/chat/starred', (req, res) => {
  if (!req.user) return res.redirect('/login?next=/chat/starred');
  const me = req.user.id;
  const rows = db.prepare('SELECT m.* FROM message_stars s JOIN messages m ON m.id=s.message_id WHERE s.user_id=? ORDER BY m.id DESC LIMIT 200').all(me).filter(m => canSeeMsg(me, m) && !m.deleted_at);
  const nameOf = id => (db.prepare('SELECT name FROM users WHERE id=?').get(id) || {}).name || 'Someone';
  const items = rows.map(m => {
    const other = m.group_id ? null : (m.sender_id === me ? m.recipient_id : m.sender_id);
    const where = m.group_id ? (db.prepare('SELECT name FROM groups WHERE id=?').get(m.group_id) || {}).name || 'Group' : nameOf(other);
    const href = m.group_id ? `/chat/group/${m.group_id}` : `/chat/${other}`;
    const body = m.kind === 'text' || !m.kind ? esc(decryptMsg(m.body_enc, m.iv).slice(0, 300)) : snippetOf(m);
    return `<div class="card star-item" data-id="${m.id}"><a href="${href}" style="color:inherit;display:block"><b>${m.sender_id === me ? 'You' : esc(nameOf(m.sender_id))}</b> <span class="mut">&rsaquo; ${esc(where)} &middot; ${timeAgo(m.created_at)}</span><div style="margin-top:4px;white-space:pre-wrap;word-break:break-word">${body}</div></a><button type="button" class="link unstar" data-id="${m.id}">Remove star</button></div>`;
  }).join('') || '<p class="mut">No starred messages yet. Press and hold a message in a chat, then tap the star.</p>';
  res.send(layout('Starred messages', `<p class="mut" style="margin:0 0 4px"><a href="/chat">&larr; Chat</a></p><h1>Starred messages</h1>${items}<script>document.addEventListener('click',function(e){var b=e.target.closest('.unstar');if(!b)return;fetch('/api/messages/star',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[Number(b.getAttribute('data-id'))],on:false})}).then(function(){var c=b.closest('.star-item');if(c)c.remove()})})</script>`, req.user));
});

app.get('/chat', (req, res) => {
  if (!req.user) return res.redirect('/login?next=/chat');
  const me = req.user.id, tab = req.query.tab === 'find' ? 'find' : 'friends';
  const reqCount = pendingReceivedCount(me);
  const tabs = `<div class="row" style="gap:0;border-bottom:1px solid var(--line);margin-bottom:14px">
<a class="tab-link${tab === 'friends' ? ' active' : ''}" href="/chat">Chats</a>
<a class="tab-link${tab === 'find' ? ' active' : ''}" href="/chat?tab=find">Find people${reqCount ? ` <b class="nbadge">${badgeText(reqCount)}</b>` : ''}</a>
</div>`;
  if (tab === 'find') {
    const q = String(req.query.q || '').trim();
    let results = '';
    if (q) {
      const rows = db.prepare("SELECT id,name,username,avatar_mime FROM users WHERE id != ? AND (lower(username) LIKE ? OR lower(name) LIKE ?) LIMIT 20")
        .all(me, '%' + cleanUsername(q) + '%', '%' + q.toLowerCase() + '%');
      results = rows.length ? rows.map(u => `<div class="chat-item row">${avatarOr(u)}<span class="meta" style="flex:1"><b><a href="/u/${u.id}" style="color:inherit">${esc(u.name)}</a></b><span>${u.username ? atLink(u.username) : ''}</span></span>${friendActionHtml(me, u.id)}</div>`).join('')
        : '<p class="mut">No one found. Try their exact @username.</p>';
    }
    const pending = db.prepare("SELECT u.id,u.name,u.username,u.avatar_mime FROM friendships f JOIN users u ON u.id=f.requester_id WHERE f.addressee_id=? AND f.status='pending' ORDER BY f.id DESC").all(me);
    const pendingHtml = pending.length ? `<p class="chat-label">Friend requests</p>${pending.map(u => `<div class="chat-item row">${avatarOr(u)}<span class="meta" style="flex:1"><b>${esc(u.name)}</b><span>${u.username ? atLink(u.username) : ''}</span></span>
<form method="post" action="/api/friends/${u.id}/accept" style="display:inline"><button>Accept</button></form>
<form method="post" action="/api/friends/${u.id}/decline" style="display:inline"><button class="link">Decline</button></form></div>`).join('')}` : '';
    return res.send(layout('Find people', `<h1>Chat</h1>${tabs}${pendingHtml}<form method="get" action="/chat"><input type="hidden" name="tab" value="find"><input name="q" value="${esc(q)}" placeholder="Search students and admins by @username or name" autocomplete="off"><button class="ghost">Search</button></form>${results}`, req.user));
  }
  const prefs = prefsOf(me);
  const friends = db.prepare('SELECT id,name,avatar_mime,last_seen,hide_active FROM users WHERE id IN (' + (friendIds(me).join(',') || '0') + ')').all();
  const lastVisible = (kind, id) => kind === 'group'
    ? db.prepare('SELECT * FROM messages WHERE group_id=? AND id NOT IN (SELECT message_id FROM message_hidden WHERE user_id=?) ORDER BY id DESC LIMIT 1').get(id, me)
    : db.prepare('SELECT * FROM messages WHERE group_id IS NULL AND ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)) AND id NOT IN (SELECT message_id FROM message_hidden WHERE user_id=?) ORDER BY id DESC LIMIT 1').get(me, id, id, me, me);
  const items = [];
  for (const u of friends) {
    const m = lastVisible('dm', u.id), p = prefs['dm:' + u.id] || {};
    const unread = db.prepare("SELECT COUNT(*) n FROM messages WHERE group_id IS NULL AND sender_id=? AND recipient_id=? AND deleted_at IS NULL AND id NOT IN (SELECT message_id FROM message_reads WHERE user_id=?) AND id NOT IN (SELECT message_id FROM message_hidden WHERE user_id=?)").get(u.id, me, me, me).n;
    const mine = m && m.sender_id === me && !m.deleted_at && m.kind !== 'call' ? tickSpan(tickFor(m, u.id)) + ' ' : '';
    items.push({ kind: 'dm', id: u.id, name: u.name, av: avatarOr(u), m, p, unread, dot: isOnline(u) ? '#22c55e' : '#ef4444',
      sub: m ? `${mine}${snipFor(m, me)} &middot; ${timeAgo(m.created_at)}` : (isOnline(u) ? 'Online now' : 'Offline') });
  }
  for (const g of db.prepare('SELECT g.id,g.name,g.avatar_mime FROM groups g JOIN group_members gm ON gm.group_id=g.id WHERE gm.user_id=?').all(me)) {
    const m = lastVisible('group', g.id), p = prefs['group:' + g.id] || {};
    const unread = db.prepare("SELECT COUNT(*) n FROM messages WHERE group_id=? AND sender_id != ? AND deleted_at IS NULL AND id NOT IN (SELECT message_id FROM message_reads WHERE user_id=?) AND id NOT IN (SELECT message_id FROM message_hidden WHERE user_id=?)").get(g.id, me, me, me).n;
    items.push({ kind: 'group', id: g.id, name: g.name, av: groupAvatarOr(g), m, p, unread, dot: null, sub: m ? `${snipFor(m, me)} &middot; ${timeAgo(m.created_at)}` : 'No messages yet' });
  }
  for (const it of items) it.archived = it.p.archived_upto != null && (!it.m || it.m.id <= it.p.archived_upto); // a new message brings an archived chat back
  items.sort((a, b) => ((b.p.pinned_at ? 1 : 0) - (a.p.pinned_at ? 1 : 0)) || ((b.p.pinned_at || 0) - (a.p.pinned_at || 0)) || ((b.m ? b.m.id : 0) - (a.m ? a.m.id : 0)) || a.name.localeCompare(b.name));
  const itemHtml = it => {
    const href = it.kind === 'group' ? `/chat/group/${it.id}` : `/chat/${it.id}`, p = it.p;
    const badge = it.unread ? `<b class="nbadge${p.muted ? ' nb-muted' : ''}">${badgeText(it.unread)}</b>` : (p.unread_mark ? '<b class="nbadge nb-dot"></b>' : '');
    const icons = (p.muted ? '<span class="ci-ic" title="Muted">&#128277;</span>' : '') + (p.pinned_at ? '<span class="ci-ic" title="Pinned">&#128204;</span>' : '');
    return `<a class="chat-item" href="${href}" data-key="${it.kind}:${it.id}" data-kind="${it.kind}" data-id="${it.id}" data-name="${esc(it.name.toLowerCase())}" data-unread="${it.unread}" data-mark="${p.unread_mark ? 1 : 0}" data-fav="${p.favorite ? 1 : 0}" data-pinned="${p.pinned_at ? 1 : 0}" data-muted="${p.muted ? 1 : 0}" data-archived="${it.archived ? 1 : 0}"><span class="av-wrap" style="position:relative">${it.av}${it.dot ? `<span class="dot" style="position:absolute;right:-2px;bottom:-2px;width:11px;height:11px;border-radius:50%;border:2px solid var(--bg);background:${it.dot}"></span>` : ''}</span><span class="meta"><b>${esc(it.name)}</b><span>${it.sub}</span></span><span class="ci-end">${icons}${badge}</span></a>`;
  };
  const archivedCount = items.filter(i => i.archived).length;
  const listHtml = `<a class="chat-item arch-row" href="#" id="archRow" data-count="${archivedCount}"><span class="arch-ic">&#128229;</span><span class="meta"><b>Archived</b></span><span class="ci-end"><span class="ci-ic" id="archCount">${archivedCount}</span></span></a>`
    + items.map(itemHtml).join('');
  const svg = d => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const listScript = `(function(){
var list=document.getElementById('chatList');if(!list)return;
var bar=document.getElementById('selBar'),cnt=document.getElementById('selCount'),menu=document.getElementById('selMenu'),search=document.getElementById('chatSearch'),empty=document.getElementById('chatEmpty'),archHead=document.getElementById('archHead'),chips=document.getElementById('chipRow');
var sel={},filter='all',query='',arch=false,pressed=false,timer=null,sx=0,sy=0;
function pending(){return new Promise(function(res){try{var rq=indexedDB.open('shq-pending',2);
rq.onupgradeneeded=function(){var d=rq.result;if(!d.objectStoreNames.contains('msgs'))d.createObjectStore('msgs',{keyPath:'id',autoIncrement:true});if(!d.objectStoreNames.contains('uploads'))d.createObjectStore('uploads',{keyPath:'id',autoIncrement:true})};
rq.onsuccess=function(){try{var g=rq.result.transaction('msgs','readonly').objectStore('msgs').getAll();g.onsuccess=function(){res(g.result||[])};g.onerror=function(){res([])}}catch(e){res([])}};rq.onerror=function(){res([])}}catch(e){res([])}})}
function mark(){pending().then(function(items){var latest={};items.forEach(function(it){var p=it.payload||{};if(!p.body)return;latest[p.group?'/chat/group/'+p.group:'/chat/'+p.to]=p.body});
Array.prototype.forEach.call(list.querySelectorAll('a.chat-item'),function(a){var b=latest[a.getAttribute('href')];if(!b)return;var sub=a.querySelector('.meta span');if(!sub)return;sub.innerHTML='';var c=document.createElement('span');c.className='tick tick-queued';c.title='Waiting for a connection';c.textContent='\\u231B';sub.appendChild(c);sub.appendChild(document.createTextNode(' '+b.slice(0,40)))})})}
function rows(){return Array.prototype.slice.call(list.querySelectorAll('a.chat-item[data-key]'))}
function keys(){return Object.keys(sel)}
function rowOf(k){return list.querySelector('a.chat-item[data-key="'+k+'"]')}
function applyView(){
var shown=0,ar=document.getElementById('archRow'),ac=ar?parseInt(ar.getAttribute('data-count'),10)||0:0;
rows().forEach(function(a){var ok=arch?a.getAttribute('data-archived')==='1':a.getAttribute('data-archived')==='0';
if(ok&&filter==='unread')ok=(parseInt(a.getAttribute('data-unread'),10)>0||a.getAttribute('data-mark')==='1');
if(ok&&filter==='fav')ok=a.getAttribute('data-fav')==='1';
if(ok&&filter==='groups')ok=a.getAttribute('data-kind')==='group';
if(ok&&query)ok=a.getAttribute('data-name').indexOf(query)>-1;
a.style.display=ok?'':'none';if(ok)shown++;a.classList.toggle('sel',!!sel[a.getAttribute('data-key')])});
if(ar){ar.style.display=(!arch&&ac>0&&filter==='all'&&!query)?'':'none'}
if(archHead)archHead.style.display=arch?'':'none';
if(chips)chips.style.display=arch?'none':'';
if(empty){empty.style.display=shown?'none':'';empty.textContent=arch?'No archived chats.':(query?'No chats match your search.':(filter==='unread'?'No unread chats.':(filter==='fav'?'No favorites yet. Select a chat and use the menu to add one.':(filter==='groups'?'No groups yet.':'No chats yet. Find friends in the other tab.'))))}
renderBar()}
function renderBar(){var n=keys().length;bar.style.display=n?'flex':'none';if(!n){menu.style.display='none';return}
cnt.textContent=n;var rs=keys().map(rowOf).filter(Boolean);
function all(attr){return rs.length&&rs.every(function(a){return a.getAttribute(attr)==='1'})}
var pin=document.getElementById('selPin'),mute=document.getElementById('selMute'),ar=document.getElementById('selArch');
pin.title=all('data-pinned')?'Unpin chat':'Pin chat';mute.title=all('data-muted')?'Unmute notifications':'Mute notifications';ar.title=arch?'Unarchive':'Archive';
var m=menu.querySelectorAll('button');Array.prototype.forEach.call(m,function(b){var a=b.getAttribute('data-act');
if(a==='view')b.style.display=(rs.length===1&&rs[0].getAttribute('data-kind')==='dm')?'':'none';
if(a==='unread')b.textContent=rs.some(function(a){return a.getAttribute('data-unread')!=='0'||a.getAttribute('data-mark')==='1'})?'Mark as read':'Mark as unread';
if(a==='fav')b.textContent=all('data-fav')?'Remove from favorites':'Add to favorites'})}
function toggle(k){if(sel[k])delete sel[k];else sel[k]=1;applyView()}
function act(action,ks){var items=(ks||keys()).map(function(k){var p=k.split(':');return{kind:p[0],id:parseInt(p[1],10)}});
fetch('/api/chats/prefs',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:items,action:action})}).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})}).then(function(x){if(!x.ok){alert(x.j.error||'Something went wrong.');return}sel={};refresh(true)}).catch(function(){alert('Could not reach the server. Try again.')})}
function allSel(attr){var rs=keys().map(rowOf).filter(Boolean);return rs.length&&rs.every(function(a){return a.getAttribute(attr)==='1'})}
document.getElementById('selClose').onclick=function(){sel={};applyView()};
document.getElementById('selPin').onclick=function(){act(allSel('data-pinned')?'unpin':'pin')};
document.getElementById('selMute').onclick=function(){act(allSel('data-muted')?'unmute':'mute')};
document.getElementById('selArch').onclick=function(){act(arch?'unarchive':'archive')};
document.getElementById('selDel').onclick=function(){if(confirm('Clear the selected chat'+(keys().length>1?'s':'')+'? This only removes the messages for you.'))act('clear')};
document.getElementById('selMore').onclick=function(e){e.stopPropagation();menu.style.display=menu.style.display==='block'?'none':'block'};
document.addEventListener('click',function(e){if(menu&&!menu.contains(e.target))menu.style.display='none'});
menu.onclick=function(e){var b=e.target.closest('button');if(!b)return;var a=b.getAttribute('data-act');menu.style.display='none';
if(a==='view'){var k=keys()[0].split(':');location.href='/u/'+k[1]}
else if(a==='unread'){var rs=keys().map(rowOf).filter(Boolean);act(rs.some(function(r){return r.getAttribute('data-unread')!=='0'||r.getAttribute('data-mark')==='1'})?'mark_read':'mark_unread')}
else if(a==='all'){rows().forEach(function(r){if(r.style.display!=='none')sel[r.getAttribute('data-key')]=1});applyView()}
else if(a==='fav')act(allSel('data-fav')?'unfavorite':'favorite');
else if(a==='clear'){if(confirm('Clear the selected chat'+(keys().length>1?'s':'')+'? This only removes the messages for you.'))act('clear')}};
function cancelPress(){if(timer){clearTimeout(timer);timer=null}}
list.addEventListener('pointerdown',function(e){var a=e.target.closest('a.chat-item[data-key]');if(!a||(e.pointerType==='mouse'&&e.button!==0))return;sx=e.clientX;sy=e.clientY;cancelPress();pressed=false;
timer=setTimeout(function(){timer=null;pressed=true;var k=a.getAttribute('data-key');if(!sel[k])sel[k]=1;if(navigator.vibrate)try{navigator.vibrate(15)}catch(x){}applyView()},450)});
list.addEventListener('pointermove',function(e){if(timer&&(Math.abs(e.clientX-sx)>10||Math.abs(e.clientY-sy)>10))cancelPress()});
['pointerup','pointercancel','pointerleave'].forEach(function(t){list.addEventListener(t,function(){cancelPress();if(pressed&&t!=='pointerleave')setTimeout(function(){pressed=false},80)})});
list.addEventListener('contextmenu',function(e){var a=e.target.closest('a.chat-item[data-key]');if(!a)return;e.preventDefault();pressed=true;sel[a.getAttribute('data-key')]=1;applyView()});
list.addEventListener('click',function(e){var ar=e.target.closest('#archRow');if(ar){e.preventDefault();arch=true;sel={};applyView();return}
var a=e.target.closest('a.chat-item[data-key]');if(!a)return;
if(pressed){e.preventDefault();pressed=false;return}
if(keys().length){e.preventDefault();toggle(a.getAttribute('data-key'))}});
document.getElementById('archBack').onclick=function(){arch=false;sel={};applyView()};
search.addEventListener('input',function(){query=search.value.trim().toLowerCase();applyView()});
chips.addEventListener('click',function(e){var c=e.target.closest('[data-f]');if(!c)return;filter=c.getAttribute('data-f');Array.prototype.forEach.call(chips.querySelectorAll('[data-f]'),function(x){x.classList.toggle('on',x===c)});applyView()});
function refresh(force){if(document.hidden&&force!==true)return;if(!force&&(keys().length||timer))return;fetch('/chat',{cache:'no-store',credentials:'same-origin'}).then(function(r){return r.text()}).then(function(h){var n=new DOMParser().parseFromString(h,'text/html').getElementById('chatList');if(n){list.innerHTML=n.innerHTML;Object.keys(sel).forEach(function(k){if(!rowOf(k))delete sel[k]});applyView();mark()}}).catch(function(){})}
applyView();mark();setInterval(refresh,4000);document.addEventListener('visibilitychange',refresh);window.addEventListener('online',refresh);
})();`;
  const selBar = `<div id="selBar" class="sel-bar" style="display:none"><button type="button" id="selClose" title="Cancel">${svg('<path d="M6 6l12 12M18 6L6 18"/>')}</button><b id="selCount">0</b><span class="sel-sp"></span>
<button type="button" id="selPin" title="Pin chat">${svg('<path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6zM12 14v7"/>')}</button>
<button type="button" id="selMute" title="Mute notifications">${svg('<path d="M6 8a6 6 0 0 1 9-5M18 11c0 4 2 5 2 6H5M10 21h4M3 3l18 18"/>')}</button>
<button type="button" id="selArch" title="Archive">${svg('<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11h14V8M10 12h4"/>')}</button>
<button type="button" id="selDel" title="Clear chat">${svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>')}</button>
<button type="button" id="selMore" title="More">${svg('<circle cx="12" cy="5" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="19" r="1.5" fill="currentColor"/>')}</button>
<div id="selMenu" class="sel-menu" style="display:none"><button type="button" data-act="view">View contact</button><button type="button" data-act="unread">Mark as unread</button><button type="button" data-act="all">Select all</button><button type="button" data-act="fav">Add to favorites</button><button type="button" data-act="clear">Clear chat</button></div></div>`;
  res.send(layout('Chat', `${selBar}<h1>Chat</h1>${tabs}<p style="margin:0 0 10px"><a class="btn ghost" href="/chat/group/new">+ New group</a> <a class="btn ghost" href="/chat/starred">&#9733; Starred</a></p>
<input id="chatSearch" class="chat-search" type="search" placeholder="Search chats" autocomplete="off">
<div id="chipRow" class="chip-row"><button type="button" class="chip on" data-f="all">All</button><button type="button" class="chip" data-f="unread">Unread</button><button type="button" class="chip" data-f="fav">Favorites</button><button type="button" class="chip" data-f="groups">Groups</button></div>
<div id="archHead" class="arch-head" style="display:none"><button type="button" id="archBack" class="link">&larr; Archived chats</button></div>
<div id="chatList">${listHtml}</div><p id="chatEmpty" class="mut" style="display:none"></p><script>${listScript}</script>`, req.user));
});

const CHAT_JS = `(function(){
var myId=__MY__,convType='__CTYPE__',convId=__CID__;
var qs=convType==='group'?('group='+convId):('to='+convId);
var thread=document.getElementById('thread'),form=document.getElementById('sendForm'),input=document.getElementById('msgInput');
function resizeInput(){input.style.height='auto';input.style.height=Math.min(input.scrollHeight,120)+'px'}
input.addEventListener('input',resizeInput);
var panel=document.getElementById('panel'),pBtn=document.getElementById('panelBtn'),micBtn=document.getElementById('micBtn');
var recBar=document.getElementById('recBar'),recTime=document.getElementById('recTime'),recSend=document.getElementById('recSend'),recCancel=document.getElementById('recCancel');
var pEmoji=document.getElementById('pEmoji'),pStickers=document.getElementById('pStickers'),ec=document.getElementById('ecats'),eg=document.getElementById('egrid'),sg=document.getElementById('sgrid'),stFile=document.getElementById('stFile'),stZip=document.getElementById('stZip'),upStatus=document.getElementById('upStatus');
var editingId=null,replyTarget=null,replyBar=document.getElementById('replyBar'),replyWho=document.getElementById('replyWho'),replyWhat=document.getElementById('replyWhat'),replyCancel=document.getElementById('replyCancel'),lastId=parseInt(thread.getAttribute('data-last-id'),10)||0,seen={};
Array.prototype.forEach.call(thread.querySelectorAll('[data-id]'),function(n){seen[n.getAttribute('data-id')]=1});
function fmt(iso){return new Date(iso+'Z').toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}
function dur(ms){var t=Math.round((ms||0)/1000);return Math.floor(t/60)+':'+('0'+(t%60)).slice(-2)}
function stamp(t){var iso=t.getAttribute('data-t');if(!iso)return;var txt=(t.getAttribute('data-pre')||'')+fmt(iso),n=t.firstChild;if(n&&n.nodeType===3)n.nodeValue=txt;else t.insertBefore(document.createTextNode(txt),t.firstChild)}
function el(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e}
${linkTokens.toString()}
${fmtBytes.toString()}
function linkifyInto(container,text){
  linkTokens(text).forEach(function(k){
    if(k.t==='text'){container.appendChild(document.createTextNode(k.v));return}
    var a=document.createElement('a');a.href=k.href;a.className='autolink'+(k.t==='user'?' mention':'');a.textContent=k.v;
    if(k.t==='url'){a.target='_blank';a.rel='noopener noreferrer'}
    container.appendChild(a);
  });
}
function toBottom(){window.scrollTo(0,document.body.scrollHeight)}
function tickHtml(t){if(!t)return'';if(t==='queued')return' <span class="tick tick-queued" title="Waiting for a connection">&#8987;</span>';if(convType==='group')return'';if(t==='read')return' <span class="tick tick-read">&#10003;&#10003;</span>';if(t==='delivered')return' <span class="tick tick-un">&#10003;&#10003;</span>';return' <span class="tick tick-un">&#10003;</span>'}
function clearReply(){replyTarget=null;replyBar.hidden=true;var t=document.getElementById('replyThumb');if(t)t.hidden=true}
var replyThumb=document.getElementById('replyThumb');
function startReply(id){
  var b=thread.querySelector('[data-id="'+id+'"]');if(!b)return;
  var kind=b.getAttribute('data-kind')||'text',textEl=b.querySelector('.msg-text'),fileEl=b.querySelector('.file-name'),tm=b.querySelector('time'),dm=/(\\d+:\\d\\d)/.exec((tm&&tm.getAttribute('data-pre'))||'');
  var text=kind==='voice'?('🎤 Voice note'+(dm?' · '+dm[1]:'')):kind==='sticker'?'Sticker':kind==='image'?'📷 Photo':kind==='video'?'🎬 Video':kind==='file'?('📄 '+(fileEl?fileEl.textContent.trim():'File')):(textEl?textEl.textContent.trim():'Message');
  var author=b.classList.contains('me')?'You':(b.querySelector('.sender-name')?b.querySelector('.sender-name').textContent:(convType==='group'?'Group member':((document.querySelector('.chat-head b')||{}).textContent||'Member')));
  replyTarget={id:Number(id),from_name:author,text:text.slice(0,160)||'Message',kind:kind};
  replyWho.textContent='Replying to '+author;replyWhat.textContent=replyTarget.text;
  replyThumb.hidden=true;replyThumb.removeAttribute('src');
  replyBar.hidden=false;input.focus();
}
replyCancel.addEventListener('click',clearReply);
var REACT_SET=['👍','❤️','😂','😮','😢','🙏'];
function react(id,emoji){fetch('/api/messages/'+id+'/react',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({emoji:emoji})}).then(function(r){return r.json()}).then(function(j){if(j&&j.reactions)renderReactions(id,j.reactions)}).catch(function(){})}
function renderReactions(id,reactions){var b=thread.querySelector('[data-id="'+id+'"]');if(!b)return;var old=b.querySelector('.reactions');if(old)old.remove();
  var keys=Object.keys(reactions||{});if(!keys.length)return;var row=el('div','reactions');keys.forEach(function(em){row.appendChild(el('span','rchip',em+' '+reactions[em]))});
  var t=b.querySelector('time');b.insertBefore(row,t)}
function startEdit(id){var b=thread.querySelector('[data-id="'+id+'"]'),span=b.querySelector('.msg-text');if(!span)return;editingId=id;input.value=span.textContent;resizeInput();input.focus()}
function doDelete(id,scope,skip){if(!skip&&!confirm(scope==='everyone'?'Delete this message for everyone?':'Delete this message for you?'))return;
  fetch('/api/messages/'+id+'/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope:scope})}).then(function(r){return r.json()}).then(function(j){
    var previews=thread.querySelectorAll('.reply-preview[data-reply-to="'+id+'"]');
    Array.prototype.forEach.call(previews,function(p){p.parentNode.removeChild(p)});
    var b=thread.querySelector('[data-id="'+id+'"]');if(!b)return;
    if(scope==='me'){b.parentNode.removeChild(b)}else{b.classList.add('deleted');b.innerHTML='';b.appendChild(el('span','mut','This message was deleted'));var t=el('time');t.setAttribute('data-t',j.created_at||'');stamp(t);b.appendChild(t)}
  }).catch(function(){})}
function senderTag(m){if(convType!=='group'||m.from===myId)return'';return el('div','sender-name',m.from_name||'')}
function replyBox(r){var rp=el('div','reply-preview'),bd=el('div','rp-body');rp.setAttribute('data-reply-to',r.id||'');bd.appendChild(el('b','rp-name',r.from_name||'Reply'));bd.appendChild(el('span','rp-text',r.text||'Message'));rp.appendChild(bd);
  var ric={image:'🖼️',video:'🎬',sticker:'😀'}[r.kind];if(ric)rp.appendChild(el('span','rp-ico',ric))
  return rp}
function bubble(m){
  if(seen[m.id]){if(m.reactions)renderReactions(m.id,m.reactions);return}
  seen[m.id]=1;
  if(m.from===myId&&m.pending&&startingUps>0){delete seen[m.id];return}
  var hello=thread.querySelector('.hello');if(hello)hello.parentNode.removeChild(hello);
  var mine=m.from===myId,side=mine?'me':'them',d,t=el('time');t.setAttribute('data-t',m.created_at);
  if(m.kind==='call'&&m.call){d=el('div','call-entry'+(m.call.bad?' missed':''));d.appendChild(el('span',null,m.call.icon));d.appendChild(el('span',null,m.call.text))}
  else if(m.deleted){d=el('div','bubble '+side+' deleted');d.appendChild(el('span','mut','This message was deleted'))}
  else if(m.kind==='voice'){d=el('div','bubble '+side);var st=senderTag(m);if(st)d.appendChild(st);var a=document.createElement('audio');a.controls=true;a.preload='none';a.src='/api/messages/media/'+m.id;d.appendChild(a);t.setAttribute('data-pre','🎤 '+dur(m.ms)+' · ')}
  else if(m.kind==='sticker'){d=el('div','sticker-msg '+side);var st2=senderTag(m);if(st2)d.appendChild(st2);d.appendChild(mcard(m));if(!mine){var sb=el('button','link save-st','+ Save sticker');sb.type='button';sb.setAttribute('data-save',m.id);d.appendChild(sb)}}
  else if(m.kind==='image'||m.kind==='video'){if(mine&&m.pending&&startingUps>0)return;d=el('div','bubble '+side+' img-msg');var st4=senderTag(m);if(st4)d.appendChild(st4);d.appendChild(mcard(m))}
  else if(m.kind==='file'){if(mine&&m.pending&&startingUps>0)return;d=el('div','bubble '+side);var st5=senderTag(m);if(st5)d.appendChild(st5);d.appendChild(fileChip(m))}
  else{d=el('div','bubble '+side);var st3=senderTag(m);if(st3)d.appendChild(st3);var sp=el('span','msg-text');linkifyInto(sp,m.body);d.appendChild(sp);if(m.edited)d.appendChild(el('span','mut',' (edited)'))}
  function topRef(){var r=d.firstChild;while(r&&(r.className==='sender-name'||r.className==='fwd'))r=r.nextSibling;return r}
  if(m.fwd&&!m.deleted)d.insertBefore(el('div','fwd','\u21AA Forwarded'),topRef());
  if(m.reply&&!m.deleted)d.insertBefore(replyBox(m.reply),topRef());
  d.setAttribute('data-id',m.id);d.setAttribute('data-kind',m.kind);
  if(m.reactions&&Object.keys(m.reactions).length){var row=el('div','reactions');Object.keys(m.reactions).forEach(function(em){row.appendChild(el('span','rchip',em+' '+m.reactions[em]))});d.appendChild(row)}
  d.appendChild(t);stamp(t);
  if(mine&&m.kind!=='call'){var tk=document.createElement('span');tk.className='tickwrap';tk.setAttribute('data-tick','1');t.appendChild(tk);updateTick(m.id,m.tick||'sent')}
  var stick=mine||nearBottom();thread.appendChild(d);decorateVoice(d);if(m.starred&&!m.deleted)setStar(d,true);if(stick)toBottom();else bumpNew();
}
function updateTick(id,status){var b=thread.querySelector('[data-id="'+id+'"]');if(!b)return;var tk=b.querySelector('[data-tick]');if(!tk)return;tk.innerHTML=tickHtml(status)}
Array.prototype.forEach.call(thread.querySelectorAll('time[data-t]'),stamp);
var polling=false;
function poll(){if(polling)return;polling=true;fetch('/api/messages/poll?'+qs+'&after='+lastId+'&seen='+(document.hidden?'0':'1')+pendQ(),{cache:'no-store',credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){
  (j.messages||[]).forEach(function(m){bubble(m);if(m.id>lastId)lastId=m.id});
  (j.receipts||[]).forEach(function(r){updateTick(r.id,r.status)});
  (j.ready||[]).forEach(readyMsg);
  polling=false;
}).catch(function(){polling=false})}
document.addEventListener('visibilitychange',function(){if(!document.hidden)poll()});
window.addEventListener('focus',poll);
window.addEventListener('online',poll);
function post(url,obj,cb){fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)}).then(function(r){return r.json()}).then(function(j){if(j&&j.id)cb(j);else alert((j&&j.error)||'Could not send.')}).catch(function(){alert('Could not send. Check your connection.')})}
toBottom();setTimeout(initialScroll,0);var initialReplyId=Number(new URLSearchParams(location.search).get('reply_to'));if(initialReplyId)setTimeout(function(){startReply(initialReplyId)},180);setInterval(poll,1500);
form.addEventListener('submit',function(e){e.preventDefault();var text=input.value.trim();if(!text)return;
  if(editingId){var id=editingId;editingId=null;input.value='';resizeInput();fetch('/api/messages/'+id+'/edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:text})}).then(function(r){return r.json()}).then(function(j){if(j&&j.ok){var b=thread.querySelector('[data-id="'+id+'"]'),span=b&&b.querySelector('.msg-text');if(span){span.innerHTML='';linkifyInto(span,text);if(!b.querySelector('.mut'))b.insertBefore(el('span','mut',' (edited)'),b.querySelector('time'))}}else alert((j&&j.error)||'Could not edit.')}).catch(function(){alert('Could not edit.')});return}
  var selectedReply=replyTarget;input.value='';resizeInput();var body=Object.assign({body:text,reply_to_id:selectedReply?selectedReply.id:null},convType==='group'?{group:convId}:{to:convId});
  if(!navigator.onLine){queueAndShow(body,text,selectedReply);clearReply();return}
  fetch('/api/messages/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json()}).then(function(j){
    if(j&&j.id){bubble({id:j.id,from:myId,kind:'text',body:text,reply:selectedReply,created_at:j.created_at,tick:'sent'});if(j.id>lastId)lastId=j.id;clearReply()}
    else alert((j&&j.error)||'Could not send.')
  }).catch(function(){queueAndShow(body,text,selectedReply);clearReply()})});

/* ---- send while offline: queue in IndexedDB, auto-send once a connection is back ---- */
function queueAndShow(body,text,selectedReply){
  var tempId='q'+Date.now()+Math.random().toString(36).slice(2);
  bubble({id:tempId,from:myId,kind:'text',body:text,reply:selectedReply||null,created_at:new Date().toISOString(),tick:'queued'});
  pendingAdd({tempId:tempId,at:new Date().toISOString(),payload:body}).then(registerBackgroundSync);
}
function pendingDB(){return new Promise(function(res,rej){var rq=indexedDB.open('shq-pending',2);rq.onupgradeneeded=function(){var db=rq.result;if(!db.objectStoreNames.contains('msgs'))db.createObjectStore('msgs',{keyPath:'id',autoIncrement:true});if(!db.objectStoreNames.contains('uploads'))db.createObjectStore('uploads',{keyPath:'id',autoIncrement:true})};rq.onsuccess=function(){res(rq.result)};rq.onerror=function(){rej(rq.error)}})}
function pendingAdd(item){return pendingDB().then(function(db){return new Promise(function(res,rej){var tx=db.transaction('msgs','readwrite'),rq=tx.objectStore('msgs').add(item);rq.onsuccess=function(){res(rq.result)};rq.onerror=function(){rej(rq.error)}})})}
function pendingList(){return pendingDB().then(function(db){return new Promise(function(res){var rq=db.transaction('msgs','readonly').objectStore('msgs').getAll();rq.onsuccess=function(){res(rq.result)};rq.onerror=function(){res([])}})})}
function pendingRemove(id){return pendingDB().then(function(db){return new Promise(function(res){var tx=db.transaction('msgs','readwrite');tx.objectStore('msgs').delete(id);tx.oncomplete=function(){res()}})})}
function registerBackgroundSync(){
  if(!('serviceWorker' in navigator)||!('SyncManager' in window))return;
  navigator.serviceWorker.ready.then(function(reg){return reg.sync.register('send-queued-messages')}).catch(function(){});
}
function flushPendingHere(){ // fallback for browsers without Background Sync: only works while this page is open
  return pendingList().then(function(items){
    return items.reduce(function(p,it){return p.then(function(){
      return fetch('/api/messages/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(it.payload)}).then(function(r){return r.json()}).then(function(j){
        if(j&&j.id){var b=thread.querySelector('[data-id="'+it.tempId+'"]');if(b)b.parentNode.removeChild(b);return pendingRemove(it.id)}
      }).catch(function(){});
    })},Promise.resolve());
  });
}
window.addEventListener('online',flushPendingHere);
function showPending(){ // a message still waiting for a connection keeps its clock after a refresh, until it is really sent
  return pendingList().then(function(items){items.forEach(function(it){var p=it.payload||{};
    var here=convType==='group'?String(p.group)===String(convId):String(p.to)===String(convId);
    if(here&&p.body&&!thread.querySelector('[data-id="'+it.tempId+'"]'))bubble({id:it.tempId,from:myId,kind:'text',body:p.body,created_at:it.at||new Date().toISOString(),tick:'queued'})})}).catch(function(){});
}
showPending().then(function(){if(navigator.onLine)flushPendingHere()});
if('serviceWorker' in navigator){
  navigator.serviceWorker.addEventListener('message',function(e){
    if(!e.data||e.data.type!=='chat-synced')return;
    (e.data.tempIds||[]).forEach(function(tid){var b=thread.querySelector('[data-id="'+tid+'"]');if(b)b.parentNode.removeChild(b)});
  });
}

/* ---- emoji + stickers panel ---- */
var EMO={'😀':'😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😍 🥰 😘 😋 😜 🤪 😎 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 😶 😐 😑 😬 🙄 😯 😴 🤤 😷 🤒 🤕 🤢 🤮 🤧 😈 💀 👻 🤡',
'👍':'👍 👎 👌 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ✋ 🤚 👋 🤝 🙏 👏 🙌 👐 🤲 💪 🫶',
'❤️':'❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💕 💞 💓 💗 💖 💘 💝 ✨ ⭐ 🌟 🔥 💯 💥 💫 🎉 🎊 🎁 🏆 🥇',
'🍔':'🍔 🍕 🌭 🍟 🍗 🍖 🍚 🍜 🍝 🍞 🧀 🥚 🍳 🥞 🍩 🍪 🎂 🍰 🍫 🍬 🍭 🍿 ☕ 🍵 🥤 🍺 🍻 🍎 🍌 🍉 🍇 🍓 🍍 🥭',
'📚':'📚 📖 📝 🎓 🏫 💻 📱 🎧 🎵 🎶 ⚽ 🏀 🎮 🚀 ✈️ 🚗 🏠 ⏰ 📅 💡 🔔 ✅ ❌ ⚠️ ❓ ❗ 💬'};
function ins(ch){var s=typeof input.selectionStart==='number'?input.selectionStart:input.value.length,e=typeof input.selectionEnd==='number'?input.selectionEnd:s;input.value=input.value.slice(0,s)+ch+input.value.slice(e);var p=s+ch.length;input.focus();try{input.setSelectionRange(p,p)}catch(_){}}
function showCat(k){eg.innerHTML='';EMO[k].split(' ').forEach(function(ch){var b=el('button',null,ch);b.type='button';b.addEventListener('click',function(){ins(ch)});eg.appendChild(b)})}
Object.keys(EMO).forEach(function(k){var b=el('button',null,k);b.type='button';b.addEventListener('click',function(){showCat(k)});ec.appendChild(b)});
showCat(Object.keys(EMO)[0]);
function tab(name){var isE=name==='emoji';pEmoji.hidden=!isE;pStickers.hidden=isE;Array.prototype.forEach.call(panel.querySelectorAll('[data-tab]'),function(b){b.className=(b.getAttribute('data-tab')===name?'ghost on':'ghost')});if(!isE)loadStickers()}
Array.prototype.forEach.call(panel.querySelectorAll('[data-tab]'),function(b){b.addEventListener('click',function(){tab(b.getAttribute('data-tab'))})});
pBtn.addEventListener('click',function(){panel.hidden=!panel.hidden;document.body.classList.toggle('panel-open',!panel.hidden);if(!panel.hidden){tab('emoji');toBottom()}});
/* ---- sticker board: lives on this device (IndexedDB), no count or size cap -- only bounded by the phone's
   own storage. Stickers added before this change are still listed (from the server) so nothing old is lost;
   every new sticker from here on is saved locally instead. ---- */
function stickerDB(){return new Promise(function(res,rej){var rq=indexedDB.open('shq-stickers',1);rq.onupgradeneeded=function(){rq.result.createObjectStore('board',{keyPath:'id',autoIncrement:true})};rq.onsuccess=function(){res(rq.result)};rq.onerror=function(){rej(rq.error)}})}
function stickerAdd(mime,blob){return stickerDB().then(function(db){return new Promise(function(res,rej){var rq=db.transaction('board','readwrite').objectStore('board').add({mime:mime,blob:blob});rq.onsuccess=function(){res(rq.result)};rq.onerror=function(){rej(rq.error)}})})}
function stickerList(){return stickerDB().then(function(db){return new Promise(function(res){var rq=db.transaction('board','readonly').objectStore('board').getAll();rq.onsuccess=function(){res(rq.result)};rq.onerror=function(){res([])}})})}
function stickerDelete(id){return stickerDB().then(function(db){return new Promise(function(res){var tx=db.transaction('board','readwrite');tx.objectStore('board').delete(id);tx.oncomplete=function(){res()}})})}
function sendSticker(key){
  var selectedReply=replyTarget;
  var isLocal=typeof key==='string'&&key.indexOf('local:')===0;
  if(!isLocal){
    var body=Object.assign({sticker_id:key,reply_to_id:selectedReply?selectedReply.id:null},convType==='group'?{group:convId}:{to:convId});
    post('/api/messages/sticker',body,function(j){bubble({id:j.id,from:myId,kind:'sticker',created_at:j.created_at,tick:'sent',reply:selectedReply});if(j.id>lastId)lastId=j.id;clearReply();panel.hidden=true;document.body.classList.remove('panel-open')});
    return;
  }
  var localId=Number(key.slice(6));
  stickerList().then(function(list){
    var s=list.filter(function(x){return x.id===localId})[0];
    if(!s)return;
    var fd=new FormData();fd.append('sticker',s.blob,'sticker');if(convType==='group')fd.append('group',convId);else fd.append('to',convId);
    if(selectedReply)fd.append('reply_to_id',String(selectedReply.id));
    fetch('/api/messages/local-sticker',{method:'POST',body:fd}).then(function(r){return r.json()}).then(function(j){
      if(j&&j.id){bubble({id:j.id,from:myId,kind:'sticker',created_at:j.created_at,tick:'sent',reply:selectedReply});if(j.id>lastId)lastId=j.id;clearReply();panel.hidden=true;document.body.classList.remove('panel-open')}
      else alert((j&&j.error)||'Could not send that sticker.');
    }).catch(function(){alert('Could not send that sticker -- check your connection.')});
  });
}
function loadStickers(){
  Promise.all([fetch('/api/stickers').then(function(r){return r.json()}).catch(function(){return {stickers:[]}}),stickerList()]).then(function(r){
    var serverList=(r[0]&&r[0].stickers)||[],localList=r[1]||[];
    sg.innerHTML='';
    if(!serverList.length&&!localList.length){sg.appendChild(el('p','mut','No stickers yet. Add a picture to start your sticker board.'));return}
    serverList.forEach(function(s){addStickerTile('/api/stickers/'+s.id,s.id,function(){
      if(confirm('Delete this sticker from your board?'))fetch('/api/stickers/'+s.id+'/delete',{method:'POST'}).then(loadStickers);
    })});
    localList.forEach(function(s){var url=URL.createObjectURL(s.blob);addStickerTile(url,'local:'+s.id,function(){
      if(confirm('Delete this sticker from your board?'))stickerDelete(s.id).then(loadStickers);
    })});
  });
}
function addStickerTile(src,sendKey,onDelete){
  var w=el('div','st'),im=document.createElement('img');im.src=src;im.alt='sticker';im.addEventListener('click',function(){sendSticker(sendKey)});
  var x=el('button','st-x','×');x.type='button';x.addEventListener('click',onDelete);
  w.appendChild(im);w.appendChild(x);sg.appendChild(w);
}
function upStatusShow(t){upStatus.hidden=false;upStatus.textContent=t}
function upStatusHide(){upStatus.hidden=true}
stFile.addEventListener('change',function(){var files=Array.prototype.slice.call(stFile.files||[]);if(!files.length)return;
  var i=0,errs=[];
  function next(){
    if(i>=files.length){stFile.value='';upStatusHide();loadStickers();if(errs.length)alert(errs.join('\\n'));return}
    var f=files[i++];
    if(!/^image\\//.test(f.type)){errs.push(f.name+': not a picture');next();return}
    upStatusShow('Adding sticker '+i+' of '+files.length+'\u2026');
    stickerAdd(f.type,f).then(function(){next()}).catch(function(){errs.push(f.name+': could not be saved');next()});
  }
  next();
});
stZip.addEventListener('change',function(){var f=stZip.files&&stZip.files[0];if(!f)return;
  upStatusShow('Unzipping your stickers\u2026');
  var fd=new FormData();fd.append('zip',f,f.name);
  fetch('/api/stickers/zip',{method:'POST',body:fd}).then(function(r){return r.json()}).then(function(j){
    stZip.value='';
    if(!j||j.error){upStatusHide();alert((j&&j.error)||'Could not read that zip file.');return}
    var imgs=j.images||[];
    return Promise.all(imgs.map(function(im){
      return fetch('data:'+im.mime+';base64,'+im.data).then(function(r){return r.blob()}).then(function(blob){return stickerAdd(im.mime,blob)});
    })).then(function(){
      upStatusHide();loadStickers();
      alert('Added '+imgs.length+' sticker'+(imgs.length===1?'':'s')+(j.skipped?' (skipped '+j.skipped+' file'+(j.skipped===1?'':'s')+' that were not pictures)':'')+'.');
    });
  }).catch(function(){upStatusHide();alert('Could not read that zip file.')});
});
/* ---- photos, videos, stickers and files: nothing downloads until you tap, and what you send appears at once ---- */
var DLKEY='sh_dl',dlSet={};try{JSON.parse(localStorage.getItem(DLKEY)||'[]').forEach(function(i){dlSet[i]=1})}catch(e){}
function isDl(id){return !!dlSet[id]}
function markDl(id){dlSet[id]=1;try{var a=Object.keys(dlSet);if(a.length>3000)a=a.slice(-3000);localStorage.setItem(DLKEY,JSON.stringify(a))}catch(e){}}
var pend={},ups={},startingUps=0;
var M_ICO={image:'🖼️',video:'🎬',sticker:'😀'},M_LBL={image:'Photo',video:'Video',sticker:'Sticker'};
function pendQ(){var k=Object.keys(pend);return k.length?'&pend='+k.slice(0,20).join(','):''}
function mUrl(id){return '/api/messages/media/'+id}
function mSize(c){return Number(c.getAttribute('data-size'))||0}
function mState(c,st){c.className=c.className.replace(/ ?mc-state-[a-z]+/g,'').replace(/ ?done/g,'')+' mc-state-'+st}
function mSet(c,st,pct,note){
  mState(c,st);var k=c.getAttribute('data-mk'),h='<div class="mc-ph"><span class="mc-ico">'+(st==='wait'?'<span class="mc-spin"></span>':M_ICO[k])+'</span><span class="mc-lbl">'+(st==='wait'?'Sending… ':'')+M_LBL[k]+'</span></div>';
  if(st==='idle')h+='<button type="button" class="mc-dl">⬇ '+fmtBytes(mSize(c))+'</button>';
  else if(st==='err')h+='<button type="button" class="mc-dl">⟳ Try again · '+fmtBytes(mSize(c))+'</button>';
  else if(st==='load'||st==='up')h+='<div class="mc-prog"><div class="mc-bar"><i style="width:'+(pct||0)+'%"></i></div><span class="mc-pct">'+(note||'')+'</span>'+(st==='up'?'<button type="button" class="mc-cancel" aria-label="Cancel">✕</button>':'')+'</div>';
  c.innerHTML=h;
  if(c.__prev&&st==='up'){c.firstChild.style.backgroundImage='url('+c.__prev+')';c.firstChild.className+=' has-prev'}}
function mProg(c,pct,note){var i=c.querySelector('.mc-bar i'),t=c.querySelector('.mc-pct');if(i)i.style.width=pct+'%';if(t)t.textContent=note||''}
function mShow(c,url){
  var id=c.getAttribute('data-mid'),k=c.getAttribute('data-mk');mState(c,'done');c.className+=' done';c.innerHTML='';
  if(k==='video'){var v=document.createElement('video');v.className='mc-vid';v.src=url;v.controls=true;v.playsInline=true;v.preload='metadata';c.appendChild(v);var a=document.createElement('a');a.className='mc-save';a.href=mUrl(id)+'?dl=1';a.setAttribute('download','');a.textContent='⬇ Save to phone';c.appendChild(a)}
  else{var im=document.createElement('img');im.className='mc-img';im.alt=M_LBL[k];im.src=url;im.setAttribute('data-view',url);c.appendChild(im)}}
function mInit(c){
  var id=c.getAttribute('data-mid');
  if(c.getAttribute('data-pending')==='1'){c.removeAttribute('data-pending');pend[id]=1;mSet(c,'wait');return}
  if(isDl(id)){mShow(c,mUrl(id));return}
  mSet(c,'idle')}
function mcard(m){
  var c=el('div','mcard mc-'+m.kind);c.setAttribute('data-mid',m.id);c.setAttribute('data-mk',m.kind);c.setAttribute('data-size',m.size||0);c.setAttribute('data-name',m.name||'');
  if(m.uploading){if(m.kind==='image')c.__prev=URL.createObjectURL(m.uploading);mSet(c,'up',0,'Sending… 0%')}
  else{if(m.pending)c.setAttribute('data-pending','1');mInit(c)}
  return c}
function mDownload(c){
  var id=c.getAttribute('data-mid'),x=new XMLHttpRequest(),sz=mSize(c);x.open('GET',mUrl(id));x.responseType='blob';mSet(c,'load',0,'0%');
  x.onprogress=function(e){var tot=e.lengthComputable?e.total:sz;if(tot)mProg(c,Math.min(100,Math.round(e.loaded*100/tot)),fmtBytes(e.loaded)+' / '+fmtBytes(tot))};
  x.onload=function(){if(x.status===200&&x.response){markDl(id);mShow(c,URL.createObjectURL(x.response))}else mSet(c,'err')};
  x.onerror=function(){mSet(c,'err')};x.send()}
function fileChip(m){
  var wait=!!(m.pending||m.uploading),d=document.createElement(wait?'div':'a');d.className='file-chip'+(wait?' pending':'');
  if(!wait){d.href=mUrl(m.id)+'?dl=1';d.setAttribute('download',m.name||'file')}
  d.appendChild(el('span','fc-ico','📄'));var mn=el('span','fc-main');mn.appendChild(el('span','file-name',m.name||'File'));
  mn.appendChild(el('span','fc-size',fmtBytes(m.size)+(wait?' · Sending…':'')));
  if(m.uploading){var bar=el('span','fc-bar');bar.appendChild(document.createElement('i'));mn.appendChild(bar)}
  d.appendChild(mn);
  if(m.uploading){var cb=el('button','mc-cancel','✕');cb.type='button';d.appendChild(cb)}else if(wait)d.appendChild(el('span','mc-spin'));else d.appendChild(el('span','fc-dl','⬇'));
  return d}
function readyMsg(r){
  delete pend[r.id];var b=thread.querySelector('[data-id="'+r.id+'"]');if(!b)return;
  if(r.gone){b.parentNode.removeChild(b);return}
  var c=b.querySelector('.mcard');if(c){if(r.size)c.setAttribute('data-size',r.size);mInit(c)}
  var fc=b.querySelector('.file-chip.pending');if(fc){var nm=(b.querySelector('.file-name')||{}).textContent;fc.parentNode.replaceChild(fileChip({id:r.id,name:nm,size:r.size}),fc)}}
var viewer=null;
function closeViewer(){if(viewer){viewer.parentNode.removeChild(viewer);viewer=null}}
function openViewer(url,id){
  closeViewer();viewer=el('div','mviewer');var im=document.createElement('img');im.src=url;viewer.appendChild(im);
  var bar=el('div','mv-bar'),cl=el('button','mv-x','✕');cl.type='button';cl.setAttribute('data-vclose','1');
  var sv=el('a','mv-save','⬇ Save to phone');sv.href=mUrl(id)+'?dl=1';sv.setAttribute('download','');bar.appendChild(cl);bar.appendChild(sv);viewer.appendChild(bar);
  viewer.addEventListener('click',function(e){if(e.target===viewer||(e.target.getAttribute&&e.target.getAttribute('data-vclose')))closeViewer()});document.body.appendChild(viewer)}
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeViewer()});
thread.addEventListener('click',function(e){
  var cb=e.target.closest?e.target.closest('.mc-cancel'):null;
  if(cb){var bb=cb.closest('[data-id]'),u=bb&&ups[bb.getAttribute('data-id')];if(u)u.cancel();return}
  var c=e.target.closest?e.target.closest('.mcard'):null;if(!c)return;
  if(e.target.closest('.mc-save'))return;
  var im=e.target.closest('.mc-img');
  if(im){if(c.getAttribute('data-mk')!=='sticker')openViewer(im.getAttribute('data-view')||im.src,c.getAttribute('data-mid'));return}
  if(/mc-state-(idle|err)/.test(c.className))mDownload(c)});
Array.prototype.forEach.call(thread.querySelectorAll('.mcard'),mInit);
Array.prototype.forEach.call(thread.querySelectorAll('.file-chip.pending[data-fid]'),function(n){pend[n.getAttribute('data-fid')]=1});
function sendFile(f){
  if(f.size>200*1024*1024){alert('That file is too big (200 MB is the limit).');return}
  var kind=f.type.indexOf('image/')===0?'image':f.type.indexOf('video/')===0?'video':'file',tmp='u'+Date.now()+Math.floor(Math.random()*1000),up={xhr:null,dead:false,id:0};
  startingUps++;ups[tmp]=up;
  bubble({id:tmp,from:myId,kind:kind,name:f.name,size:f.size,created_at:new Date().toISOString().slice(0,19).replace('T',' '),tick:'sent',uploading:f});
  var b=thread.querySelector('[data-id="'+tmp+'"]'),c=b&&b.querySelector('.mcard');
  function prog(pct){if(c)mProg(c,pct,'Sending… '+pct+'%');else if(b){var t=b.querySelector('.fc-size'),bi=b.querySelector('.fc-bar i');if(t)t.textContent=fmtBytes(f.size)+' · Sending… '+pct+'%';if(bi)bi.style.width=pct+'%'}}
  function clean(){delete ups[tmp];if(up.id)delete ups[up.id];if(b&&b.parentNode)b.parentNode.removeChild(b)}
  up.cancel=function(){up.dead=true;if(up.xhr)up.xhr.abort();if(up.id)fetch('/api/messages/'+up.id+'/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope:'everyone'})}).catch(function(){});clean()};
  function finish(id){
    delete ups[id];markDl(id);
    if(c){c.setAttribute('data-size',f.size);mShow(c,URL.createObjectURL(f))}
    else{var fc=b.querySelector('.file-chip');if(fc)fc.parentNode.replaceChild(fileChip({id:id,name:f.name,size:f.size}),fc)}
    updateTick(id,'sent')}
  var sb=Object.assign({name:f.name,size:f.size,mime:f.type||'application/octet-stream'},convType==='group'?{group:convId}:{to:convId});
  fetch('/api/messages/attachment/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sb)}).then(function(r){return r.json()}).then(function(j){
    startingUps--;if(up.dead)return;
    if(!j||!j.id){alert((j&&j.error)||'Could not send that file.');clean();return}
    up.id=j.id;ups[j.id]=up;seen[j.id]=1;if(j.id>lastId)lastId=j.id;
    if(b){b.setAttribute('data-id',j.id);if(c)c.setAttribute('data-mid',j.id)}
    var x=new XMLHttpRequest(),fd=new FormData();up.xhr=x;fd.append('file',f,f.name);
    x.open('POST','/api/messages/attachment/'+j.id);
    x.upload.onprogress=function(e){if(e.lengthComputable)prog(Math.min(100,Math.round(e.loaded*100/e.total)))};
    x.onload=function(){if(up.dead)return;if(x.status===200)finish(j.id);else{var m='Could not send that file.';try{m=JSON.parse(x.responseText).error||m}catch(er){}alert(m);up.cancel()}};
    x.onerror=function(){if(up.dead)return;alert('Could not send that file. Check your connection and try again.');up.cancel()};
    x.send(fd)
  }).catch(function(){startingUps--;if(up.dead)return;alert('Could not send that file. Check your connection and try again.');clean()})}
var attachInput=document.getElementById('fileInput');
attachInput.addEventListener('change',function(){var fs=Array.prototype.slice.call(attachInput.files||[]);attachInput.value='';fs.slice(0,10).forEach(sendFile)});
thread.addEventListener('click',function(e){
  var save=e.target.closest?e.target.closest('[data-save]'):null;
  if(save){fetch('/api/stickers/from-message/'+save.getAttribute('data-save'),{method:'POST'}).then(function(r){return r.json()}).then(function(j){save.textContent=(j&&j.ok)?'✓ Saved to your stickers':((j&&j.error)||'Could not save');save.disabled=true}).catch(function(){save.textContent='Could not save'});return}
});

/* ---- mobile reply gestures: swipe a message horizontally or long-press it ---- */
var touchStart=null,pressTimer=null;
thread.addEventListener('touchstart',function(e){
  var b=e.target.closest?e.target.closest('[data-id]'):null;
  if(!b||e.target.closest('button,input,audio,textarea'))return;
  var t=e.touches[0];touchStart={id:b.getAttribute('data-id'),x:t.clientX,y:t.clientY};
  clearTimeout(pressTimer);
  pressTimer=setTimeout(function(){if(touchStart){selectAdd(touchStart.id);touchStart=null}},450);
},{passive:true});
thread.addEventListener('touchmove',function(e){
  if(!touchStart)return;
  var t=e.touches[0],dx=t.clientX-touchStart.x,dy=t.clientY-touchStart.y;
  if(Math.abs(dx)>12||Math.abs(dy)>12)clearTimeout(pressTimer);
  if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.3){
    var id=touchStart.id;touchStart=null;clearTimeout(pressTimer);startReply(id);
  }
},{passive:true});
thread.addEventListener('touchend',function(){clearTimeout(pressTimer);touchStart=null},{passive:true});
thread.addEventListener('touchcancel',function(){clearTimeout(pressTimer);touchStart=null},{passive:true});

/* ---- press-and-hold a message to select it: top bar (reply, copy, forward, star, info, delete) + floating reactions ---- */
var sel={},pressed=false,selBar=document.getElementById('msgSelBar'),selCnt=document.getElementById('msgSelCount'),rbar=document.getElementById('reactBar'),toastEl=document.getElementById('toast'),sheet=document.getElementById('sheet'),sheetBox=document.getElementById('sheetBox'),msgMenu=document.getElementById('msgMenu'),btm=document.getElementById('toBtm'),btmN=document.getElementById('toBtmN'),newCount=0;
function selIds(){return Object.keys(sel)}
function bubOf(id){return thread.querySelector('[data-id="'+id+'"]')}
function isMine(b){return b.classList.contains('me')}
function show(id,on){document.getElementById(id).style.display=on?'':'none'}
function toast(t){toastEl.textContent=t;toastEl.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(function(){toastEl.style.display='none'},1800)}
function copyText(t){function fb(){var ta=document.createElement('textarea');ta.value=t;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy')}catch(e){}document.body.removeChild(ta)}
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(t).catch(fb);else fb()}
function fullTime(iso){return iso?new Date(iso+'Z').toLocaleString([],{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):''}
function setStar(b,on){if(on)b.setAttribute('data-starred','1');else b.removeAttribute('data-starred');var tm=b.querySelector('time');if(!tm)return;var ex=tm.querySelector('.starmark');
  if(on&&!ex){tm.insertBefore(el('span','starmark',' ★'),tm.querySelector('.tickwrap'))}else if(!on&&ex)ex.remove()}
function placeReact(b){rbar.style.display='flex';var r=b.getBoundingClientRect(),w=rbar.offsetWidth||280,top=Math.max(70,r.top-54);rbar.style.top=top+'px';
  var left=isMine(b)?Math.min(window.innerWidth-w-8,Math.max(8,r.right-w)):Math.max(8,Math.min(window.innerWidth-w-8,r.left));rbar.style.left=left+'px'}
function renderSel(){
  var ids=selIds();
  Array.prototype.forEach.call(thread.querySelectorAll('[data-id]'),function(b){b.classList.toggle('msg-sel',!!sel[b.getAttribute('data-id')])});
  document.body.classList.toggle('msg-selecting',ids.length>0);
  selBar.style.display=ids.length?'flex':'none';rbar.style.display='none';msgMenu.style.display='none';
  if(!ids.length)return;
  selCnt.textContent=ids.length;
  var bs=ids.map(bubOf).filter(Boolean),one=bs.length===1,deleted=bs.some(function(b){return b.classList.contains('deleted')||b.getAttribute('data-kind')==='call'});
  show('mReply',one&&!deleted);show('mFwd',!deleted);show('mStar',!deleted);
  show('mCopy',bs.some(function(b){return b.getAttribute('data-kind')==='text'&&!!b.querySelector('.msg-text')}));
  show('mInfo',one&&isMine(bs[0])&&!deleted);
  var canEdit=one&&isMine(bs[0])&&!deleted&&bs[0].getAttribute('data-kind')==='text';show('mMore',canEdit);
  document.getElementById('mStar').title=bs.every(function(b){return b.getAttribute('data-starred')==='1'})?'Remove star':'Star';
  if(one&&!deleted)placeReact(bs[0]);
}
function selectAdd(id){if(!bubOf(id))return;pressed=true;if(navigator.vibrate)try{navigator.vibrate(15)}catch(x){}sel[id]=1;renderSel()}
function selToggle(id){if(sel[id])delete sel[id];else sel[id]=1;renderSel()}
function selClear(){sel={};renderSel()}
thread.addEventListener('pointerdown',function(){pressed=false},true);
thread.addEventListener('click',function(e){var b=e.target.closest?e.target.closest('[data-id]'):null;
  if(pressed){e.preventDefault();e.stopPropagation();pressed=false;return}
  if(selIds().length&&b){e.preventDefault();e.stopPropagation();selToggle(b.getAttribute('data-id'))}},true);
thread.addEventListener('contextmenu',function(e){var b=e.target.closest?e.target.closest('[data-id]'):null;if(!b)return;e.preventDefault();selectAdd(b.getAttribute('data-id'))});
document.addEventListener('keydown',function(e){if(e.key==='Escape'){if(sheet.style.display!=='none')closeSheet();else selClear()}});
window.addEventListener('scroll',function(){var ids=selIds();if(ids.length===1){var b=bubOf(ids[0]);if(b)placeReact(b)}},{passive:true});
REACT_SET.forEach(function(em){var bt=el('button',null,em);bt.type='button';bt.addEventListener('click',function(){var ids=selIds();if(ids.length===1)react(ids[0],em);selClear()});rbar.appendChild(bt)});
function openSheet(node){sheetBox.innerHTML='';sheetBox.appendChild(node);sheet.style.display='flex'}
function closeSheet(){sheet.style.display='none'}
sheet.addEventListener('click',function(e){if(e.target===sheet)closeSheet()});
function sbtn(text,fn,cls){var b=el('button',cls||'ghost',text);b.type='button';b.addEventListener('click',fn);return b}
document.getElementById('mClose').onclick=selClear;
document.getElementById('mReply').onclick=function(){var ids=selIds();if(ids.length===1)startReply(ids[0]);selClear()};
document.getElementById('mCopy').onclick=function(){var t=selIds().map(bubOf).filter(Boolean).map(function(b){var m=b.querySelector('.msg-text');return b.getAttribute('data-kind')==='text'&&m?m.textContent:''}).filter(Boolean).join('\\n');if(t){copyText(t);toast('Copied')}selClear()};
document.getElementById('mMore').onclick=function(e){e.stopPropagation();msgMenu.style.display=msgMenu.style.display==='block'?'none':'block'};
document.getElementById('mEdit').onclick=function(){var ids=selIds();selClear();if(ids.length===1)startEdit(ids[0])};
document.addEventListener('click',function(e){if(!msgMenu.contains(e.target))msgMenu.style.display='none'});
document.getElementById('mStar').onclick=function(){var ids=selIds(),bs=ids.map(bubOf).filter(Boolean),on=!bs.every(function(b){return b.getAttribute('data-starred')==='1'});
  fetch('/api/messages/star',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:ids.map(Number),on:on})}).then(function(r){return r.json()}).then(function(j){if(j&&j.ok){bs.forEach(function(b){setStar(b,on)});toast(on?'Starred':'Star removed')}}).catch(function(){toast('Could not reach the server')});selClear()};
document.getElementById('mInfo').onclick=function(){var ids=selIds();if(ids.length!==1)return;var id=ids[0];selClear();
  var box=el('div');box.appendChild(el('b',null,'Message info'));box.appendChild(el('p','mut','Loading…'));openSheet(box);
  fetch('/api/messages/'+id+'/info',{credentials:'same-origin',cache:'no-store'}).then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(j){
    var o=el('div');o.appendChild(el('b',null,'Message info'));
    function line(k,v){var p=el('p');p.style.margin='10px 0 0';p.appendChild(el('b',null,k+': '));p.appendChild(document.createTextNode(v));o.appendChild(p)}
    if(j.group){line('Sent',fullTime(j.sent));line('Read by',j.read.length?'':'nobody yet');j.read.forEach(function(r){line('✓✓ '+r.name,fullTime(r.at))});if(j.waiting.length)line('Not read yet',j.waiting.join(', '))}
    else{line('Read',j.read?fullTime(j.read):'not yet');line('Delivered',j.delivered?fullTime(j.delivered):'not yet');line('Sent',fullTime(j.sent))}
    o.appendChild(sbtn('Close',closeSheet));openSheet(o)}).catch(function(){var o=el('div');o.appendChild(el('p','mut','Could not load the info.'));o.appendChild(sbtn('Close',closeSheet));openSheet(o)})};
function delMany(ids,scope){ids.forEach(function(id){doDelete(id,scope,true)});closeSheet();selClear()}
document.getElementById('mDel').onclick=function(){var ids=selIds(),bs=ids.map(bubOf).filter(Boolean),allMine=bs.length&&bs.every(function(b){return isMine(b)&&!b.classList.contains('deleted')});
  var o=el('div');o.appendChild(el('b',null,'Delete '+(ids.length>1?ids.length+' messages':'message')+'?'));
  if(allMine)o.appendChild(sbtn('Delete for everyone',function(){delMany(ids,'everyone')},'danger'));
  o.appendChild(sbtn('Delete for me',function(){delMany(ids,'me')}));o.appendChild(sbtn('Cancel',closeSheet));openSheet(o)};
document.getElementById('mFwd').onclick=function(){var ids=selIds().map(Number);
  var o=el('div');o.appendChild(el('b',null,'Forward to…'));var list=el('div');o.appendChild(list);list.appendChild(el('p','mut','Loading…'));
  var chosen={},go=sbtn('Forward',function(){var t=Object.keys(chosen).map(function(k){var p=k.split(':');return{kind:p[0],id:Number(p[1])}});if(!t.length)return;go.disabled=true;
    fetch('/api/messages/forward',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:ids,targets:t})}).then(function(r){return r.json()}).then(function(j){if(j&&j.ok){toast('Forwarded');closeSheet();selClear();poll()}else{go.disabled=false;alert((j&&j.error)||'Could not forward.')}}).catch(function(){go.disabled=false;alert('Could not forward. Check your connection.')})},'');
  o.appendChild(go);o.appendChild(sbtn('Cancel',closeSheet));openSheet(o);
  fetch('/api/chats/targets',{credentials:'same-origin',cache:'no-store'}).then(function(r){return r.json()}).then(function(j){list.innerHTML='';var ts=j.targets||[];if(!ts.length)list.appendChild(el('p','mut','No chats to forward to yet.'));
    ts.forEach(function(t){var l=el('label','fw-row'),c=document.createElement('input');c.type='checkbox';c.addEventListener('change',function(){var k=t.kind+':'+t.id;if(c.checked){if(Object.keys(chosen).length>=5){c.checked=false;toast('You can pick up to 5 chats');return}chosen[k]=1}else delete chosen[k]});l.appendChild(c);l.appendChild(el('span',null,(t.kind==='group'?'👥 ':'')+t.name));list.appendChild(l)})}).catch(function(){list.innerHTML='';list.appendChild(el('p','mut','Could not load your chats.'))})};
/* ---- scroll-to-latest button with a count of new messages ---- */
function nearBottom(){return document.documentElement.scrollHeight-(window.scrollY+window.innerHeight)<220}
function updBtm(){var far=!nearBottom();btm.style.display=far?'flex':'none';if(!far)newCount=0;btmN.style.display=newCount?'':'none';btmN.textContent=newCount}
function bumpNew(){newCount++;updBtm()}
window.addEventListener('scroll',updBtm,{passive:true});
btm.onclick=function(){newCount=0;toBottom();updBtm()};
function initialScroll(){var d=document.getElementById('unreadDiv');if(d){window.scrollTo(0,Math.max(0,d.getBoundingClientRect().top+window.scrollY-90))}else toBottom();updBtm()}
/* ---- voice notes: playback speed 1x / 1.5x / 2x ---- */
function decorateVoice(d){if(!d||d.getAttribute('data-kind')!=='voice'||d.querySelector('.vspeed'))return;var a=d.querySelector('audio');if(!a)return;var b=el('button','vspeed','1x'),rates=[1,1.5,2],i=0;b.type='button';
  b.addEventListener('click',function(e){e.stopPropagation();i=(i+1)%3;a.playbackRate=rates[i];b.textContent=rates[i]+'x'});a.addEventListener('play',function(){a.playbackRate=rates[i]});a.parentNode.insertBefore(b,a.nextSibling)}
Array.prototype.forEach.call(thread.querySelectorAll('[data-kind="voice"]'),decorateVoice);

/* ---- voice notes: tap the mic to record, tap Send to deliver ---- */
var rec=null,chunks=[],stream=null,t0=0,tick=null,cancelled=false;
function pickMime(){var c=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus'];for(var i=0;i<c.length;i++){if(window.MediaRecorder&&MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported(c[i]))return c[i]}return ''}
function stopTracks(){if(stream){stream.getTracks().forEach(function(t){t.stop()});stream=null}}
function endRec(){clearInterval(tick);recBar.hidden=true;form.hidden=false}
function finish(cancel){cancelled=cancel;endRec();if(rec&&rec.state!=='inactive')rec.stop();else stopTracks()}
function sendVoice(blob,ms,type){var selectedReply=replyTarget,fd=new FormData();if(convType==='group')fd.append('group',convId);else fd.append('to',convId);fd.append('ms',ms);if(selectedReply)fd.append('reply_to_id',String(selectedReply.id));var ext=/mp4/.test(type)?'m4a':/ogg/.test(type)?'ogg':'webm';fd.append('audio',blob,'voice.'+ext);
  fetch('/api/messages/voice',{method:'POST',body:fd}).then(function(r){return r.json()}).then(function(j){if(j&&j.id){bubble({id:j.id,from:myId,kind:'voice',ms:ms,created_at:j.created_at,tick:'sent',reply:selectedReply});if(j.id>lastId)lastId=j.id;clearReply()}else alert((j&&j.error)||'Could not send the voice note.')}).catch(function(){alert('Could not send the voice note.')})}
micBtn.addEventListener('click',function(){
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia||!window.MediaRecorder){alert('Voice notes are not supported in this browser.');return}
  navigator.mediaDevices.getUserMedia({audio:true}).then(function(s){
    stream=s;cancelled=false;chunks=[];var mt=pickMime();
    try{rec=mt?new MediaRecorder(s,{mimeType:mt}):new MediaRecorder(s)}catch(err){stopTracks();alert('Could not start recording.');return}
    rec.ondataavailable=function(e){if(e.data&&e.data.size)chunks.push(e.data)};
    rec.onstop=function(){var ms=Date.now()-t0,type=rec.mimeType||mt||'audio/webm';stopTracks();if(cancelled||!chunks.length)return;sendVoice(new Blob(chunks,{type:type}),ms,type)};
    rec.start();t0=Date.now();panel.hidden=true;document.body.classList.remove('panel-open');form.hidden=true;recBar.hidden=false;recTime.textContent='0:00';
    tick=setInterval(function(){var ms=Date.now()-t0;recTime.textContent=dur(ms);if(ms>=120000)finish(false)},250);
  }).catch(function(){alert('Allow microphone access to send voice notes.')})});
recSend.addEventListener('click',function(){finish(false)});
recCancel.addEventListener('click',function(){finish(true)});
})();`;

// A divider like "3 unread messages" goes just above the first message this person has not seen yet (worked out before they are marked read).
function withUnreadDivider(rows, me, mk) {
  const unread = rows.filter(m => m.sender_id !== me && !m.deleted_at && !isRead(m.id, me)), first = unread[0];
  return rows.map(m => (first && m.id === first.id ? `<div class="unread-div" id="unreadDiv">${unread.length} unread message${unread.length === 1 ? '' : 's'}</div>` : '') + mk(m)).join('');
}
const ic = d => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const MSG_SEL_BAR = `<div id="msgSelBar" class="sel-bar" style="display:none"><button type="button" id="mClose" title="Cancel">${ic('<path d="M6 6l12 12M18 6L6 18"/>')}</button><b id="msgSelCount">0</b><span class="sel-sp"></span>
<button type="button" id="mReply" title="Reply">${ic('<path d="M9 14L4 9l5-5M4 9h9a7 7 0 0 1 7 7v2"/>')}</button>
<button type="button" id="mCopy" title="Copy">${ic('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>')}</button>
<button type="button" id="mFwd" title="Forward">${ic('<path d="M15 14l5-5-5-5M20 9h-9a7 7 0 0 0-7 7v2"/>')}</button>
<button type="button" id="mStar" title="Star">${ic('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>')}</button>
<button type="button" id="mInfo" title="Message info">${ic('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>')}</button>
<button type="button" id="mDel" title="Delete">${ic('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>')}</button>
<button type="button" id="mMore" title="More">${ic('<circle cx="12" cy="5" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="19" r="1.5" fill="currentColor"/>')}</button>
<div id="msgMenu" class="sel-menu" style="display:none"><button type="button" id="mEdit">Edit</button></div></div>
<div id="reactBar" class="react-bar" style="display:none"></div>
<button type="button" id="toBtm" class="to-btm" style="display:none" aria-label="Scroll to latest message">${ic('<path d="M6 9l6 6 6-6"/>')}<b id="toBtmN" class="nbadge" style="display:none"></b></button>
<div id="sheet" class="sheet" style="display:none"><div id="sheetBox" class="sheet-box"></div></div>
<div id="toast" class="toast" style="display:none"></div>`;
function threadPage(req, res, { isGroup, convId, title, headHtml, bubbles, lastId }) {
  const script = CHAT_JS.replace('__CTYPE__', isGroup ? 'group' : 'dm').replace('__CID__', String(convId)).replace('__MY__', String(req.user.id));
  res.send(layout(title, `${MSG_SEL_BAR}${headHtml}
<div id="thread" class="thread" data-last-id="${lastId}">${bubbles || '<p class="mut hello">Say hello 👋</p>'}</div>
<div id="panel" class="chat-panel" hidden><div class="ptabs"><button type="button" class="ghost on" data-tab="emoji">😊 Emoji</button><button type="button" class="ghost" data-tab="stickers">Stickers</button></div>
<div id="pEmoji" class="pbody"><div id="ecats" class="ecats"></div><div id="egrid" class="egrid"></div></div>
<div id="pStickers" class="pbody" hidden><label class="btn ghost st-add">+ Add sticker(s)<input type="file" id="stFile" accept="image/png,image/webp,image/gif,image/jpeg" multiple></label>
<label class="btn ghost st-add">+ Add a .zip of pictures<input type="file" id="stZip" accept=".zip,application/zip,application/x-zip-compressed"></label><div id="sgrid" class="sgrid"></div></div></div>
<div id="replyBar" class="reply-bar" hidden><div class="rp-body"><b id="replyWho" class="rp-name">Replying</b><span id="replyWhat" class="rp-text"></span></div><img id="replyThumb" class="rp-thumb" alt="" hidden><button type="button" id="replyCancel" class="link" aria-label="Cancel reply">&#10005;</button></div>
<form id="sendForm" class="chat-bar"><button type="button" id="panelBtn" class="ic" aria-label="Emoji and stickers">😊</button><label class="ic" id="attachBtn" aria-label="Attach a photo or file"><input type="file" id="fileInput" multiple style="display:none">📎</label><textarea id="msgInput" placeholder="Message" maxlength="2000" autocomplete="off" required rows="1"></textarea><button type="button" id="micBtn" class="ic" aria-label="Record a voice note">🎤</button><button>Send</button></form>
<div id="recBar" class="chat-bar rec" hidden><span class="rec-dot"></span><b id="recTime">0:00</b><span class="mut" style="flex:1">Recording&hellip;</span><button type="button" id="recCancel" class="ghost">Cancel</button><button type="button" id="recSend">Send</button></div>
<p id="upStatus" class="mut" style="margin:4px 0 0" hidden></p>
<script>${script}</script>`, req.user, { noAI: true }));
}

app.get('/chat/:id', (req, res) => {
  if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  const otherId = Number(req.params.id);
  if (otherId === req.user.id) return res.redirect('/chat');
  const other = db.prepare('SELECT id,name,title,avatar_mime,last_seen,hide_active FROM users WHERE id=?').get(otherId);
  if (!other) return res.status(404).send(layout('Not found', '<h2>User not found</h2>', req.user));
  if (friendStatus(req.user.id, otherId) !== 'friends') return res.status(403).send(layout('Not friends yet', `<p class="mut"><a href="/chat">&larr; Chat</a></p><h2>You are not friends with ${esc(other.name)} yet</h2><p>${friendActionHtml(req.user.id, otherId)}</p>`, req.user));
  const rows = db.prepare('SELECT * FROM messages WHERE group_id IS NULL AND ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)) ORDER BY id ASC').all(req.user.id, otherId, otherId, req.user.id)
    .filter(m => !isHiddenFor(m.id, req.user.id));
  const bubbles = withUnreadDivider(rows, req.user.id, m => bubbleHtml(m, req.user.id, false));
  markRead(rows, req.user.id); clearUnreadMark(req.user.id, 'dm', otherId);
  const lastId = rows.length ? rows[rows.length - 1].id : 0;
  const headHtml = `<div class="chat-head"><a href="/chat" class="link" style="font-size:20px">&larr;</a><a href="/u/${other.id}" style="display:flex;align-items:center;gap:10px;color:inherit;text-decoration:none">${avatarOr(other)}<div><b>${esc(other.name)}</b>${other.title ? `<span class="role-tag">${esc(other.title)}</span>` : ''}<br><span class="mut" style="font-size:12px">${isOnline(other) ? 'Online' : 'Offline'} &middot; tap to view profile</span></div></a></div>`;
  threadPage(req, res, { isGroup: false, convId: otherId, title: other.name, headHtml, bubbles, lastId });
});

app.get('/chat/group/:id', (req, res) => {
  if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  const gid = Number(req.params.id);
  const g = db.prepare('SELECT * FROM groups WHERE id=?').get(gid);
  if (!g) return res.status(404).send(layout('Not found', '<h2>Group not found</h2>', req.user));
  if (!isGroupMember(gid, req.user.id)) return res.sendStatus(403);
  const members = groupMembers(gid);
  const byId = Object.fromEntries(members.map(m => [m.id, m.name]));
  const rows = db.prepare('SELECT * FROM messages WHERE group_id=? ORDER BY id ASC').all(gid).filter(m => !isHiddenFor(m.id, req.user.id)).map(m => ({ ...m, sender_name: byId[m.sender_id] || 'Former member' }));
  const bubbles = withUnreadDivider(rows, req.user.id, m => bubbleHtml(m, req.user.id, true));
  markRead(rows, req.user.id); clearUnreadMark(req.user.id, 'group', gid);
  const lastId = rows.length ? rows[rows.length - 1].id : 0;
  const headHtml = `<div class="chat-head"><a href="/chat" class="link" style="font-size:20px">&larr;</a><a href="/chat/group/${gid}/info" style="display:flex;align-items:center;gap:10px;color:inherit;text-decoration:none">${groupAvatarOr(g)}<div><b>${esc(g.name)}</b><br><span class="mut" style="font-size:12px">${members.length} members &middot; tap for group info</span></div></a></div>`;
  threadPage(req, res, { isGroup: true, convId: gid, title: g.name, headHtml, bubbles, lastId });
});

// Group info -- a full page styled after a familiar group-settings screen: big picture, name, member
// count, then a plain list of members and actions. Any admin can rename, add/remove members, change the
// picture, or make another member an admin too (a group can have more than one admin).
app.get('/chat/group/:id/info', (req, res) => {
  if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  const gid = Number(req.params.id);
  const g = db.prepare('SELECT * FROM groups WHERE id=?').get(gid);
  if (!g) return res.status(404).send(layout('Not found', '<h2>Group not found</h2>', req.user));
  if (!isGroupMember(gid, req.user.id)) return res.sendStatus(403);
  const members = groupMembers(gid);
  const amAdmin = isGroupAdmin(gid, req.user.id);
  const friendsNotIn = db.prepare('SELECT id,name FROM users WHERE id IN (' + (friendIds(req.user.id).join(',') || '0') + ') AND id NOT IN (' + (members.map(m => m.id).join(',') || '0') + ')').all();
  const avatarBlock = `<div style="text-align:center;margin:6px 0 18px">
${amAdmin ? `<label style="cursor:pointer;display:inline-block;position:relative">${groupAvatarOr(g, 96)}<form id="avF" method="post" action="/chat/group/${gid}/avatar" enctype="multipart/form-data" style="display:none"><input type="file" name="file" id="avI" accept="image/png,image/jpeg,image/webp"></form><span class="role-tag" style="position:absolute;bottom:0;right:-6px">Edit</span></label><script>document.getElementById('avI').addEventListener('change',function(){document.getElementById('avF').submit()})</script>`
    : groupAvatarOr(g, 96)}
<h1 style="margin:10px 0 2px;font-size:22px">${esc(g.name)}</h1><p class="mut" style="margin:0">Group &middot; ${members.length} members</p></div>`;
  const memberRow = m => {
    const isMe = m.id === req.user.id;
    const actions = !amAdmin || isMe ? '' : `${m.role === 'admin'
        ? `<form method="post" action="/chat/group/${gid}/demote/${m.id}"><button class="link">Remove admin</button></form>`
        : `<form method="post" action="/chat/group/${gid}/promote/${m.id}"><button class="link">Make admin</button></form>`}
<form method="post" action="/chat/group/${gid}/remove/${m.id}" onsubmit="return confirm('Remove ${esc(m.name)} from the group?')"><button class="link">Remove</button></form>`;
    return `<div class="card row">${avatarOr(m, 36)}<span style="flex:1">${esc(m.name)}${isMe ? ' (you)' : ''}${m.role === 'admin' ? ' <span class="role-tag">Group admin</span>' : ''}</span>${actions}</div>`;
  };
  res.send(layout(g.name, `<p class="mut" style="margin:0 0 4px"><a href="/chat/group/${gid}">&larr; Back to chat</a></p>
${avatarBlock}
${req.query.msg ? `<p class="mut">${esc(req.query.msg)}</p>` : ''}
${amAdmin ? `<form method="post" action="/chat/group/${gid}/rename" class="card row"><input name="name" placeholder="Rename group" value="${esc(g.name)}" style="width:auto;flex:1"><button>Save</button></form>` : ''}
${amAdmin && friendsNotIn.length ? `<form method="post" action="/chat/group/${gid}/add" class="card row"><select name="user_id">${friendsNotIn.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select><button>Add to group</button></form>` : ''}
<p class="chat-label">${members.length} members</p>
${members.map(memberRow).join('')}
<form method="post" action="/chat/group/${gid}/leave" onsubmit="return confirm('Leave this group?')" style="margin-top:14px"><button class="link">Leave group</button></form>`, req.user));
});

function validateReplyTarget(req, target) {
  const replyId = Number(req.body && req.body.reply_to_id) || null;
  if (!replyId) return { id: null };
  const parent = db.prepare('SELECT * FROM messages WHERE id=?').get(replyId);
  const sameConversation = parent && (target.group_id
    ? parent.group_id === target.group_id
    : !parent.group_id && ((parent.sender_id === req.user.id && parent.recipient_id === target.recipient_id) || (parent.sender_id === target.recipient_id && parent.recipient_id === req.user.id)));
  if (!sameConversation || parent.deleted_at || isHiddenFor(parent.id, req.user.id)) {
    return { error: 'Choose a message from this conversation to reply to.' };
  }
  return { id: replyId };
}

app.post('/api/messages/send', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const text = String((req.body && req.body.body) || '').trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: 'Invalid message.' });
  const target = resolveTarget(req);
  if (!target) return res.status(400).json({ error: 'Invalid message.' });
  const reply = validateReplyTarget(req, target);
  if (reply.error) return res.status(400).json({ error: reply.error });
  const replyId = reply.id;
  const { body_enc, iv } = encryptMsg(text);
  const info = db.prepare('INSERT INTO messages(sender_id,recipient_id,group_id,body_enc,iv,reply_to_id) VALUES(?,?,?,?,?,?)').run(req.user.id, target.recipient_id, target.group_id, body_enc, iv, replyId);
  const row = db.prepare('SELECT created_at FROM messages WHERE id=?').get(info.lastInsertRowid);
  notifyNewMessage(req.user, target, text.slice(0, 120), Number(info.lastInsertRowid));
  res.json({ id: Number(info.lastInsertRowid), created_at: row.created_at });
});

// Resolves ?to= (a friend) or ?group= (a group you belong to) from either the JSON body or a multipart body, into {recipient_id, group_id}.
function resolveTarget(req) {
  const b = req.body || {};
  if (b.group !== undefined && b.group !== '') {
    const gid = Number(b.group);
    if (!gid || !isGroupMember(gid, req.user.id)) return null;
    return { recipient_id: 0, group_id: gid };
  }
  const to = Number(b.to);
  if (!to || to === req.user.id || friendStatus(req.user.id, to) !== 'friends') return null;
  return { recipient_id: to, group_id: null };
}
function notifyNewMessage(sender, target, preview, messageId) {
  if (target.group_id) {
    const others = db.prepare('SELECT user_id FROM group_members WHERE group_id=? AND user_id != ?').all(target.group_id, sender.id).map(r => r.user_id).filter(id => !isMutedChat(id, 'group', target.group_id));
    const g = db.prepare('SELECT name FROM groups WHERE id=?').get(target.group_id);
    if (others.length) notify(others, { title: g.name, body: `${sender.name}: ${preview}`, url: '/chat/group/' + target.group_id + (messageId ? '?reply_to=' + messageId : ''), tag: 'group-' + target.group_id, quickReply: { group: target.group_id, reply_to_id: messageId || null } });
  } else if (!isMutedChat(target.recipient_id, 'dm', sender.id)) {
    notify([target.recipient_id], { title: sender.name, body: preview, url: '/chat/' + sender.id + (messageId ? '?reply_to=' + messageId : ''), tag: 'dm-' + sender.id, quickReply: { to: sender.id, reply_to_id: messageId || null } });
  }
}

// Sends bytes with Range support -- iPhones refuse to play audio without it.
function sendBytes(req, res, buf, mime) {
  // Only ordinary pictures, video, audio and PDFs are shown as such; anything else (HTML, SVG, scripts) is sent as a
  // plain download and fenced off, so a file someone sends in chat can never run on the site.
  const okType = /^(image\/(png|jpe?g|gif|webp|avif|bmp)|video\/[a-z0-9.+-]+|audio\/[a-z0-9.+-]+|application\/pdf)(;.*)?$/i.test(String(mime || ''));
  mime = okType ? mime : 'application/octet-stream';
  if (!/^application\/pdf/i.test(mime)) res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Content-Type', mime || 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const m = /^bytes=(\d*)-(\d*)$/.exec(String((req.headers && req.headers.range) || ''));
  if (m && (m[1] !== '' || m[2] !== '')) {
    const start = m[1] === '' ? Math.max(0, buf.length - Number(m[2])) : Number(m[1]);
    const end = (m[1] === '' || m[2] === '') ? buf.length - 1 : Math.min(Number(m[2]), buf.length - 1);
    if (start > end || start >= buf.length) { res.setHeader('Content-Range', `bytes */${buf.length}`); return res.sendStatus(416); }
    res.setHeader('Content-Range', `bytes ${start}-${end}/${buf.length}`);
    return res.status(206).send(buf.subarray(start, end + 1));
  }
  res.send(buf);
}
let lastPendingSweep = 0;
const AUDIO_MIME = /^audio\/[a-z0-9.+-]+(;\s*codecs=[a-z0-9.,+-]+)?$/i;
const STICKER_MIMES = ['image/png', 'image/webp', 'image/gif', 'image/jpeg'];
const MAX_STICKERS = 60;
const insertMedia = (from, target, kind, buf, mime, ms, name, replyId) => {
  const t = encryptMsg(''), m = encryptBytes(buf);
  const info = db.prepare('INSERT INTO messages(sender_id,recipient_id,group_id,body_enc,iv,kind,media_enc,media_iv,media_mime,media_ms,media_name,reply_to_id,media_size) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(from, target.recipient_id, target.group_id, t.body_enc, t.iv, kind, m.enc, m.iv, mime, ms || null, name || null, replyId || null, buf.length);
  return { id: Number(info.lastInsertRowid), created_at: db.prepare('SELECT created_at FROM messages WHERE id=?').get(info.lastInsertRowid).created_at };
};

// Voice notes: a recording made in the chat page, stored encrypted like every other message.
app.post('/api/messages/voice', upload.single('audio'), (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const target = resolveTarget(req);
  if (!target) return res.status(400).json({ error: 'Invalid message.' });
  if (!req.file || !AUDIO_MIME.test(req.file.mimetype)) return res.status(400).json({ error: 'That is not a voice recording.' });
  if (req.file.buffer.length > 3 * 1024 * 1024) return res.status(413).json({ error: 'That voice note is too long.' });
  if (limited('voice:' + req.user.id, 30, 60e3)) return res.status(429).json({ error: 'Slow down a little.' });
  const ms = Math.max(0, Math.min(Number(req.body.ms) || 0, 300000));
  const reply = validateReplyTarget(req, target);
  if (reply.error) return res.status(400).json({ error: reply.error });
  const result = insertMedia(req.user.id, target, 'voice', req.file.buffer, req.file.mimetype, ms, null, reply.id);
  notifyNewMessage(req.user, target, '🎤 Voice note', result.id);
  res.json(result);
});
// Stickers: sent from your own sticker board; the picture is copied into the message so it never breaks if you later delete it.
app.post('/api/messages/sticker', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const target = resolveTarget(req);
  const sid = Number(req.body && req.body.sticker_id);
  const st = sid ? db.prepare('SELECT * FROM stickers WHERE id=? AND user_id=?').get(sid, req.user.id) : null;
  if (!target || !st) return res.status(400).json({ error: 'Invalid sticker.' });
  if (limited('sticker:' + req.user.id, 60, 60e3)) return res.status(429).json({ error: 'Slow down a little.' });
  const reply = validateReplyTarget(req, target);
  if (reply.error) return res.status(400).json({ error: reply.error });
  const result = insertMedia(req.user.id, target, 'sticker', Buffer.from(st.data), st.mime, null, null, reply.id);
  notifyNewMessage(req.user, target, 'Sticker', result.id);
  res.json(result);
});
// A sticker that only ever lived on the sender's device: the recipient still needs the bytes themselves, so
// this uploads it fresh (no server-side sticker board involved) but keeps it tagged as a sticker to send.
app.post('/api/messages/local-sticker', upload.single('sticker'), (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const target = resolveTarget(req);
  if (!target || !req.file || !STICKER_MIMES.includes(req.file.mimetype)) return res.status(400).json({ error: 'Invalid sticker.' });
  if (limited('sticker:' + req.user.id, 60, 60e3)) return res.status(429).json({ error: 'Slow down a little.' });
  const reply = validateReplyTarget(req, target);
  if (reply.error) return res.status(400).json({ error: reply.error });
  const result = insertMedia(req.user.id, target, 'sticker', req.file.buffer, req.file.mimetype, null, null, reply.id);
  notifyNewMessage(req.user, target, 'Sticker', result.id);
  res.json(result);
});
// A photo or any other file picked from the gallery or phone storage -- same encrypted storage as everything else.
app.post('/api/messages/attachment', upload.single('file'), (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const target = resolveTarget(req);
  if (!target) return res.status(400).json({ error: 'Invalid message.' });
  if (!req.file) return res.status(400).json({ error: 'Choose a file first.' });
  if (limited('attach:' + req.user.id, 20, 60e3)) return res.status(429).json({ error: 'Slow down a little.' });
  const kind = /^image\//.test(req.file.mimetype) ? 'image' : /^video\//.test(req.file.mimetype) ? 'video' : 'file';
  const result = insertMedia(req.user.id, target, kind, req.file.buffer, req.file.mimetype, null, req.file.originalname.slice(0, 150));
  notifyNewMessage(req.user, target, kind === 'image' ? '📷 Photo' : kind === 'video' ? '🎬 Video' : `📄 ${req.file.originalname.slice(0, 60)}`, result.id);
  res.json(result);
});
// Two-step sending: the message is dropped on the server straight away as an empty placeholder (so it shows in the chat at once),
// then the file itself is uploaded into it. Everyone in the chat sees "Sending..." until the file has arrived.
app.post('/api/messages/attachment/start', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const target = resolveTarget(req);
  if (!target) return res.status(400).json({ error: 'Invalid message.' });
  if (limited('attach:' + req.user.id, 20, 60e3)) return res.status(429).json({ error: 'Slow down a little.' });
  const b = req.body || {}, size = Math.max(0, Math.floor(Number(b.size) || 0));
  if (size > 200 * 1024 * 1024) return res.status(413).json({ error: 'That file is too big (200 MB is the limit).' });
  const mime = /^[\w.+-]+\/[\w.+-]+$/.test(String(b.mime || '')) ? String(b.mime).slice(0, 100) : 'application/octet-stream';
  const name = String(b.name || 'file').replace(/[\r\n"]/g, '').slice(0, 150) || 'file';
  const kind = /^image\//.test(mime) ? 'image' : /^video\//.test(mime) ? 'video' : 'file';
  const t = encryptMsg('');
  const info = db.prepare('INSERT INTO messages(sender_id,recipient_id,group_id,body_enc,iv,kind,media_mime,media_name,media_size) VALUES(?,?,?,?,?,?,?,?,?)').run(req.user.id, target.recipient_id, target.group_id, t.body_enc, t.iv, kind, mime, name, size);
  res.json({ id: Number(info.lastInsertRowid), kind, created_at: db.prepare('SELECT created_at FROM messages WHERE id=?').get(info.lastInsertRowid).created_at });
});
app.post('/api/messages/attachment/:id', upload.single('file'), (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const m = db.prepare('SELECT id,sender_id,recipient_id,group_id,kind,deleted_at,(media_enc IS NOT NULL) AS filled FROM messages WHERE id=?').get(Number(req.params.id));
  if (!m || m.sender_id !== req.user.id || m.deleted_at || m.filled || !MEDIA_KINDS.includes(m.kind)) return res.status(404).json({ error: 'This message is no longer waiting for a file.' });
  if (!req.file) return res.status(400).json({ error: 'Choose a file first.' });
  const kind = /^image\//.test(req.file.mimetype) ? 'image' : /^video\//.test(req.file.mimetype) ? 'video' : 'file';
  const enc = encryptBytes(req.file.buffer);
  db.prepare('UPDATE messages SET media_enc=?, media_iv=?, media_mime=?, media_size=?, media_name=?, kind=? WHERE id=?').run(enc.enc, enc.iv, req.file.mimetype, req.file.buffer.length, String(req.file.originalname || 'file').slice(0, 150), kind, m.id);
  notifyNewMessage(req.user, { recipient_id: m.recipient_id, group_id: m.group_id }, kind === 'image' ? '📷 Photo' : kind === 'video' ? '🎬 Video' : `📄 ${String(req.file.originalname).slice(0, 60)}`, m.id);
  res.json({ ok: true, id: m.id, kind, size: req.file.buffer.length });
});
// A voice note or sticker's file -- only people in that conversation can fetch it.
app.get('/api/messages/media/:id', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const m = db.prepare('SELECT * FROM messages WHERE id=?').get(Number(req.params.id));
  if (!m || !m.media_enc) return res.sendStatus(404);
  const allowed = m.group_id ? isGroupMember(m.group_id, req.user.id) : (m.sender_id === req.user.id || m.recipient_id === req.user.id);
  if (!allowed) return res.sendStatus(404);
  const buf = decryptBytes(m.media_enc, m.media_iv);
  if (!buf) return res.sendStatus(404);
  if (req.query.dl) {
    const ext = ((m.media_mime || '').split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 5);
    res.setHeader('Content-Disposition', `attachment; filename="${String(m.media_name || ('studies-hub-' + (m.kind || 'file') + '.' + ext)).replace(/[^\w .()-]/g, '_')}"`);
  }
  sendBytes(req, res, buf, m.media_mime);
});

app.get('/api/messages/poll', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  markDelivered(req.user.id);
  const after = Number(req.query.after) || 0;
  let rows, meta = {};
  if (req.query.group) {
    const gid = Number(req.query.group);
    if (!gid || !isGroupMember(gid, req.user.id)) return res.status(400).json({ error: 'Missing conversation.' });
    rows = db.prepare('SELECT * FROM messages WHERE group_id=? AND id>? ORDER BY id ASC').all(gid, after);
    const names = Object.fromEntries(groupMembers(gid).map(m => [m.id, m.name]));
    rows.forEach(m => { meta[m.id] = { from_name: names[m.sender_id] }; });
  } else {
    const withId = Number(req.query.with || req.query.to);
    if (!withId) return res.status(400).json({ error: 'Missing conversation.' });
    rows = db.prepare('SELECT * FROM messages WHERE group_id IS NULL AND id>? AND ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)) ORDER BY id ASC')
      .all(after, req.user.id, withId, withId, req.user.id);
  }
  rows = rows.filter(m => !isHiddenFor(m.id, req.user.id));
  // Read receipts: a message only counts as viewed while the chat tab is actually showing (the page sends seen=0 when it is in the
  // background). The moment it is showing again, everything still unread in this conversation is marked read, so the sender's ticks turn green.
  if (req.query.seen !== '0') {
    markRead(rows, req.user.id);
    const unreadSql = 'AND NOT EXISTS (SELECT 1 FROM message_reads r WHERE r.message_id=messages.id AND r.user_id=?)';
    const waiting = req.query.group
      ? db.prepare('SELECT * FROM messages WHERE group_id=? AND sender_id!=? ' + unreadSql).all(Number(req.query.group), req.user.id, req.user.id)
      : db.prepare('SELECT * FROM messages WHERE group_id IS NULL AND sender_id=? AND recipient_id=? ' + unreadSql).all(Number(req.query.with || req.query.to), req.user.id, req.user.id);
    markRead(waiting, req.user.id);
  }
  const messages = rows.map(m => ({
    id: m.id, from: m.sender_id, from_name: (meta[m.id] || {}).from_name, kind: m.kind || 'text',
    deleted: !!m.deleted_at, edited: !!m.edited_at,
    body: m.deleted_at ? '' : (m.kind === 'text' || !m.kind ? decryptMsg(m.body_enc, m.iv) : ''),
    ms: m.media_ms || 0, name: m.media_name || '', size: mediaSizeOf(m), pending: isPendingMedia(m), created_at: m.created_at,
    reactions: reactionsFor(m.id),
    reply: messageReplyInfo(m, req.user.id, !!m.group_id), fwd: !!m.forwarded, starred: isStarred(m.id, req.user.id), call: m.kind === 'call' ? callInfo(m, req.user.id) : undefined,
    tick: m.sender_id === req.user.id && !m.group_id ? tickFor(m, m.recipient_id) : undefined,
  }));
  // Tick refresh for messages I sent earlier in this conversation, so the sender's ticks update live even with no new messages.
  let receipts = [];
  if (!req.query.group) {
    const withId = Number(req.query.with || req.query.to);
    const mine = db.prepare("SELECT id,recipient_id,delivered_at FROM messages WHERE group_id IS NULL AND sender_id=? AND recipient_id=? AND deleted_at IS NULL ORDER BY id DESC LIMIT 30").all(req.user.id, withId);
    receipts = mine.map(m => ({ id: m.id, status: tickFor(m, m.recipient_id) }));
  }
  // Uploads the page is still waiting on: tell it which have now arrived (or were cancelled).
  const ready = [];
  String(req.query.pend || '').split(',').slice(0, 20).map(Number).filter(n => Number.isSafeInteger(n) && n > 0).forEach(id => {
    const r = db.prepare('SELECT id,sender_id,recipient_id,group_id,kind,media_size,deleted_at,(media_enc IS NOT NULL) AS filled FROM messages WHERE id=?').get(id);
    if (!r || r.deleted_at || !canSeeMsg(req.user.id, r)) ready.push({ id, gone: true });
    else if (r.filled) ready.push({ id, kind: r.kind, size: r.media_size || 0 });
  });
  if (Date.now() - lastPendingSweep > 60e3) { lastPendingSweep = Date.now(); db.prepare("DELETE FROM messages WHERE media_enc IS NULL AND kind IN ('image','video','file') AND created_at < datetime('now','-60 minutes')").run(); }
  res.json({ messages, receipts, ready });
});

app.post('/api/messages/:id/react', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const m = db.prepare('SELECT * FROM messages WHERE id=?').get(Number(req.params.id));
  const allowed = m && (m.group_id ? isGroupMember(m.group_id, req.user.id) : (m.sender_id === req.user.id || m.recipient_id === req.user.id));
  if (!allowed) return res.status(404).json({ error: 'Message not found.' });
  const emoji = String((req.body && req.body.emoji) || '').slice(0, 8);
  if (!emoji) return res.status(400).json({ error: 'Choose a reaction.' });
  const existing = db.prepare('SELECT emoji FROM message_reactions WHERE message_id=? AND user_id=?').get(m.id, req.user.id);
  if (existing && existing.emoji === emoji) db.prepare('DELETE FROM message_reactions WHERE message_id=? AND user_id=?').run(m.id, req.user.id);
  else db.prepare('INSERT INTO message_reactions(message_id,user_id,emoji) VALUES(?,?,?) ON CONFLICT(message_id,user_id) DO UPDATE SET emoji=excluded.emoji').run(m.id, req.user.id, emoji);
  res.json({ ok: true, reactions: reactionsFor(m.id) });
});
app.post('/api/messages/:id/edit', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const m = db.prepare('SELECT * FROM messages WHERE id=?').get(Number(req.params.id));
  if (!m || m.sender_id !== req.user.id) return res.status(404).json({ error: 'Message not found.' });
  if (m.kind !== 'text' && m.kind !== undefined) { /* only text is editable */ }
  if (m.kind && m.kind !== 'text') return res.status(400).json({ error: 'Only text messages can be edited.' });
  if (m.deleted_at) return res.status(400).json({ error: 'That message was deleted.' });
  const text = String((req.body && req.body.body) || '').trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: 'Message cannot be empty.' });
  const { body_enc, iv } = encryptMsg(text);
  db.prepare('UPDATE messages SET body_enc=?, iv=?, edited_at=CURRENT_TIMESTAMP WHERE id=?').run(body_enc, iv, m.id);
  res.json({ ok: true });
});
app.post('/api/messages/:id/delete', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const m = db.prepare('SELECT * FROM messages WHERE id=?').get(Number(req.params.id));
  const allowed = m && (m.group_id ? isGroupMember(m.group_id, req.user.id) : (m.sender_id === req.user.id || m.recipient_id === req.user.id));
  if (!allowed) return res.status(404).json({ error: 'Message not found.' });
  const scope = req.body && req.body.scope === 'everyone' ? 'everyone' : 'me';
  if (scope === 'everyone') {
    if (m.sender_id !== req.user.id) return res.status(403).json({ error: 'Only the sender can delete for everyone.' });
    const t = encryptMsg('');
    // Remove reply links to this message so its deleted content is not left behind as a reply preview.
    db.prepare('UPDATE messages SET reply_to_id=NULL WHERE reply_to_id=?').run(m.id);
    db.prepare('UPDATE messages SET body_enc=?, iv=?, media_enc=NULL, media_iv=NULL, media_mime=NULL, media_ms=NULL, deleted_at=CURRENT_TIMESTAMP, deleted_by=? WHERE id=?').run(t.body_enc, t.iv, req.user.id, m.id);
    return res.json({ ok: true, created_at: m.created_at });
  }
  db.prepare('INSERT OR IGNORE INTO message_hidden(message_id,user_id) VALUES(?,?)').run(m.id, req.user.id);
  res.json({ ok: true });
});

// ---------- unread badge (nav) ----------
function chatBadge(me) {
  const dm = db.prepare("SELECT COUNT(DISTINCT sender_id) n FROM messages WHERE group_id IS NULL AND recipient_id=? AND deleted_at IS NULL AND id NOT IN (SELECT message_id FROM message_hidden WHERE user_id=?) AND id NOT IN (SELECT message_id FROM message_reads WHERE user_id=?)").get(me, me, me).n;
  const gRows = db.prepare('SELECT group_id FROM group_members WHERE user_id=?').all(me).map(r => r.group_id);
  let g = 0;
  for (const gid of gRows) if (db.prepare("SELECT 1 FROM messages WHERE group_id=? AND sender_id != ? AND deleted_at IS NULL AND id NOT IN (SELECT message_id FROM message_reads WHERE user_id=?) LIMIT 1").get(gid, me, me)) g++;
  return dm + g;
}

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

app.get('/avatar/:id', (req, res) => {
  const row = db.prepare('SELECT avatar_data, avatar_mime FROM users WHERE id=?').get(req.params.id);
  if (!row || !row.avatar_data) return res.sendStatus(404);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Content-Type', row.avatar_mime || 'application/octet-stream');
  res.send(Buffer.from(row.avatar_data));
});

const levelOptions = (sel, blank) => `<option value="">${blank}</option>${LEVELS.map(l => `<option value="${l}"${Number(sel) === l ? ' selected' : ''}>${l} level</option>`).join('')}`;
// Once someone has signed up, their username, university, department and level are permanent -- only their name, picture and position can change.
// (A level only moves when the central admin, or someone they appointed, promotes students.) A field is locked as soon as it has a value.
const lockedOf = u => ({ username: !!(u && u.username), university: !!(u && u.university), department: !!(u && u.department), level: !!(u && u.level) });
const lockedRow = (label, value) => `<label class="mut">${label}</label><div class="locked-field"><span>${esc(String(value))}</span></div>`;
function profileFields(v, student, lk = {}) {
  const lockedBlock = lk.username || lk.university || lk.department || lk.level;
  return `<label class="mut">Your name</label><input name="name" value="${esc(v.name || '')}" maxlength="80" required>
${lk.username ? lockedRow('Username', '@' + v.username) : `<label class="mut">Username</label><input name="username" id="unameInput" value="${esc(v.username || '')}" maxlength="21" placeholder="@yourname" autocapitalize="none" autocomplete="off" required>
<p class="hint" id="unameHint">3 to 20 characters: letters, numbers, dots or underscores. Nobody else can have the same one, and friends will find you with it. <b>You cannot change it later.</b></p>`}
${lk.university ? lockedRow('University', v.university) : `<label class="mut">University</label><input name="university" value="${esc(v.university || 'University of Uyo')}" maxlength="120"${student ? ' required' : ''}>`}
${lk.department ? lockedRow('Department / course of study', v.department) : `<label class="mut">Department / course of study</label><select name="department"${student ? ' required' : ''}><option value="">Choose your department...</option>${departmentOptions(v.department)}</select>`}
${lk.level ? lockedRow('Level', v.level + ' level') : `<label class="mut">Level</label><select name="level"${student ? ' required' : ''}>${levelOptions(v.level, 'Choose your level...')}</select>`}
<p class="hint">${lockedBlock ? 'These are fixed once you have signed up. Your level moves up only when the school admin promotes students; if something is wrong, ask an admin.' : 'Your department and level decide which uploads you see. <b>You cannot change them later</b>, so choose carefully.'}</p>
<label class="mut">Position held in school (optional)</label><input name="position" value="${esc(v.position || '')}" maxlength="60" placeholder="e.g. Director of Socials">
<p class="hint">If you add one, school authorities check it first. Once verified it shows beside your name.</p>`;
}
const UNAME_JS = `(function(){var i=document.getElementById('unameInput'),h=document.getElementById('unameHint'),t=null;if(!i)return;
i.addEventListener('input',function(){clearTimeout(t);var v=i.value;t=setTimeout(function(){if(!v.replace(/^@+/,'').length)return;fetch('/api/username/check?u='+encodeURIComponent(v)).then(function(r){return r.json()}).then(function(j){h.textContent=j.message;h.className='hint '+(j.ok?'ok':'err')}).catch(function(){})},350)})})();`;
function readProfile(user, body) {
  const trim = (v, n) => String(v || '').trim().slice(0, n);
  const student = user.role === 'user', lk = lockedOf(user);
  const d = { name: trim(body.name, 80) || user.name, username: cleanUsername(body.username), university: trim(body.university, 120) || null, department: trim(body.department, 120) || null, level: LEVELS.includes(Number(body.level)) ? Number(body.level) : null, position: trim(body.position, 60) || null };
  // Locked fields can never be changed by the person: whatever was sent is thrown away and the saved value is kept.
  if (lk.username) d.username = user.username;
  if (lk.university) d.university = user.university;
  if (lk.department) d.department = user.department;
  if (lk.level) d.level = user.level;
  let problem = lk.username ? '' : usernameProblem(d.username, user.id);
  if (!problem && !lk.department && d.department && !departmentNames().includes(d.department)) problem = 'Choose your department from the list.';
  if (!problem && student) {
    if (!d.university) problem = 'Enter your university.';
    else if (!d.department) problem = 'Choose your department from the list.';
    else if (!d.level) problem = 'Choose your level.';
  }
  return { d, problem };
}
// Saves the profile. A position needs school authorities' approval (a full admin approves their own); until then no title shows.
function saveProfile(user, d) {
  const cur = db.prepare('SELECT username,university,department,level FROM users WHERE id=?').get(user.id) || {};
  try { // a value that is already saved is never overwritten here, whatever the caller passed
    db.prepare('UPDATE users SET name=?, username=?, university=?, department=?, level=? WHERE id=?').run(d.name, cur.username || d.username, cur.university || d.university, cur.department || d.department, cur.level || d.level, user.id);
  } catch { return 'That username is already taken.'; }
  if ((d.position || null) !== (user.position || null)) {
    if (!d.position) db.prepare('UPDATE users SET position=NULL, position_status=NULL, title=NULL WHERE id=?').run(user.id);
    else if (can.full(user)) db.prepare("UPDATE users SET position=?, position_status='approved', title=? WHERE id=?").run(d.position, d.position, user.id);
    else {
      db.prepare("UPDATE users SET position=?, position_status='pending', title=NULL WHERE id=?").run(d.position, user.id);
      const claimant = { department: d.department, level: d.level };
      const delegate = db.prepare("SELECT * FROM users WHERE position_status='approved' AND position_can_verify=1").all()
        .filter(v => canVerifyClaim(v, claimant))
        .sort((a, b) => (SCOPE_RANK[a.position_scope] || 1) - (SCOPE_RANK[b.position_scope] || 1))[0];
      if (delegate) notify([delegate.id], { title: 'Position to verify', body: `${d.name} says: ${d.position}`, url: '/settings', tag: 'position' });
      else notify(fullAdminIds(), { title: 'Position to verify', body: `${d.name} says: ${d.position}`, url: '/admin#positions', tag: 'position' });
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
app.get('/lecturer/welcome', (req, res) => {
  if (!req.user) return res.redirect('/login?next=/lecturer/welcome');
  if (!req.user.is_lecturer) return res.redirect('/welcome');
  if (profileComplete(req.user)) return res.redirect('/lecturer');
  res.send(lecturerWelcomePage(req.user));
});
function lecturerWelcomePage(u, err = '') {
  const courses = db.prepare('SELECT id, name FROM courses ORDER BY name').all();
  const picked = db.prepare('SELECT course_id FROM lecturer_courses WHERE lecturer_id=?').all(u.id).map(r => r.course_id);
  const instList = institutionList(), uniKnown = u.university && instList.includes(u.university);
  return layout('Finish setting up', `<div class="auth"><h1>A few details</h1><p class="mut">This goes to a full admin to verify you're really on staff at the institution you name.</p>${err ? `<p class="err">${esc(err)}</p>` : ''}
<form method="post" class="card">
<input name="name" value="${esc(u.name || '')}" placeholder="Your name" required maxlength="80">
<select name="university" id="uniSelect" required>
<option value="">Institution you teach at&hellip;</option>
${instList.concat([OTHER_UNI]).map(n => `<option value="${esc(n)}"${u.university === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}
</select>
<input name="university_other" id="uniOther" placeholder="Type your institution's name" maxlength="120" value="${!uniKnown ? esc(u.university || '') : ''}" style="${u.university && !uniKnown ? '' : 'display:none'}">
<script>(function(){var s=document.getElementById('uniSelect'),o=document.getElementById('uniOther');function sync(){var other=s.value==='Other (type it in below)';o.style.display=other?'':'none';o.required=other}s.addEventListener('change',sync);sync()})()</script>
<input name="reg_no" value="${esc(u.lecturer_reg_no || '')}" placeholder="Staff/registration number (optional)" maxlength="60">
<label class="mut">Which course(s) do you teach? (pick any that already exist -- you can pick more than one)</label>
<div style="max-height:180px;overflow-y:auto;border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin:6px 0">${courses.map(c => `<label class="row" style="justify-content:flex-start;gap:8px;margin:4px 0;cursor:pointer"><input type="checkbox" name="course_id" value="${c.id}" style="width:auto"${picked.includes(c.id) ? ' checked' : ''}>${esc(c.name)}</label>`).join('') || '<p class="mut" style="margin:0">No courses listed yet -- add yours below.</p>'}</div>
<input name="new_course" placeholder="Course not listed? Type its name" maxlength="120">
<button>Submit for verification</button></form></div>`, u);
}
app.post('/lecturer/welcome', (req, res) => {
  if (!req.user) return res.redirect('/login?next=/lecturer/welcome');
  if (!req.user.is_lecturer) return res.redirect('/welcome');
  const name = String(req.body.name || '').trim().slice(0, 80);
  const uniChoice = String(req.body.university || '').trim();
  const university = (uniChoice === 'Other (type it in below)' ? String(req.body.university_other || '').trim() : uniChoice).slice(0, 120);
  const regNo = String(req.body.reg_no || '').trim().slice(0, 60) || null;
  const newCourseName = String(req.body.new_course || '').trim().slice(0, 120);
  const pickedIds = (Array.isArray(req.body.course_id) ? req.body.course_id : req.body.course_id ? [req.body.course_id] : []).map(Number).filter(Boolean);
  const fail = m => res.status(400).send(lecturerWelcomePage({ ...req.user, name, university, lecturer_reg_no: regNo }, m));
  if (!name || !university) return fail('Please fill in your name and institution.');
  let newCourseId = null;
  if (newCourseName) {
    const existing = db.prepare('SELECT id FROM courses WHERE name=?').get(newCourseName);
    newCourseId = existing ? existing.id : Number(db.prepare('INSERT INTO courses(name) VALUES(?)').run(newCourseName).lastInsertRowid);
  }
  const allCourseIds = [...new Set([...pickedIds, ...(newCourseId ? [newCourseId] : [])])];
  if (!allCourseIds.length) return fail('Pick at least one course, or add one that is not listed yet.');
  db.prepare('UPDATE users SET name=?, university=?, lecturer_reg_no=?, lecturer_status=? WHERE id=?').run(name, university, regNo, 'pending', req.user.id);
  db.prepare('DELETE FROM lecturer_courses WHERE lecturer_id=?').run(req.user.id);
  const ins = db.prepare('INSERT OR IGNORE INTO lecturer_courses(lecturer_id,course_id) VALUES(?,?)');
  allCourseIds.forEach(cid => ins.run(req.user.id, cid));
  const courseNames = db.prepare(`SELECT name FROM courses WHERE id IN (${allCourseIds.map(() => '?').join(',')})`).all(...allCourseIds).map(c => c.name).join(', ');
  notify(fullAdminIds(), { title: 'Lecturer to verify', body: `${name} (${university}) -- ${courseNames}`, url: '/admin#lecturers', tag: 'lecturer' });
  res.redirect('/lecturer');
});
app.get('/lecturer', (req, res) => {
  if (!req.user) return res.redirect('/login?next=/lecturer');
  if (!req.user.is_lecturer) return res.redirect(isCentral(req.user) ? '/admin/structure#courses' : '/dashboard');
  if (!profileComplete(req.user)) return res.redirect('/lecturer/welcome');
  if (req.user.lecturer_status === 'pending') return res.send(layout('My courses', `<h1>My courses</h1><p class="pill pending">Waiting for a full admin to verify you teach at ${esc(req.user.university)}</p><p class="mut">You'll be able to upload once that's done.</p>`, req.user));
  if (req.user.lecturer_status === 'rejected') return res.send(layout('My courses', `<h1>My courses</h1><p class="err">This wasn't approved.</p><p class="mut"><a href="/lecturer/welcome">Edit your details and try again &rarr;</a></p>`, req.user));
  const myCourses = db.prepare('SELECT c.id, c.name FROM courses c JOIN lecturer_courses lc ON lc.course_id=c.id WHERE lc.lecturer_id=? ORDER BY c.name').all(req.user.id);
  const myPages = db.prepare("SELECT p.*, c.name AS course_name FROM pages p LEFT JOIN courses c ON c.id=p.course_id WHERE p.author_id=? ORDER BY p.id DESC").all(req.user.id);
  const courseLinks = myCourses.map(c => `<a class="btn ghost" style="margin:4px 6px 0 0;display:inline-block" href="/lecturer/course/${c.id}">${esc(c.name)}</a>`).join('') || '<p class="mut">No courses linked to your account.</p>';
  const uploadForm = `<form class="card" id="upload" method="post" action="/lecturer/upload" enctype="multipart/form-data"><h3>Upload for a course</h3>
<select name="course_id" required><option value="">Which course is this for?</option>${myCourses.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
<select name="kind" id="lkindSelect"><option value="pdf">PDF document</option><option value="doc">Word document</option><option value="html">HTML page</option></select>
<div id="lfileField"><input type="file" name="file" accept=".pdf" required></div>
<label class="mut">Which departments is this for? (leave all unchecked for every department)</label>${departmentCheckboxes([])}
<label class="mut">Level</label><select name="level"><option value="all">All levels</option>${LEVELS.map(l => `<option value="${l}">${l} level only</option>`).join('')}</select>
<button>Publish -- goes live immediately</button></form>
<script>(function(){var k=document.getElementById('lkindSelect'),fi=document.querySelector('#lfileField input');function sync(){fi.accept=k.value==='pdf'?'.pdf':k.value==='doc'?'.doc,.docx':'.html,.htm,text/html'}k.addEventListener('change',sync);sync()})()</script>`;
  const pagesList = myPages.map(p => {
    const [icon, label] = KIND_META[p.kind] || KIND_META.html;
    return `<div class="card row"><div><a href="/p/${p.slug}">${icon} ${esc(p.title)}</a><br><span class="mut">${esc(p.course_name || '')} &middot; ${label}</span></div>
<div class="row" style="gap:6px"><a href="/lecturer/pages/${p.id}/edit" class="link">Edit</a><form method="post" action="/lecturer/pages/${p.id}/delete" onsubmit="return confirm('Delete this upload?')"><button class="link">Delete</button></form></div></div>`;
  }).join('') || '<p class="mut">Nothing uploaded yet.</p>';
  res.send(layout('My courses', `<h1>My courses</h1><p class="mut" style="margin-top:0">${esc(req.user.university)}${req.user.lecturer_reg_no ? ' &middot; ' + esc(req.user.lecturer_reg_no) : ''}</p>
${req.query.msg ? `<p class="mut">${esc(req.query.msg)}</p>` : ''}
<div>${courseLinks}</div>
${uploadForm}<h3>Your uploads (${myPages.length})</h3>${pagesList}`, req.user));
});
app.post('/lecturer/upload', upload.single('file'), (req, res) => {
  if (!req.user || !req.user.is_lecturer) return res.sendStatus(403);
  if (req.user.lecturer_status !== 'approved') return res.sendStatus(403);
  const courseId = Number(req.body.course_id);
  const owns = courseId && db.prepare('SELECT 1 FROM lecturer_courses WHERE lecturer_id=? AND course_id=?').get(req.user.id, courseId);
  if (!owns) return res.redirect(back('Pick one of your own courses.'));
  const kind = ['pdf', 'doc', 'html'].includes(req.body.kind) ? req.body.kind : 'pdf';
  const title = (req.body.title || '').trim();
  if (!req.file) return res.redirect(back('Choose a file first.'));
  const base = req.file.originalname.replace(/\.[a-z0-9]+$/i, '');
  const slug = uniqueSlug(slugify(base)), aud = readAudience(req.body, title || base);
  if (kind === 'pdf' || kind === 'doc') {
    db.prepare('INSERT INTO pages(slug,title,html,kind,file_data,file_mime,file_name,dept,level,author_id,course_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(slug, title || base, '', kind, req.file.buffer, req.file.mimetype, req.file.originalname, aud.dept, aud.level, req.user.id, courseId);
  } else {
    db.prepare('INSERT INTO pages(slug,title,html,kind,dept,level,author_id,course_id) VALUES(?,?,?,?,?,?,?,?)')
      .run(slug, title || base, req.file.buffer.toString('utf8'), kind, aud.dept, aud.level, req.user.id, courseId);
  }
  announceUpload({ title: title || base, slug, paid: 0, ...aud });
  res.redirect('/lecturer?msg=' + encodeURIComponent(`Published at /p/${slug}`));
});
app.get('/lecturer/pages/:id/edit', (req, res) => {
  if (!req.user || !req.user.is_lecturer) return res.redirect('/login');
  const p = db.prepare('SELECT * FROM pages WHERE id=? AND author_id=?').get(req.params.id, req.user.id);
  if (!p) return res.status(404).send(layout('Not found', '<p><a href="/lecturer">Back</a></p>', req.user));
  res.send(layout('Edit upload', `<p class="mut"><a href="/lecturer">&larr; Back</a></p><h1 style="font-size:24px">${esc(p.title)}</h1>
<form class="card" method="post" action="/lecturer/pages/${p.id}/edit" enctype="multipart/form-data">
<input name="title" value="${esc(p.title)}" required maxlength="140">
<label class="mut">Replace the file (optional -- leave blank to keep the current one)</label>
<input type="file" name="file" accept="${p.kind === 'pdf' ? '.pdf' : p.kind === 'doc' ? '.doc,.docx' : '.html,.htm'}">
<label class="mut">Which departments? (leave all unchecked for every department)</label>${departmentCheckboxes(deptListOf(p))}
<label class="mut">Level</label><select name="level"><option value="all">All levels</option>${LEVELS.map(l => `<option value="${l}"${Number(p.level) === l ? ' selected' : ''}>${l} level only</option>`).join('')}</select>
<button>Save changes</button></form>`, req.user));
});
app.post('/lecturer/pages/:id/edit', upload.single('file'), (req, res) => {
  if (!req.user || !req.user.is_lecturer) return res.redirect('/login');
  const p = db.prepare('SELECT * FROM pages WHERE id=? AND author_id=?').get(req.params.id, req.user.id);
  if (!p) return res.status(404).send(layout('Not found', '<p><a href="/lecturer">Back</a></p>', req.user));
  const title = (req.body.title || '').trim() || p.title;
  const aud = readAudience(req.body, title);
  if (req.file) {
    if (p.kind === 'pdf' || p.kind === 'doc') db.prepare('UPDATE pages SET title=?, file_data=?, file_mime=?, file_name=?, dept=?, level=? WHERE id=?').run(title, req.file.buffer, req.file.mimetype, req.file.originalname, aud.dept, aud.level, p.id);
    else db.prepare('UPDATE pages SET title=?, html=?, dept=?, level=? WHERE id=?').run(title, req.file.buffer.toString('utf8'), aud.dept, aud.level, p.id);
  } else {
    db.prepare('UPDATE pages SET title=?, dept=?, level=? WHERE id=?').run(title, aud.dept, aud.level, p.id);
  }
  res.redirect('/lecturer?msg=' + encodeURIComponent('Saved.'));
});
app.post('/lecturer/pages/:id/delete', (req, res) => {
  if (!req.user || !req.user.is_lecturer) return res.redirect('/login');
  const p = db.prepare('SELECT id FROM pages WHERE id=? AND author_id=?').get(req.params.id, req.user.id);
  if (!p) return res.status(404).send(layout('Not found', '<p><a href="/lecturer">Back</a></p>', req.user));
  db.prepare('DELETE FROM pages WHERE id=?').run(p.id);
  res.redirect('/lecturer?msg=' + encodeURIComponent('Deleted.'));
});
// Browse a course's uploads folder-style: university, then lecturer, then their files -- so one lecturer
// never has to wade through a long flat list to find a colleague's (or another institution's) material.
app.get('/lecturer/course/:id', (req, res) => {
  if (!req.user) return res.redirect('/login');
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id);
  if (!course) return res.status(404).send(layout('Not found', '<p><a href="/lecturer">Back</a></p>', req.user));
  // What lecturers post to a course is for the lecturers who teach that same course (verified ones) and nobody else -- not students, and not admins
  // (the central admin is a student unless he registers as a lecturer). Students reach lecturer material through the normal pages meant for them.
  const owns = req.user.is_lecturer && req.user.lecturer_status === 'approved' && db.prepare('SELECT 1 FROM lecturer_courses WHERE lecturer_id=? AND course_id=?').get(req.user.id, course.id);
  if (!owns) return res.status(404).send(layout('Not found', `<p><a href="${req.user.is_lecturer ? '/lecturer' : '/dashboard'}">Back</a></p>`, req.user));
  const rows = db.prepare(`SELECT p.*, u.name AS author_name, u.university AS author_university FROM pages p JOIN users u ON u.id=p.author_id WHERE p.course_id=? ORDER BY u.university, u.name, p.id DESC`).all(course.id);
  const byUni = {};
  rows.forEach(r => { (byUni[r.author_university] = byUni[r.author_university] || {})[r.author_name] = (byUni[r.author_university][r.author_name] || []).concat(r); });
  const html = Object.keys(byUni).sort().map(uni => `<details class="card"><summary style="cursor:pointer;font-weight:600">${esc(uni)}</summary>
${Object.keys(byUni[uni]).sort().map(name => `<details style="margin:8px 0 0 10px"><summary style="cursor:pointer">${esc(name)}</summary>
${byUni[uni][name].map(p => { const [icon, label] = KIND_META[p.kind] || KIND_META.html; return `<p style="margin:6px 0 6px 14px"><a href="/p/${p.slug}">${icon} ${esc(p.title)}</a> <span class="mut">${label}</span></p>`; }).join('')}
</details>`).join('')}
</details>`).join('') || '<p class="mut">No uploads for this course yet.</p>';
  res.send(layout(course.name, `<p class="mut"><a href="/lecturer">&larr; Back</a></p><h1>${esc(course.name)}</h1>${html}`, req.user));
});
app.get('/api/username/check', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  if (limited('ucheck:' + req.user.id, 60, 60e3)) return res.status(429).json({ ok: false, message: 'Slow down a little.' });
  const p = usernameProblem(req.query.u, req.user.id);
  res.json({ ok: !p, message: p || 'That username is available.' });
});

const SETTINGS_PAGES = [
  ['/settings/profile', '👤', 'Profile', 'Your picture, name, and details'],
  ['/settings/active-status', '🟢', 'Active status', 'Whether others see when you\u2019re online'],
  ['/settings/appearance', '🎨', 'Appearance', 'Light or dark mode'],
  ['/settings/notifications', '🔔', 'Notifications', 'Get alerted on this device'],
];
app.get('/settings', (req, res) => {
  if (!req.user) return res.redirect('/login?next=/settings');
  const links = (canPromote(req.user) ? SETTINGS_PAGES.concat([['/admin/levels', '🎓', 'Level promotion', 'Move students up to the next level']]) : SETTINGS_PAGES).map(([href, icon, label, sub]) => `<a class="card row" href="${href}" style="align-items:center;gap:14px;text-decoration:none;color:inherit"><span style="font-size:22px">${icon}</span><div style="flex:1"><b>${esc(label)}</b><br><span class="mut" style="font-size:13px">${esc(sub)}</span></div><span class="mut">&rsaquo;</span></a>`).join('');
  res.send(layout('Settings', `<h1>Settings</h1>${links}`, req.user));
});
app.get('/settings/profile', (req, res) => {
  if (!req.user) return res.redirect('/login?next=/settings/profile');
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const avatarPreview = u.avatar_mime ? `<img src="/avatar/${u.id}" class="drawer-av-img" style="width:64px;height:64px">` : `<span class="avatar" style="width:64px;height:64px;font-size:22px">${esc((u.name || '?').trim().charAt(0).toUpperCase() || '?')}</span>`;
  const avatarForm = `<div class="card row" style="align-items:center;gap:16px">${avatarPreview}<form method="post" action="/settings/avatar" enctype="multipart/form-data" style="flex:1;min-width:180px"><input type="file" name="file" accept="image/png,image/jpeg,image/webp" required><button class="ghost">Upload picture</button></form></div>`;
  const msg = req.query.msg ? `<p class="${req.query.err ? 'err' : 'mut'}">${esc(req.query.msg)}</p>` : '';
  if (u.is_lecturer) {
    return res.send(layout('Profile', `<p class="mut"><a href="/settings">&larr; Settings</a></p><h1>Profile</h1>${msg}${avatarForm}
<form method="post" action="/settings/profile" class="card">
<input name="name" value="${esc(u.name || '')}" placeholder="Your name" required maxlength="80">
<input name="reg_no" value="${esc(u.lecturer_reg_no || '')}" placeholder="Staff/registration number (optional)" maxlength="60">
<p class="mut" style="margin:4px 0">Institution: <b>${esc(u.university || '')}</b> (set once, verified -- contact a full admin to change it)</p>
<button>Save</button></form>`, req.user));
  }
  const posNote = u.position_status === 'pending' ? '<p class="pill pending">Position waiting for verification</p>' : u.position_status === 'approved' ? '<p class="pill">&#10003; Position verified</p>' : u.position_status === 'rejected' ? '<p class="err">Your position could not be verified.</p>' : '';
  res.send(layout('Profile', `<p class="mut"><a href="/settings">&larr; Settings</a></p><h1>Profile</h1>${msg}${avatarForm}
<form method="post" action="/settings/profile" class="card">${profileFields(u, u.role === 'user', lockedOf(u))}${posNote}<button>Save</button></form>
<script>${UNAME_JS}</script>`, req.user));
});
app.post('/settings/profile', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (u.is_lecturer) {
    const name = String(req.body.name || '').trim().slice(0, 80);
    const regNo = String(req.body.reg_no || '').trim().slice(0, 60) || null;
    if (!name) return res.redirect('/settings/profile?err=1&msg=' + encodeURIComponent('Enter your name.'));
    db.prepare('UPDATE users SET name=?, lecturer_reg_no=? WHERE id=?').run(name, regNo, u.id);
    return res.redirect('/settings/profile?msg=' + encodeURIComponent('Saved.'));
  }
  const { d, problem } = readProfile(u, req.body);
  if (problem) return res.redirect('/settings/profile?err=1&msg=' + encodeURIComponent(problem));
  const err = saveProfile(u, d);
  if (err) return res.redirect('/settings/profile?err=1&msg=' + encodeURIComponent(err));
  res.redirect('/settings/profile?msg=' + encodeURIComponent('Saved.'));
});
app.post('/settings/avatar', upload.single('file'), (req, res) => {
  if (!req.user) return res.sendStatus(401);
  if (!req.file || !/^image\//.test(req.file.mimetype)) return res.redirect('/settings/profile?msg=' + encodeURIComponent('Choose an image file.'));
  db.prepare('UPDATE users SET avatar_data=?, avatar_mime=? WHERE id=?').run(req.file.buffer, req.file.mimetype, req.user.id);
  res.redirect('/settings/profile?msg=' + encodeURIComponent('Picture updated.'));
});
app.get('/settings/active-status', (req, res) => {
  if (!req.user) return res.redirect('/login?next=/settings/active-status');
  const hidden = !!db.prepare('SELECT hide_active FROM users WHERE id=?').get(req.user.id).hide_active;
  res.send(layout('Active status', `<p class="mut"><a href="/settings">&larr; Settings</a></p><h1>Active status</h1>
<p class="mut">When this is on, friends can see when you're online in chat. Turn it off to always appear offline to them.</p>
<form method="post" action="/settings/active-status" class="card row" style="align-items:center"><div style="flex:1"><b>Show when I'm online</b></div><button name="hide" value="${hidden ? '0' : '1'}">${hidden ? 'Turn on' : 'Turn off'}</button></form>`, req.user));
});
app.post('/settings/active-status', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  db.prepare('UPDATE users SET hide_active=? WHERE id=?').run(req.body.hide === '1' ? 1 : 0, req.user.id);
  res.redirect('/settings/active-status');
});
app.get('/settings/appearance', (req, res) => {
  if (!req.user) return res.redirect('/login?next=/settings/appearance');
  const theme = db.prepare('SELECT theme FROM users WHERE id=?').get(req.user.id).theme || 'dark';
  res.send(layout('Appearance', `<p class="mut"><a href="/settings">&larr; Settings</a></p><h1>Appearance</h1>
<form method="post" action="/settings/appearance" class="card">
<label class="row" style="gap:10px;cursor:pointer"><input type="radio" name="theme" value="dark" style="width:auto"${theme === 'dark' ? ' checked' : ''}> Dark mode</label>
<label class="row" style="gap:10px;cursor:pointer;margin-top:8px"><input type="radio" name="theme" value="light" style="width:auto"${theme === 'light' ? ' checked' : ''}> Light mode</label>
<button style="margin-top:10px">Save</button></form>`, req.user));
});
app.post('/settings/appearance', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  db.prepare('UPDATE users SET theme=? WHERE id=?').run(req.body.theme === 'light' ? 'light' : 'dark', req.user.id);
  res.redirect('/settings/appearance');
});
app.post('/settings/notifications', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  db.prepare('UPDATE users SET email_notify=? WHERE id=?').run(req.body.email === '0' ? 0 : 1, req.user.id);
  res.redirect('/settings/notifications');
});
app.get('/settings/notifications', (req, res) => {
  if (!req.user) return res.redirect('/login?next=/settings/notifications');
  res.send(layout('Notifications', `<p class="mut"><a href="/settings">&larr; Settings</a></p><h1>Notifications</h1>
${(() => { const on = (db.prepare('SELECT email_notify e FROM users WHERE id=?').get(req.user.id) || {}).e !== 0; return `<form method="post" action="/settings/notifications" class="card row" style="align-items:center"><div style="flex:1"><b>Email alerts</b><p class="mut" style="margin:2px 0 0">News, new uploads and updates also arrive in your email (not chat messages).</p></div><button name="email" value="${on ? '0' : '1'}">${on ? 'Turn off' : 'Turn on'}</button></form>`; })()}
<div class="card"><p class="mut" style="margin:4px 0 8px">Get a notification on this device for messages, friend requests and new uploads.</p><button type="button" class="ghost" onclick="window.enablePush&&window.enablePush().then(function(ok){alert(ok?'Notifications are on for this device.':'Notifications were not allowed. You can allow them in your browser settings.')})">Turn on notifications</button></div>`, req.user));
});

function youtubeId(url) {
  const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([a-zA-Z0-9_-]{11})/.exec(String(url || ''));
  return m ? m[1] : null;
}
const hasPurchased = (userId, pageId) => !!db.prepare("SELECT 1 FROM purchases WHERE user_id=? AND page_id=? AND status='approved'").get(userId, pageId);
const purchaseFor = (userId, pageId) => db.prepare('SELECT * FROM purchases WHERE user_id=? AND page_id=?').get(userId, pageId);
function canViewPage(page, user) {
  if (page.paid) return !!user && (can.pages(user) || hasPurchased(user.id, page.id));
  if (page.members_only) return !!user;
  return true;
}
const KIND_META = { html: ['🌐', 'Page'], cbt: ['📝', 'CBT'], pdf: ['📄', 'PDF'], doc: ['📃', 'Document'], video: ['▶️', 'Video'] };
function pageCard(p) {
  const [icon, label] = KIND_META[p.kind] || KIND_META.html;
  const chip = p.paid ? `<span class="chip pay">₦${((p.price_kobo || PRICE_KOBO) / 100).toFixed(0)} to view</span>` : p.members_only ? '<span class="chip lock">Members</span>' : '<span class="chip">Open</span>';
  return `<a class="tile" href="/p/${p.slug}"><span class="stat">${icon}</span>${chip}<h3>${esc(p.title)}</h3><span class="go">${label} &middot; View &rarr;</span></a>`;
}

// Uploaded pages open full-screen with their own design. We only make sure they display well on phones
// (charset + viewport tags if missing) and add one small "back" button so visitors are never stuck.
function preparePage(html, home) {
  let h = String(html).replace(/^\uFEFF/, '');
  const add = [];
  if (!/<meta[^>]+charset/i.test(h)) add.push('<meta charset="utf-8">');
  if (!/<meta[^>]+name\s*=\s*["']?viewport/i.test(h)) add.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  const memShim = '<script>try{localStorage.getItem("x")}catch(e){var mk=function(){var d={};return{getItem:function(k){return k in d?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}};try{Object.defineProperty(window,"localStorage",{value:mk()});Object.defineProperty(window,"sessionStorage",{value:mk()})}catch(_){}}</script>';
  add.push(memShim);
  if (add.length) {
    const tags = add.join('');
    if (/<head[^>]*>/i.test(h)) h = h.replace(/<head[^>]*>/i, m => m + tags);
    else if (/<html[^>]*>/i.test(h)) h = h.replace(/<html[^>]*>/i, m => m + '<head>' + tags + '</head>');
    else h = h.replace(/^(\s*<!doctype[^>]*>)?/i, m => m + tags);
  }
  const back = `<a href="${home}" style="position:fixed;left:12px;bottom:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:2147483647;font:600 13px system-ui,sans-serif;color:#eaf2ff;background:rgba(18,18,28,.85);border:1px solid rgba(56,176,248,.55);border-radius:99px;padding:8px 14px;text-decoration:none">&larr; Studies Hub</a>`;
  let at = -1, m; const re = /<\/body>/gi;
  while ((m = re.exec(h))) at = m.index;
  return at >= 0 ? h.slice(0, at) + back + h.slice(at) : h + back;
}

function paywallBody(p, req) {
  const priceNgn = (p.price_kobo || PRICE_KOBO) / 100;
  const claim = req.user ? purchaseFor(req.user.id, p.id) : null;
  let action;
  if (!req.user) {
    action = `<a class="btn" href="/login?next=${encodeURIComponent('/p/' + p.slug)}">Log in to pay</a>`;
  } else if (!FLW_ON) {
    // Graceful fallback if the Flutterwave keys have not been added to the environment yet -- the old manual
    // route still works underneath, so the site keeps functioning instead of showing a dead end.
    action = claim && claim.status === 'pending'
      ? '<p class="pill pending">Payment claimed &mdash; waiting for confirmation</p><p class="mut">This is usually checked and unlocked by hand, so it can take a little while.</p>'
      : `<p class="err" style="margin:0 0 10px">Card/transfer payment isn't set up yet.</p><div class="card" style="text-align:left;max-width:340px;margin:0 auto"><p class="mut" style="margin:0 0 6px">For now, pay by bank transfer to:</p>
<p style="margin:2px 0"><b>${esc(BANK_ACCOUNT_NUMBER)}</b> &middot; ${esc(BANK_NAME)}</p>
<p class="mut" style="margin:2px 0 12px">${esc(BANK_ACCOUNT_NAME)}</p>
<form method="post" action="/pay/claim"><input type="hidden" name="slug" value="${esc(p.slug)}"><button style="width:100%">I have made this payment</button></form></div>`;
  } else {
    const txRef = `cbt_${req.user.id}_${p.id}_${Date.now()}`;
    action = `<button id="flwPayBtn" class="btn" style="width:100%">Pay ₦${priceNgn.toFixed(0)} now</button>
<script src="https://checkout.flutterwave.com/v3.js"></script>
<script>document.getElementById('flwPayBtn').addEventListener('click',function(){
  FlutterwaveCheckout({
    public_key: ${jsForScript(FLW_PUBLIC_KEY)},
    tx_ref: ${jsForScript(txRef)},
    amount: ${priceNgn},
    currency: 'NGN',
    customer: { email: ${jsForScript(req.user.email)}, name: ${jsForScript(req.user.name)} },
    customizations: { title: 'Studies Hub', description: ${jsForScript(p.title)} },
    callback: function(data){
      fetch('/pay/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({transaction_id:data.transaction_id,slug:${jsForScript(p.slug)}})})
        .then(function(r){return r.json()}).then(function(j){ if(j&&j.ok)location.reload(); else alert((j&&j.error)||'Could not confirm payment.') });
    },
    onclose: function(){}
  });
});</script>`;
  }
  return `<div class="dash-hero"><p class="eyebrow" style="margin:0">Locked</p><h1 style="margin:.2em 0">${esc(p.title)}</h1><p class="mut" style="margin:0">This content needs a one-time payment to unlock.</p></div>
<div class="card" style="text-align:center"><p style="font-size:32px;font-weight:700;margin:8px 0">₦${priceNgn.toFixed(0)}</p>${action}</div>`;
}

app.get('/p/:slug', (req, res) => {
  const p = db.prepare('SELECT * FROM pages WHERE slug=?').get(req.params.slug);
  if (!p) return res.status(404).send(layout('Not found', '<h2>Page not found</h2>', req.user));
  if (!sortedFor(p, req.user)) {
    if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    return res.status(403).send(layout(p.title, '<div class="card"><h2>Not for your department or level</h2><p class="mut">This upload is sorted for a different department or level, so it is not available to you.</p><p><a class="btn ghost" href="/dashboard">Back to my dashboard</a></p></div>', req.user));
  }
  if (!canViewPage(p, req.user)) {
    if (p.members_only && !p.paid) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    return res.send(layout(p.title, paywallBody(p, req), req.user));
  }
  res.setHeader('Cache-Control', 'private, no-cache');
  if (p.kind === 'html' || p.kind === 'cbt') {
    // Uploaded pages run in a sealed box: they work normally but cannot reach this site's sign-in or act as the person viewing.
    res.setHeader('Content-Security-Policy', 'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads');
    return res.type('html').send(preparePage(p.html, '/'));
  }
  if (p.kind === 'video') {
    return res.send(layout(p.title, `<div class="card"><h1 style="margin-top:0">${esc(p.title)}</h1><div style="position:relative;padding-top:56.25%;border-radius:12px;overflow:hidden"><iframe src="https://www.youtube.com/embed/${esc(p.video_id)}" style="position:absolute;inset:0;width:100%;height:100%;border:0" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen></iframe></div></div>`, req.user));
  }
  // pdf: rendered page-by-page onto <canvas> with PDF.js -- the browser's native <embed> PDF viewer does not
  // reliably work on mobile Chrome/Android, which is why this needed replacing rather than just embedding.
  // doc: converted to HTML right in the browser (Mammoth.js). Both fetch through the same authenticated route
  // everything else here uses, so department/level access control still applies either way.
  const embed = p.kind === 'pdf'
    ? `<div id="pdfViewer" class="doc-viewer"><p class="mut">Loading PDF&hellip;</p></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.5.141/pdf.min.js"></script>
<script>(function(){
  var box=document.getElementById('pdfViewer');
  pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.5.141/pdf.worker.min.js';
  fetch('/p/${p.slug}/raw').then(function(r){return r.arrayBuffer()}).then(function(buf){return pdfjsLib.getDocument({data:buf}).promise}).then(function(doc){
    box.innerHTML='';
    var chain=Promise.resolve();
    var _loop=function(n){chain=chain.then(function(){return doc.getPage(n)}).then(function(page){
      var scale=Math.min(2,(box.clientWidth||320)/page.getViewport({scale:1}).width);
      var vp=page.getViewport({scale:scale}),canvas=document.createElement('canvas');
      canvas.width=vp.width;canvas.height=vp.height;canvas.style.width='100%';canvas.style.marginBottom='10px';canvas.style.borderRadius='8px';
      box.appendChild(canvas);
      return page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
    })};
    for(var n=1;n<=doc.numPages;n++)_loop(n);
    return chain;
  }).catch(function(){box.innerHTML='<p class="mut">Could not preview this PDF here -- try the download link below.</p>'});
})()</script>`
    : `<div id="docViewer" class="doc-viewer"><p class="mut">Loading document&hellip;</p></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js"></script>
<script>fetch('/p/${p.slug}/raw').then(function(r){return r.arrayBuffer()}).then(function(buf){return mammoth.convertToHtml({arrayBuffer:buf})}).then(function(result){document.getElementById('docViewer').innerHTML=result.value||'<p class="mut">This document has no readable text to preview.</p>'}).catch(function(){document.getElementById('docViewer').innerHTML='<p class="mut">Could not preview this document here -- try the download link below.</p>'})</script>`;
  res.send(layout(p.title, `<div class="card"><h1 style="margin-top:0">${esc(p.title)}</h1>${embed}<p style="margin-top:14px"><a class="btn ghost" href="/p/${p.slug}/raw">Download ${p.kind === 'pdf' ? 'PDF' : 'document'}</a></p></div>`, req.user));
});

app.get('/p/:slug/raw', (req, res) => {
  const p = db.prepare('SELECT * FROM pages WHERE slug=?').get(req.params.slug);
  if (!p || !p.file_data || !sortedFor(p, req.user)) return res.status(404).send('Not found');
  if (!canViewPage(p, req.user)) return res.status(p.members_only && !p.paid ? 401 : 402).send('Not available');
  const safeMime = /^(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.[a-z.]+|image\/(png|jpe?g|gif|webp))$/i.test(String(p.file_mime || ''));
  res.setHeader('Content-Type', safeMime ? p.file_mime : 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `${p.kind === 'pdf' && safeMime ? 'inline' : 'attachment'}; filename="${(p.file_name || p.slug).replace(/"/g, '')}"`);
  res.send(Buffer.from(p.file_data));
});

app.post('/pay/verify', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Log in first.' });
  const page = db.prepare('SELECT * FROM pages WHERE slug=?').get(req.body.slug);
  if (!page || !page.paid) return res.status(400).json({ error: 'Invalid item.' });
  const transactionId = req.body.transaction_id;
  if (!transactionId) return res.status(400).json({ error: 'Missing transaction.' });
  const priorUse = db.prepare('SELECT user_id, page_id FROM purchases WHERE reference=?').get(String(transactionId));
  if (priorUse) {
    if (priorUse.user_id === req.user.id && priorUse.page_id === page.id) return res.json({ ok: true }); // a duplicate callback for the SAME purchase -- not an error
    return res.status(400).json({ error: 'That transaction has already been used.' }); // a replay attempt against a different user/page -- rejected
  }
  const data = await verifyFlutterwave(transactionId);
  if (!data) return res.status(400).json({ error: 'Payment could not be verified.' });
  if (data.tx_ref && !String(data.tx_ref).startsWith(`cbt_${req.user.id}_${page.id}_`)) return res.status(400).json({ error: 'That payment was made for something else.' }); // a real payment for another item/user can't be reused here
  const expectedNgn = (page.price_kobo || PRICE_KOBO) / 100;
  if (data.currency !== 'NGN' || Number(data.amount) < expectedNgn) return res.status(400).json({ error: 'The amount paid does not match the price.' });
  const existing = db.prepare('SELECT id FROM purchases WHERE user_id=? AND page_id=?').get(req.user.id, page.id);
  if (existing) db.prepare("UPDATE purchases SET status='approved', reference=?, amount=? WHERE id=?").run(String(transactionId), Math.round(data.amount * 100), existing.id);
  else db.prepare("INSERT INTO purchases(user_id,page_id,reference,amount,status) VALUES(?,?,?,?,'approved')").run(req.user.id, page.id, String(transactionId), Math.round(data.amount * 100));
  res.json({ ok: true });
});
app.post('/pay/claim', (req, res) => {
  if (!req.user) return res.redirect('/login');
  const page = db.prepare('SELECT * FROM pages WHERE slug=?').get(req.body.slug);
  if (!page || !page.paid || !sortedFor(page, req.user)) return res.redirect('/');
  const reference = `manual_${req.user.id}_${page.id}_${Date.now()}`;
  db.prepare('INSERT OR IGNORE INTO purchases(user_id,page_id,reference,amount,status) VALUES(?,?,?,?,?)')
    .run(req.user.id, page.id, reference, page.price_kobo || PRICE_KOBO, 'pending');
  notify(fullAdminIds(), { title: 'Payment claim', body: `${req.user.name} says they paid for ${page.title}`, url: '/admin#payments', tag: 'payment' });
  res.redirect('/p/' + page.slug);
});
app.post('/admin/payments/:id/approve', admin, (req, res) => {
  const claim = db.prepare('SELECT p.user_id, pg.title, pg.slug FROM purchases p JOIN pages pg ON pg.id=p.page_id WHERE p.id=?').get(req.params.id);
  db.prepare("UPDATE purchases SET status='approved' WHERE id=?").run(req.params.id);
  if (claim) notify([claim.user_id], { title: 'Payment confirmed', body: `${claim.title} is now unlocked for you`, url: '/p/' + claim.slug, tag: 'payment' });
  res.redirect(back('Payment approved -- unlocked for that user.'));
});
app.post('/admin/payments/:id/reject', admin, (req, res) => {
  db.prepare('DELETE FROM purchases WHERE id=?').run(req.params.id);
  res.redirect(back('Payment claim removed.'));
});

// Paid promotional posts: any logged-in member can pay to advertise a business or service in News for a month.
app.get('/sponsor', (req, res) => {
  if (!req.user) return res.redirect('/login?next=/sponsor');
  res.send(layout('Advertise on Studies Hub', `<p class="mut"><a href="/news">&larr; Back to News</a></p><h1>Advertise your business or service</h1>
<p class="mut">₦${SPONSOR_PRICE_NGN} a month to show your post in the News section, clearly marked "Sponsored". Pick how long you want it to run and the price is worked out for you.</p>
<form class="card" method="post" action="/sponsor" enctype="multipart/form-data">
<input name="title" placeholder="What are you advertising?" required maxlength="140">
<textarea name="body" placeholder="Describe it" required maxlength="2000" style="width:100%;min-height:80px;font:inherit;padding:11px 13px;margin:6px 0;color:var(--fg);background:rgba(8,10,22,.65);border:1px solid var(--line);border-radius:10px"></textarea>
<input name="contact" placeholder="How should people reach you? (phone, @username, etc.)" maxlength="140">
<input type="file" name="image" accept="image/*" style="padding:9px 0">
<label class="mut">Start date</label><input type="date" name="start_date" id="sponsorStart" required>
<label class="mut">End date</label><input type="date" name="end_date" id="sponsorEnd" required>
<p class="pill" id="sponsorBill" style="margin:8px 0">Pick your dates to see the price.</p>
<button>Continue to payment</button>
</form>
<script>(function(){
  var sd=document.getElementById('sponsorStart'),ed=document.getElementById('sponsorEnd'),bp=document.getElementById('sponsorBill'),rate=${SPONSOR_PRICE_NGN};
  var today=new Date();today.setHours(0,0,0,0);var todayStr=today.toISOString().slice(0,10);
  sd.min=todayStr;
  function sync(){
    if(!sd.value){ed.min=todayStr;return}
    var startD=new Date(sd.value+'T00:00:00'),minEnd=new Date(startD.getTime()+86400000),minEndStr=minEnd.toISOString().slice(0,10);
    ed.min=minEndStr;
    if(ed.value&&ed.value<minEndStr)ed.value=minEndStr;
    if(sd.value&&ed.value){
      var days=Math.round((new Date(ed.value+'T00:00:00')-startD)/86400000);
      var price=Math.ceil((days/30)*rate);
      bp.textContent='₦'+price.toLocaleString()+' for '+days+' day'+(days===1?'':'s')+' ('+sd.value+' to '+ed.value+')';
    } else bp.textContent='Pick your dates to see the price.';
  }
  sd.addEventListener('change',sync);ed.addEventListener('change',sync);sync();
})()</script>`, req.user));
});
app.post('/sponsor', upload.single('image'), (req, res) => {
  if (!req.user) return res.redirect('/login?next=/sponsor');
  const title = String(req.body.title || '').trim().slice(0, 140);
  const body = String(req.body.body || '').trim().slice(0, 2000);
  const contact = String(req.body.contact || '').trim().slice(0, 140);
  if (!title || !body) return res.redirect('/sponsor');
  if (req.file && !/^image\//.test(req.file.mimetype)) return res.redirect('/sponsor');
  const startDate = new Date(String(req.body.start_date || '') + 'T00:00:00');
  const endDate = new Date(String(req.body.end_date || '') + 'T00:00:00');
  const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
  if (isNaN(startDate) || isNaN(endDate) || startDate < todayMid || endDate <= startDate) return res.redirect('/sponsor');
  const days = Math.round((endDate - startDate) / 86400000);
  if (days < 1 || days > 366) return res.redirect('/sponsor'); // a year is a generous, sane ceiling
  const amountKobo = Math.round(Math.ceil((days / 30) * SPONSOR_PRICE_NGN) * 100);
  const reference = `sponsor_${req.user.id}_${Date.now()}`;
  const info = db.prepare("INSERT INTO sponsor_posts(user_id,title,body,contact,image_data,image_mime,reference,amount_kobo,duration_days,status) VALUES(?,?,?,?,?,?,?,?,?,'pending_payment')")
    .run(req.user.id, title, body, contact, req.file ? req.file.buffer : null, req.file ? req.file.mimetype : null, reference, amountKobo, days);
  notify(fullAdminIds(), { title: 'Sponsor post payment claim', body: `${req.user.name} wants to advertise "${title}" for ${days} days`, url: '/admin#sponsors', tag: 'sponsor' });
  res.redirect('/sponsor/' + info.lastInsertRowid);
});
app.get('/sponsor/:id', (req, res) => {
  if (!req.user) return res.redirect('/login');
  const s = db.prepare('SELECT * FROM sponsor_posts WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!s) return res.status(404).send(layout('Not found', '<p><a href="/news">Back to News</a></p>', req.user));
  const statusLine = s.status === 'approved' ? `<p class="pill">&#10003; Live until ${esc((s.expires_at || '').slice(0, 10))}</p>` : s.status === 'rejected' ? '<p class="err">This submission was not approved.</p>' : '<p class="pill pending">Waiting for payment to be confirmed</p>';
  res.send(layout('Your sponsor post', `<p class="mut"><a href="/news">&larr; Back to News</a></p><h1>${esc(s.title)}</h1>${statusLine}
<p class="mut">${s.duration_days} day${s.duration_days === 1 ? '' : 's'} &middot; ₦${(s.amount_kobo / 100).toLocaleString()}</p>
<p class="mut"><a href="/sponsor/${s.id}/edit">Edit this post &rarr;</a></p>
${s.status === 'pending_payment' ? (FLW_ON ? `<div class="card" style="text-align:center"><button id="flwSponsorBtn" class="btn" style="width:100%">Pay ₦${(s.amount_kobo / 100).toLocaleString()} now</button>
<script src="https://checkout.flutterwave.com/v3.js"></script>
<script>document.getElementById('flwSponsorBtn').addEventListener('click',function(){
  FlutterwaveCheckout({
    public_key: ${jsForScript(FLW_PUBLIC_KEY)},
    tx_ref: ${jsForScript(`sponsor_${s.id}_${Date.now()}`)},
    amount: ${s.amount_kobo / 100},
    currency: 'NGN',
    customer: { email: ${jsForScript(req.user.email)}, name: ${jsForScript(req.user.name)} },
    customizations: { title: 'Studies Hub Sponsor Post', description: ${jsForScript(s.title)} },
    callback: function(data){
      fetch('/sponsor/${s.id}/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({transaction_id:data.transaction_id})})
        .then(function(r){return r.json()}).then(function(j){ if(j&&j.ok)location.reload(); else alert((j&&j.error)||'Could not confirm payment.') });
    },
    onclose: function(){}
  });
});</script></div>` : `<div class="card"><p class="err" style="margin:0 0 10px">Card/transfer payment isn't set up yet.</p><p>For now, pay <b>₦${(s.amount_kobo / 100).toLocaleString()}</b> by bank transfer to:</p><p style="margin:2px 0"><b>${esc(BANK_ACCOUNT_NUMBER)}</b> &middot; ${esc(BANK_NAME)}</p><p class="mut" style="margin:2px 0 12px">${esc(BANK_ACCOUNT_NAME)}</p><form method="post" action="/sponsor/${s.id}/claim"><button>I've paid</button></form></div>`) : ''}
<form method="post" action="/sponsor/${s.id}/delete" onsubmit="return confirm('Delete this sponsor post? This cannot be undone.')" style="margin-top:14px"><button class="link">Delete this post</button></form>`, req.user));
});
app.get('/sponsor/:id/edit', (req, res) => {
  if (!req.user) return res.redirect('/login');
  const s = db.prepare('SELECT * FROM sponsor_posts WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!s) return res.status(404).send(layout('Not found', '<p><a href="/news">Back to News</a></p>', req.user));
  res.send(layout('Edit your sponsor post', `<p class="mut"><a href="/sponsor/${s.id}">&larr; Back</a></p><h1>Edit your sponsor post</h1>
${s.status === 'approved' ? '<p class="mut">This is already live -- changes show right away, no need to pay again.</p>' : ''}
<form class="card" method="post" action="/sponsor/${s.id}/edit" enctype="multipart/form-data">
<input name="title" value="${esc(s.title)}" required maxlength="140">
<textarea name="body" required maxlength="2000" style="width:100%;min-height:80px;font:inherit;padding:11px 13px;margin:6px 0;color:var(--fg);background:rgba(8,10,22,.65);border:1px solid var(--line);border-radius:10px">${esc(s.body)}</textarea>
<input name="contact" value="${esc(s.contact || '')}" placeholder="How should people reach you?" maxlength="140">
${s.image_data ? `<img src="/sponsor-image/${s.id}" style="max-width:100%;border-radius:10px;margin:6px 0;display:block">` : ''}
<label class="mut">${s.image_data ? 'Replace photo (optional)' : 'Add a photo (optional)'}</label>
<input type="file" name="image" accept="image/*" style="padding:9px 0">
<button>Save changes</button>
</form>`, req.user));
});
app.post('/sponsor/:id/edit', upload.single('image'), (req, res) => {
  if (!req.user) return res.redirect('/login');
  const s = db.prepare('SELECT id FROM sponsor_posts WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!s) return res.status(404).send(layout('Not found', '<p><a href="/news">Back to News</a></p>', req.user));
  const title = String(req.body.title || '').trim().slice(0, 140);
  const body = String(req.body.body || '').trim().slice(0, 2000);
  const contact = String(req.body.contact || '').trim().slice(0, 140);
  if (!title || !body) return res.redirect(`/sponsor/${s.id}/edit`);
  if (req.file && !/^image\//.test(req.file.mimetype)) return res.redirect(`/sponsor/${s.id}/edit`);
  if (req.file) db.prepare('UPDATE sponsor_posts SET title=?, body=?, contact=?, image_data=?, image_mime=? WHERE id=?').run(title, body, contact, req.file.buffer, req.file.mimetype, s.id);
  else db.prepare('UPDATE sponsor_posts SET title=?, body=?, contact=? WHERE id=?').run(title, body, contact, s.id);
  res.redirect('/sponsor/' + s.id);
});
app.post('/sponsor/:id/delete', (req, res) => {
  if (!req.user) return res.redirect('/login');
  const s = db.prepare('SELECT id FROM sponsor_posts WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!s) return res.status(404).send(layout('Not found', '<p><a href="/news">Back to News</a></p>', req.user));
  db.prepare('DELETE FROM sponsor_posts WHERE id=?').run(s.id);
  res.redirect('/news');
});
app.post('/sponsor/:id/verify', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Log in first.' });
  const s = db.prepare('SELECT * FROM sponsor_posts WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!s) return res.status(404).json({ error: 'Not found.' });
  if (s.status === 'approved') return res.json({ ok: true }); // already live -- a duplicate callback is not an error
  const transactionId = req.body.transaction_id;
  if (!transactionId) return res.status(400).json({ error: 'Missing transaction.' });
  const data = await verifyFlutterwave(transactionId);
  if (!data) return res.status(400).json({ error: 'Payment could not be verified.' });
  if (data.tx_ref && !String(data.tx_ref).startsWith(`sponsor_${s.id}_`)) return res.status(400).json({ error: 'That payment was made for something else.' });
  if (data.currency !== 'NGN' || Number(data.amount) < s.amount_kobo / 100) return res.status(400).json({ error: 'The amount paid does not match the bill.' });
  try {
    db.prepare("UPDATE sponsor_posts SET status='approved', reference=?, expires_at=datetime('now','+' || ? || ' days') WHERE id=?").run(String(transactionId), s.duration_days, s.id);
  } catch { return res.status(400).json({ error: 'That transaction has already been used.' }); }
  notify([s.user_id], { title: 'Your sponsor post is live', body: `"${s.title}" is now showing in News for ${s.duration_days} days.`, url: '/sponsor/' + s.id, tag: 'sponsor' });
  res.json({ ok: true });
});
app.post('/sponsor/:id/claim', (req, res) => {
  if (!req.user) return res.redirect('/login');
  const s = db.prepare("SELECT id FROM sponsor_posts WHERE id=? AND user_id=? AND status='pending_payment'").get(req.params.id, req.user.id);
  if (s) notify(fullAdminIds(), { title: 'Sponsor post payment claim', body: `${req.user.name} says they paid for their sponsor post`, url: '/admin#sponsors', tag: 'sponsor' });
  res.redirect('/sponsor/' + req.params.id);
});
app.get('/sponsor-image/:id', (req, res) => {
  const row = db.prepare('SELECT image_data, image_mime FROM sponsor_posts WHERE id=?').get(req.params.id);
  if (!row || !row.image_data) return res.sendStatus(404);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Content-Type', row.image_mime || 'application/octet-stream');
  res.send(Buffer.from(row.image_data));
});
app.post('/admin/sponsors/:id/approve', admin, (req, res) => {
  const s = db.prepare('SELECT user_id, title, duration_days FROM sponsor_posts WHERE id=?').get(req.params.id);
  if (!s) return res.redirect(back('Not found.'));
  db.prepare("UPDATE sponsor_posts SET status='approved', expires_at=datetime('now','+' || ? || ' days') WHERE id=?").run(s.duration_days, req.params.id);
  notify([s.user_id], { title: 'Your sponsor post is live', body: `"${s.title}" is now showing in News for ${s.duration_days} days.`, url: '/sponsor/' + req.params.id, tag: 'sponsor' });
  res.redirect(back(`Sponsor post approved -- live for ${s.duration_days} days.`));
});
app.post('/admin/sponsors/:id/reject', admin, (req, res) => {
  const s = db.prepare('SELECT user_id, title FROM sponsor_posts WHERE id=?').get(req.params.id);
  db.prepare("UPDATE sponsor_posts SET status='rejected' WHERE id=?").run(req.params.id);
  if (s) notify([s.user_id], { title: 'Sponsor post not approved', body: `"${s.title}" could not be approved.`, url: '/sponsor/' + req.params.id, tag: 'sponsor' });
  res.redirect(back('Sponsor post rejected.'));
});

app.get('/signup', (req, res) => res.send(authForm('signup')));
app.post('/signup', async (req, res) => {
  if (limited('signup-ip:' + req.ip, 12, 3600e3)) return res.status(429).send('Too many sign-ups from this connection. Please try again later.');
  const name = String(req.body.name || '').trim().slice(0, 80);
  const email = String(req.body.email || '').trim().toLowerCase();
  const pw = String(req.body.password || '');
  const bad = m => res.status(400).send(authForm('signup', m));
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) return bad('Enter your name and a valid email.');
  if (pw.length < 8) return bad('Password must be at least 8 characters.');
  if (weakPw(pw, email)) return bad('That password is too easy to guess. Please pick something less common.');
  let u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (u && u.verified) return bad('That email is already registered. Try logging in.');
  if (!u) { // an existing unverified account is never modified here, only re-sent a link
    const id = insertUser('name,email,hash', [name, email, bcrypt.hashSync(pw, 12)]);
    u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  }
  if ((await sendSafely(req, u)) === 'fail') return bad("We couldn't send the verification email. Please try again in a minute.");
  res.send(checkEmailPage(email));
});

// Public lecturer portal landing page: discoverable without exposing lecturer-only content.
app.get('/lecturer/portal', (req, res) => {
  res.send(layout('Lecturer Portal | Studies Hub', `<div class="auth" style="max-width:720px">
<h1>Studies Hub Lecturer Portal</h1>
<p>Lecturers can register, sign in, manage their linked courses, and share learning materials with students through Studies Hub.</p>
<div class="card">
<h2>New lecturer?</h2>
<p class="mut">Create a lecturer account and complete your institution details. A full admin must verify your lecturer status before uploads are enabled.</p>
<a class="btn" href="/lecturer/signup">Register as a lecturer</a>
</div>
<div class="card">
<h2>Already registered?</h2>
<p class="mut">Sign in to continue to your lecturer courses and uploads.</p>
<a class="btn ghost" href="/lecturer/login">Lecturer log in</a>
</div>
<p class="mut">Students should use the regular <a href="/signup">student sign-up</a>.</p>
</div>`, null, { description: 'Official Studies Hub lecturer portal. Register or sign in to manage courses and share educational materials with students.' }));
});
app.get('/lecturer/login', (req, res) => res.redirect('/login?next=%2Flecturer'));

app.get('/lecturer/signup', (req, res) => res.send(layout('Lecturer sign up', `<div class="auth"><h1>Lecturer sign up</h1>
<p class="mut">For teaching staff only. Students should use the regular <a href="/signup">sign up</a> instead.</p>
<form method="post" class="card">
<input name="name" placeholder="Your name" required maxlength="80">
<input name="email" type="email" placeholder="Email address" required>
<input name="password" type="password" placeholder="Password (8+ characters)" required>
<button>Create lecturer account</button></form>
${GOOGLE_ON ? '<a class="btn ghost gbtn" href="/auth/google?as=lecturer">Continue with Google</a>' : ''}
<p class="mut">Already registered? <a href="/lecturer/login">Lecturer log in</a></p></div>`, null, { footer: true })));
app.post('/lecturer/signup', async (req, res) => {
  if (limited('signup-ip:' + req.ip, 12, 3600e3)) return res.status(429).send('Too many sign-ups from this connection. Please try again later.');
  const name = String(req.body.name || '').trim().slice(0, 80);
  const email = String(req.body.email || '').trim().toLowerCase();
  const pw = String(req.body.password || '');
  const bad = m => res.status(400).send(layout('Lecturer sign up', `<div class="auth"><h1>Lecturer sign up</h1><p class="err">${esc(m)}</p>
<form method="post" class="card"><input name="name" placeholder="Your name" required maxlength="80" value="${esc(name)}"><input name="email" type="email" placeholder="Email address" required value="${esc(email)}"><input name="password" type="password" placeholder="Password (8+ characters)" required><button>Create lecturer account</button></form></div>`, null, { footer: true }));
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) return bad('Enter your name and a valid email.');
  if (pw.length < 8) return bad('Password must be at least 8 characters.');
  if (weakPw(pw, email)) return bad('That password is too easy to guess. Please pick something less common.');
  let u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (u && u.verified) return bad('That email is already registered. Try logging in.');
  if (!u) {
    const id = insertUser('name,email,hash,is_lecturer', [name, email, bcrypt.hashSync(pw, 12), 1]);
    u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  }
  if ((await sendSafely(req, u)) === 'fail') return bad("We couldn't send the verification email. Please try again in a minute.");
  res.send(checkEmailPage(email));
});

app.get('/login', (req, res) => res.send(authForm('login', '', safeNext(req.query.next))));
app.post('/login', (req, res) => {
  const next = safeNext(req.body.next);
  if (tooMany(req.ip)) return res.status(429).send(authForm('login', 'Too many attempts. Try again in 15 minutes.', next));
  const who = String(req.body.email || '').trim().toLowerCase().slice(0, 200), acct = 'acct:' + who;
  if (tooMany(acct)) return res.status(429).send(authForm('login', 'Too many attempts on this account. Try again in 15 minutes, or reset your password.', next));
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(who);
  if (!u) bcrypt.compareSync(String(req.body.password || ''), DUMMY_HASH); // same waiting time whether or not the email exists
  if (!u || !bcrypt.compareSync(String(req.body.password || ''), u.hash)) {
    noteFail(req.ip); noteFail(acct);
    return res.status(401).send(authForm('login', 'Wrong email or password.', next));
  }
  if (!u.verified) return res.status(403).send(notice('Verify your email', 'Your email is not verified yet. Check your inbox for the link, or request a new one.', resendForm(u.email)));
  fails.delete('acct:' + who);
  startSession(res, u.id);
  res.redirect(next || '/');
});

app.get('/verify', (req, res) => {
  const token = String(req.query.token || '');
  const u = token && db.prepare('SELECT id FROM users WHERE verify_hash=? AND verify_expires>?').get(sha(token), Date.now());
  if (!u) return res.status(400).send(notice('Link invalid or expired', 'Request a new verification email below.', resendForm()));
  db.prepare('UPDATE users SET verified=1, verify_hash=NULL, verify_expires=NULL WHERE id=?').run(u.id);
  res.send(notice('Email verified', 'Your account is active.', '<p><a href="/login">Log in</a></p>'));
});

app.post('/resend', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE email=? AND verified=0').get(email);
  if (u) await sendSafely(req, u);
  res.send(notice('Check your email', 'If that address has an unverified account, a new link is on its way.', resendForm(email)));
});

// ---------- forgot password: 6-digit email code (same flow for every account, admin included) ----------
app.get('/forgot', (req, res) => res.send(forgotForm()));
app.post('/forgot', async (req, res) => {
  if (limited('forgot-ip:' + req.ip, 10, 15 * 60e3)) return res.status(429).send('Too many requests. Please try again in a few minutes.');
  const email = String(req.body.email || '').trim().toLowerCase();
  if (limited('forgot-ip:' + req.ip, 8, 15 * 60e3)) return res.status(429).send(forgotForm('Too many requests. Try again in a few minutes.'));
  const u = email && db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (u && !limited('forgot-em:' + email, 3, 15 * 60e3)) {
    const code = String(crypto.randomInt(100000, 1000000));
    db.prepare('UPDATE users SET reset_hash=?, reset_expires=?, reset_attempts=0 WHERE id=?').run(bcrypt.hashSync(code, 10), Date.now() + 600000, u.id);
    try { await sendResetCode(u.email, code); } catch (e) { console.error('Reset email failed:', e.message); }
  }
  res.redirect('/reset?email=' + encodeURIComponent(email)); // identical whether or not the account exists
});

app.get('/reset', (req, res) => res.send(resetForm(String(req.query.email || ''))));
app.post('/reset', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const code = String(req.body.code || '').trim(), pw = String(req.body.password || '');
  const bad = m => res.status(400).send(resetForm(email, m));
  if (limited('reset-ip:' + req.ip, 10, 15 * 60e3)) return res.status(429).send(resetForm(email, 'Too many attempts. Try again in a few minutes.'));
  if (pw.length < 8) return bad('Password must be at least 8 characters.');
  if (weakPw(pw, email)) return bad('That password is too easy to guess. Please pick something less common.');
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!u || !u.reset_hash || !u.reset_expires) return bad('Invalid or expired code.');
  const clear = () => db.prepare('UPDATE users SET reset_hash=NULL, reset_expires=NULL, reset_attempts=0 WHERE id=?').run(u.id);
  if (Date.now() > u.reset_expires) { clear(); return bad('That code expired. Request a new one.'); }
  const attempts = (u.reset_attempts || 0) + 1;
  if (attempts > 5) { clear(); return bad('Too many wrong codes. Request a new one.'); }
  db.prepare('UPDATE users SET reset_attempts=? WHERE id=?').run(attempts, u.id);
  if (!bcrypt.compareSync(code, u.reset_hash)) return bad('Invalid or expired code.');
  db.prepare('UPDATE users SET hash=?, verified=1, reset_hash=NULL, reset_expires=NULL, reset_attempts=0 WHERE id=?').run(bcrypt.hashSync(pw, 12), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
  res.send(notice('Password updated', 'You can now log in with your new password.', '<p><a class="btn" href="/login">Log in</a></p>'));
});

// ---------- Continue with Google ----------
const gRedirect = req => process.env.GOOGLE_REDIRECT_URI || `${baseUrl(req)}/auth/google/callback`;
app.get('/auth/google', (req, res) => {
  if (!GOOGLE_ON) return res.redirect('/login');
  const state = crypto.randomBytes(16).toString('hex');
  const cookies = [`gstate=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${SECURE}`];
  if (req.query.as === 'lecturer') cookies.push(`gaslecturer=1; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${SECURE}`);
  res.setHeader('Set-Cookie', cookies);
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: gRedirect(req), response_type: 'code',
    scope: 'openid email profile', state, prompt: 'select_account'
  }));
});
app.get('/auth/google/callback', async (req, res) => {
  try {
    const c = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('gstate='));
    if (!GOOGLE_ON || !req.query.code || !c || c.slice(7) !== req.query.state) throw new Error('state mismatch');
    const tr = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: String(req.query.code), client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: gRedirect(req), grant_type: 'authorization_code' })
    });
    const t = await tr.json();
    if (!tr.ok) throw new Error(t.error_description || t.error);
    const g = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } })).json();
    if (!g.email || !g.email_verified) throw new Error('Google email not verified');
    const email = g.email.toLowerCase(), rnd = () => bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10);
    const asLecturer = (req.headers.cookie || '').split(';').map(x => x.trim()).some(x => x === 'gaslecturer=1');
    let u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (!u) {
      const id = insertUser('name,email,hash,verified,is_lecturer', [String(g.name || email.split('@')[0]).slice(0, 80), email, rnd(), 1, asLecturer ? 1 : 0]);
      u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    } else if (!u.verified) { // drop any password someone set before the real owner proved the email
      db.prepare('UPDATE users SET verified=1, hash=? WHERE id=?').run(rnd(), u.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
    }
    startSession(res, u.id);
    res.redirect('/');
  } catch (e) {
    console.error('Google sign-in failed:', e.message);
    res.status(400).send(notice('Google sign-in failed', 'Please try again, or use your email and password.', '<p><a class="btn" href="/login">Back to log in</a></p>'));
  }
});

// ---------- AI assistant (Groq or Claude; members only, rate-limited) ----------
async function askAI(messages, system) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 25000);
  try {
    if (AI === 'groq') {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', signal: ctl.signal,
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: AI_MODEL, max_tokens: 500, temperature: 0.5, messages: [{ role: 'system', content: system }, ...messages] })
      });
      const j = await r.json();
      if (!r.ok) throw new Error((j.error && j.error.message) || r.status);
      return j.choices[0].message.content;
    }
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctl.signal,
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: AI_MODEL, max_tokens: 500, system, messages })
    });
    const j = await r.json();
    if (!r.ok) throw new Error((j.error && j.error.message) || r.status);
    return j.content.filter(b => b.type === 'text').map(b => b.text).join('');
  } finally { clearTimeout(timer); }
}

app.post('/api/chat', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Please log in to use the assistant.' });
  if (!AI) return res.status(503).json({ error: 'The assistant is not set up yet.' });
  if (limited('chat:' + req.user.id, 20, 10 * 60e3)) return res.status(429).json({ error: 'Slow down a little and try again in a few minutes.' });
  const msgs = (Array.isArray(req.body.messages) ? req.body.messages : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-10).map(m => ({ role: m.role, content: m.content.slice(0, 1000) }));
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return res.status(400).json({ error: 'Send a question first.' });
  const pages = db.prepare('SELECT slug,title,dept,level,author_id,course_id FROM pages ORDER BY id DESC LIMIT 300').all().filter(p => sortedFor(p, req.user)).slice(0, 50);
  const system = `You are the assistant for Studies Hub, a website that hosts study pages. Answer clearly and briefly in plain language, and say so when you are not sure. Pages currently on the site: ${pages.map(p => `${p.title} (/p/${p.slug})`).join(', ') || 'none yet'}. Do not invent pages or features that are not listed.`;
  try { res.json({ reply: await askAI(msgs, system) }); }
  catch (e) { console.error('AI error:', e.message); res.status(502).json({ error: 'The assistant could not answer right now. Please try again.' }); }
});

app.post('/logout', (req, res) => {
  if (req.sid) db.prepare('DELETE FROM sessions WHERE id=?').run(sidKey(req.sid));
  res.setHeader('Clear-Site-Data', '"cache"'); // nothing from this account stays readable in the browser on a shared phone
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
  res.redirect('/');
});

// ---------- admin ----------
const back = msg => '/admin?' + (adminTab ? 'tab=' + adminTab + '&' : '') + 'msg=' + encodeURIComponent(msg);

// ---------- dashboard body: what a logged-in visitor sees at "/" ----------
// Preview tile for one upload: a picture (the YouTube thumbnail for videos, a big icon for everything else).
function previewTile(p) {
  const [icon, label] = KIND_META[p.kind] || KIND_META.html;
  const chip = p.paid ? `<span class="chip pay">₦${((p.price_kobo || PRICE_KOBO) / 100).toFixed(0)} to view</span>` : p.members_only ? '<span class="chip lock">Members</span>' : '<span class="chip">Open</span>';
  const thumb = p.kind === 'video' && p.video_id
    ? `<img class="pv-img" src="https://i.ytimg.com/vi/${esc(p.video_id)}/hqdefault.jpg" alt="" loading="lazy">`
    : `<div class="pv-img pv-icon">${icon}</div>`;
  return `<a class="pv" href="/p/${p.slug}">${thumb}<div class="pv-body">${chip}<h3>${esc(p.title)}</h3><span class="mut">${label}${p.level ? ` &middot; ${p.level} level` : ''}</span></div></a>`;
}
// Dashboard: a greeting, then only uploads that are meant for this member (their department and level).
// "Available" = free to view plus anything they've paid for; "Locked" = pay-to-view CBT they haven't unlocked yet.
function dashboardBody(req) {
  const u = req.user, initial = esc((u.name || '?').trim().charAt(0).toUpperCase() || '?'), staff = can.pages(u);
  const rows = db.prepare('SELECT id,slug,title,members_only,kind,paid,price_kobo,video_id,dept,level,author_id,course_id FROM pages ORDER BY id DESC LIMIT 300').all().filter(p => sortedFor(p, u));
  const isLocked = p => !!p.paid && !staff && !hasPurchased(u.id, p.id);
  const locked = rows.filter(isLocked), available = rows.filter(p => !isLocked(p));
  const pill = u.verified ? '<span class="pill">&#10003; Verified</span>' : '<span class="pill pending">Verification pending</span>';
  const posPill = u.position_status === 'pending' ? ` <span class="pill pending">Position waiting for verification: ${esc(u.position)}</span>` : u.title ? ` <span class="pill">${esc(u.title)}</span>` : '';
  const forYou = [u.department, u.level ? u.level + ' level' : ''].filter(Boolean).join(' · ');
  const subtitle = isCentral(u) ? 'You are the central admin.' : u.role !== 'user' ? `You are a ${esc(ROLE_LABEL[u.role] || 'admin')}.` : (forYou ? esc(forYou) : 'Uploads for you, at a glance.');
  const grid = list => `<div class="pv-grid">${list.map(previewTile).join('')}</div>`;
  return `${req.query.welcome ? '<p class="pill" style="margin:10px 0 0">You are all set. Here is everything meant for you.</p>' : ''}<div class="dash-hero"><div class="dash-top">${u.avatar_mime ? `<img src="/avatar/${u.id}" class="drawer-av-img" style="width:52px;height:52px" alt="">` : `<span class="avatar">${initial}</span>`}<div><p class="eyebrow" style="margin:0">Dashboard</p><h1 style="margin:.1em 0">Hello, ${esc(u.name)}</h1><p class="mut" style="margin:0">${subtitle}${u.username ? ` &middot; @${esc(u.username)}` : ''}</p></div></div>
<p style="margin:14px 0 0">${pill}${posPill} <span class="mut">&middot; member since ${esc(String(u.created_at).slice(0, 10))}</span></p></div>
<h2 class="sec">${rows.length} upload${rows.length === 1 ? '' : 's'} for you</h2>
<div class="box"><h2>Available to you <span class="count">${available.length}</span></h2><p class="hint">Free to view, plus anything you have paid for.</p>${available.length ? grid(available) : '<p class="mut">Nothing available yet.</p>'}</div>
${locked.length ? `<div class="box"><h2>Locked &mdash; pay to view <span class="count">${locked.length}</span></h2><p class="hint">Pay once and it moves up into Available.</p>${grid(locked)}</div>` : ''}`;
}

app.post('/account/name', (req, res) => {
  if (!req.user) return res.sendStatus(401);
  const name = String(req.body.name || '').trim().slice(0, 80);
  if (!name) return res.redirect('/dashboard');
  db.prepare('UPDATE users SET name=? WHERE id=?').run(name, req.user.id);
  res.redirect('/dashboard');
});

app.get('/dashboard', (req, res) => {
  if (!req.user) return res.redirect('/login?next=/dashboard');
  res.send(layout('Dashboard', dashboardBody(req), req.user));
});

app.get('/admin', adminish, (req, res) => {
  const me = req.user, central_ = isCentral(me);
  const cp = can.pages(me), ck = can.allKinds(me), cn = can.news(me), cs = can.support(me), cf = can.full(me);
  const pages = cp ? db.prepare('SELECT * FROM pages WHERE author_id IS NULL AND (admin_id=? OR (admin_id IS NULL AND ?=1)) ORDER BY id DESC').all(me.id, cf ? 1 : 0) : [];
  const roleSelect = u => `<form method="post" action="/admin/users/${u.id}/role" class="row" style="gap:6px;flex-wrap:nowrap"><select name="role">${ROLES.map(r => `<option value="${r}"${u.role === r ? ' selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select><button class="link">Update role</button></form>`;
  const paymentsSection = cf ? (() => {
    const claims = db.prepare("SELECT p.*, u.name un, u.email ue, pg.title pt, pg.slug ps, pg.price_kobo FROM purchases p JOIN users u ON u.id=p.user_id JOIN pages pg ON pg.id=p.page_id WHERE p.status='pending' ORDER BY p.id DESC").all();
    if (!claims.length) return '';
    return `<h3 id="payments">Payment claims waiting for you (${claims.length})</h3>${claims.map(c => `<div class="card row"><div><b>${esc(c.un)}</b> <span class="mut">${esc(c.ue)}</span><br><span class="mut">₦${((c.price_kobo || PRICE_KOBO) / 100).toFixed(0)} for "${esc(c.pt)}"</span></div>
<div class="row" style="gap:6px"><form method="post" action="/admin/payments/${c.id}/approve"><button>Approve</button></form><form method="post" action="/admin/payments/${c.id}/reject" onsubmit="return confirm('Reject this payment claim?')"><button class="link">Reject</button></form></div></div>`).join('')}`;
  })() : '';
  const sponsorsSection = cf ? (() => {
    const claims = db.prepare("SELECT s.*, u.name un FROM sponsor_posts s JOIN users u ON u.id=s.user_id WHERE s.status='pending_payment' ORDER BY s.id DESC").all();
    if (!claims.length) return '';
    return `<h3 id="sponsors">Sponsor post payment claims (${claims.length})</h3>${claims.map(c => `<div class="card"><b>${esc(c.un)}</b> wants to advertise: <b>${esc(c.title)}</b><p class="mut">${esc(c.body.slice(0, 150))}${c.body.length > 150 ? '…' : ''}</p><p class="mut">₦${(c.amount_kobo / 100).toLocaleString()} for ${c.duration_days} day${c.duration_days === 1 ? '' : 's'}</p>
<div class="row" style="gap:6px"><form method="post" action="/admin/sponsors/${c.id}/approve"><button>Approve -- ${c.duration_days} days live</button></form><form method="post" action="/admin/sponsors/${c.id}/reject"><button class="link">Reject</button></form></div></div>`).join('')}`;
  })() : '';
  const levelSection = canPromote(me) ? `<h3 id="levels">Levels</h3><p class="mut" style="margin-top:0">Move students up to the next level (everyone, or one department or level) and choose who else may do it.</p><p><a class="btn" href="/admin/levels">Open level promotion</a></p>` : '';
  const positionsSection = cf ? (() => {
    const pend = db.prepare("SELECT id,name,username,position,department,level FROM users WHERE position_status='pending' ORDER BY id").all();
    const depts = db.prepare('SELECT id,name,faculty FROM departments ORDER BY faculty,name').all();
    const facs = [...new Set(depts.map(d => d.faculty))];
    const approvers = db.prepare("SELECT id,name,title FROM users WHERE position_status='approved' AND position_auto_role='news' ORDER BY name").all();
    const approverOpts = `<option value="">No extra approval needed</option>${approvers.map(a => `<option value="${a.id}">${esc(a.name)}${a.title ? ' -- ' + esc(a.title) : ''}</option>`).join('')}`;
    return `<h3 id="positions">Positions waiting for verification (${pend.length})</h3>${pend.map(p => `<div class="card"><b>${esc(p.name)}</b> <span class="mut">${p.username ? '@' + esc(p.username) : ''} ${esc(p.department || '')} ${p.level ? p.level + ' level' : ''}</span><br>Says they are: <b>${esc(p.position)}</b>
<form method="post" action="/admin/positions/${p.id}/approve" style="margin-top:10px">
<label class="mut">How far their posts reach</label>
<select name="scope"><option value="own">Their own department + level (e.g. a class rep)</option><option value="department">Their whole department, every level (e.g. a departmental president)</option><option value="faculty">Their whole faculty, every department (e.g. a faculty president)</option><option value="school">The whole school</option></select>
<label class="mut">Grant automatically, once verified</label>
<select name="auto_role"><option value="">Nothing extra -- just show the title</option><option value="news">News admin -- can post news directly</option><option value="content">Files admin -- can upload course content</option><option value="observer">Observer -- read-only view of Admin, no posting power</option></select>
<label class="mut">Their news must be approved by</label>
<select name="approver_id">${approverOpts}</select>
<label class="row" style="gap:8px;margin-top:8px;cursor:pointer"><input type="checkbox" name="can_verify" value="1" style="width:auto">Let them verify other position claims within their own scope (e.g. a president verifying their reps)</label>
<div class="row" style="gap:6px;margin-top:8px"><button>Verify</button></div>
</form>
<form method="post" action="/admin/positions/${p.id}/reject" style="margin-top:4px"><button class="link">Reject instead</button></form>
</div>`).join('') || '<p class="mut">No positions waiting.</p>'}
<h3 id="departments">Departments (${depts.length})</h3><p class="mut" style="margin-top:0">This list feeds sign-up and the upload form. Add anything that is missing.</p>
<form class="card" method="post" action="/admin/departments/add"><input name="name" placeholder="Department or programme name" required maxlength="120"><input name="faculty" list="facList" placeholder="Faculty (e.g. Science)" maxlength="80"><datalist id="facList">${facs.map(f => `<option value="${esc(f)}">`).join('')}</datalist><button>Add department</button></form>
<details class="card"><summary style="cursor:pointer">Show all departments</summary>${facs.map(f => `<p class="chat-label">${esc(f)}</p>${depts.filter(d => d.faculty === f).map(d => `<form method="post" action="/admin/departments/${d.id}/delete" class="row" onsubmit="return confirm('Remove this department from the list?')"><span>${esc(d.name)}</span><button class="link">Remove</button></form>`).join('')}`).join('')}</details>`;
  })() : '';
  const delegatedVerifySection = me.position_can_verify ? (() => {
    let pend;
    if (me.position_scope === 'own') pend = db.prepare("SELECT id,name,username,position,department,level FROM users WHERE position_status='pending' AND department=? AND level=?").all(me.department, me.level);
    else if (me.position_scope === 'department') pend = db.prepare("SELECT id,name,username,position,department,level FROM users WHERE position_status='pending' AND department=?").all(me.department);
    else if (me.position_scope === 'faculty') {
      const fac = facultyOf(me.department);
      const depts = fac ? db.prepare('SELECT name FROM departments WHERE faculty=?').all(fac).map(d => d.name) : [];
      pend = depts.length ? db.prepare(`SELECT id,name,username,position,department,level FROM users WHERE position_status='pending' AND department IN (${depts.map(() => '?').join(',')})`).all(...depts) : [];
    } else pend = db.prepare("SELECT id,name,username,position,department,level FROM users WHERE position_status='pending'").all();
    const myRank = SCOPE_RANK[me.position_scope] || 1;
    const SCOPE_LABEL = { own: 'Their own department + level', department: 'Their whole department', faculty: 'Their whole faculty', school: 'The whole school' };
    const scopeOpts = Object.keys(SCOPE_RANK).filter(s => SCOPE_RANK[s] <= myRank).map(s => `<option value="${s}">${SCOPE_LABEL[s]}</option>`).join('');
    return `<h3 id="verify-queue">Position claims waiting for you to verify (${pend.length})</h3>${pend.map(p => `<div class="card"><b>${esc(p.name)}</b> <span class="mut">${p.username ? '@' + esc(p.username) : ''} ${esc(p.department || '')} ${p.level ? p.level + ' level' : ''}</span><br>Says they are: <b>${esc(p.position)}</b>
<form method="post" action="/positions/${p.id}/verify" style="margin-top:8px">
<select name="scope">${scopeOpts}</select>
<select name="auto_role"><option value="">Nothing extra</option><option value="news">News admin</option><option value="content">Files admin</option></select>
<label class="row" style="gap:8px;margin-top:6px;cursor:pointer"><input type="checkbox" name="can_verify" value="1" style="width:auto">Let them verify others too</label>
<div class="row" style="gap:6px;margin-top:8px"><button>Verify</button></div>
</form>
<form method="post" action="/positions/${p.id}/verify-reject" style="margin-top:4px"><button class="link">Reject</button></form>
</div>`).join('') || '<p class="mut">No one waiting on you right now.</p>'}`;
  })() : '';
  const lecturersSection = cf ? (() => {
    const pend = db.prepare("SELECT id,name,email,university,lecturer_reg_no FROM users WHERE is_lecturer=1 AND lecturer_status='pending' ORDER BY id").all();
    if (!pend.length) return '';
    return `<h3 id="lecturers">Lecturers waiting for verification (${pend.length})</h3>${pend.map(l => {
      const courses = db.prepare('SELECT c.name FROM courses c JOIN lecturer_courses lc ON lc.course_id=c.id WHERE lc.lecturer_id=?').all(l.id).map(c => c.name).join(', ');
      return `<div class="card"><b>${esc(l.name)}</b> <span class="mut">${esc(l.email)}</span><br><b>${esc(l.university)}</b>${l.lecturer_reg_no ? ' &middot; reg. no. ' + esc(l.lecturer_reg_no) : ''}<br><span class="mut">Teaches: ${esc(courses) || '(none picked)'}</span>
<div class="row" style="gap:6px;margin-top:8px"><form method="post" action="/admin/lecturers/${l.id}/approve"><button>Verify</button></form><form method="post" action="/admin/lecturers/${l.id}/reject"><button class="link">Reject</button></form></div></div>`;
    }).join('')}`;
  })() : '';
  const observerSection = me.role === 'observer' ? (() => {
    const counts = {
      users: db.prepare("SELECT COUNT(*) n FROM users WHERE role='user'").get().n,
      pendingPositions: db.prepare("SELECT COUNT(*) n FROM users WHERE position_status='pending'").get().n,
      pendingNews: db.prepare("SELECT COUNT(*) n FROM news WHERE status IN ('pending','pending_approver')").get().n,
      pages: db.prepare('SELECT COUNT(*) n FROM pages').get().n,
    };
    const verified = db.prepare("SELECT name, username, title, department, level FROM users WHERE position_status='approved' ORDER BY name").all();
    return `<p class="mut">Read-only view -- you can see what's happening across the site, but nothing here can be changed from this account.</p>
<h3>At a glance</h3><p class="mut" style="margin-top:0">${counts.users} students &middot; ${counts.pages} pages uploaded &middot; ${counts.pendingNews} news item${counts.pendingNews === 1 ? '' : 's'} awaiting approval &middot; ${counts.pendingPositions} position${counts.pendingPositions === 1 ? '' : 's'} awaiting verification</p>
<h3>Verified positions (${verified.length})</h3>${verified.map(v => `<p class="mut">${esc(v.name)}${v.username ? ' @' + esc(v.username) : ''} -- <b>${esc(v.title || '')}</b> (${esc(v.department || '')}${v.level ? ', ' + v.level + ' level' : ''})</p>`).join('') || '<p class="mut">None yet.</p>'}`;
  })() : '';
  const usersSection = cs ? (() => {
    const users = db.prepare('SELECT id,name,email,role,verified,created_at,last_seen,title,username,position_status FROM users ORDER BY id DESC').all();
    const post = (u, action, label, extra = '', confirmMsg = '') => `<form method="post" action="/admin/users/${u.id}/${action}"${confirmMsg ? ` onsubmit="return confirm('${confirmMsg}')"` : ''}>${extra}<button class="link">${label}</button></form>`;
    const rows = users.map(u => {
      const protectedTarget = u.role === 'admin' && !cf; // login-help admins can't touch full admins
      const status = u.verified ? 'verified' : `${post(u, 'verify', 'Verify now')}${post(u, 'resend-verification', 'Resend link')}`;
      const roleCell = u.email === ADMIN_EMAIL ? 'Central admin' : central_ ? roleSelect(u) : (ROLE_LABEL[u.role] || 'User');
      const titleCell = cf ? (u.title ? `<span class="role-tag" style="margin:0">${esc(u.title)}</span>` : u.position_status === 'pending' ? '<span class="mut">awaiting verification</span>' : '') : '';
      const helpCell = protectedTarget ? '' : `${post(u, 'reset-code', 'Send reset code')}${post(u, 'signout', 'Sign out everywhere', '', 'Sign this person out of every device?')}`;
      const removeCell = cf && u.role !== 'admin' ? post(u, 'delete', 'Remove', '', 'Remove this user?') : '';
      return `<tr><td>${presenceDot(u)}${esc(u.name)}${u.username ? ` <span class="mut">${atLink(u.username)}</span>` : ''}</td><td>${esc(u.email)}</td><td>${esc(String(u.created_at).slice(0, 10))}</td><td>${status}</td><td>${roleCell}</td>${cf ? `<td>${titleCell}</td>` : ''}<td>${helpCell}</td>${cf ? `<td>${removeCell}</td>` : ''}</tr>`;
    }).join('');
    return `<h3 id="users">${cf ? 'Registered users' : 'Login help'} (${users.length})</h3><div style="overflow-x:auto"><table><tr><th>Name</th><th>Email</th><th>Joined</th><th>Status</th><th>Role</th>${cf ? '<th>Title</th>' : ''}<th>Login help</th>${cf ? '<th></th>' : ''}</tr>${rows}</table></div>`;
  })() : '';
  const pendingNews = cn ? db.prepare("SELECT n.*, u.name un, u.email ue FROM news n JOIN users u ON u.id = n.author_id WHERE n.status='pending' ORDER BY n.id DESC").all() : [];
  const newsThumb = n => n.image_data ? `<img src="/news-image/${n.id}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;float:left;margin-right:10px">` : '';
  const pendingNewsSection = pendingNews.length ? `<h3 id="pending-news">News waiting for you (${pendingNews.length})</h3>${pendingNews.map(n => `<div class="card" style="overflow:hidden">${newsThumb(n)}<b>${esc(n.title)}</b> <span class="mut">by ${esc(n.un)} (${esc(n.ue)})</span><p class="mut" style="margin:6px 0;white-space:pre-wrap">${esc(n.body)}</p>
<div class="row" style="gap:6px"><form method="post" action="/admin/news/${n.id}/approve"><button>Approve</button></form><form method="post" action="/admin/news/${n.id}/delete" onsubmit="return confirm('Reject this news item?')"><button class="link">Reject</button></form></div></div>`).join('')}` : '';
  const newsItems = cn ? db.prepare("SELECT * FROM news WHERE status='approved' ORDER BY id DESC").all().filter(n => mayManageNews(me, n)) : [];
  const newsSection = cn ? `${pendingNewsSection}<h3 id="news">Post news (${newsItems.length})</h3>
<form class="card" method="post" action="/admin/news" enctype="multipart/form-data"><input name="title" placeholder="Headline" required maxlength="140"><input type="file" name="image" accept="image/*" style="padding:9px 0"><textarea name="body" placeholder="Short summary" required maxlength="2000000" style="width:100%;min-height:70px;font:inherit;padding:11px 13px;margin:6px 0;color:var(--fg);background:rgba(8,10,22,.65);border:1px solid var(--line);border-radius:10px"></textarea><button>Post</button></form>
${newsItems.map(n => `<div class="card row" style="overflow:hidden">${newsThumb(n)}<span class="mut">${esc(n.title)}</span><a href="/admin/news/${n.id}/edit">Edit</a><form method="post" action="/admin/news/${n.id}/delete" onsubmit="return confirm('Delete this news item?')"><button class="link">Delete</button></form></div>`).join('') || '<p class="mut">No news posted yet.</p>'}` : '';
  const pagesSection = cp ? `<form class="card" id="upload" method="post" action="/admin/upload" enctype="multipart/form-data"><h3>Upload content</h3>
<input name="title" placeholder="Title (optional — defaults to file name)">
${ck ? `<select name="kind" id="kindSelect"><option value="html">HTML page</option><option value="cbt">CBT (quiz) HTML</option><option value="pdf">PDF document</option><option value="doc">Word document</option><option value="video">YouTube video</option></select>`
    : '<input type="hidden" name="kind" value="html"><p class="mut" style="margin:4px 0">Your role can upload plain HTML pages. PDFs, Word documents, videos and CBT pages need a Files admin or a full admin.</p>'}
<div id="fileField"><input type="file" name="file" accept=".html,.htm,text/html"></div>
${ck ? `<div id="videoField" style="display:none"><input name="video_url" placeholder="https://youtube.com/watch?v=..."></div>` : ''}
<label><input type="checkbox" name="members_only" value="1"> Members only (login required)</label><br>
<label class="hint" style="display:block;margin-top:8px">Who is this for?</label>
<details><summary>Which departments? (leave all unchecked for every department)</summary>${departmentCheckboxes([])}</details>
<select name="level"><option value="auto">Level: detect from the course code in the title (GST 121 = 100 level)</option><option value="all">All levels</option>${LEVELS.map(l => `<option value="${l}">${l} level only</option>`).join('')}</select>
${cf ? `<div id="payField" style="display:none"><label><input type="radio" name="visibility" value="normal" checked> Free to view</label> <label style="margin-left:14px"><input type="radio" name="visibility" value="paid"> Payment to view (₦${PRICE_NGN})</label><p class="hint">Only CBT uploads can be pay-to-view.</p></div>` : ''}
<button>Upload</button></form>
${ck ? `<script>(function(){var k=document.getElementById('kindSelect'),f=document.getElementById('fileField'),v=document.getElementById('videoField'),fi=f.querySelector('input'),pf=document.getElementById('payField');function sync(){var isVideo=k.value==='video';if(pf)pf.style.display=k.value==='cbt'?'':'none';v.style.display=isVideo?'':'none';f.style.display=isVideo?'none':'';fi.required=!isVideo;fi.accept=k.value==='pdf'?'.pdf':k.value==='doc'?'.doc,.docx':'.html,.htm,text/html'}k.addEventListener('change',sync);sync()})()</script>
<script>if('launchQueue' in window){window.launchQueue.setConsumer(function(lp){if(!lp.files||!lp.files.length)return;lp.files[0].getFile().then(function(file){var dt=new DataTransfer();dt.items.add(file);var fi=document.querySelector('#fileField input[type=file]');fi.files=dt.files;var n=file.name.toLowerCase();var ks=document.getElementById('kindSelect');ks.value=n.indexOf('.pdf')>-1?'pdf':(n.indexOf('.doc')>-1?'doc':'html');ks.dispatchEvent(new Event('change'));document.getElementById('upload').scrollIntoView({behavior:'smooth'})})})}</script>` : ''}
${cp ? `<script>if('serviceWorker' in navigator){navigator.serviceWorker.addEventListener('message',function(e){if(e.data&&e.data.type==='uploads-synced')location.reload()})}</script>` : ''}
<h3 id="pages">Pages (${pages.length})</h3>${(() => {
    if (!pages.length) return '<p class="mut">No pages yet.</p>';
    const pageCard = p => {
      const [pIcon, pLabel] = KIND_META[p.kind] || KIND_META.html;
      const status = p.paid ? `₦${((p.price_kobo || PRICE_KOBO) / 100).toFixed(0)} to view` : (p.members_only ? 'Members only' : 'Open');
      const replaceCtrl = p.kind === 'video'
        ? (ck ? `<form method="post" action="/admin/pages/${p.id}/video" class="row"><input name="video_url" placeholder="New YouTube URL" style="width:auto"><button>Update link</button></form>` : '')
        : (p.kind === 'html' || ck ? `<form method="post" action="/admin/pages/${p.id}/replace" enctype="multipart/form-data" class="row"><input type="file" name="file" required style="width:auto"><button>Replace file</button></form>` : '');
      const deptList = deptListOf(p);
      const forWho = `${deptList.length ? esc(deptList.join(', ')) : 'All departments'} &middot; ${p.level ? p.level + ' level' : 'All levels'}`;
      return `<div class="card"><div class="row"><a href="/p/${p.slug}" target="_blank">${pIcon} ${esc(p.title)}</a><span class="mut">/p/${p.slug} &middot; ${pLabel} &middot; ${status}</span></div>
<p class="mut" style="margin:6px 0 0">For: ${forWho} &middot; <a href="/admin/pages/${p.id}/sort">Change</a></p>
<div class="row" style="margin-top:10px">
<form method="post" action="/admin/pages/${p.id}/toggle"><button class="link">${p.members_only ? '🔒 Members only — make open' : 'Open — make members only'}</button></form>
${replaceCtrl}
<form method="post" action="/admin/pages/${p.id}/delete" onsubmit="return confirm('Delete this page?')"><button class="link">Delete</button></form></div></div>`;
    };
    // Folders by level -- "All levels" first, then 100 up to 600, each only shown if it actually has pages.
    const groups = [['All levels', pages.filter(p => !p.level)]].concat(LEVELS.map(l => [`${l} level`, pages.filter(p => p.level === l)]));
    return groups.filter(([, list]) => list.length).map(([label, list]) => `<details class="card"><summary style="cursor:pointer;font-weight:600">${esc(label)} (${list.length})</summary><div style="margin-top:10px">${list.map(pageCard).join('')}</div></details>`).join('');
  })()}` : '';
  const tab = String(req.query.tab || ''), msgHtml = req.query.msg ? `<p class="mut">${esc(req.query.msg)}</p>` : '';
  const count = sql => { try { return Number(db.prepare(sql).get().n) || 0; } catch (e) { return 0; } };
  const TABS = {
    pages: [cp, '⬆️', 'Uploads & pages', 'Upload files and manage what you posted', pagesSection, 0],
    news: [cn, '📢', 'News', 'Post news and review what students share', newsSection, pendingNews.length],
    positions: [cf || !!me.position_can_verify, '🎖️', 'Positions & departments', 'Verify positions and claims', `${delegatedVerifySection}${positionsSection}`, cf ? count("SELECT COUNT(*) n FROM users WHERE position_status='pending'") : 0],
    lecturers: [cf, '🎓', 'Lecturers', 'Verify lecturer accounts', lecturersSection, cf ? count("SELECT COUNT(*) n FROM users WHERE is_lecturer=1 AND lecturer_status='pending'") : 0],
    payments: [cf, '💳', 'Payments & sponsors', 'Payment claims and sponsor posts', `${paymentsSection}${sponsorsSection}`, cf ? count("SELECT COUNT(*) n FROM purchases WHERE status='pending'") + count("SELECT COUNT(*) n FROM sponsor_posts WHERE status='pending_payment'") : 0],
    users: [cs, '👥', cf ? 'Users' : 'Login help', cf ? 'Everyone who registered' : 'Help people who cannot log in', usersSection, 0],
    overview: [me.role === 'observer', '👁️', 'Overview', 'Read-only look at the site', observerSection, 0],
  };
  const tile = (href, icon, label, desc, n) => `<a class="tile" href="${href}"><span class="stat">${icon}</span>${n > 0 ? `<span class="chip pay">${n} waiting</span>` : ''}<h3>${esc(label)}</h3><span class="go">${esc(desc)} &rarr;</span></a>`;
  const T = TABS[tab];
  if (T && T[0]) return res.send(layout('Admin', `<p class="mut"><a href="/admin">&larr; Admin</a></p><h1>${esc(T[2])}</h1>${msgHtml}${T[4] || '<p class="mut">Nothing is waiting here right now.</p>'}`, req.user));
  const tiles = Object.entries(TABS).filter(([, t]) => t[0]).map(([k, t]) => tile('/admin?tab=' + k, t[1], t[2], t[3], t[5]))
    .concat(canPromote(me) ? [tile('/admin/levels', '🪜', 'Levels', 'Move students up a level', 0)] : [])
    .concat(central_ ? [tile('/admin/team', '🧑‍💼', 'Admin team', 'Appoint admins by @username', 0), tile('/admin/structure', '🏛️', 'Site structure', 'Faculties, departments, institutions, courses', 0)] : []);
  res.send(layout('Admin', `<h1>Admin</h1><p class="mut" style="margin-top:0">${central_ ? 'Central admin' : esc(ROLE_LABEL[me.role] || 'Admin')}</p>${msgHtml}<div class="grid">${tiles.join('')}</div>
<script>(function(){var h=location.hash.slice(1),m={upload:'pages',pages:'pages',news:'news','pending-news':'news',positions:'positions','verify-queue':'positions',lecturers:'lecturers',payments:'payments',sponsors:'payments',users:'users'};if(h&&m[h]&&location.search.indexOf('tab=')<0)location.replace('/admin?tab='+m[h]+'#'+h);else if(h==='levels')location.replace('/admin/levels')})()</script>`, req.user));
});

// Reads the "who is this for?" choices: a department (or all) and a level (or all, or detected from the course code).
function readAudience(body, titleHint) {
  const picked = (Array.isArray(body.dept) ? body.dept : body.dept ? [body.dept] : []).filter(d => departmentNames().includes(d));
  const level = String(body.level || 'auto');
  return {
    dept: picked.length ? picked.join(',') : null,
    level: level === 'auto' ? levelFromText(titleHint) : LEVELS.includes(Number(level)) ? Number(level) : null,
  };
}
app.post('/admin/upload', pagesAdmin, upload.single('file'), (req, res) => {
  const kind = ['html', 'cbt', 'pdf', 'doc', 'video'].includes(req.body.kind) ? req.body.kind : 'html';
  if (kind !== 'html' && !can.allKinds(req.user)) return res.sendStatus(403);
  const paid = can.full(req.user) && kind === 'cbt' && req.body.visibility === 'paid' ? 1 : 0; // only CBT can be pay-to-view
  const membersOnly = req.body.members_only ? 1 : 0;
  const title = (req.body.title || '').trim();

  if (kind === 'video') {
    const vid = youtubeId(req.body.video_url);
    if (!vid) return res.redirect(back('Enter a valid YouTube link.'));
    const slug = uniqueSlug(slugify(title || 'video')), aud = readAudience(req.body, title);
    db.prepare('INSERT INTO pages(slug,title,html,members_only,kind,paid,price_kobo,video_id,dept,level,admin_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(slug, title || 'Video', '', membersOnly, 'video', paid, PRICE_KOBO, vid, aud.dept, aud.level, req.user.id);
    announceUpload({ title: title || 'Video', slug, paid, ...aud });
    return res.redirect(back(`Published at /p/${slug}`));
  }
  if (!req.file) return res.redirect(back('Choose a file first.'));
  const base = req.file.originalname.replace(/\.[a-z0-9]+$/i, '');
  const slug = uniqueSlug(slugify(base)), aud = readAudience(req.body, title || base);
  if (kind === 'pdf' || kind === 'doc') {
    db.prepare('INSERT INTO pages(slug,title,html,members_only,kind,paid,price_kobo,file_data,file_mime,file_name,dept,level,admin_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(slug, title || base, '', membersOnly, kind, paid, PRICE_KOBO, req.file.buffer, req.file.mimetype, req.file.originalname, aud.dept, aud.level, req.user.id);
  } else {
    db.prepare('INSERT INTO pages(slug,title,html,members_only,kind,paid,price_kobo,dept,level,admin_id) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(slug, title || base, req.file.buffer.toString('utf8'), membersOnly, kind, paid, PRICE_KOBO, aud.dept, aud.level, req.user.id);
  }
  announceUpload({ title: title || base, slug, paid, ...aud });
  res.redirect(back(`Published at /p/${slug}`));
});
// Change who an existing upload is for.
app.get('/admin/pages/:id/sort', pagesAdmin, (req, res) => {
  const p = db.prepare('SELECT * FROM pages WHERE id=?').get(req.params.id);
  if (!p) return res.redirect(back('Page not found.'));
  if (!ownsAdminPage(req.user, p)) return res.redirect(back(NOT_YOURS));
  res.send(layout('Who is this for?', `<p class="mut"><a href="/admin?tab=pages">&larr; Admin</a></p><h1 style="font-size:26px">${esc(p.title)}</h1>
<form class="card" method="post" action="/admin/pages/${p.id}/sort"><label class="mut">Which departments? (leave all unchecked for every department)</label>${departmentCheckboxes(deptListOf(p))}
<label class="mut">Level</label><select name="level"><option value="all">All levels</option>${LEVELS.map(l => `<option value="${l}"${Number(p.level) === l ? ' selected' : ''}>${l} level only</option>`).join('')}</select><button>Save</button></form>`, req.user));
});
app.post('/admin/pages/:id/sort', pagesAdmin, (req, res) => {
  const p = db.prepare('SELECT id, author_id, admin_id FROM pages WHERE id=?').get(req.params.id);
  if (!p) return res.redirect(back('Page not found.'));
  if (p.author_id) return res.redirect(back('That was uploaded by a lecturer -- only they can change it.'));
  if (!ownsAdminPage(req.user, p)) return res.redirect(back(NOT_YOURS));
  const aud = readAudience({ dept: req.body.dept, level: req.body.level === '' ? 'all' : req.body.level }, '');
  db.prepare('UPDATE pages SET dept=?, level=? WHERE id=?').run(aud.dept, aud.level, p.id);
  res.redirect(back('Saved who this upload is for.'));
});
// Positions and departments (full admin).
// Whether `verifier` (already verified, with delegated verification power) may act on `claimant`'s pending claim.
function canVerifyClaim(verifier, claimant) {
  if (!verifier || verifier.position_status !== 'approved' || !verifier.position_can_verify || !verifier.position_scope) return false;
  if (verifier.position_scope === 'own') return claimant.department === verifier.department && Number(claimant.level) === Number(verifier.level);
  if (verifier.position_scope === 'department') return claimant.department === verifier.department;
  if (verifier.position_scope === 'faculty') { const f = facultyOf(verifier.department); return !!f && facultyOf(claimant.department) === f; }
  return true; // school-scoped verifier (rare -- central admin normally covers this) can verify anyone
}
// A president (or class rep) verifying someone within their own scope -- open to anyone with that delegated
// power, not just central/full admin. They can never grant more reach than they hold themselves.
app.post('/positions/:id/verify', (req, res) => {
  if (!req.user) return res.redirect('/login');
  const t = db.prepare("SELECT id,position,role,department,level FROM users WHERE id=? AND position_status='pending'").get(req.params.id);
  if (!t || !canVerifyClaim(req.user, t)) return res.redirect(back('You cannot verify that claim.'));
  const myRank = SCOPE_RANK[req.user.position_scope] || 1;
  let scope = ['own', 'department', 'faculty', 'school'].includes(req.body.scope) ? req.body.scope : 'own';
  if (SCOPE_RANK[scope] > myRank) scope = req.user.position_scope;
  const autoRole = ['news', 'content'].includes(req.body.auto_role) ? req.body.auto_role : null;
  const canVerify = req.body.can_verify ? 1 : 0;
  db.prepare("UPDATE users SET title=position, position_status='approved', position_scope=?, position_auto_role=?, position_can_verify=? WHERE id=?").run(scope, autoRole, canVerify, t.id);
  if (autoRole && t.role === 'user') db.prepare('UPDATE users SET role=? WHERE id=?').run(autoRole, t.id);
  notify([t.id], { title: 'Position verified', body: `${t.position} now shows beside your name.`, url: '/settings', tag: 'position' });
  res.redirect(back('Position verified.'));
});
app.post('/positions/:id/verify-reject', (req, res) => {
  if (!req.user) return res.redirect('/login');
  const t = db.prepare("SELECT id,department,level FROM users WHERE id=? AND position_status='pending'").get(req.params.id);
  if (!t || !canVerifyClaim(req.user, t)) return res.redirect(back('You cannot act on that claim.'));
  db.prepare("UPDATE users SET position_status='rejected' WHERE id=?").run(req.params.id);
  res.redirect(back('Rejected.'));
});
app.post('/admin/lecturers/:id/approve', admin, (req, res) => {
  const t = db.prepare("SELECT id FROM users WHERE id=? AND is_lecturer=1 AND lecturer_status='pending'").get(req.params.id);
  if (!t) return res.redirect(back('Nothing to verify.'));
  db.prepare("UPDATE users SET lecturer_status='approved' WHERE id=?").run(t.id);
  notify([t.id], { title: 'You are verified', body: 'You can now upload for your courses.', url: '/lecturer', tag: 'lecturer' });
  res.redirect(back('Lecturer verified.'));
});
app.post('/admin/lecturers/:id/reject', admin, (req, res) => {
  const t = db.prepare("SELECT id FROM users WHERE id=? AND is_lecturer=1 AND lecturer_status='pending'").get(req.params.id);
  if (!t) return res.redirect(back('Nothing to reject.'));
  db.prepare("UPDATE users SET lecturer_status='rejected' WHERE id=?").run(t.id);
  res.redirect(back('Lecturer rejected.'));
});
app.post('/admin/positions/:id/approve', admin, (req, res) => {
  const t = db.prepare("SELECT id,position,role FROM users WHERE id=? AND position_status='pending'").get(req.params.id);
  if (!t) return res.redirect(back('Nothing to verify.'));
  const scope = ['own', 'department', 'faculty', 'school'].includes(req.body.scope) ? req.body.scope : 'own';
  const autoRole = ['news', 'content', 'observer'].includes(req.body.auto_role) ? req.body.auto_role : null;
  const approverId = req.body.approver_id ? Number(req.body.approver_id) : null;
  const canVerify = req.body.can_verify ? 1 : 0;
  db.prepare("UPDATE users SET title=position, position_status='approved', position_scope=?, position_auto_role=?, position_approver_id=?, position_can_verify=? WHERE id=?").run(scope, autoRole, approverId, canVerify, t.id);
  if (autoRole && t.role === 'user') db.prepare('UPDATE users SET role=? WHERE id=?').run(autoRole, t.id);
  notify([t.id], { title: 'Position verified', body: `${t.position} now shows beside your name.`, url: '/settings', tag: 'position' });
  res.redirect(back('Position verified.'));
});
app.post('/admin/positions/:id/reject', admin, (req, res) => {
  const t = db.prepare("SELECT id,position FROM users WHERE id=? AND position_status='pending'").get(req.params.id);
  if (!t) return res.redirect(back('Nothing to reject.'));
  db.prepare("UPDATE users SET title=NULL, position_status='rejected' WHERE id=?").run(t.id);
  notify([t.id], { title: 'Position not verified', body: 'School authorities could not verify the position you entered.', url: '/settings', tag: 'position' });
  res.redirect(back('Position rejected.'));
});
app.post('/admin/departments/add', admin, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 120), faculty = String(req.body.faculty || '').trim().slice(0, 80) || 'Other';
  if (!name) return res.redirect(back('Enter a department name.'));
  db.prepare('INSERT OR IGNORE INTO departments(name,faculty) VALUES(?,?)').run(name, faculty);
  res.redirect(back(`Added ${name}.`));
});
app.post('/admin/departments/:id/delete', admin, (req, res) => {
  db.prepare('DELETE FROM departments WHERE id=?').run(req.params.id);
  res.redirect(back('Department removed from the list.'));
});
// ---------- Levels: only the central admin and the people they appoint can move students up ----------
const TOP_LEVEL = LEVELS[LEVELS.length - 1];
function promotionTargets(dept, fromLevel) {
  const where = ["role='user'", 'level IS NOT NULL', `level < ${TOP_LEVEL}`], args = [];
  if (dept) { where.push('department=?'); args.push(dept); }
  if (fromLevel) { where.push('level=?'); args.push(fromLevel); }
  return { where: where.join(' AND '), args };
}
app.get('/admin/levels', promoter, (req, res) => {
  const msg = req.query.msg ? `<p class="pill">${esc(req.query.msg)}</p>` : '';
  const counts = LEVELS.map(l => `${l} level: <b>${db.prepare("SELECT COUNT(*) n FROM users WHERE role='user' AND level=?").get(l).n}</b>`).join(' &middot; ');
  const depts = db.prepare("SELECT DISTINCT department d FROM users WHERE role='user' AND department IS NOT NULL ORDER BY department").all().map(r => r.d);
  const log = db.prepare("SELECT l.*, u.name FROM level_log l LEFT JOIN users u ON u.id=l.by_user ORDER BY l.id DESC LIMIT 8").all();
  const helpers = isCentral(req.user) ? db.prepare("SELECT id,name,username,email FROM users WHERE can_promote=1 ORDER BY name").all() : [];
  res.send(layout('Level promotion', `<p class="mut"><a href="${can.anyAdmin(req.user) ? '/admin' : '/settings'}">&larr; Back</a></p><h1>Level promotion</h1>${msg}
<p class="mut">Students cannot change their own level, department or username. A level only moves when it is done here.</p>
<div class="card"><p class="mut" style="margin:0 0 8px">${counts}</p>
<form method="post" action="/admin/levels/advance" id="advForm">
<label class="mut">Department</label><select name="department"><option value="">Every department</option>${depts.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}</select>
<label class="mut">Which level moves up</label><select name="level"><option value="">Every level (100&rarr;200, 200&rarr;300 ...)</option>${LEVELS.slice(0, -1).map(l => `<option value="${l}">Only ${l} level &rarr; ${l + 100}</option>`).join('')}</select>
<button style="margin-top:10px">Move students up one level</button></form>
<p class="hint">Students already at ${TOP_LEVEL} level stay where they are. This cannot be undone, so check the choice above before you press the button.</p></div>
${isCentral(req.user) ? `<h3>People allowed to promote students</h3><p class="mut" style="margin-top:0">Only you (the central admin) can add or remove them.</p>
${helpers.length ? helpers.map(h => `<div class="card row" style="align-items:center"><span style="flex:1"><b>${esc(h.name)}</b> <span class="mut">${h.username ? '@' + esc(h.username) : esc(h.email)}</span></span><form method="post" action="/admin/levels/promoters/${h.id}/remove"><button class="link">Remove</button></form></div>`).join('') : '<p class="mut">Nobody else yet.</p>'}
<form method="post" action="/admin/levels/promoters/add" class="card row" style="align-items:center"><input name="who" placeholder="@username or email of the person" required style="flex:1"><button>Allow</button></form>` : ''}
<h3>Recent promotions</h3>${log.length ? log.map(l => `<p class="mut" style="margin:4px 0">${timeAgo(l.at)}: <b>${esc(l.name || 'Admin')}</b> moved ${l.moved} student${l.moved === 1 ? '' : 's'} up${l.department ? ' in ' + esc(l.department) : ''}${l.from_level ? ' from ' + l.from_level + ' level' : ''}.</p>`).join('') : '<p class="mut">Nothing yet.</p>'}
<script>document.getElementById('advForm').addEventListener('submit',function(e){var f=e.target,d=f.department.value||'every department',l=f.level.value?f.level.value+' level':'every level';if(!confirm('Move '+l+' in '+d+' up one level? This cannot be undone.'))e.preventDefault()})</script>`, req.user));
});
app.post('/admin/levels/advance', promoter, (req, res) => {
  const dept = String(req.body.department || '').trim() || null, from = LEVELS.includes(Number(req.body.level)) && Number(req.body.level) < TOP_LEVEL ? Number(req.body.level) : null;
  const t = promotionTargets(dept, from);
  const ids = db.prepare(`SELECT id FROM users WHERE ${t.where}`).all(...t.args).map(r => r.id);
  const info = db.prepare(`UPDATE users SET level = level + 100 WHERE ${t.where}`).run(...t.args);
  db.prepare('INSERT INTO level_log(by_user,department,from_level,moved) VALUES(?,?,?,?)').run(req.user.id, dept, from, info.changes);
  if (ids.length) notify(ids, { title: 'You moved up a level', body: 'Your level has been updated by the school admin.', url: '/dashboard', tag: 'level' });
  res.redirect('/admin/levels?msg=' + encodeURIComponent(`${info.changes} student${info.changes === 1 ? '' : 's'} moved up a level.`));
});
app.post('/admin/levels/promoters/add', central, (req, res) => {
  const who = String(req.body.who || '').trim();
  const u = db.prepare('SELECT id,name FROM users WHERE lower(username)=? OR lower(email)=?').get(cleanUsername(who), who.toLowerCase());
  if (!u) return res.redirect('/admin/levels?msg=' + encodeURIComponent('No member found with that username or email.'));
  db.prepare('UPDATE users SET can_promote=1 WHERE id=?').run(u.id);
  notify([u.id], { title: 'You can promote students', body: 'The central admin allowed you to move students up a level (Settings > Level promotion).', url: '/admin/levels', tag: 'level' });
  res.redirect('/admin/levels?msg=' + encodeURIComponent(`${u.name} can now promote students.`));
});
app.post('/admin/levels/promoters/:id/remove', central, (req, res) => {
  db.prepare('UPDATE users SET can_promote=0 WHERE id=?').run(Number(req.params.id));
  res.redirect('/admin/levels?msg=' + encodeURIComponent('Removed.'));
});

app.post('/admin/pages/:id/replace', pagesAdmin, upload.single('file'), (req, res) => {
  const page = db.prepare('SELECT kind, author_id, admin_id FROM pages WHERE id=?').get(req.params.id);
  if (!page) return res.redirect(back('Page not found.'));
  if (page.author_id) return res.redirect(back('That was uploaded by a lecturer -- only they can change it.'));
  if (!ownsAdminPage(req.user, page)) return res.redirect(back(NOT_YOURS));
  if (page.kind !== 'html' && !can.allKinds(req.user)) return res.sendStatus(403);
  if (!req.file) return res.redirect(back('Choose a file first.'));
  if (page.kind === 'pdf' || page.kind === 'doc') {
    db.prepare('UPDATE pages SET file_data=?, file_mime=?, file_name=? WHERE id=?').run(req.file.buffer, req.file.mimetype, req.file.originalname, req.params.id);
  } else {
    db.prepare('UPDATE pages SET html=? WHERE id=?').run(req.file.buffer.toString('utf8'), req.params.id);
  }
  res.redirect(back('File replaced.'));
});
app.post('/admin/pages/:id/video', filesAdmin, (req, res) => {
  const vid = youtubeId(req.body.video_url);
  if (!vid) return res.redirect(back('Enter a valid YouTube link.'));
  const own = db.prepare('SELECT author_id, admin_id FROM pages WHERE id=?').get(req.params.id);
  if (!own || !ownsAdminPage(req.user, own)) return res.redirect(back(NOT_YOURS));
  db.prepare("UPDATE pages SET video_id=? WHERE id=? AND kind='video'").run(vid, req.params.id);
  res.redirect(back('Video link updated.'));
});
app.post('/admin/news', newsAdmin, upload.single('image'), (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 140);
  const body = String(req.body.body || '').trim().slice(0, 2000000);
  if (!title || !body) return res.redirect(back('Enter a headline and a summary.'));
  if (req.file && !/^image\//.test(req.file.mimetype)) return res.redirect(back('That file is not an image.'));
  const info = db.prepare('INSERT INTO news(title,body,image_data,image_mime,author_id,status) VALUES(?,?,?,?,?,?)')
    .run(title, body, req.file ? req.file.buffer : null, req.file ? req.file.mimetype : null, req.user.id, 'approved');
  broadcastNews(Number(info.lastInsertRowid), req.user.id);
  res.redirect(back('News posted.'));
});
app.post('/admin/news/:id/approve', newsAdmin, (req, res) => {
  const wasPending = db.prepare("SELECT author_id FROM news WHERE id=? AND status='pending'").get(req.params.id);
  db.prepare("UPDATE news SET status='approved' WHERE id=?").run(req.params.id);
  if (wasPending) {
    if (wasPending.author_id && wasPending.author_id !== req.user.id) notify([wasPending.author_id], { title: 'Your news is live', body: 'An admin approved what you shared.', url: '/news/' + req.params.id, tag: 'news-approved' });
    broadcastNews(Number(req.params.id), wasPending.author_id);
  }
  res.redirect(back('News approved.'));
});
app.post('/news/:id/approver-approve', (req, res) => {
  if (!req.user) return res.redirect('/login');
  const n = db.prepare("SELECT author_id FROM news WHERE id=? AND status='pending_approver' AND approver_id=?").get(req.params.id, req.user.id);
  if (!n) return res.redirect(back('That item is not waiting on you.'));
  db.prepare("UPDATE news SET status='approved' WHERE id=?").run(req.params.id);
  if (n.author_id && n.author_id !== req.user.id) notify([n.author_id], { title: 'Your news is live', body: `${req.user.name} approved what you shared.`, url: '/news/' + req.params.id, tag: 'news-approved' });
  broadcastNews(Number(req.params.id), n.author_id);
  res.redirect(back('Approved -- it is live.'));
});
app.post('/news/:id/approver-reject', (req, res) => {
  if (!req.user) return res.redirect('/login');
  const n = db.prepare("SELECT id FROM news WHERE id=? AND status='pending_approver' AND approver_id=?").get(req.params.id, req.user.id);
  if (!n) return res.redirect(back('That item is not waiting on you.'));
  db.prepare("UPDATE news SET status='rejected' WHERE id=?").run(req.params.id);
  res.redirect(back('Rejected.'));
});
app.post('/admin/news/:id/delete', newsAdmin, (req, res) => {
  const own = db.prepare('SELECT author_id FROM news WHERE id=?').get(req.params.id);
  if (own && !mayManageNews(req.user, own)) return res.redirect(back(NOT_YOURS));
  db.prepare('DELETE FROM news WHERE id=?').run(req.params.id);
  res.redirect(back('News deleted.'));
});
app.get('/admin/news/:id/edit', newsAdmin, (req, res) => {
  const n = db.prepare('SELECT * FROM news WHERE id=?').get(req.params.id);
  if (!n) return res.redirect(back('News item not found.'));
  if (!mayManageNews(req.user, n)) return res.redirect(back(NOT_YOURS));
  res.send(layout('Edit news', `<p class="mut"><a href="/admin?tab=news">&larr; Admin</a></p><h1 style="font-size:26px">Edit news</h1>
${n.image_data ? `<img src="/news-image/${n.id}" style="max-width:220px;border-radius:10px;display:block;margin-bottom:10px">` : ''}
<form class="card" method="post" action="/admin/news/${n.id}/edit" enctype="multipart/form-data">
<input name="title" value="${esc(n.title)}" required maxlength="140">
<input type="file" name="image" accept="image/*" style="padding:9px 0">
<p class="hint">Choose a picture only if you want to replace the current one.</p>
<textarea name="body" required maxlength="2000000" style="width:100%;min-height:120px;font:inherit;padding:11px 13px;margin:6px 0;color:var(--fg);background:rgba(8,10,22,.65);border:1px solid var(--line);border-radius:10px">${esc(n.body)}</textarea>
<button>Save changes</button></form>`, req.user));
});
app.post('/admin/news/:id/edit', newsAdmin, upload.single('image'), (req, res) => {
  const n = db.prepare('SELECT id, author_id FROM news WHERE id=?').get(req.params.id);
  if (!n) return res.redirect(back('News item not found.'));
  if (!mayManageNews(req.user, n)) return res.redirect(back(NOT_YOURS));
  const title = String(req.body.title || '').trim().slice(0, 140);
  const body = String(req.body.body || '').trim().slice(0, 2000000);
  if (!title || !body) return res.redirect(`/admin/news/${n.id}/edit`);
  if (req.file && !/^image\//.test(req.file.mimetype)) return res.redirect(back('That file is not an image.'));
  if (req.file) db.prepare('UPDATE news SET title=?, body=?, image_data=?, image_mime=? WHERE id=?').run(title, body, req.file.buffer, req.file.mimetype, n.id);
  else db.prepare('UPDATE news SET title=?, body=? WHERE id=?').run(title, body, n.id);
  res.redirect(back('News updated.'));
});
app.post('/admin/pages/:id/toggle', pagesAdmin, (req, res) => {
  const p = db.prepare('SELECT author_id, admin_id FROM pages WHERE id=?').get(req.params.id);
  if (p && p.author_id) return res.redirect(back('That was uploaded by a lecturer -- only they can change it.'));
  if (p && !ownsAdminPage(req.user, p)) return res.redirect(back(NOT_YOURS));
  db.prepare('UPDATE pages SET members_only = 1 - members_only WHERE id=?').run(req.params.id);
  res.redirect('/admin');
});
app.post('/admin/pages/:id/delete', pagesAdmin, (req, res) => {
  const p = db.prepare('SELECT author_id, admin_id FROM pages WHERE id=?').get(req.params.id);
  if (p && p.author_id) return res.redirect(back('That was uploaded by a lecturer -- only they can delete it.'));
  if (p && !ownsAdminPage(req.user, p)) return res.redirect(back(NOT_YOURS));
  db.prepare('DELETE FROM pages WHERE id=?').run(req.params.id);
  res.redirect(back('Page deleted.'));
});
// Login-help actions. Login-help admins can help anyone except full admins; full admins can help everyone.
const helpTarget = (req, res) => {
  const t = db.prepare('SELECT * FROM users WHERE id=?').get(Number(req.params.id));
  if (!t) { res.redirect(back('User not found.')); return null; }
  if (t.role === 'admin' && !can.full(req.user)) { res.sendStatus(403); return null; }
  return t;
};
app.post('/admin/users/:id/verify', supportAdmin, (req, res) => {
  const t = helpTarget(req, res); if (!t) return;
  db.prepare('UPDATE users SET verified=1, verify_hash=NULL, verify_expires=NULL WHERE id=?').run(t.id);
  res.redirect(back('User verified.'));
});
app.post('/admin/users/:id/resend-verification', supportAdmin, async (req, res) => {
  const t = helpTarget(req, res); if (!t) return;
  if (t.verified) return res.redirect(back('That account is already verified.'));
  const r = await sendSafely(req, t);
  res.redirect(back(r === 'sent' ? `Verification link sent to ${t.email}.` : r === 'wait' ? 'A link was sent a moment ago. Wait a minute and try again.' : 'The email could not be sent. Check the email settings.'));
});
app.post('/admin/users/:id/reset-code', supportAdmin, async (req, res) => {
  const t = helpTarget(req, res); if (!t) return;
  if (limited('help-reset:' + t.id, 3, 15 * 60e3)) return res.redirect(back('Too many codes sent to this person. Try again in a few minutes.'));
  const code = String(crypto.randomInt(100000, 1000000));
  db.prepare('UPDATE users SET reset_hash=?, reset_expires=?, reset_attempts=0 WHERE id=?').run(bcrypt.hashSync(code, 10), Date.now() + 600000, t.id);
  try { await sendResetCode(t.email, code); } catch (e) { console.error('Reset email failed:', e.message); }
  res.redirect(back(`A reset code was emailed to ${t.email}. It goes only to their inbox.`)); // the code is never shown to the admin
});
app.post('/admin/users/:id/signout', supportAdmin, (req, res) => {
  const t = helpTarget(req, res); if (!t) return;
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(t.id);
  res.redirect(back(`${t.name} was signed out everywhere.`));
});
app.post('/admin/users/:id/delete', admin, (req, res) => {
  const t = db.prepare('SELECT id,name,role FROM users WHERE id=?').get(Number(req.params.id));
  if (!t) return res.redirect(back('That person is already gone.'));
  if (t.role === 'admin') return res.redirect(back('The main admin account cannot be removed.'));
  purgeUser(t.id);
  console.log(`Audit: ${req.user.email} removed account #${t.id} completely`);
  res.redirect(back(`${t.name} was removed completely: chats, friends, uploads, sign-ins and the Google link are all gone.`));
});
// Only the central admin (the ADMIN_EMAIL account) can create or change any kind of admin (files, news, login-help, partial, full),
// and only for users who have already registered.
app.post('/admin/users/:id/role', central, (req, res) => {
  const role = ROLES.includes(req.body.role) ? req.body.role : 'user';
  const target = db.prepare('SELECT email FROM users WHERE id=?').get(req.params.id);
  if (target && target.email !== ADMIN_EMAIL) db.prepare('UPDATE users SET role=? WHERE id=?').run(role, req.params.id);
  res.redirect(back('Role updated.'));
});

// ---------- Admin team: the central admin appoints (and changes) admins by @username, each with just the job they are given ----------
const TEAM_ROLES = ROLES.filter(r => r !== 'user');
const ROLE_JOB = { partial: 'Can upload plain HTML pages.', content: 'Can upload every kind of file (PDF, Word, video, CBT).', news: 'Can post news and review what students share.', support: 'Can help people who cannot log in.', observer: 'Can look but not change anything.', admin: 'Full admin: everything except the central admin\'s own powers.' };
const teamBack = msg => '/admin/team?msg=' + encodeURIComponent(msg);
app.get('/admin/team', central, (req, res) => {
  const staff = db.prepare("SELECT id,name,email,username,role FROM users WHERE role!='user' ORDER BY name").all();
  const roleOpts = (cur, withUser) => (withUser ? ['user'] : []).concat(TEAM_ROLES).map(r => `<option value="${r}"${cur === r ? ' selected' : ''}>${esc(ROLE_LABEL[r])}</option>`).join('');
  const rows = staff.map(u => u.email === ADMIN_EMAIL
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
  if (u.email === ADMIN_EMAIL) return res.redirect(teamBack('That is you, the central admin.'));
  if (u.is_lecturer) return res.redirect(teamBack('Lecturer accounts cannot be given admin roles.'));
  setTeamRole(u, role, req.user);
  res.redirect(teamBack(`${u.name} is now: ${ROLE_LABEL[role]}.`));
});
app.post('/admin/team/:id/role', central, (req, res) => {
  const role = req.body.role === 'user' ? 'user' : TEAM_ROLES.includes(req.body.role) ? req.body.role : null;
  const u = role && db.prepare('SELECT id,name,email FROM users WHERE id=?').get(req.params.id);
  if (!u || u.email === ADMIN_EMAIL) return res.redirect(teamBack('Could not change that role.'));
  setTeamRole(u, role, req.user);
  res.redirect(teamBack(role === 'user' ? `${u.name} is a normal member again.` : `${u.name} is now: ${ROLE_LABEL[role]}.`));
});

// ---------- Site structure: the central admin edits faculties, departments, institutions and courses ----------
const sback = (msg, anchor) => '/admin/structure?msg=' + encodeURIComponent(msg) + (anchor ? '#' + anchor : '');
// Changes a name everywhere it is stored (people, uploads, news reach, logs) so nothing is left pointing at the old name.
function renameValue(cols, from, to) {
  let n = 0;
  for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name))
    for (const c of db.prepare(`PRAGMA table_info("${t}")`).all())
      if (cols.includes(c.name)) n += Number(db.prepare(`UPDATE "${t}" SET "${c.name}"=? WHERE "${c.name}"=?`).run(to, from).changes);
  return n;
}
function renameInPageAudience(from, to) { // uploads keep their departments as a comma-separated list
  for (const r of db.prepare("SELECT id,dept FROM pages WHERE dept IS NOT NULL AND dept!=''").all()) {
    const parts = r.dept.split(','); if (!parts.includes(from)) continue;
    db.prepare('UPDATE pages SET dept=? WHERE id=?').run([...new Set(parts.map(x => x === from ? to : x))].join(','), r.id);
  }
}
const clean = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
app.get('/admin/structure', central, (req, res) => {
  const depts = db.prepare('SELECT id,name,faculty FROM departments ORDER BY faculty,name').all(), facs = [...new Set(depts.map(d => d.faculty))];
  const people = db.prepare("SELECT department n, COUNT(*) c FROM users WHERE department IS NOT NULL AND department!='' GROUP BY department").all();
  const pc = Object.fromEntries(people.map(r => [r.n, r.c]));
  const facList = `<datalist id="facList">${facs.map(f => `<option value="${esc(f)}">`).join('')}</datalist>`;
  const deptHtml = facs.map(f => `<div class="card"><form method="post" action="/admin/structure/faculty/rename" class="row" style="gap:6px"><input type="hidden" name="from" value="${esc(f)}"><input name="to" value="${esc(f)}" maxlength="80" required style="flex:1"><button>Rename faculty</button></form>
${depts.filter(d => d.faculty === f).map(d => `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line)"><form method="post" action="/admin/structure/department/${d.id}/save" class="row" style="gap:6px"><input name="name" value="${esc(d.name)}" maxlength="120" required style="flex:2;min-width:160px"><input name="faculty" list="facList" value="${esc(d.faculty)}" maxlength="80" required style="flex:1;min-width:130px" title="Faculty this department belongs to"><button>Save</button></form>
<span class="mut" style="font-size:12px">${pc[d.name] || 0} student${(pc[d.name] || 0) === 1 ? '' : 's'}</span> <form method="post" action="/admin/structure/department/${d.id}/delete" style="display:inline" onsubmit="return confirm('Remove this department from the list?')"><button class="link">Remove</button></form></div>`).join('')}</div>`).join('');
  const instRows = db.prepare('SELECT i.id,i.name,(SELECT COUNT(*) FROM users u WHERE u.university=i.name) c FROM institutions i ORDER BY i.name').all();
  const strays = db.prepare("SELECT university n, COUNT(*) c FROM users WHERE university IS NOT NULL AND university!='' AND university NOT IN (SELECT name FROM institutions) GROUP BY university ORDER BY university").all();
  const instHtml = instRows.map(i => `<div class="card"><form method="post" action="/admin/structure/institution/${i.id}/save" class="row" style="gap:6px"><input name="name" value="${esc(i.name)}" maxlength="120" required style="flex:1;min-width:200px"><button>Rename</button></form><span class="mut" style="font-size:12px">${i.c} member${i.c === 1 ? '' : 's'}</span> <form method="post" action="/admin/structure/institution/${i.id}/delete" style="display:inline" onsubmit="return confirm('Take this institution off the picker list? Existing members keep it.')"><button class="link">Remove from list</button></form></div>`).join('')
    + (strays.length ? `<p class="mut">Typed in by members and not on the list:</p>${strays.map(x => `<div class="card row"><span>${esc(x.n)} <span class="mut">(${x.c})</span></span><form method="post" action="/admin/structure/institution/add"><input type="hidden" name="name" value="${esc(x.n)}"><button class="link">Add to list</button></form></div>`).join('')}` : '');
  const courses = db.prepare('SELECT c.id,c.name,(SELECT COUNT(*) FROM lecturer_courses lc WHERE lc.course_id=c.id) l,(SELECT COUNT(*) FROM pages p WHERE p.course_id=c.id) p FROM courses c ORDER BY c.name').all();
  const courseHtml = courses.map(c => `<div class="card"><form method="post" action="/admin/structure/course/${c.id}/rename" class="row" style="gap:6px"><input name="name" value="${esc(c.name)}" maxlength="120" required style="flex:1;min-width:180px"><button>Rename</button></form>
<span class="mut" style="font-size:12px">${c.l} lecturer${c.l === 1 ? '' : 's'} &middot; ${c.p} upload${c.p === 1 ? '' : 's'}</span>
<div class="row" style="gap:6px;margin-top:6px"><form method="post" action="/admin/structure/course/${c.id}/merge" class="row" style="gap:6px"><select name="into" style="width:auto"><option value="">Move everything into&hellip;</option>${courses.filter(o => o.id !== c.id).map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select><button class="link">Merge</button></form>
<form method="post" action="/admin/structure/course/${c.id}/delete" onsubmit="return confirm('Delete this course? Lecturers lose it from their list and its uploads become unfiled.')"><button class="link">Delete</button></form></div></div>`).join('');
  res.send(layout('Site structure', `<p class="mut"><a href="/admin">&larr; Admin</a></p><h1>Site structure</h1>${req.query.msg ? `<p class="mut">${esc(req.query.msg)}</p>` : ''}${facList}
<p class="mut" style="margin-top:0">Changing a name here changes it for everyone it is attached to.</p>
<details id="faculties" class="card" open><summary style="cursor:pointer;font-weight:600">Faculties &amp; departments (${depts.length})</summary>
<form class="card row" method="post" action="/admin/structure/department/add" style="gap:6px;margin-top:10px"><input name="name" placeholder="New department" required maxlength="120" style="flex:2;min-width:160px"><input name="faculty" list="facList" placeholder="Faculty" required maxlength="80" style="flex:1;min-width:130px"><button>Add</button></form>${deptHtml}</details>
<details id="institutions" class="card"><summary style="cursor:pointer;font-weight:600">Institutions (${instRows.length})</summary>
<form class="card row" method="post" action="/admin/structure/institution/add" style="gap:6px;margin-top:10px"><input name="name" placeholder="New institution" required maxlength="120" style="flex:1;min-width:200px"><button>Add</button></form>${instHtml}</details>
<details id="courses" class="card"><summary style="cursor:pointer;font-weight:600">Lecturer courses (${courses.length})</summary>
<p class="mut">These are the courses lecturers pick and upload under. If something is not really a course, rename it, delete it, or merge it into the right one.</p>
<form class="card row" method="post" action="/admin/structure/course/add" style="gap:6px"><input name="name" placeholder="New course" required maxlength="120" style="flex:1;min-width:180px"><button>Add</button></form>${courseHtml || '<p class="mut">No courses yet.</p>'}</details>
<script>(function(){var h=location.hash.slice(1),d=h&&document.getElementById(h);if(d&&d.tagName==='DETAILS'){d.open=true;d.scrollIntoView()}})()</script>`, req.user));
});
app.post('/admin/structure/faculty/rename', central, (req, res) => {
  const from = clean(req.body.from, 80), to = clean(req.body.to, 80);
  if (!from || !to) return res.redirect(sback('Type the new faculty name.'));
  if (from !== to) renameValue(['faculty', 'scope_faculty'], from, to);
  res.redirect(sback(from === to ? 'No change.' : `Faculty renamed to ${to}.`, 'faculties'));
});
app.post('/admin/structure/department/add', central, (req, res) => {
  const name = clean(req.body.name, 120), faculty = clean(req.body.faculty, 80) || 'Other';
  if (!name) return res.redirect(sback('Type a department name.'));
  if (db.prepare('SELECT 1 FROM departments WHERE name=?').get(name)) return res.redirect(sback('That department already exists.', 'faculties'));
  db.prepare('INSERT INTO departments(name,faculty) VALUES(?,?)').run(name, faculty);
  res.redirect(sback(`Added ${name} under ${faculty}.`, 'faculties'));
});
app.post('/admin/structure/department/:id/save', central, (req, res) => {
  const d = db.prepare('SELECT * FROM departments WHERE id=?').get(req.params.id), name = clean(req.body.name, 120), faculty = clean(req.body.faculty, 80) || 'Other';
  if (!d || !name) return res.redirect(sback('Could not save that department.', 'faculties'));
  if (name !== d.name) {
    if (db.prepare('SELECT 1 FROM departments WHERE name=? AND id!=?').get(name, d.id)) return res.redirect(sback('Another department already has that name.', 'faculties'));
    db.prepare('UPDATE departments SET name=? WHERE id=?').run(name, d.id);
    renameValue(['department', 'scope_department'], d.name, name); renameInPageAudience(d.name, name);
  }
  if (faculty !== d.faculty) db.prepare('UPDATE departments SET faculty=? WHERE id=?').run(faculty, d.id);
  res.redirect(sback(`Saved ${name}${faculty !== d.faculty ? ` (now under ${faculty})` : ''}.`, 'faculties'));
});
app.post('/admin/structure/department/:id/delete', central, (req, res) => {
  const d = db.prepare('SELECT * FROM departments WHERE id=?').get(req.params.id);
  if (!d) return res.redirect(sback('Not found.', 'faculties'));
  const n = db.prepare('SELECT COUNT(*) n FROM users WHERE department=?').get(d.name).n;
  if (n) return res.redirect(sback(`${n} student${n === 1 ? ' is' : 's are'} in ${d.name}. Rename it or move it instead of removing it.`, 'faculties'));
  db.prepare('DELETE FROM departments WHERE id=?').run(d.id);
  res.redirect(sback(`Removed ${d.name}.`, 'faculties'));
});
app.post('/admin/structure/institution/add', central, (req, res) => {
  const name = clean(req.body.name, 120);
  if (!name || /^Other\b/i.test(name)) return res.redirect(sback('Type an institution name.', 'institutions'));
  db.prepare('INSERT OR IGNORE INTO institutions(name) VALUES(?)').run(name);
  res.redirect(sback(`Added ${name}.`, 'institutions'));
});
app.post('/admin/structure/institution/:id/save', central, (req, res) => {
  const i = db.prepare('SELECT * FROM institutions WHERE id=?').get(req.params.id), name = clean(req.body.name, 120);
  if (!i || !name) return res.redirect(sback('Could not save that institution.', 'institutions'));
  if (name !== i.name) {
    if (db.prepare('SELECT 1 FROM institutions WHERE name=? AND id!=?').get(name, i.id)) return res.redirect(sback('Another institution already has that name.', 'institutions'));
    db.prepare('UPDATE institutions SET name=? WHERE id=?').run(name, i.id); renameValue(['university'], i.name, name);
  }
  res.redirect(sback(`Saved ${name}.`, 'institutions'));
});
app.post('/admin/structure/institution/:id/delete', central, (req, res) => {
  db.prepare('DELETE FROM institutions WHERE id=?').run(req.params.id);
  res.redirect(sback('Removed from the picker list.', 'institutions'));
});
app.post('/admin/structure/course/add', central, (req, res) => {
  const name = clean(req.body.name, 120);
  if (!name) return res.redirect(sback('Type a course name.', 'courses'));
  db.prepare('INSERT OR IGNORE INTO courses(name) VALUES(?)').run(name);
  res.redirect(sback(`Added ${name}.`, 'courses'));
});
app.post('/admin/structure/course/:id/rename', central, (req, res) => {
  const c = db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id), name = clean(req.body.name, 120);
  if (!c || !name) return res.redirect(sback('Could not save that course.', 'courses'));
  if (db.prepare('SELECT 1 FROM courses WHERE name=? AND id!=?').get(name, c.id)) return res.redirect(sback('Another course already has that name. Use Merge instead.', 'courses'));
  db.prepare('UPDATE courses SET name=? WHERE id=?').run(name, c.id);
  res.redirect(sback(`Saved ${name}.`, 'courses'));
});
app.post('/admin/structure/course/:id/delete', central, (req, res) => {
  const c = db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id);
  if (!c) return res.redirect(sback('Not found.', 'courses'));
  db.prepare('DELETE FROM lecturer_courses WHERE course_id=?').run(c.id); db.prepare('UPDATE pages SET course_id=NULL WHERE course_id=?').run(c.id); db.prepare('DELETE FROM courses WHERE id=?').run(c.id);
  res.redirect(sback(`Deleted ${c.name}.`, 'courses'));
});
app.post('/admin/structure/course/:id/merge', central, (req, res) => {
  const c = db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id), to = db.prepare('SELECT * FROM courses WHERE id=?').get(Number(req.body.into) || 0);
  if (!c || !to || c.id === to.id) return res.redirect(sback('Choose the course to move everything into.', 'courses'));
  db.prepare('UPDATE OR IGNORE lecturer_courses SET course_id=? WHERE course_id=?').run(to.id, c.id); db.prepare('DELETE FROM lecturer_courses WHERE course_id=?').run(c.id);
  db.prepare('UPDATE pages SET course_id=? WHERE course_id=?').run(to.id, c.id); db.prepare('DELETE FROM courses WHERE id=?').run(c.id);
  res.redirect(sback(`${c.name} was merged into ${to.name}.`, 'courses'));
});

app.use((err, req, res, next) => res.status(400).send(layout('Error', `<h2>Something went wrong</h2><p class="mut">${esc(err.message)} (uploads are limited to 20 MB)</p>`, req.user)));

sweepRemnants();
app.listen(PORT, () => console.log(`Studies Hub running on http://localhost:${PORT}`));
