// The page a visitor (not logged in) sees first: what Studies Hub is, and two clear buttons.
const ic = p => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
const F = [
  ['Course materials', 'Notes, slides and past questions for your department.', '<path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5C4.7 20 4 19.3 4 18.5z"/><path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H13v16h5.5c.8 0 1.5-.7 1.5-1.5z"/>'],
  ['CBT practice', 'Practise with timed questions before the exam.', '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="m9 12 2 2 4-4"/>'],
  ['Chat', 'Message coursemates, make groups, call.', '<path d="M20 12a8 8 0 0 1-11.7 7.1L4 20l1-4A8 8 0 1 1 20 12z"/>'],
  ['Campus news', 'What is happening on your campus today.', '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>']
];
module.exports = `<style>.vh{max-width:880px;margin:0 auto;padding:18px 0 8px;text-align:center}.vh img.vl{width:76px;height:76px;border-radius:20px}.vh h1{font-size:clamp(26px,6vw,40px);line-height:1.15;margin:14px auto 10px;max-width:680px}.vh p.vs{color:var(--mut);max-width:560px;margin:0 auto 20px;line-height:1.6}.vh .vb{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}.vh .vb a{display:inline-flex;align-items:center;justify-content:center;min-width:150px;height:50px;padding:0 26px;border-radius:26px;font-weight:700;text-decoration:none}.vh .vb .go{background:linear-gradient(180deg,var(--blue),var(--blue2));color:#04122b}.vh .vb .lo{border:1.5px solid var(--blue);color:var(--blue)}.vf{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:26px 0 12px;text-align:left}.vf div{padding:16px;border:1px solid var(--line);border-radius:18px;background:var(--panel)}.vf svg{width:30px;height:30px;fill:none;stroke:var(--blue);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.vf b{display:block;margin:10px 0 4px}.vf span{color:var(--mut);font-size:14px;line-height:1.45}.vh .vm{font-size:14px;color:var(--mut)}</style>
<section class="vh"><img class="vl" src="/logo.png?v=2" alt="Studies Hub"><h1>Studies Hub: free study materials for Nigerian university students</h1>
<p class="vs">Find course materials, past questions, timetables and campus news in one place, and chat with your coursemates.</p>
<div class="vb"><a class="go" href="/signup">Create account</a><a class="lo" href="/login">Log in</a></div>
<div class="vf">${F.map(f => `<div>${ic(f[2])}<b>${f[0]}</b><span>${f[1]}</span></div>`).join('')}</div>
<p class="vm"><a href="/about">About us</a> &middot; <a href="/how-it-works">How it works</a> &middot; <a href="/guides">Study guides</a></p></section>`;
