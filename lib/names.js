'use strict';
// A page has a main name (the course's own name, shown big) and a sub name (the course code, shown small underneath).
// The course code is also what places the page: level and semester are read from it.
exports.sub = (p, e) => p && p.code ? `<div class="subname">${(e || (s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))))(p.code)}</div>` : '';
