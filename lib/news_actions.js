// The little icon row under each news post: comment, like, share, save. Counts come from three small tables (see routes/news_social.js).
const IC = {
  c: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  l: '<path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11z"/>',
  s: '<path d="M4 12v7h16v-7M12 3v12M8 7l4-4 4 4"/>',
  b: '<path d="M6 3h12v18l-6-4-6 4z"/>'
};
const svg = d => `<svg class="ic" viewBox="0 0 24 24">${d}</svg>`;

// { id: { likes, comments, liked, saved } } for the ids shown, for this viewer (me may be 0)
exports.stats = (db, ids, me) => {
  const out = {}; if (!ids.length) return out;
  const list = ids.map(Number).join(',');
  for (const id of ids) out[id] = { likes: 0, comments: 0, liked: false, saved: false };
  for (const r of db.prepare(`SELECT news_id id, COUNT(*) n FROM news_likes WHERE news_id IN (${list}) GROUP BY news_id`).all()) out[r.id].likes = r.n;
  for (const r of db.prepare(`SELECT news_id id, COUNT(*) n FROM news_comments WHERE news_id IN (${list}) GROUP BY news_id`).all()) out[r.id].comments = r.n;
  if (me) {
    for (const r of db.prepare(`SELECT news_id id FROM news_likes WHERE user_id=? AND news_id IN (${list})`).all(me)) out[r.id].liked = true;
    for (const r of db.prepare(`SELECT news_id id FROM news_saves WHERE user_id=? AND news_id IN (${list})`).all(me)) out[r.id].saved = true;
  }
  return out;
};

exports.bar = (id, st) => `<div class="acts" data-id="${id}">
<a class="act" href="/news/${id}/comments" aria-label="Comments">${svg(IC.c)}<span>${st.comments || ''}</span></a>
<button type="button" class="act${st.liked ? ' on' : ''}" data-a="like" aria-label="Like">${svg(IC.l)}<span>${st.likes || ''}</span></button>
<button type="button" class="act" data-a="share" aria-label="Share">${svg(IC.s)}</button>
<button type="button" class="act${st.saved ? ' on' : ''}" data-a="save" aria-label="Save">${svg(IC.b)}</button></div>`;

exports.script = loggedIn => `<script>(function(){var IN=${loggedIn ? 'true' : 'false'};
document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('.acts .act[data-a]');if(!b)return;e.preventDefault();var box=b.closest('.acts'),id=box.getAttribute('data-id'),a=b.getAttribute('data-a');
 if(a==='share'){var u=location.origin+'/news/'+id;if(navigator.share){navigator.share({url:u}).catch(function(){})}else if(navigator.clipboard){navigator.clipboard.writeText(u).then(function(){var s=b.querySelector('span');b.classList.add('on');setTimeout(function(){b.classList.remove('on')},1200)}).catch(function(){})}return}
 if(!IN){location.href='/login?next='+encodeURIComponent(location.pathname);return}
 fetch('/news/'+id+'/'+a,{method:'POST',credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){b.classList.toggle('on',!!j.on);var s=b.querySelector('span');if(s&&j.count!=null)s.textContent=j.count||''}).catch(function(){})});
})()</script>`;
