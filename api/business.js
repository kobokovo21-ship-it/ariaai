const config = { maxDuration: 300 };

const ALLOWED_ORIGINS = [
  'https://virgoio.com',
  'https://www.virgoio.com'
];

async function handler(req, res) {
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';

  // Nur eigene Domains dürfen CORS-Header bekommen
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // Harte Sperre: Anfrage muss von eigener Domain kommen
  const originOk = ALLOWED_ORIGINS.includes(origin);
  const refererOk = ALLOWED_ORIGINS.some(o => referer.startsWith(o));
  if (!originOk && !refererOk) {
    console.warn('⛔ Blocked request. origin=' + origin + ' referer=' + referer);
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const { type, messages = [], systemOverride } = req.body || {};

    const defaultSystems = {
      plan: 'Du bist ein Business-Experte. Erstelle NUR vollständige Businesspläne auf Deutsch. Struktur: 1) Executive Summary 2) Produkt/Dienstleistung 3) Marktanalyse 4) Zielgruppe 5) Wettbewerb 6) Marketing 7) Finanzen 8) Meilensteine. Direkt verwendbar, keine Platzhalter.',
      website: 'Du bist ein Copywriter. Erstelle NUR professionelle Website-Texte auf Deutsch. Struktur: Hero-Headline (max 8 Wörter), Subheadline, 3 USPs mit Erklärung, Über uns, Leistungen, CTA. Conversion-optimiert.',
      'website-html': 'Du bist ein MOTION DESIGN & WEB ANIMATION EXPERT. GENERIERE NUR WUNDERSCHÖNES, modernes HTML mit ECHTEN CSS/SVG Animationen. ANIMATIONEN SIND NICHT OPTIONAL — JEDE Website MUSS atemberaubend animiert sein! Antworte NUR mit vollständigem HTML-Code. Beginne direkt mit <!DOCTYPE html>. KEIN Text davor/danach, KEINE Backticks. PFLICHT-ANIMATIONEN in jeder Website: @keyframes (fade-in, slide-up, pulse, glow, float), Hover-Effekte auf ALLEN Buttons/Cards (scale + glow), Scroll-Reveal Animationen, animierte Hintergründe, SVG-Bewegungen, Gradient-Shifts, Parallax-Effekte. Keine statischen Seiten — ALLES MUSS SICH BEWEGEN. Das HTML muss luxuriös, modern und ständig in Bewegung sein.',
      ads: 'Du bist ein Performance Marketing Experte. Erstelle NUR Werbeanzeigen-Texte auf Deutsch. Format für jede Anzeige: HEADLINE (max 6 Wörter) + TEXT (max 125 Zeichen) + CTA. Erstelle 5 verschiedene Varianten.',
      social: 'Du bist ein Social Media Manager. Erstelle NUR Social Media Posts auf Deutsch. Für jeden Post: Plattform (Instagram/LinkedIn/TikTok) + Caption + max 5 Hashtags. Erstelle 10 abwechslungsreiche Posts. KEIN Businessplan, nur Posts!',
      email: 'Du bist ein Email Marketing Experte. Erstelle NUR eine 5-teilige Email-Sequenz auf Deutsch. Jede Email: Betreff + Inhalt + CTA. 1) Willkommen 2) Mehrwert 3) Beweis/Case Study 4) Angebot 5) Follow-up.',
      pitch: 'Du bist ein Startup-Pitch Experte. Erstelle NUR ein vollständiges Pitch Deck auf Deutsch. Struktur: Problem, Lösung, Marktgröße, Geschäftsmodell, Traktion, Team, Finanzierung. Überzeugend für Investoren.'
    };

    const systemPrompt =
      systemOverride ||
      defaultSystems[type] ||
      'Du bist Virgo Business AI — erstelle professionelle Business-Inhalte auf Deutsch. Antworte vollständig und direkt verwendbar.';

    const maxTokens = type === 'website-html' ? 16000 : 4096;

    const extractText = (msg) => {
      if (!msg) return '';
      return Array.isArray(msg.content)
        ? (msg.content.find(b => b.type === 'text')?.text || '')
        : (msg.content || '');
    };

    // Anthropic API - OPUS 4.8 für Website, Sonnet 4.6 für Rest
    try {
      const isWebsite = type === 'website-html';
      const anthropicModel = process.env.ANTHROPIC_MODEL || (isWebsite ? 'claude-opus-4-8' : 'claude-sonnet-4-6');

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: anthropicModel,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages
        })
      });

      if (r.status === 529 || r.status === 500 || r.status === 503 || r.status === 502 || r.status === 429) {
        throw new Error('Anthropic overloaded: ' + r.status);
      }

      const data = await r.json();
      if (data.type === 'error' || !data.content) throw new Error('Anthropic error');

      console.log(`✓ Anthropic (${anthropicModel}) erfolgreich`);
      return res.status(200).json(data);
    } catch (anthropicErr) {
      console.warn('⚠️ Anthropic failed → Gemini:', anthropicErr.message);
    }

    // Gemini API
    try {
      if (!process.env.GEMINI_API_KEY) throw new Error('Kein Gemini Key');

      const geminiMessages = messages.map(msg => {
        const text = extractText(msg);
        return { role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text }] };
      });

      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: geminiMessages,
            generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 }
          })
        }
      );

      if (!geminiRes.ok) throw new Error('Gemini HTTP ' + geminiRes.status);

      const geminiData = await geminiRes.json();
      const geminiText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!geminiText) throw new Error('Gemini no content');

      console.log('✓ Gemini erfolgreich');
      return res.status(200).json({ content: [{ type: 'text', text: geminiText }], _fallback: 'gemini' });
    } catch (geminiErr) {
      console.warn('⚠️ Gemini failed → OpenAI:', geminiErr.message);
    }

    // OpenAI API (Fallback)
    try {
      if (!process.env.OPENAI_API_KEY) throw new Error('Kein OpenAI Key');

      const openaiMessages = [{ role: 'system', content: systemPrompt }];
      messages.forEach(msg => {
        const text = extractText(msg);
        openaiMessages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: text });
      });

      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || 'gpt-4o',
          max_tokens: maxTokens,
          messages: openaiMessages,
          temperature: 0.7
        })
      });

      if (!openaiRes.ok) throw new Error('OpenAI HTTP ' + openaiRes.status);

      const openaiData = await openaiRes.json();
      const openaiText = openaiData?.choices?.[0]?.message?.content;
      if (!openaiText) throw new Error('OpenAI no content');

      console.log('✓ OpenAI erfolgreich');
      return res.status(200).json({ content: [{ type: 'text', text: openaiText }], _fallback: 'openai' });
    } catch (openaiErr) {
      console.error('❌ Alle 3 APIs fehlgeschlagen:', openaiErr.message);
    }

    // Fallback wenn alle fehlschlagen
    return res.status(200).json({
      content: [{ type: 'text', text: 'Virgo ist gerade stark ausgelastet. Bitte versuche es in 30 Sekunden nochmal.' }],
      _fallback: 'none'
    });
  } catch (err) {
    console.error('Fatal error:', err.message);
    return res.status(200).json({
      content: [{ type: 'text', text: 'Virgo ist gerade kurz überlastet. Bitte versuche es gleich nochmal.' }],
      _error: err.message
    });
  }
}

module.exports = handler;
exports.config = config;
