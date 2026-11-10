// Studies Hub AI assistant
// Knows the website features, materials available to each student, and can guide them.
// Uses free Groq (or Anthropic). Keeps existing rate limit. Safe for Railway.

function register(app, deps) {
  const { db, limited, sortedFor, AI, AI_MODEL, hasPurchased, can } = deps;

  function htmlToText(html) {
    if (!html) return '';
    return String(html)
      .replace(/<script[\\s\\S]*?<\\/script>/gi, ' ')
      .replace(/<style[\\s\\S]*?<\\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\\s+/g, ' ')
      .trim()
      .slice(0, 3500);
  }

  async function askAI(messages, system) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 28000);
    try {
      if (AI === 'groq') {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          signal: ctl.signal,
          headers: {
            Authorization: 'Bearer ' + process.env.GROQ_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: AI_MODEL,
            max_tokens: 700,
            temperature: 0.4,
            messages: [{ role: 'system', content: system }, ...messages]
          })
        });
        const j = await r.json();
        if (!r.ok) throw new Error((j.error && j.error.message) || r.status);
        return j.choices[0].message.content;
      }
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: ctl.signal,
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: AI_MODEL,
          max_tokens: 700,
          system,
          messages
        })
      });
      const j = await r.json();
      if (!r.ok) throw new Error((j.error && j.error.message) || r.status);
      return j.content.filter(b => b.type === 'text').map(b => b.text).join('');
    } finally {
      clearTimeout(timer);
    }
  }

  function materialsCatalog(user) {
    const rows = db.prepare(
      'SELECT id, slug, title, kind, paid, dept, level, semester, university FROM pages ORDER BY id DESC LIMIT 400'
    ).all().filter(p => sortedFor(p, user));

    const staff = can && can.pages && can.pages(user);
    return rows.slice(0, 80).map(p => {
      const kind = (p.kind || 'html').toUpperCase();
      const locked = p.paid && !staff && !hasPurchased(user.id, p.id);
      const bits = [
        p.title,
        '(' + kind + ')',
        locked ? '[LOCKED - pay to view]' : '',
        p.level ? (p.level + 'L') : '',
        p.dept || '',
        p.semester ? ('sem ' + p.semester) : '',
        '-> /p/' + p.slug
      ].filter(Boolean);
      return bits.join(' · ');
    });
  }

  function pageExcerpt(user, question) {
    const q = (question || '').toLowerCase();
    const rows = db.prepare(
      'SELECT id, slug, title, kind, html, paid FROM pages ORDER BY id DESC LIMIT 400'
    ).all().filter(p => sortedFor(p, user));

    let match = rows.find(p => q.includes('/p/' + p.slug) || q.includes(p.slug.toLowerCase()));
    if (!match) {
      match = rows.find(p => p.title && q.includes(String(p.title).toLowerCase().slice(0, 25)));
    }
    if (!match) return null;

    const staff = can && can.pages && can.pages(user);
    if (match.paid && !staff && !hasPurchased(user.id, match.id)) {
      return 'The material "' + match.title + '" (/p/' + match.slug + ') is locked. The student must pay to unlock it before the content can be discussed.';
    }

    if (match.kind === 'html' || match.kind === 'cbt') {
      const text = htmlToText(match.html);
      if (text.length > 80) {
        return 'Content excerpt from "' + match.title + '" (/p/' + match.slug + '):\\n' + text;
      }
    }
    return 'The material "' + match.title + '" is a ' + (match.kind || 'page') + ' at /p/' + match.slug + '. (Open it on the site to read the full content.)';
  }

  function buildSystem(user, question) {
    const catalog = materialsCatalog(user);
    const excerpt = pageExcerpt(user, question);
    const who = [
      user.name || 'Student',
      user.department ? ('Department: ' + user.department) : '',
      user.level ? ('Level: ' + user.level) : '',
      user.university || '',
      user.graduated ? 'Graduate' : ''
    ].filter(Boolean).join(' · ');

    return [
      'You are the official assistant for Studies Hub — a university study website used by Nigerian students.',
      '',
      'YOUR JOB:',
      '- Help students find and understand study materials, CBT practice, notes, PDFs and videos available to them.',
      '- Explain clearly how to use the website (Dashboard, Chat, News, Settings, payments, friends, groups, calls).',
      '- Answer questions about materials when you have the content or metadata.',
      '- Be short, clear, friendly and practical. Use simple English.',
      '- Never invent materials, links or features that do not exist. If you do not know, say so and tell the student where to look.',
      '',
      'HOW THE WEBSITE WORKS:',
      '- Home / News: public news feed. After login students go to Dashboard.',
      '- Dashboard: shows materials for the student\'s department and level. Free + paid-unlocked items are Available. Locked CBT items need payment.',
      '- Each material opens at /p/<slug>.',
      '- Chat: students must be friends first (Find people → request → accept). Groups, voice notes, photos, stickers, reactions, calls exist.',
      '- News: members can submit posts (need News admin approval).',
      '- Settings: name, username, university, department, level, picture, position, notifications.',
      '- Payments: only CBT can be pay-to-view. Student pays, admin approves, then it unlocks.',
      '- Sidebar (menu button): Home, Dashboard, News, Browse pages, Chat, Settings.',
      '',
      'CURRENT STUDENT:',
      who,
      '',
      'MATERIALS THIS STUDENT CAN SEE:',
      (catalog.length ? catalog.join('\\n') : 'No materials visible for this student yet.'),
      '',
      excerpt ? ('RELEVANT MATERIAL CONTENT:\\n' + excerpt) : '',
      '',
      'RULES:',
      '- Only talk about materials listed above or the excerpt.',
      '- If a material is [LOCKED], tell the student it needs payment.',
      '- Give exact menu names or paths when directing the student.',
      '- Do not reveal private data or admin tools.',
      '- Keep answers under ~180 words unless the student asks for more detail.'
    ].filter(Boolean).join('\\n');
  }

  app.post('/api/chat', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Please log in to use the assistant.' });
    if (!AI) return res.status(503).json({ error: 'The assistant is not set up yet.' });
    if (limited('chat:' + req.user.id, 20, 10 * 60e3)) {
      return res.status(429).json({ error: 'Slow down a little and try again in a few minutes.' });
    }

    const msgs = (Array.isArray(req.body.messages) ? req.body.messages : [])
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-10)
      .map(m => ({ role: m.role, content: m.content.slice(0, 1000) }));

    while (msgs.length && msgs[0].role !== 'user') msgs.shift();
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'Send a question first.' });
    }

    const lastQuestion = msgs[msgs.length - 1].content;
    const system = buildSystem(req.user, lastQuestion);

    try {
      const reply = await askAI(msgs, system);
      res.json({ reply });
    } catch (e) {
      console.error('AI error:', e.message);
      res.status(502).json({ error: 'The assistant could not answer right now. Please try again.' });
    }
  });
}

module.exports = { register };
