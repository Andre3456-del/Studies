// The prices the owner can change from inside the app (sponsor adverts, CBT tests, other paid materials).
// They live in the database. The old environment values are only the starting point the first time.
const cache = new WeakMap();
module.exports = function prices(db) {
  if (cache.has(db)) return cache.get(db);
  db.exec('CREATE TABLE IF NOT EXISTS site_prices (key TEXT PRIMARY KEY, ngn INTEGER NOT NULL)');
  const start = { sponsor: Number(process.env.SPONSOR_PRICE_NGN || 2500), cbt: Number(process.env.PRICE_NGN || 100), material: Number(process.env.PRICE_NGN || 100) };
  const get = k => { const r = db.prepare('SELECT ngn FROM site_prices WHERE key=?').get(k); return r ? r.ngn : start[k]; };
  const api = {
    sponsor: () => get('sponsor'), cbt: () => get('cbt'), material: () => get('material'),
    // the standing price (in kobo) for a new paid item of this kind
    defKobo: kind => get(kind === 'cbt' ? 'cbt' : 'material') * 100,
    // Saves a new price. Paid items still sitting at the old standing price move to the new one; items with their own price are left alone.
    set(k, ngn) {
      ngn = Math.round(Number(ngn));
      if (!(k in start) || !(ngn >= 1 && ngn <= 10000000)) return false;
      const old = get(k);
      db.prepare('INSERT INTO site_prices(key,ngn) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET ngn=excluded.ngn').run(k, ngn);
      if (k === 'cbt') db.prepare("UPDATE pages SET price_kobo=? WHERE paid=1 AND kind='cbt' AND price_kobo=?").run(ngn * 100, old * 100);
      if (k === 'material') db.prepare("UPDATE pages SET price_kobo=? WHERE paid=1 AND kind!='cbt' AND price_kobo=?").run(ngn * 100, old * 100);
      return true;
    },
  };
  cache.set(db, api);
  return api;
};
