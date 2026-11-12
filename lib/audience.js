// Reading who an upload is for (departments and levels)
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { LEVELS, departmentNames, levelFromText } = ctx;
  function readAudience(body, titleHint) {
    const picked = (Array.isArray(body.dept) ? body.dept : body.dept ? [body.dept] : []).filter(d => departmentNames().includes(d));
    const level = String(body.level || 'auto');
    return {
      dept: picked.length ? picked.join(',') : null,
      level: level === 'auto' ? levelFromText(titleHint) : LEVELS.includes(Number(level)) ? Number(level) : null,
    };
  }
  return { readAudience };
};
