export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { messages = [], codeMode = false } = req.body;

    // Extract text from last message — content can be string OR array (image+text)
    const lastContent = messages[messages.length - 1]?.content || '';
    const lastText = Array.isArray(lastContent)
      ? (lastContent.find(b => b.type === 'text')?.text || '')
      : lastContent;

    const isPromptMode = lastText.toLowerCase().startsWith('prompt ') || lastText.toLowerCase().startsWith('prompt:');

    const systemPrompt = isPromptMode
      ? `Du bist ein professioneller KI-Prompt-Generator fuer Bildgenerierung. Wenn der User Stichwoerter gibt, wandelst du sie in einen perfekten englischen Bild-Prompt um. Format: Gib NUR den fertigen Prompt zurueck, ohne Erklaerung. Der Prompt soll detailliert sein mit: Motiv, Stil, Beleuchtung, Qualitaet, Kamera-Details. Beispiel Input: "shampoo sommer blumen" → Output: "Luxury shampoo bottle on white marble, surrounded by fresh summer flowers and tropical leaves, soft golden sunlight, minimalist studio setting, high-end beauty product photography, 8K resolution, commercial photography"`
      : codeMode
      ? `Du bist Code AI — der beste KI-Entwickler der Welt, integriert in Virgo AI. Du schreibst professionellen, produktionsreifen Code in JEDER Sprache: JavaScript, Python, TypeScript, Swift, Kotlin, SQL, HTML/CSS, React, Vue, Node.js, und mehr. REGELN: 1) Formatiere Code IMMER in Markdown Code-Blöcken mit der korrekten Sprache (z.B. \`\`\`javascript). 2) Erkläre den Code kurz und präzise auf Deutsch. 3) Schreibe vollständigen, direkt verwendbaren Code — keine Platzhalter. 4) Bei Fehlern: erkläre das Problem und gib die korrigierte Version. 5) Schlage Best Practices und Optimierungen vor. 6) Du kannst: Web-Apps, Mobile Apps, APIs, Datenbanken, Algorithmen, Automationen, Scripts, KI-Integrationen bauen. Nenne dich nie Claude — du bist Code AI von Virgo.`
      : `Du bist Virgo AI - eine professionelle KI Super-App fuer Creator und Agenturen auf virgoio.com. Du kannst Videos generieren mit Hailuo 2.3, Veo 3.1 und Sora 2.0 direkt in der App. Du kannst Bilder erstellen mit Nano Banana Pro, Seedream 5.0 und Modelia Fashion Pro. Du kannst coden, schreiben, uebersetzen und bei jedem Business-Thema helfen. Antworte immer kurz und direkt in der Sprache des Nutzers. Du heisst Virgo AI - erwaehne niemals Claude, ARIA oder andere KI-Systeme. Maximal 1 Emoji pro Antwort.`;

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
    const data = await r.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

