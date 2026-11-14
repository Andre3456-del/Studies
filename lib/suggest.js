// "Suggested Studikins": people you might want to message, ranked by how much you have in common.
// Same department, same level, same university, Studikins in common, and being active lately all add points;
// a small daily shuffle keeps the list from always being the same.
module.exports = function suggest(db, me, contacts, chatted, limit = 12) {
  const mine = db.prepare('SELECT university,department,level FROM users WHERE id=?').get(me) || {};
  const skip = new Set([me, ...chatted]);
  const rows = db.prepare("SELECT id,name,username,avatar_mime,university,department,level,last_seen FROM users WHERE id!=? AND verified=1 AND is_lecturer=0 AND COALESCE(virtual,0)=0 AND role NOT IN ('admin','uniadmin') ORDER BY COALESCE(last_seen,0) DESC LIMIT 500").all(me);
  const mutual = {};
  const F = contacts.map(Number).filter(Boolean);
  if (F.length) {
    const list = F.join(',');
    for (const r of db.prepare(`SELECT requester_id a, addressee_id b FROM friendships WHERE status='friends' AND (requester_id IN (${list}) OR addressee_id IN (${list}))`).all()) {
      const aIn = F.includes(r.a), bIn = F.includes(r.b);
      if (aIn && !bIn) mutual[r.b] = (mutual[r.b] || 0) + 1;
      if (bIn && !aIn) mutual[r.a] = (mutual[r.a] || 0) + 1;
    }
  }
  const day = Math.floor(Date.now() / 864e5), jit = id => (((id * 2654435761 + me * 40503 + day * 9973) >>> 0) % 1000) / 1000 * 1.5;
  const out = [];
  for (const u of rows) {
    if (skip.has(u.id)) continue;
    let s = jit(u.id), why = '';
    const mu = mutual[u.id] || 0;
    if (mine.department && u.department === mine.department) { s += 4; why = 'Same department'; }
    if (mine.level && u.level === mine.level) { s += 2; why = why || 'Same level'; }
    if (mine.university && u.university === mine.university) { s += 2; why = why || 'Same university'; }
    if (mu) { s += Math.min(mu, 5) * 2; why = mu + ' Studikin' + (mu > 1 ? 's' : '') + ' in common'; }
    if (u.last_seen && Date.now() - u.last_seen < 864e5) s += 1;
    out.push({ u, s, why: why || 'On Studies Hub' });
  }
  return out.sort((a, b) => b.s - a.s).slice(0, limit);
};
