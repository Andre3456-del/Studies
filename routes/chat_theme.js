// Settings > Chat: the background used in all your chats (each chat can still have its own from the paint button inside it).
const T = require('../lib/chat_theme');
module.exports = function register(app, ctx) {
  const { layout } = ctx;
  app.get('/settings/chat', (req, res) => {
    if (!req.user) return res.redirect('/login?next=/settings/chat');
    res.set({ 'Cache-Control': 'no-store' });
    res.send(layout('Chat', `<p class="mut"><a href="/settings">&larr; Settings</a></p><h1>Chat background</h1>
<div id="shwBox" style="margin-top:14px"></div><p class="mut" style="margin-top:16px;font-size:13px">&#128274; Only you see this.</p>
<script>${T.js};SHW.picker(document.getElementById('shwBox'),'',function(){var b=document.getElementById('shwBox');b.style.outline='2px solid #38b0f8';setTimeout(function(){b.style.outline=''},700)});SHW.apply(SHW.mine(''))</script>`, req.user));
  });
};
