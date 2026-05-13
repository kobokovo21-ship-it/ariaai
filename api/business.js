export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { type, data = {}, messages = [] } = req.body;

    const prompts = {
      businessplan: `Erstelle einen professionellen Businessplan auf Deutsch für: ${JSON.stringify(data)}. 
        Struktur: 1) Executive Summary 2) Produkt/Dienstleistung 3) Marktanalyse 4) Zielgruppe 5) Wettbewerb 
        6) Marketing & Vertrieb 7) Finanzplanung 8) Meilensteine. Sei konkret und praxisorientiert.`,
      
      website: `Erstelle einen vollständigen Website-Text auf Deutsch für: ${JSON.stringify(data)}.
        Erstelle: 1) Hero-Headline (max 8 Wörter, stark) 2) Subheadline 3) 3 USPs mit Erklärung 
        4) Über uns Text 5) Leistungen/Produkte 6) Call-to-Action Text 7) Footer Text. 
        Optimiert für Conversions.`,
      
      ads: `Erstelle 5 verschiedene Meta/Facebook Ad-Texte auf Deutsch für: ${JSON.stringify(data)}.
        Jede Anzeige: Headline (max 6 Wörter) + Text (max 125 Zeichen) + Call-to-Action.
        Verschiedene Ansätze: emotional, rational, Neugier, Angebot, Problem-Lösung.`,
      
      social: `Erstelle 10 Social Media Posts auf Deutsch für: ${JSON.stringify(data)}.
        Mix aus: Instagram, LinkedIn, TikTok. 
        Jeder Post: Plattform + Caption + Hashtags (max 5). 
        Abwechslungsreich: informativ, unterhaltsam, inspirierend, verkaufend.`,
      
      email: `Erstelle eine professionelle Email-Sequenz auf Deutsch für: ${JSON.stringify(data)}.
        5 Emails: 1) Willkommen 2) Mehrwert/Tipps 3) Case Study/Beweis 4) Angebot 5) Follow-up.
        Jede Email: Betreff + Inhalt + CTA.`,
      
      pitch: `Erstelle einen überzeugenden Pitch auf Deutsch für: ${JSON.stringify(data)}.
        Struktur: Problem → Lösung → Marktgröße → Geschäftsmodell → Traktion → Team → Finanzierung.
        Prägnant, überzeugend, für Investoren geeignet.`
    };

    const systemPrompt = 'Du bist Virgo Business AI — der beste Business-Berater der Welt. Du erstellst professionelle Business-Dokumente, Marketingtexte und Strategien. Antworte immer vollständig und direkt verwendbar. Keine Platzhalter. Formatiere mit klaren Überschriften.';

    const userMessages = messages.length > 0 ? messages : [{ role: 'user', content: prompts[type] || `Erstelle für folgendes Business: ${JSON.stringify(data)}` }];

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: systemPrompt,
        messages: userMessages
      })
    });

    const d = await r.json();
    return res.status(200).json(d);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
