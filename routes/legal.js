// Privacy policy and terms pages
// Moved out of server.js unchanged. Everything it needs from the rest of the site is handed in below.
module.exports = function register(app, ctx) {
  const { AI, GOOGLE_ON, esc, layout } = ctx;
  app.get('/privacy', (req, res) => {
    const updated = new Date().toISOString().slice(0, 10);
    const contactEmail = (process.env.CONTACT_EMAIL || 'studieshub.org@gmail.com').replace(/^.*<([^>]+)>.*$/, '$1').trim();
    const emailProviders = [
      process.env.GOOGLE_REFRESH_TOKEN ? 'Google (Gmail)' : null,
      process.env.RESEND_API_KEY ? 'Resend' : null,
      process.env.BREVO_API_KEY ? 'Brevo' : null,
      process.env.SMTP_HOST ? 'our email server' : null,
    ].filter(Boolean);
    const aiProvider = AI === 'groq' ? 'Groq' : AI === 'claude' ? 'Anthropic' : null;
    const body = `<main class="auth privacy-policy" style="max-width:860px;width:100%;margin:24px auto;padding:clamp(18px,4vw,36px);border:1px solid var(--line);border-radius:22px;background:var(--card);box-shadow:0 12px 40px rgba(0,0,0,.12)"><style>.privacy-policy{line-height:1.7}.privacy-policy h1{font-size:clamp(28px,5vw,38px);line-height:1.15;margin:8px 0}.privacy-policy h2{font-size:19px;margin:28px 0 8px;padding-top:18px;border-top:1px solid var(--line)}.privacy-policy p{line-height:1.75}.privacy-policy li{margin:9px 0;padding-left:3px}.privacy-policy ul{padding-left:22px}.privacy-policy a{overflow-wrap:anywhere}.privacy-kicker{font-size:12px;letter-spacing:1.5px;font-weight:800;color:var(--accent,#64748b)}.privacy-contact{padding:16px;border:1px solid var(--line);border-radius:14px;background:var(--bg);overflow-wrap:anywhere}</style><header style="padding:4px 0 18px;border-bottom:1px solid var(--line);margin-bottom:18px"><p class="privacy-kicker">STUDIES HUB · PRIVACY & DATA</p><h1>Privacy Policy</h1><p class="mut" style="margin:0">Last updated ${updated}</p></header>

<p>This page explains, in plain language, what Studies Hub collects and why. It covers what this site actually does today -- nothing more, nothing hidden.</p>

<h2>What we collect</h2>
<ul>
<li><b>Account details:</b> your name and email address, and a password (we never store your actual password -- only a one-way scrambled/hashed version that can't be reversed).</li>
<li>${GOOGLE_ON ? '<b>Google sign-in:</b> if you use "Continue with Google," Google shares your name, email address, and whether Google has verified that email -- we don\'t see or store your Google password.' : ''}</li>
<li><b>A username</b> (like @yourname) that other members use to find and add you as a friend. It is visible to any logged-in member.</li>
<li><b>Student details:</b> your university, department and level, so we can show you the pages and CBT practice meant for your course. If you tell us you hold a position (like "Director of Socials"), that claim is checked by a school-authority admin before it shows beside your name.</li>
<li><b>Lecturer details:</b> if you register as a lecturer, we collect your institution and the courses you select, plus an optional staff/registration number. A full admin reviews your lecturer details before upload permissions are enabled.</li>
<li><b>Educational materials:</b> files or HTML learning materials you upload, their titles, course links, and the department/level audience you select.</li>
<li><b>Profile details you choose to add:</b> a profile picture, from the Settings page. Other logged-in members can see your profile (picture, username, university, department, level, verified position) and your online/offline status.</li>
<li><b>Activity used to run the site:</b> when you were last active, and, if you submit news or a payment claim, that submission and its status (pending/approved/rejected).</li>
<li><b>Friends and groups:</b> who you have sent or received a friend request with, who you are friends with, and any group you create or are added to (its name and member list).</li>
<li><b>Messages:</b> if you chat with a friend or in a group, your text messages, voice notes and stickers are stored so the conversation can be shown to the people in it -- including whether a message has been delivered or read, any reactions, edits, and deletions. If you build a sticker board, the pictures you add to it are stored for you.</li>
<li><b>Push notifications:</b> if you turn notifications on, your browser gives us a subscription address so we can alert your device about messages, friend requests, new uploads and similar activity. We never see the notification after it leaves our server -- only your browser can read what it says.</li>
</ul>

<h2>How we use it</h2>
<ul>
<li>To create and secure your account, verify your email, and let you reset your password.</li>
<li>To personalize your dashboard and show you educational materials sorted for your department and level.</li>
<li>To verify lecturer accounts, link lecturers to their selected courses, and publish the learning materials they choose to upload.</li>
<li>To show your name, photo, profile details and online/offline status to other logged-in members -- not to the public.</li>
<li>To let you find and message friends, and to run groups you are part of.</li>
<li>To send you a notification (if you turned them on) about things like a new message, friend request or upload.</li>
<li>To review content before it goes public: news you submit, a claimed school position, and payment claims are checked by an admin before they're approved. Some admins only handle one job (files, news, positions and departments, or helping people who can't log in); helping with login can include sending you a verification link or a password-reset code by email, or signing you out of your devices.</li>
</ul>

<h2>Payments</h2>
<p>Studies Hub does not use a card payment processor and does not collect your card or bank details. Some content is unlocked via manual bank transfer: we show our own account details, you pay directly through your own bank, and an admin manually confirms and unlocks the content. We don't see your banking information at any point in that process.</p>

<h2>Chat and messages</h2>
<p>You can only message someone once you are friends, or in a group you both belong to. Text messages, voice notes and stickers are stored encrypted (scrambled so a stolen copy of our database would be unreadable) -- but this is not "end-to-end" encryption. The site itself is still able to decrypt and read messages when needed, for example to look into abuse reports. Please don't send anything in chat you wouldn't want anyone but the people in that conversation to ever see. A group has its own admin, chosen by whoever creates it, who can add or remove members and rename the group.</p>

${aiProvider ? `<h2>The "Ask AI" assistant</h2><p>If you use the Ask AI assistant, your question and Studies Hub's reply are sent to ${aiProvider}, an outside AI provider, purely to generate that reply. We don't send your email, password, or profile details to them -- just the conversation you type.</p>` : ''}

<h2>Cookies</h2>
<p>We use one cookie to keep you logged in between visits. We don't use advertising or tracking cookies, and there are currently no ads on this site.</p>

<h2>Who else sees your data</h2>
<p>We share information only with the outside services that make the site work${emailProviders.length ? `, such as ${emailProviders.join(' and/or ')} for sending verification and password-reset emails` : ''}${GOOGLE_ON ? ', and Google for sign-in' : ''}${aiProvider ? `, and ${aiProvider} for the AI assistant` : ''}, plus our hosting provider, which stores the site's data on our behalf. We do not sell your data to anyone.</p>


<h2>Google API data and email sending</h2>
${process.env.GOOGLE_REFRESH_TOKEN ? `<p>When Studies Hub uses the Gmail API with the <code>gmail.send</code> permission, it uses that permission to send account-related emails such as verification links or password-reset messages. This permission does not allow Studies Hub to read, search, or delete Gmail messages. Google user data is used only for the feature disclosed to you and is not sold or used for targeted advertising.</p><p>Studies Hub does not use Google API data to train generalized AI or machine-learning models. Data received from Google APIs is handled in accordance with the Google API Services User Data Policy, including its Limited Use requirements.</p>` : `<p>When Google API services are enabled, Studies Hub will describe the specific Google data accessed, the purpose, and the permission requested before use. We do not request access to Gmail messages for reading or searching as part of the email-sending feature.</p>`}

<h2>Data protection and security</h2>
<ul>
<li><b>Password protection:</b> account passwords are stored as bcrypt hashes rather than in readable form.</li>
<li><b>Encrypted messages:</b> chat text, voice notes and sticker media are encrypted by the application using AES-256-GCM while stored. This is not end-to-end encryption; the application can decrypt messages to provide the service.</li>
<li><b>Secure transmission:</b> use the HTTPS version of Studies Hub to protect information sent between your device and the website.</li>
<li><b>Access controls:</b> account areas and administrative actions are restricted by sign-in and role checks within the application.</li>
<li><b>Limited collection and use:</b> information is used to operate the features described in this policy and shared with service providers only where needed to operate those features.</li>
</ul>
<p>We review and maintain safeguards appropriate to the information we handle. No online service can guarantee absolute security. Protection of stored data also depends on the security of the hosting environment, database access, and any configured encryption-key management.</p>

<h2>How long we keep it</h2>
<p>We keep your account and its data for as long as your account exists. We don't currently have an automatic "delete my account" button -- if you'd like your data reviewed, corrected, or removed, contact us (below) and we'll handle it by hand.</p>

<h2>Children</h2>
<p>Studies Hub is intended for students old enough to independently create an account and is not directed at young children.</p>

<h2>Changes to this policy</h2>
<p>If how we handle your data changes meaningfully, we'll update this page and change the date above.</p>

<h2>Contact us</h2>
<div class="privacy-contact"><b>Questions or data requests?</b><p style="margin:6px 0 0">To ask about your data or request a correction or deletion, email <a href="mailto:${esc(contactEmail)}">${esc(contactEmail)}</a>.</p></div>
</main>`;
    res.send(layout('Privacy Policy', body, req.user));
  });


   
  // Terms & Conditions -- separate public page; uses the existing layout and styling.
  app.get('/terms', (req, res) => {
    const updated = new Date().toISOString().slice(0, 10);
    const contactEmail = (process.env.CONTACT_EMAIL || 'studieshub.org@gmail.com').replace(/^.*<([^>]+)>.*$/, '$1').trim();
    const body = `<main class="auth privacy-policy" style="max-width:860px;width:100%;margin:24px auto;padding:clamp(18px,4vw,36px);border:1px solid var(--line);border-radius:22px;background:var(--card);box-shadow:0 12px 40px rgba(0,0,0,.12)"><style>.privacy-policy{line-height:1.7}.privacy-policy h1{font-size:clamp(28px,5vw,38px);line-height:1.15;margin:8px 0}.privacy-policy h2{font-size:19px;margin:28px 0 8px;padding-top:18px;border-top:1px solid var(--line)}.privacy-policy p{line-height:1.75}.privacy-policy li{margin:9px 0;padding-left:3px}.privacy-policy ul{padding-left:22px}.privacy-policy a{overflow-wrap:anywhere}</style><header style="padding:4px 0 18px;border-bottom:1px solid var(--line);margin-bottom:18px"><p class="privacy-kicker">STUDIES HUB · TERMS</p><h1>Terms &amp; Conditions</h1><p class="mut" style="margin:0">Last updated ${updated}</p></header>
<p>These Terms &amp; Conditions govern your access to and use of Studies Hub at studieshub.org. By creating an account or using the service, you agree to these terms. If you do not agree, do not use the service.</p>
<h2>1. About Studies Hub</h2><p>Studies Hub is an educational platform for students and lecturers to access, share and discuss learning materials, practice CBT-style exercises, publish approved news, and communicate with other members.</p>
<h2>2. Eligibility and accounts</h2><p>You must provide accurate information, keep your login details confidential, and use only your own account. You are responsible for activity carried out through your account and must notify us if you suspect unauthorized access.</p>
<h2>3. Student accounts</h2><p>Students must provide truthful details, including university, department, level and username where requested. Do not impersonate another student or misrepresent your academic status.</p>
<h2>4. Lecturer accounts</h2><p>Lecturer registration and upload privileges may require review and approval by a Studies Hub administrator. Registration does not guarantee verification or approval. Lecturers must provide accurate institutional and course information.</p>
<h2>5. Educational materials and accuracy</h2><p>Materials may be uploaded by users and may be incomplete, outdated, or inaccurate. Studies Hub does not guarantee that every file, answer, course label, or CBT question is correct. Use materials as learning aids and confirm important academic information with your institution or lecturer.</p>
<h2>6. User uploads and responsibility</h2><p>You are responsible for materials you upload, including their legality, accuracy, and suitability for the audience selected. Do not upload malware, unlawful material, private information about others without permission, or content that infringes another person's rights.</p>
<h2>7. Intellectual property</h2><p>You retain rights you hold in content you create. By uploading content, you give Studies Hub permission to host, store, display, and distribute it as needed to operate the features you choose. You must have permission to share third-party content. Respect copyright, school rules, and any applicable licences.</p>
<h2>8. CBT and assessments</h2><p>CBT features are for practice and learning unless a page explicitly states otherwise. Do not use the platform to cheat, impersonate another candidate, distribute confidential examination materials, or interfere with an assessment.</p>
<h2>9. News and public submissions</h2><p>News and other submissions may be reviewed before publication. Studies Hub may decline, restrict, or remove content that violates these terms, applicable law, or platform safety requirements.</p>
<h2>10. Messaging, stickers and voice notes</h2><p>Use chat respectfully and only to communicate with permitted friends or group members. Do not harass, threaten, defraud, impersonate, or share unlawful or non-consensual content. Messages are encrypted in storage but are not end-to-end encrypted; do not treat chat as a private vault.</p>
<h2>11. Groups and communities</h2><p>Group creators and authorized group administrators may manage membership and group details. Members must follow these terms and respect the privacy and rights of other participants.</p>
<h2>12. Payments and paid content</h2><p>Where paid content is offered, follow the payment instructions shown on the platform and submit truthful payment information. Access may be granted after manual confirmation or provider verification, as applicable. Do not submit false receipts or attempt to bypass payment controls. Any displayed price and refund arrangement shown for a particular transaction applies to that transaction.</p>
<h2>13. Third-party services</h2><p>Some features rely on third-party services such as email, hosting, authentication, AI, or calling providers. Their services may have separate terms and privacy practices. Studies Hub is not responsible for independent third-party systems beyond its reasonable control.</p>
<h2>14. Privacy</h2><p>Your use of Studies Hub is also governed by our <a href="/privacy">Privacy Policy</a>, which explains what information is handled, why it is used, and how to make a privacy request.</p>
<h2>15. Prohibited activities</h2><p>You must not attempt unauthorized access, disrupt the service, exploit vulnerabilities, reverse engineer or bypass access controls unlawfully, send spam, scrape personal information, upload malicious code, manipulate payment or verification processes, or use Studies Hub for unlawful activity.</p>
<h2>16. Moderation and enforcement</h2><p>Studies Hub may investigate reports, review content, restrict features, remove material, suspend accounts, or terminate access when reasonably necessary to protect users, comply with law, or enforce these terms.</p>
<h2>17. Availability and changes</h2><p>We aim to keep Studies Hub available but do not guarantee uninterrupted service. Features may be changed, suspended, or discontinued for maintenance, security, operational, or other legitimate reasons.</p>
<h2>18. Disclaimer</h2><p>To the extent permitted by applicable law, Studies Hub is provided on an “as available” basis. We do not guarantee that the service will always be error-free, that user content is accurate, or that every feature will meet every user's needs.</p>
<h2>19. Limitation of liability</h2><p>To the extent permitted by applicable law, Studies Hub and its operators are not liable for indirect or consequential losses arising from use of the service, reliance on user-uploaded materials, service interruption, or unauthorized activity beyond reasonable control. Nothing in these terms excludes liability that cannot legally be excluded.</p>
<h2>20. Your responsibility for claims</h2><p>You agree not to misuse the platform or violate another person's rights. Where permitted by law, you may be responsible for losses or claims caused by your unlawful conduct or material breach of these terms.</p>
<h2>21. Suspension and termination</h2><p>You may stop using Studies Hub at any time. We may suspend or terminate access for serious or repeated violations, security concerns, legal requirements, or misuse of the service. Data handling after account closure is described in the Privacy Policy and applicable law.</p>
<h2>22. Governing law</h2><p>These terms are intended to be governed by the laws of the Federal Republic of Nigeria, subject to any mandatory legal protections that apply to a user.</p>
<h2>23. Disputes and severability</h2><p>If a concern arises, contact us first so we can try to resolve it. If any provision of these terms is found unenforceable, the remaining provisions continue to apply to the extent permitted by law.</p>
<h2>24. Changes and contact</h2><p>We may update these terms when the service or legal requirements change. The updated date above indicates the latest version. Continued use after an update means you accept the revised terms where permitted by law.</p><p>Questions about these terms? Email <a href="mailto:${esc(contactEmail)}">${esc(contactEmail)}</a>.</p>
</main>`;
    res.send(layout('Terms & Conditions', body, req.user));
  });
};
