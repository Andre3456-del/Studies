'use strict';
// Sends one email through the first service that works: Google, then Resend, then Brevo, then SMTP (only the ones that are set up).
// When a service refuses (daily limit reached, or any error), the same email goes straight to the next one.
// A service that says it is full is skipped until midnight (UTC); any other failure is skipped for one minute.
// Optional: RESEND_DAILY_LIMIT / BREVO_DAILY_LIMIT / GOOGLE_DAILY_LIMIT / SMTP_DAILY_LIMIT, e.g. 100: switch just before the limit is reached.
const skipUntil = {};
let db = null;
const day = () => new Date().toISOString().slice(0, 10);
const nextMidnight = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.getTime(); };
function count(name) { try { return (db.prepare('SELECT n FROM mail_counts WHERE day=? AND provider=?').get(day(), name) || { n: 0 }).n; } catch (e) { return 0; } }
function bump(name) { try { db.prepare('INSERT INTO mail_counts(day,provider,n) VALUES(?,?,1) ON CONFLICT(day,provider) DO UPDATE SET n=n+1').run(day(), name); } catch (e) { /* counting is optional */ } }
exports.init = d => { db = d; try { db.exec('CREATE TABLE IF NOT EXISTS mail_counts(day TEXT, provider TEXT, n INTEGER DEFAULT 0, PRIMARY KEY(day,provider))'); } catch (e) { /* ignore */ } };
exports.today = () => { try { return db.prepare('SELECT provider, n FROM mail_counts WHERE day=?').all(day()); } catch (e) { return []; } };
// providers: [[name, async () => send], ...] in the order to try. Returns true when sent, false when nothing is set up; throws if every one failed.
exports.run = async providers => {
  if (!providers.length) return false;
  let last = null;
  for (const [name, fn] of providers) {
    if ((skipUntil[name] || 0) > Date.now()) continue;
    const cap = Number(process.env[name.toUpperCase() + '_DAILY_LIMIT'] || 0);
    if (cap && count(name) >= cap) { skipUntil[name] = nextMidnight(); continue; }
    try { await fn(); bump(name); return true; }
    catch (e) {
      last = e;
      skipUntil[name] = /429|quota|limit|exceed|too many/i.test(String(e && e.message)) ? nextMidnight() : Date.now() + 60e3;
      console.error(`Email via ${name} failed (${e && e.message}); trying the next service.`);
    }
  }
  throw last || new Error('Every email service is at its limit or down');
};
