// The look of the whole site, in one place: true black, thin lines, round pictures, big images, icons first, little text.
// It is added after the normal styles, so it only changes colours, spacing and shapes (nothing else is touched).
exports.css = `
/* ===== New look: black, flat, picture-first ===== */
:root{--bg:#000;--panel:#0b0b0f;--line:rgba(255,255,255,.12);--fg:#f2f5fa;--mut:#8b94a7;--blue:#1d9bf0;--blue2:#1a8cd8}
:root[data-theme="light"]{--bg:#fff;--panel:#f6f8fb;--line:rgba(15,25,40,.12);--fg:#0f1419;--mut:#5b6877;--blue:#1d9bf0;--blue2:#1a8cd8}
body{background:var(--bg)}
.top{background:rgba(0,0,0,.82)!important;border-bottom:1px solid var(--line)!important;backdrop-filter:blur(14px)}
:root[data-theme="light"] .top{background:rgba(255,255,255,.85)!important}
.brand{font-weight:800;letter-spacing:-.2px}
/* Helper sentences under titles: gone (things label themselves). */
.hint,main>p.mut:not(:only-child),.pushbar span+span{display:none!important}
/* Cards: flat rows with thin lines, like X / Threads */
.card{background:transparent!important;border:0!important;border-bottom:1px solid var(--line)!important;border-radius:0!important;padding:14px 4px!important;margin:0!important}
.news-card{background:transparent;border:0;border-bottom:1px solid var(--line);border-radius:0;margin:0;padding:14px 0}
.news-img{border-radius:16px;aspect-ratio:16/9;border:1px solid var(--line)}
.news-meta{font-size:13px}
/* Chat list: WhatsApp / Telegram rows, big round pictures */
.chat-item{border-radius:0;padding:10px 12px;border-bottom:1px solid var(--line)}
.chat-item:hover{background:rgba(255,255,255,.05)}
.chat-item .av .avatar,.chat-item .av img{width:54px;height:54px}
.chat-item .meta b{font-size:16px}
.chat-item .meta span{font-size:14px}
.chat-item .av .dot{width:13px;height:13px;border-color:#000}
/* Pills: like YouTube chips */
.chip-row{gap:8px}.chip{box-shadow:none;background:rgba(255,255,255,.1);border:0;color:var(--fg);padding:7px 14px}
.chip.on{background:var(--fg);color:#000}
:root[data-theme="light"] .chip{background:rgba(15,25,40,.07)}
:root[data-theme="light"] .chip.on{background:#0f1419;color:#fff}
/* Buttons: round, one accent colour */
button,.btn{border-radius:999px;font-weight:700}
.chip,.chip.on{box-shadow:none!important}
/* Bottom bar: solid black, filled look when selected, small dot badge, no outline */
body.has-tabbar .tabbar{background:#000;border-top:1px solid var(--line);backdrop-filter:none}
:root[data-theme="light"] body.has-tabbar .tabbar{background:#fff}
.tabbar a,.tabbar button{color:var(--mut);border-radius:0}
.tabbar a.on{color:var(--fg)}.tabbar a.on .ico{stroke-width:2.6;fill:currentColor;fill-opacity:.18}
.tabbar .nbadge{background:#f4212e;color:#fff;border:2px solid #000;min-width:18px;height:18px;line-height:14px}
/* Full-screen phone menu: icon tiles instead of long boxes */
@media (max-width:1023px){
 .drawer{background:#000}
 .drawer-top{background:#000}
 .drawer-user{background:transparent;border:0;border-bottom:1px solid var(--line);border-radius:0;margin:0;padding:16px}
 .drawer-item{background:transparent;border-radius:12px;margin:0 8px;padding:14px 12px;font-size:19px;font-weight:700}
 .drawer-item.active{background:transparent;color:var(--fg)}
 .drawer-item .ico{width:26px;height:26px}
}
@media (min-width:1024px){.drawer{background:#000;border-right:1px solid var(--line)}.drawer-item{font-weight:600}.drawer-item.active{background:transparent;font-weight:800}}
/* Pictures first: round avatars everywhere, no glow */
.avatar{box-shadow:none}
/* Chat bubbles: WhatsApp / Telegram colours */
:root:not([data-theme="light"]) .bubble.me{background:#005c4b;color:#fff}
/* Inputs: dark pill fields */
input:not([type=checkbox]):not([type=radio]),textarea,select{background:#0b0b0f;border-color:var(--line)}
:root[data-theme="light"] input:not([type=checkbox]):not([type=radio]),:root[data-theme="light"] textarea,:root[data-theme="light"] select{background:#fff}
/* Page title is already in the top bar: no second big title */
main>h1:first-of-type{display:none}
@media (min-width:1024px){main>h1:first-of-type{display:block}}
/* Settings: round icon + one word, like Telegram */
.card.row .sub{display:none}
.sico{flex:none;width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.09);display:flex;align-items:center;justify-content:center;font-size:20px}
.card.row b{font-size:17px;font-weight:600}
/* Profile header (dashboard): compact like a Threads profile */
.dash-hero{background:transparent!important;border:0!important;border-bottom:1px solid var(--line)!important;border-radius:0!important;box-shadow:none!important;padding:8px 0 18px!important}
.dash-hero:before,.dash-hero:after{display:none!important}
.dash-top .avatar,.dash-top .drawer-av-img{width:64px!important;height:64px!important}
.dash-top h1{font-size:22px}
/* News: "What's happening?" composer row like X */
.composer{padding:10px 4px!important}
.composer summary{list-style:none;display:flex;align-items:center;gap:12px;cursor:pointer}
.composer summary::-webkit-details-marker{display:none}
.composer .avatar,.composer .drawer-av-img{width:42px;height:42px;font-size:16px;border-radius:50%;object-fit:cover;flex:none}
.cpill{flex:1;color:var(--mut);font-size:18px}
.cgo{width:38px;height:38px;border-radius:50%;background:var(--blue);color:#fff;display:flex;align-items:center;justify-content:center;font-size:17px}
`;