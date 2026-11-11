// The "Sponsored" cards shown on the public home page and in News: picture, video or audio, a title, the text, and how to reach the advertiser.
// Only the columns that are needed are read, so a big video is never loaded just to draw the list.
module.exports = function sponsorCards({ db, esc, linkify, user, limit = 5 }) {
  const rows = db.prepare("SELECT id, user_id, title, body, contact, media_kind, media_mime, length(media_data) AS media_len, image_data IS NOT NULL AS has_image FROM sponsor_posts WHERE status='approved' AND expires_at > datetime('now') ORDER BY id DESC LIMIT ?").all(limit);
  return rows.map(s => {
    let media = '';
    if (s.media_len && s.media_kind === 'video') media = `<video class="news-img" controls playsinline preload="metadata" src="/sponsor-media/${s.id}?v=${s.media_len}" style="margin-bottom:8px;width:100%;max-height:420px;background:#000"></video>`;
    else if (s.media_len && s.media_kind === 'audio') media = `<audio controls preload="none" src="/sponsor-media/${s.id}?v=${s.media_len}" style="width:100%;margin-bottom:8px"></audio>`;
    else if (s.media_len) media = `<img class="news-img" src="/sponsor-media/${s.id}?v=${s.media_len}" alt="" style="margin-bottom:8px">`;
    else if (s.has_image) media = `<img class="news-img" src="/sponsor-image/${s.id}" alt="" style="margin-bottom:8px">`;
    const mine = user && s.user_id && user.id === s.user_id;
    return `<div class="card" style="border-color:#ffd166"><p class="pill" style="background:#ffd16622;border-color:#ffd16655;color:#ffd166">Sponsored</p>${media}<h3 style="margin:4px 0">${esc(s.title)}</h3><p class="mut" style="white-space:pre-wrap">${linkify(s.body)}</p>${s.contact ? `<p class="mut" style="margin:4px 0 0">${linkify(s.contact)}</p>` : ''}${mine ? `<a class="btn" href="/sponsor/${s.id}/edit" style="display:block;text-align:center;margin-top:12px">Edit post</a>` : ''}</div>`;
  }).join('');
};
