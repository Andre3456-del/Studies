// The "I accept the Terms and Privacy Policy" tick on sign-up. The Create account button stays dimmed until it is ticked
// (the page script in ui_theme.js looks for data-gate); the server also refuses a sign-up that was not ticked.
module.exports = `<label class="agree"><input type="checkbox" name="agree" value="1" data-gate required><span class="agbox" aria-hidden="true"></span><span>I accept the <a href="/terms" target="_blank" rel="noopener">Terms &amp; Conditions</a> and the <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</span></label>`;
