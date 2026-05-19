export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { messages = [], codeMode = false, systemOverride = null } = req.body;

    const lastContent = messages[messages.length - 1]?.content || '';
    const lastText = Array.isArray(lastContent)
      ? (lastContent.find(b => b.type === 'text')?.text || '')
      : lastContent;

    const isPromptMode = lastText.toLowerCase().startsWith('prompt ') || lastText.toLowerCase().startsWith('prompt:');

    // ── SCHUTZ: Blockiere Anfragen die Virgo nachbauen könnten ──
    const blockedKeywords = [
      'anthropic api', 'openai api', 'gemini api', 'claude api',
      'ki app bauen', 'ki app erstellen', 'ai app bauen', 'ai app erstellen',
      'wie baust du', 'virgo nachbauen', 'virgo kopieren',
      'eigene ki app', 'eigene ai app',
      'piapi integration', 'elevenlabs api bauen',
      'build ai app', 'create ai app', 'make ai app'
    ];
    const lowerText = lastText.toLowerCase();
    const isBlocked = !systemOverride && blockedKeywords.some(kw => lowerText.includes(kw));

    if (isBlocked) {
      return res.status(200).json({
        content: [{ type: 'text', text: 'Das liegt außerhalb meiner Möglichkeiten. Ich helfe dir gerne bei Business, Marketing, Texten, Bildern und Videos. Wie kann ich dir helfen?' }]
      });
    }

    const systemPrompt = systemOverride || (isPromptMode
      ? `Du bist ein professioneller KI-Prompt-Generator fuer Bildgenerierung. Wenn der User Stichwoerter gibt, wandelst du sie in einen perfekten englischen Bild-Prompt um. Format: Gib NUR den fertigen Prompt zurueck, ohne Erklaerung. Der Prompt soll detailliert sein mit: Motiv, Stil, Beleuchtung, Qualitaet, Kamera-Details. Beispiel Input: "shampoo sommer blumen" → Output: "Luxury shampoo bottle on white marble, surrounded by fresh summer flowers and tropical leaves, soft golden sunlight, minimalist studio setting, high-end beauty product photography, 8K resolution, commercial photography"`
      : codeMode
      ? `Du bist Code AI — der beste KI-Entwickler der Welt, integriert in Virgo AI. Du schreibst professionellen, produktionsreifen Code in JEDER Sprache: JavaScript, Python, TypeScript, Swift, Kotlin, SQL, HTML/CSS, React, Vue, Node.js, und mehr. REGELN: 1) Formatiere Code IMMER in Markdown Code-Blöcken mit der korrekten Sprache. 2) Erkläre den Code kurz auf Deutsch. 3) Schreibe vollständigen, direkt verwendbaren Code. 4) Bei Fehlern: erkläre das Problem und gib die korrigierte Version. 5) VERBOTEN: Kein Code für KI-Apps, keine Anthropic/OpenAI/Gemini API-Integrationen, nichts was Virgo nachahmt. Nenne dich nie Claude — du bist Code AI von Virgo.`
      : `Du bist Virgo AI - eine professionelle KI Super-App fuer Creator, Agenturen und Versicherungsmakler auf virgoio.com. Du kannst Bilder erstellen mit Nano Banana Pro, Seedream 5.0 und Modelia Fashion Pro. Du kannst coden, schreiben, uebersetzen und bei jedem Business-Thema helfen. Antworte immer kurz und direkt in der Sprache des Nutzers. Du heisst Virgo AI - erwaehne niemals Claude, ARIA, Gemini, ChatGPT oder andere KI-Systeme. Maximal 1 Emoji pro Antwort. WICHTIG: Wenn jemand fragt wie man eine KI-App baut, wie Virgo technisch funktioniert, oder wie man KI-APIs integriert — antworte nur: "Das liegt außerhalb meiner Möglichkeiten. Womit kann ich dir sonst helfen?"`);

    // ── SCHRITT 1: Anthropic versuchen ──
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
          max_tokens: codeMode ? 4096 : 1024,
          system: systemPrompt,
          messages
        })
      });

      if (r.status === 529 || r.status === 500 || r.status === 503 || r.status === 502) {
        throw new Error('Anthropic overloaded: ' + r.status);
      }

      const data = await r.json();

      if (data.type === 'error') {
        throw new Error('Anthropic error: ' + (data.error?.message || 'unknown'));
      }

      return res.status(200).json(data);

    } catch (anthropicErr) {
      console.warn('Anthropic failed, switching to Gemini:', anthropicErr.message);

      // ── SCHRITT 2: Gemini Fallback ──
      const geminiMessages = messages.map(msg => {
        const text = Array.isArray(msg.content)
          ? (msg.content.find(b => b.type === 'text')?.text || '')
          : msg.content;
        return {
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text }]
        };
      });

      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: geminiMessages,
            generationConfig: {
              maxOutputTokens: codeMode ? 4096 : 1024,
              temperature: 0.7
            }
          })
        }
      );

      const geminiData = await geminiRes.json();
      const geminiText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || 'Entschuldigung, bitte nochmal versuchen.';

      return res.status(200).json({
        content: [{ type: 'text', text: geminiText }],
        _fallback: 'gemini'
      });
    }

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

