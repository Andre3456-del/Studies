// Helpers for uploaded pages: video links, paywall, page cards, previews
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { FLW_ON, PRICE_KOBO, can, db, esc } = ctx;
  function youtubeId(url) {
    const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([a-zA-Z0-9_-]{11})/.exec(String(url || ''));
    return m ? m[1] : null;
  }
  // A video uploaded from a phone: the browser's own label is trusted only when it names a real video type; otherwise the file
  // ending decides (some phones send nothing useful). Anything else is refused, so a page can never be passed off as a video.
  function videoMimeOf(file) {
    const m = String((file && file.mimetype) || '').toLowerCase();
    if (/^video\/(mp4|quicktime|webm|x-matroska|3gpp2?|x-m4v|mpeg|ogg)$/.test(m)) return m;
    const e = /\.(mp4|m4v|mov|webm|mkv|3gp|3g2|mpeg|mpg|ogv)$/i.exec(String((file && file.originalname) || ''));
    return e ? ({ mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', '3gp': 'video/3gpp', '3g2': 'video/3gpp2', mpeg: 'video/mpeg', mpg: 'video/mpeg', ogv: 'video/ogg' })[e[1].toLowerCase()] : null;
  }
  const hasPurchased = (userId, pageId) => !!db.prepare("SELECT 1 FROM purchases WHERE user_id=? AND page_id=? AND status='approved'").get(userId, pageId);
  const purchaseFor = (userId, pageId) => db.prepare('SELECT * FROM purchases WHERE user_id=? AND page_id=?').get(userId, pageId);
  function canViewPage(page, user) {
    if (page.paid) return !!user && (can.pages(user) || hasPurchased(user.id, page.id));
    if (page.members_only) return !!user;
    return true;
  }
  // A picture upload must really be a JPG or PNG (checked by its first bytes, not just its name).
  function isImageUpload(f) { const b = f && f.buffer; return !!b && b.length > 8 && ((b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)); }
  const KIND_META = { html: ['🌐', 'Page'], cbt: ['📝', 'CBT'], pdf: ['📄', 'PDF'], doc: ['📃', 'Document'], video: ['▶️', 'Video'], image: ['🖼️', 'Image'] };
  function pageCard(p) {
    const [icon, label] = KIND_META[p.kind] || KIND_META.html;
    const chip = p.paid ? '<span class="chip pay">Pay</span>' : '';
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
    if (!home) return h;
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
      action = '<p class="err" style="margin:0">Payments are not available right now. Please try again a little later.</p>';
    } else {
      const back = req.query && req.query.paid;
      const waiting = back === '1' && db.prepare("SELECT 1 FROM flw_payments WHERE user_id=? AND kind='page' AND item_id=? AND status='pending' AND created_at>?").get(req.user.id, p.id, Date.now() - ctx.FLW_WINDOW);
      action = (back === 'cancelled' ? '<p class="mut" style="margin:0 0 10px">The payment was not completed. You can try again.</p>' : '')
        + (waiting ? '<p class="pill pending" style="margin:0 0 10px">Confirming your payment&hellip;</p><p class="mut" style="margin:0 0 10px">This page unlocks by itself as soon as the payment is confirmed. You do not need to do anything.</p><script>setTimeout(function(){location.reload()},7000)</script>' : '')
        + `<form method="post" action="/pay/start"><input type="hidden" name="slug" value="${esc(p.slug)}"><button class="btn" style="width:100%">Continue to payment</button></form>`;
    }
    return `<div class="dash-hero"><p class="eyebrow" style="margin:0">Locked</p><h1 style="margin:.2em 0">${esc(p.title)}</h1><p class="mut" style="margin:0">This content needs a one-time payment to unlock.</p></div>
<div class="card" style="text-align:center"><p style="font-size:32px;font-weight:700;margin:8px 0">₦${priceNgn.toFixed(0)}</p>${action}</div>`;
  }
  return { KIND_META, canViewPage, hasPurchased, isImageUpload, pageCard, paywallBody, preparePage, videoMimeOf, youtubeId };
};
