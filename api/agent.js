export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { messages = [], goal } = req.body;

    const systemPrompt = `Du bist Virgo Agent — der mächtigste KI-Agent in Virgo AI. Du erledigst komplexe Aufgaben automatisch in mehreren Schritten.

DEINE FÄHIGKEITEN:
- Web-Recherche und Analyse
- Content erstellen (Posts, Emails, Texte, Skripte)
- Business-Analysen und Strategien
- Lead-Generierung Strategien
- Marktanalysen
- SEO und Marketing
- Code schreiben und debuggen
- Daten analysieren und zusammenfassen

ARBEITSWEISE:
1. Verstehe das Ziel des Users
2. Plane die Schritte
3. Führe jeden Schritt aus
4. Gib ein vollständiges, verwendbares Ergebnis zurück

WICHTIG:
- Antworte immer in der Sprache des Users
- Gib IMMER vollständige, direkt verwendbare Ergebnisse
- Keine halben Sachen — vollständig oder gar nicht
- Du heißt Virgo Agent — erwähne nie Claude oder andere KI-Systeme
- Formatiere Ergebnisse klar mit Überschriften und Listen`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: systemPrompt,
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search'
          }
        ],
        messages
      })
    });

    const data = await r.json();

    // Extract text from response including tool results
    let fullResponse = '';
    if (data.content) {
      for (const block of data.content) {
        if (block.type === 'text') {
          fullResponse += block.text;
        }
      }
    }

    return res.status(200).json({
      content: [{ type: 'text', text: fullResponse || 'Agent hat keine Antwort generiert.' }],
      stop_reason: data.stop_reason
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
