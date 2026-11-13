// The round friend circles at the top of the chat list (like stories on Snapchat or Facebook).
// A coloured ring means a story you have not seen yet; a green dot means the friend is online.
module.exports = function circles({ me, items, users, avatarOr, esc, isOnline, stories }) {
  const byId = new Map(users.map(u => [u.id, u]));
  const ids = items.filter(i => i.kind === 'dm' && i.id !== me).slice(0, 12).map(i => i.id);
  const mine = stories[me];
  const you = `<a class="st" href="${mine ? '/stories/' + me : '/stories/new'}"><span class="ring${mine ? (mine.seen ? ' seen' : '') : ' none'}">${avatarOr(byId.get(me))}</span><span class="st-plus">+</span><span class="st-n">Your story</span></a>`;
  const rest = ids.map(id => {
    const u = byId.get(id), s = stories[id];
    return `<a class="st" href="${s ? '/stories/' + id : '/chat/' + id}"><span class="ring${s ? (s.seen ? ' seen' : '') : ' none'}">${avatarOr(u)}${isOnline(u) ? '<i class="st-on"></i>' : ''}</span><span class="st-n">${esc(String(u.name).split(' ')[0])}</span></a>`;
  }).join('');
  return `<div class="stories">${you}${rest}</div>`;
};
