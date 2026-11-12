// Who may verify a position claim
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { facultyOf } = ctx;
  function canVerifyClaim(verifier, claimant) {
    if (!verifier || verifier.position_status !== 'approved' || !verifier.position_can_verify || !verifier.position_scope) return false;
    if (verifier.university && claimant.university && verifier.university !== claimant.university) return false; // a verifier only covers their own university
    if (verifier.position_scope === 'own') return claimant.department === verifier.department && Number(claimant.level) === Number(verifier.level);
    if (verifier.position_scope === 'department') return claimant.department === verifier.department;
    if (verifier.position_scope === 'faculty') { const f = facultyOf(verifier.department); return !!f && facultyOf(claimant.department) === f; }
    return true; // school-scoped verifier (rare -- central admin normally covers this) can verify anyone
  }
  return { canVerifyClaim };
};
