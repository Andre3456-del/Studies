// Who is typing or recording a voice note right now. Kept in memory only (it lasts a few seconds and is never stored).
const M = new Map(); // conversation key -> Map(userId -> { k: 'typing' | 'recording', t: time, name })
const TTL = 5000;
const key = (type, id, me) => type === 'group' ? 'g' + id : 'd' + Math.min(me, id) + '_' + Math.max(me, id);
exports.set = (me, name, type, id, kind) => {
  const k = key(type, Number(id), me);
  let m = M.get(k);
  if (!kind) { if (m) { m.delete(me); if (!m.size) M.delete(k); } return; }
  if (!m) M.set(k, m = new Map());
  m.set(me, { k: kind, t: Date.now(), name });
  if (M.size > 2000) for (const [kk, mm] of M) { for (const [u, v] of mm) if (Date.now() - v.t > TTL) mm.delete(u); if (!mm.size) M.delete(kk); }
};
// What this person should see for a conversation: { k, who } or null.
exports.get = (me, type, id) => {
  const m = M.get(key(type, Number(id), me));
  if (!m) return null;
  const now = Date.now(), live = [];
  for (const [u, v] of m) if (u !== me && now - v.t < TTL) live.push(v);
  if (!live.length) return null;
  live.sort((a, b) => (a.k === 'recording' ? 0 : 1) - (b.k === 'recording' ? 0 : 1));
  return { k: live[0].k, who: type === 'group' ? (live.length > 1 ? live.length + ' people' : String(live[0].name || '').split(' ')[0]) : '' };
};
