# Studies Hub

A study hub for a university: sign up, get sorted into your department and level, browse pages and CBT practice made just for you, read news, and chat with friends and groups — with push notifications. One Node.js app, one file. Needs Node.js 22.13 or newer (no native modules, so it installs anywhere).

## What is inside

- **Home (`/`) is the news feed** for anyone not logged in — just the news cards, nothing else, no share form. **Logging in takes you straight to your Dashboard.**
- **Dashboard (`/dashboard`):** your greeting, then picture previews of every upload sorted for you — split into **Available to you** (free, plus anything you've paid for) and, only if you have any, **Locked — pay to view** (CBT practice you haven't unlocked yet).
- **Sign-up details (`/welcome`):** right after verifying their email (or signing in with Google), a student is asked for a **username**, **university**, **department** and **level**; anyone can also claim a **position** (e.g. "Director of Socials"), which a full admin checks before it shows next to their name. Nothing else on the site is reachable until this is filled in. Staff accounts (any admin role) only need a username.
- **Sorted uploads:** every upload is either for *everyone*, for one or several *departments* (tick as many as apply when uploading), for one *level*, or both. A student only ever sees what matches their own department and level. Course-code levels are auto-detected from the title (`GST 121` → 100 level) or can be set by hand. Change who an existing upload is for any time from `/admin`.
- **Pages:** upload HTML files, PDFs, Word documents, YouTube videos or CBT (quiz) HTML in `/admin`. Each page lives at `/p/<name>`, open to everyone, members-only, or sorted to a department/level.
- **Pay-to-view is CBT-only:** a full admin can mark a **CBT upload only** as "Payment to view" (₦100 by default, `PRICE_NGN` to change it). Nothing else can be paid content. There's no payment gateway — the visitor sees your bank transfer details, sends the money, and taps "I have made this payment," which creates a pending claim for a full admin to approve by hand in `/admin`.
- **Accounts:** email + password sign-up with a verification link, plus **Continue with Google**.
- **Admin roles:** `donryscott28@gmail.com` is the permanent central admin, and the only account that can create or change admins (dropdown in `/admin` → Users). Six roles: **User**; **Partial admin** (upload/manage plain HTML pages); **Files admin** (upload/manage every kind of file); **News admin** (post news, approve or reject what members submit); **Login-help admin** (verify someone by hand, resend a verification link, email a password-reset code, sign someone out everywhere — never sees the code, can't touch full admins, can't remove users or change roles); **Full admin** (everything, including payments, positions and departments). Only a full admin verifies a claimed position or edits the department list.
- **Who's online:** in `/admin` and in Chat, a green dot means active in the last two minutes.
- **Forgot password:** a 6-digit code emailed to the user (valid 10 minutes, 5 tries).
- **Email:** sent through Gmail with the Gmail API over HTTPS (works on Railway). Resend, Brevo or SMTP also work.
- **Push notifications:** built in, no third-party service — messages, friend requests, new uploads sorted for you, news, and payment/position approvals all push straight to the browser or phone, even with the site closed. No extra account or API key needed; it self-generates its own keys on first run.
- **Installable:** Studies Hub has an app icon and manifest, so "Add to Home Screen" / "Install" works like a real app, using your logo.
- **AI assistant:** an "Ask AI" button for logged-in members (not shown inside Chat), powered by Groq or Claude.
- **Storage:** SQLite in `data/site.db` (accounts, pages, messages, everything).

## Navigation, News, Settings

- **Sidebar:** tap ☰ (top left, every page) — Home, and once logged in, Dashboard, News, Browse pages, Chat, Settings, plus whichever admin links your role allows.
- **News (`/news`):** public reading, no account needed. Any logged-in member can submit a post ("Share something") with an optional real uploaded picture; it waits for a news admin's approval, who can also **edit** it any time afterward (title, text, or picture) from `/admin`. Tapping a card opens the full picture and text — exactly as typed or pasted, real line breaks kept, nothing squashed together, and any http(s) link inside it becomes a real, tappable, underlined link that opens in a new tab. The same goes for links typed in chat.
- **Settings (`/settings`):** name, username, university, department, level, a profile picture, and a claimed position (if any).
- **Profiles (`/u/:id`):** any logged-in member can view another's picture, username, university, department, level, verified position/title and their news — with a Message button once you're friends. Email is never shown.
- **Privacy Policy (`/privacy`):** a public page, linked from a footer at the very bottom of the public home page, the login page and the sign-up pages only (nowhere inside the site), plainly describing what the site collects — sign-up details, chat (encrypted at rest, not end-to-end), push notifications, the AI assistant, cookies, and who your data is shared with. This is a good-faith description, not legal advice — have it checked for your jurisdiction (e.g. Nigeria's NDPA).

## Chat: friends, groups, and everything WhatsApp-style

- **Friends first:** open Chat → **Find people** to search by `@username` or name and send a friend request; the other person accepts it from the same tab (with a badge showing how many requests are waiting, "15+" past fifteen). Only friends can message each other. The **Chats** tab lists your friends (online or not) and groups, each with an unread-count badge; the same badge total shows on the Chat nav link and the menu button.
- **Groups:** made from your friends (Chat → **+ New group**), with their own picture (tap it on the group info page to change it). The creator is the group's first admin, and any admin can rename the group, add friends, remove members, or make another member an admin too (a group can have more than one, and the last remaining admin can't be demoted). If an admin leaves, the next member is promoted automatically, and an empty group is deleted. Tap a member's name in a group message to see who sent it, or the group's name/picture in the thread for the full group-info page.
- **Messages** can be text, a **voice note** (tap the mic, tap Send — needs microphone permission), a **photo or any file**, or a **sticker**. The smiley button opens an emoji picker and your personal sticker board -- add pictures one at a time or several at once, or drop in a **.zip of pictures** and every image inside it is unzipped straight onto your board. Stickers live on your own phone (see "Writing space and storage limits" below), so there's no size or count cap any more. Tap a sticker to send it, and tap "+ Save sticker" on one someone sends you.
- **The message box grows** as you type more than one line, up to a point (then it scrolls inside itself). Press **Enter for a new line** -- send with the **Send** button, same as any multi-line message box.
- **Delivery ticks** on your own sent messages, in the chat and next to the last message in the Chats list: a clock = still waiting for a connection to send (it stays after a refresh until it goes); one **red** tick = sent, the person hasn't been online since; two **red** ticks = delivered (they've been online since it was sent -- this is saved, so it never goes back to one tick when they go offline); two **green** ticks = read. A message only counts as read while the person's chat is actually on screen (not in a background tab), and ticks update live without a refresh. The time and tick sit at the bottom-right of each message.
- **Replies look like WhatsApp:** a coloured bar, the sender's name and the quoted text; replying to a **sticker or photo** shows the actual picture beside the quote, and replying to a **voice note** shows "Voice note · 0:14". The same preview shows above the message box while you reply. Voice and video call buttons are small icons at the right of the chat header.
- **Attachments:** tap 📎 to send a photo or any file from your gallery or phone storage (up to 20 MB) -- photos show inline, other files show as a named, downloadable card.
- **React, edit, delete:** tap a message's actions to react with an emoji, edit your own text (voice notes and stickers can't be edited), delete it just for yourself, or — if you sent it — delete it for everyone (it's replaced with "This message was deleted" and the stored content is actually wiped, not just hidden).
- **Encryption:** every message (text, voice, sticker) is stored **encrypted at rest** (AES-256-GCM) — a stolen copy of the database is unreadable. This is **not end-to-end encryption**: the server can still decrypt messages, e.g. to look into abuse reports. True end-to-end encryption is a bigger, different feature with a real trade-off (a lost device can mean unrecoverable messages) — ask if you want that built instead.

## Push notifications

No setup needed — it's built into the app itself (Web Push, VAPID keys generated once and stored in the database) rather than a third-party push service, so there's no extra account, API key, or monthly limit. The first time a logged-in member is shown the "Turn on notifications" bar (or taps the button in Settings), their browser asks permission; once granted, the site can notify their device about new messages, friend requests, uploads sorted for them, news, and payment/position approvals, even with the site closed. `Settings` also has a manual "Turn on notifications" button. Because it's self-contained, this works out of the box on Railway with no extra Variables.

The same service worker also shows a branded "You're offline" page (`/offline.html`) if a page fails to load with no connection, instead of the browser's blank default error.

**Works properly with no connection, not just a fallback page:**
- **Browsing** — every page you successfully open is remembered, so opening it again with no signal shows what you last saw instead of an error. A page you've never opened before still falls back to the "You're offline" page.
- **Chat** — type and send a message with no connection (or it fails mid-send) and it shows with a small ⌛ instead of a tick. It's saved on the phone and sent for real the moment a connection is back, even if the app has been closed in the meantime (on browsers that support Background Sync; otherwise it sends as soon as the app is reopened online).
- **Admin uploads** — tap Upload with no connection and you'll see "Saved on your device" instead of an error. The file and everything you filled in are kept and uploaded automatically once you're back online -- the admin page refreshes itself when that happens.

## App Capabilities (PWA Builder)

Six of PWA Builder's "App Capabilities" are wired up:
- **Shortcuts** — long-press the installed icon for quick jumps to Dashboard, Chat, News, and Settings.
- **Launch handler** — re-opening the app (from a notification, a share, the icon) focuses the existing window instead of opening a duplicate.
- **Share target** — share a link, some text, or a photo from any other app "to Studies Hub," and it lands on a pre-filled News post for you to finish and submit (goes through the same admin approval as any other post).
- **File handlers** — "Open with Studies Hub" on a PDF or Word file in the phone's file manager lands a files/full admin straight on the upload form with that file already attached.
- **Protocol handler** — registers `web+studieshub://`, a foundation for deep links (e.g. from a QR code) that open straight inside the installed app.
- **Window controls overlay** — a small polish for anyone who installs the site on a laptop/desktop, giving the app its own header instead of a plain browser-style window.

The remaining ones from PWA Builder's audit are now in too:
- **Periodic Background Sync** (Service Worker section) — on phones that support it, the app quietly refreshes Dashboard/News/Chat in the background every so often, so offline browsing shows something fresher than whatever was last open. The browser decides if and how often this actually runs; there's no way to force it.
- **Widgets** — a "Studies Hub News" card for the Windows 11 Widgets Board, showing the 3 latest approved posts, tapping through to News. Built correctly per Microsoft's spec, but realistically **Windows-only** — it won't appear for an Android phone at all.
- **Edge Side Panel** and **Tabbed Display** — one-line manifest additions for anyone who installs the site in Edge on a laptop. No visible effect on a phone.
- **Note Taking** — Windows' global "new note" shortcut opens straight to the News "Share something" form, the closest match the site has to jotting something down. Also desktop-only.

Honest summary: every item PWA Builder listed is now implemented. The ones that matter day-to-day for your actual students (Shortcuts, Share Target, File Handlers, Launch Handler, Background Sync, Offline Support) are real, tested features. The Windows-desktop-only ones (Widgets, Edge Side Panel, Tabbed Display, Note Taking, Window Controls Overlay) are correctly built to spec but will go unseen by anyone browsing on a phone.

## Run it on your computer

```
npm install
ADMIN_PASSWORD='a-long-password' npm start
```

Open http://localhost:3000. Log in at `/login` as `donryscott28@gmail.com` with whatever `ADMIN_PASSWORD` you set — set your own real password there, never write it into `server.js`. `ADMIN_PASSWORD` re-applies on every start, so changing it (on Railway: edit the Variable and redeploy) always takes effect, even for an account created earlier.
Without email settings, verification links and reset codes print in the terminal instead of being emailed, and `/admin` has a "verify now" button.
On an Android phone the same works in Termux (`pkg install nodejs unzip`, unzip this folder, `npm install`, `npm start`).

## Put it online with Railway (no GitHub needed)

```
npm i -g @railway/cli
railway login
cd html-hub
railway init
railway up
```

If `railway up` asks for a service, create one. Then in the Railway dashboard, open the service:

1. **Networking**: click "Generate Domain" (your public https address).
2. **Volume**: add one, mount path `/data` (keeps accounts, pages, messages between deploys).
3. **Variables**: add the ones in `env.example`, then redeploy. At minimum: `ADMIN_PASSWORD`, `NODE_ENV=production`, `RAILPACK_NODE_VERSION=22`, `BASE_URL`.

Never paste keys or secrets into chats or commit them; put them only in Railway Variables.
To use GitHub instead, push this folder to a repo and choose "Deploy from GitHub repo".
Railway blocks SMTP on Free, Trial and Hobby plans; that is why email goes out over HTTPS (Gmail API).

## Google sign-in and Gmail sending

1. In console.cloud.google.com, create a project and enable the **Gmail API**.
2. OAuth consent screen: External, add donryscott28@gmail.com as a test user. Before you go live, click "Publish app": in Testing mode, refresh tokens can expire after 7 days.
3. Credentials > Create OAuth client ID > Web application. Authorized redirect URIs:
   `https://YOUR-DOMAIN/auth/google/callback` and `https://developers.google.com/oauthplayground`
4. Put the client ID and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
5. Get the refresh token: open developers.google.com/oauthplayground, click the gear, tick "Use your own OAuth credentials", paste the ID and secret. In step 1 enter the scope `https://www.googleapis.com/auth/gmail.send`, authorize with donryscott28@gmail.com, click "Exchange authorization code for tokens", and copy the refresh token into `GOOGLE_REFRESH_TOKEN`.
6. Set `EMAIL_FROM=donryscott28@gmail.com`.

Each part turns on only when its variables are set. No Google variables means no Google button, and email falls back to Resend, Brevo, SMTP, or the console.

## AI assistant

Set one of these in Variables:

- `GROQ_API_KEY` from console.groq.com (default model `llama-3.3-70b-versatile`)
- `ANTHROPIC_API_KEY` from console.anthropic.com (default model `claude-haiku-4-5-20251001`)

Optional: `AI_MODEL` to pick a different model. Only logged-in members see the "Ask AI" button (not inside Chat), each limited to 20 questions per 10 minutes.

## Uploading pages

In `/admin`, every upload can be aimed at **all departments or one**, and **all levels or one** (or auto-detected from a course code like `GST 121` in the title). Each opens full-screen exactly as you designed it, for whoever it's sorted for (members-only pages ask for login first; sorted pages tell a mismatched visitor plainly that it isn't for their department or level). The site adds only a small "Studies Hub" back button and, if your file has none, a mobile viewport tag.
Best results: one self-contained file, with CSS, JavaScript and images inside it or loaded from full https:// links. Files that point to other uploaded files (like `style.css` or `about.html`) will not find them. Limit: 5 MB per file (20 MB for the whole request).

## Departments and positions

Full admins manage the department list in `/admin` (Positions & departments) — it seeds itself with University of Uyo's faculties and departments on first run, and you can add or remove entries any time; the list feeds both sign-up and the upload form's "who is this for?" picker, which lets you tick more than one department (leave all unticked for every department). When a member claims a position (in Settings), it shows up for verification — but not necessarily to a full admin.

**Verification is a real chain, not a single admin queue.** A full admin verifies the first person at the top of a scope (say, a Faculty President) and can tick "let them verify others too." From then on, that person sees their own small "waiting on you" list right on `/admin` and can verify anyone within their own scope directly — no central admin involved. If that person also gets verify-power, the chain keeps going: a Faculty President can verify Department Presidents in their faculty, who can then verify Class Representatives in their own department, who can then verify further claims in their own department+level. A claim with no eligible delegate yet simply falls back to a full admin, so nothing ever gets stuck.

Verifying someone sets three things:
- **How far their news posts reach** — their own department + level only, their whole department (every level), their whole faculty (every department in it), or the whole school.
- **What it grants automatically** — News admin, Files admin, Observer (read-only -- see below), or nothing beyond the title. This only ever *upgrades* a plain member; someone who already holds a special role is never demoted by a lesser position being verified for them.
- **Whether they can verify others too**, and if so, at what scope — capped so no one can hand out reach wider than their own (a department president can't grant someone school-wide reach, even by mistake).

A Director of Academics (or anyone else) can separately be set to need one specific person's sign-off on their posts — e.g. their faculty's Director of Information — rather than going through the general news queue; that person's approval (from a small queue on their own News page) publishes it directly.

Anyone with real posting power from a verified position gets a small blue ✓ next to their name — on news, their profile, wherever their title shows.

**The Observer role** is for someone like a SUG President: a real admin login, but read-only. They can open `/admin` and see the same counts and verified-position list a full admin would, but there is no upload form, no approve/reject button, nothing that changes anything — and that's enforced at the route level, not just hidden in the page.

**End of a session,** the **central admin only** (not any other full admin) can click "Advance everyone to the next level" in `/admin` to move every student up one level at once (100→200, 200→300, and so on). Students already at the top level are left as they are — there's no "graduated" state yet.

## Ads and sponsor posts

The public **home page** carries your Google AdSense snippet (and Google's `google-adsense-account` meta tag) in its `<head>`, so AdSense's site check finds it; `/ads.txt` is served too. The News section loads the same script, so Auto ads can run in both once turned on in your AdSense dashboard. To show ad cards **inside the home news feed** (after the first story, then after every 4th, styled like a news card and labelled "Advertisement"), create an **In-feed** ad unit in AdSense and set `ADSENSE_FEED_SLOT` (and `ADSENSE_FEED_LAYOUT_KEY`, if AdSense gives one) in your Railway variables.

Separately, anyone logged in can pay **₦2000 (`SPONSOR_PRICE_NGN` to change it) to advertise a business or service** for 30 days at `/sponsor` — title, description, contact info, optional photo. It works exactly like the CBT payment flow: pay by bank transfer, tap "I've paid," a full admin confirms it in `/admin`, and it goes live in News (clearly marked "Sponsored") until it quietly expires 30 days later. The person who submitted it can edit it any time from their own post's page — while waiting on payment or even after it's already live (a live edit shows right away, no re-approval or re-payment needed).

## Writing space and storage limits

- **News posts** can now run up to 2,000,000 characters (up from 600) -- plenty of room for a full write-up, not just a short update.
- **Stickers now live on your own phone** (in the browser's on-device storage), not on the server -- so there's no 1MB-per-sticker or 60-sticker cap any more; it's limited only by your phone's own storage. Stickers you already had before this change still show up (pulled from the server as before), so nothing old is lost; every new one just gets saved locally from here on. Sending a sticker still has to transmit its bytes, obviously, since the other person needs to actually receive the picture.
- **The shared upload-size ceiling was raised from 20MB to 200MB** (news images, admin uploads, chat attachments, avatars -- it's one setting used everywhere). This one honestly can't go to "unlimited": every upload is currently held in memory before being saved, so a Railway instance only has so much RAM to work with, and a truly unbounded limit risks crashing the server on a very large file. 200MB comfortably covers any PDF, Word doc, or HTML page, and most videos. If you outgrow that -- say, long lecture-recording videos -- the real fix is switching uploads to stream to disk (or outside storage like S3) instead of holding them in memory, which is a bigger change than a one-line limit.
- **Admin-uploaded content (CBT, PDFs, pages) can't move to phone storage** the way stickers did -- that content is for every student to see from their *own* different phones, so it has to live somewhere all of them can reach, which means the server, not any one person's device.

## Lecturer accounts

A completely separate side of the site, for teaching staff -- not students.

- **Sign up at `/lecturer/signup`** (own link, own page) -- email+password with the same verification-code flow as students, or "Continue with Google." Never mixed into the student sign-up.
- **Then a short profile**: name, institution, an optional staff/registration number, and which course(s) they teach -- picked from existing courses, or typed in if it's not listed yet (that adds it to the catalog automatically).
- **Verification**: goes to a full admin, who sees the claimed institution and courses before clicking Verify. There's no automatic credential check against the institution -- a human confirms it, same spirit as everything else verified on this site.
- **Once verified**, a lecturer's whole interface is just their own courses: upload a PDF, Word doc, or HTML page for one of their courses, pick which departments and level it's for (reusing the same picker admin uploads use), and it **goes live immediately** -- no approval queue. They can edit or delete anything they uploaded, any time, but never touch another lecturer's upload -- not a colleague's, not even from the same course or university.
- **Browsing a course is folder-style, not a flat list**: tap the course, see it broken down by institution, then by lecturer, then their files -- so a lecturer (or admin) can find a specific colleague's material without scrolling past everyone else's.
- **Known gap**: there's no way yet for an already-verified lecturer to add a course to their account later -- re-running the welcome form would incorrectly reset them to pending. Worth fixing if this comes up.

## Viewing PDFs and Word documents in the browser

- **PDFs** embed directly using the browser's own built-in PDF viewer.
- **Word documents (.docx)** are converted to readable HTML right in the browser (via Mammoth.js, loaded from a CDN) by fetching the file through the same authenticated route everything else uses -- so department/level access control still applies, nothing is exposed to an outside service. Older `.doc` files, or anything Mammoth can't parse, fall back to a plain download link instead of a broken preview.

## Paid content: CBT only (Flutterwave, with bank transfer as the fallback)

Only CBT (quiz) uploads can be marked "Payment to view" — everything else is always free, and **sponsor posts** are paid the same way. Add your Flutterwave keys in Variables and a **"Pay now"** button opens Flutterwave's checkout (card, bank transfer, USSD):

```
FLUTTERWAVE_PUBLIC_KEY=FLWPUBK-...
FLUTTERWAVE_SECRET_KEY=FLWSECK-...
```

The browser's "payment successful" message is never trusted on its own: the server asks Flutterwave directly (`/pay/verify` for CBT, `/sponsor/:id/verify` for sponsor posts), and only unlocks/publishes when Flutterwave confirms the payment was successful, in Naira, for at least the price, and made for that exact person and item. A payment reference can only ever be used once.

**If the keys are not set**, the site falls back to the manual bank-transfer flow below, so nothing breaks.

### Manual bank transfer (used when Flutterwave keys are not set)

Payments go straight to your own account, with no gateway or fees. In Variables you can optionally override the defaults already baked in:

```
BANK_NAME=OPay
BANK_ACCOUNT_NUMBER=7043309103
BANK_ACCOUNT_NAME=Esseabasi Usen Inyangmme
PRICE_NGN=100
```

When someone claims a payment, it shows up under "Payment claims waiting for you" in `/admin`. Check your bank/OPay app, then click Approve (unlocks it — it moves from Locked to Available on their dashboard) or Reject.

## Chat features (WhatsApp-style)

- **Chat list:** search, filters (All, Unread, Favorites, Groups), pin up to 3 chats, archive (an archived chat comes back when a new message arrives), mute (no push notifications), favorites, mark as unread, clear chat (only for you). Press and hold a chat to select it; the top bar has pin, mute, archive, clear and a menu.
- **Chat screen:** press and hold a message to select it. The top bar has reply, copy, forward (up to 10 messages to up to 5 chats), star, message info (delivered/read times; per-person in groups), delete (for me / for everyone) and edit. A reaction bar floats above the message. A divider shows "N unread messages", a button scrolls back to the latest message, voice notes play at 1x / 1.5x / 2x, forwarded messages are labelled, and starred messages are listed at `/chat/starred`.
- Call lines appear in 1-to-1 chats: "Video call - 47 sec", "Missed video call", "Declined", "No answer".
- New tables: `chat_prefs`, `message_stars` (created automatically); new `messages.forwarded` column.

## Calls

- WhatsApp-style call screens: ringing then a timer, bottom control pill (more, camera, microphone, end), your own small camera window with flip-camera, add people, "X is muted" / "You're muted" notices, "Couldn't make call" with Cancel and Call again, and a full-screen incoming call with Decline and Accept.
- **Share your screen** (More menu) on computers; phone browsers cannot share a screen, so the button is hidden there. A shared screen shows as its own tile for the other person.
- **Minimise:** the chevron at the top left of a call keeps the call running while you browse the rest of the site (pages open inside the call page). A green "Tap to return to call" bar, with mute and end buttons, stays on top, and video calls keep a small floating video window. Closing the browser tab ends the call.
- **Echo guard:** if two devices are close together a howl can build up (one phone's speaker feeds the other's microphone). The microphone processing spots a steady loud tone, cuts just that frequency for a few seconds and shows "Echo detected". Earphones remove the cause.
- A call that nobody answers within 45 seconds counts as missed and stops ringing.
- Sound: echo cancellation, noise suppression and automatic volume from the browser, plus our own voice cleaner on the microphone (cuts rumble and hiss, a gate that closes when nobody is speaking and learns how noisy the room is, and a leveller), all at 48 kHz so the pitch never shifts. Your own voice is never played back to you. Two phones in the same room will still squeal at each other; use earphones or separate rooms when testing.

## Profile rules, level promotion and links
- After sign-up only the **profile picture, name and position** can be changed. Username, university, department (and so faculty) and level are fixed and show as plain text.
- Levels move up only when the central admin, or someone they appoint, promotes students: **Settings > Level promotion** (`/admin/levels`). Only the central admin can appoint or remove helpers. Every promotion is logged and students are notified.
- Phone numbers, emails, links and @usernames are tappable everywhere (chat, news, sponsor posts). Tapping @name opens that person's profile (`/@name`).
- Pages refresh themselves every few seconds (new posts, badges, counts) without a manual reload. A page is left alone while you are typing in a form.

## Sharing documents, and photos/videos in chat
- Press and hold any document or course page (the cards on Browse, the dashboard and so on) to get **Discuss with someone**. Pick a friend or group and the link is sent to that chat. A quick tap still just opens the page.
- Photos, videos and stickers in chat do not load by themselves. They show a card with the file size (for example "12 MB"); tapping it downloads it from the server and shows it on the site. Photos open full screen, and there is a "Save to phone" link on photos and videos. Once you have opened one it stays visible on that device.
- Sending is instant: the message is created on the server as an empty placeholder first, and the file is then uploaded into it with a progress bar (the other person sees "Sending..."). Tap the cross to cancel. Videos are supported (up to 200 MB). Placeholders that never receive a file are cleaned up after an hour.

## Calls: ringing, screen sharing and staying alive
- When someone calls you, your phone gets a ringing notification (with **Answer** and **Decline**) even if the site is closed, as long as you turned on notifications and have data. It disappears when the call is answered, declined, cancelled or missed. Tapping the notification itself opens the app on the normal incoming-call screen.
- The **share screen** button is in the call's bottom bar. Sharing a screen in a voice call turns it into a video call for everybody; everyone else sees the shared screen big, with people as small tiles. Phone browsers (Android and iPhone) do not allow screen capture at all, so on a phone the button explains this; sharing works from a laptop or desktop browser.
- Calls keep going while you use other apps: the call shows lock-screen controls like a media player, video calls can pop out into a small floating window (More > Pop out video window), and the screen stays awake. Browsers on iPhone may still freeze a call in the background; installing the site to the home screen helps.

## Other email options

`RESEND_API_KEY` + `MAIL_FROM` (needs a domain you own), `BREVO_API_KEY` + `MAIL_FROM`, or SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`) on hosts that allow it.

Uploaded pages run on the same domain as the site, so only upload HTML you trust.
