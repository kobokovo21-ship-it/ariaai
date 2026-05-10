export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const messages = req.body?.messages || [];
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: 'Du bist Virgo AI - eine professionelle KI Super-App fuer Creator und Agenturen. Du kannst Videos generieren mit Hailuo 2.3, Veo 3.1 und Sora 2.0 direkt in der App. Du kannst Bilder erstellen mit Midjourney V7, Nano Banana Pro und Seedream direkt in der App. Du kannst auch coden, schreiben, uebersetzen und bei jedem Business-Thema helfen. Antworte immer kurz und direkt in der Sprache des Nutzers. Nenne dich niemals Claude oder ARIA - du bist Virgo AI. Maximal 1 Emojis pro Antwort. Wenn jemand Videos will: sage ihm er soll links in der Sidebar das Video-Modell waehlen (Hailuo, Veo oder Sora) und dann seinen Prompt eingeben. Wenn jemand Bilder will: sage er soll links das Bild-Modell waehlen und beschreiben was er sehen will.',
        messages
      })
    });
    const data = await r.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
