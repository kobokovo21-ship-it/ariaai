export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { type, messages = [], systemOverride } = req.body;

    const defaultSystems = {
      'plan': 'Du bist ein Business-Experte. Erstelle NUR vollständige Businesspläne auf Deutsch. Struktur: 1) Executive Summary 2) Produkt/Dienstleistung 3) Marktanalyse 4) Zielgruppe 5) Wettbewerb 6) Marketing 7) Finanzen 8) Meilensteine. Direkt verwendbar, keine Platzhalter.',
      'website': 'Du bist ein Copywriter. Erstelle NUR professionelle Website-Texte auf Deutsch. Struktur: Hero-Headline (max 8 Wörter), Subheadline, 3 USPs mit Erklärung, Über uns, Leistungen, CTA. Conversion-optimiert.',
      'website-html': 'Du bist ein professioneller Web-Developer. Generiere NUR vollständiges, produktionsreifes HTML+CSS für eine Website. Die HTML muss: 1) Responsive sein (mobile-first), 2) Modern design mit Tailwind-Style, 3) Alle Inhalte eingebaut (Hero, Features, CTA, Footer), 4) SEO-freundlich, 5) Sofort einsatzbereit. WICHTIG: Gib nur reines HTML+CSS zurück, keine Markdown, keine Code-Blöcke, keine Erklärung, keine Platzhalter. Inline CSS im <style> Tag. Halte das CSS kompakt und schließe IMMER alle Tags (besonders </style> und </body></html>). Die Website muss PERFEKT aussehen und funktionieren. Starte direkt mit <!DOCTYPE html>',
      'ads': 'Du bist ein Performance Marketing Experte. Erstelle NUR Werbeanzeigen-Texte auf Deutsch. Format für jede Anzeige: HEADLINE (max 6 Wörter) + TEXT (max 125 Zeichen) + CTA. Erstelle 5 verschiedene Varianten.',
      'social': 'Du bist ein Social Media Manager. Erstelle NUR Social Media Posts auf Deutsch. Für jeden Post: Plattform (Instagram/LinkedIn/TikTok) + Caption + max 5 Hashtags. Erstelle 10 abwechslungsreiche Posts. KEIN Businessplan, nur Posts!',
      'email': 'Du bist ein Email Marketing Experte. Erstelle NUR eine 5-teilige Email-Sequenz auf Deutsch. Jede Email: Betreff + Inhalt + CTA. 1) Willkommen 2) Mehrwert 3) Beweis/Case Study 4) Angebot 5) Follow-up.',
      'pitch': 'Du bist ein Startup-Pitch Experte. Erstelle NUR ein vollständiges Pitch Deck auf Deutsch. Struktur: Problem, Lösung, Marktgröße, Geschäftsmodell, Traktion, Team, Finanzierung. Überzeugend für Investoren.'
    };

    let systemPrompt = systemOverride || defaultSystems[type] || 'Du bist Virgo Business AI — erstelle professionelle Business-Inhalte auf Deutsch. Antworte vollständig und direkt verwendbar.';

    // ── WICHTIG: Business-Tools sind BRANCHENNEUTRAL ──
    // Egal was das Frontend schickt — Makler-Bezug wird entfernt, damit
    // der Business-Workspace für JEDE Branche funktioniert (Café, Shop, Handwerk, etc.)
    if (systemPrompt) {
      systemPrompt = systemPrompt
        .replace(/Business-Experte für Versicherungsmakler/g, 'Business-Experte')
        .replace(/Copywriter für Versicherungsmakler/g, 'Copywriter')
        .replace(/Performance Marketing Experte für Versicherungsmakler/g, 'Performance Marketing Experte')
        .replace(/Social Media Manager für Versicherungsmakler/g, 'Social Media Manager')
        .replace(/Email Marketing Experte für Versicherungsmakler/g, 'Email Marketing Experte')
        .replace(/Pitch-Experte für Versicherungsmakler/g, 'Pitch-Experte')
        .replace(/ für Versicherungsmakler/g, '')
        .replace(/für Versicherungsmakler/g, '')
        .replace(/auf Versicherungsmakler zugeschnitten/g, 'passend zur Geschäftsidee')
        .replace(/Versicherungsmakler/g, 'Unternehmen');
    }

    const maxTokens = type === 'website-html' ? 8192 : 2048;

    // ═══════════════════════════════════════════
    // SCHRITT 1: ANTHROPIC (Claude)
    // ═══════════════════════════════════════════
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
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
      return res.status(200).json(data);
    } catch (anthropicErr) {
      console.warn('⚠️ Anthropic failed → Gemini:', anthropicErr.message);
    }

    // ═══════════════════════════════════════════
    // SCHRITT 2: GEMINI
    // ═══════════════════════════════════════════
    try {
      if (!process.env.GEMINI_API_KEY) throw new Error('Kein Gemini Key');
      const geminiMessages = messages.map(msg => {
        const text = Array.isArray(msg.content)
          ? (msg.content.find(b => b.type === 'text')?.text || '')
          : msg.content;
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
      return res.status(200).json({ content: [{ type: 'text', text: geminiText }], _fallback: 'gemini' });
    } catch (geminiErr) {
      console.warn('⚠️ Gemini failed → OpenAI:', geminiErr.message);
    }

    // ═══════════════════════════════════════════
    // SCHRITT 3: OPENAI (ChatGPT)
    // ═══════════════════════════════════════════
    try {
      if (!process.env.OPENAI_API_KEY) throw new Error('Kein OpenAI Key');
      const openaiMessages = [{ role: 'system', content: systemPrompt }];
      messages.forEach(msg => {
        const text = Array.isArray(msg.content)
          ? (msg.content.find(b => b.type === 'text')?.text || '')
          : msg.content;
        openaiMessages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: text });
      });
      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY },
        body: JSON.stringify({ model: 'gpt-4o', max_completion_tokens: maxTokens, messages: openaiMessages })
      });
      if (!openaiRes.ok) throw new Error('OpenAI HTTP ' + openaiRes.status);
      const openaiData = await openaiRes.json();
      const openaiText = openaiData?.choices?.[0]?.message?.content;
      if (!openaiText) throw new Error('OpenAI no content');
      return res.status(200).json({ content: [{ type: 'text', text: openaiText }], _fallback: 'openai' });
    } catch (openaiErr) {
      console.error('❌ Alle 3 fehlgeschlagen:', openaiErr.message);
    }

    return res.status(200).json({
      content: [{ type: 'text', text: 'Virgo ist gerade stark ausgelastet. Bitte versuche es in 30 Sekunden nochmal.' }],
      _fallback: 'none'
    });

  } catch (err) {
    return res.status(200).json({
      content: [{ type: 'text', text: 'Virgo ist gerade kurz überlastet. Bitte versuche es gleich nochmal.' }],
      _error: err.message
    });
  }
}
