export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { messages = [], codeMode = false } = req.body;

    const systemPrompt = codeMode
      ? `Du bist Code AI auf Virgo — ein spezialisierter KI-Entwickler. Du schreibst sauberen, modernen Code in jeder Sprache. Formatiere Code immer in Markdown Code-Blöcken mit der richtigen Sprache (z.B. \`\`\`javascript). Erkläre den Code kurz auf Deutsch. Du kannst: Websites, Apps, APIs, Skripte, Datenbanken, Algorithmen erstellen. Nenne dich nie Claude — du bist Code AI von Virgo.`
      : `Du bist Virgo AI - eine professionelle KI Super-App fuer Creator und Agenturen auf virgoio.com. Du kannst Videos generieren mit Hailuo 2.3, Veo 3.1 und Sora 2.0 direkt in der App. Du kannst Bilder erstellen mit Midjourney V7, Nano Banana Pro, Seedream 5.0 und Modelia Fashion Pro. Du kannst coden, schreiben, uebersetzen und bei jedem Business-Thema helfen. Antworte immer kurz und direkt in der Sprache des Nutzers. Du heisst Virgo AI - erwaehne niemals Claude, ARIA oder andere KI-Systeme. Maximal 1 Emoji pro Antwort. Fuer Videos: sage dem Nutzer er soll in der Sidebar links das Video-Modell waehlen. Fuer Bilder: sage er soll das Bild-Modell waehlen.`;

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
