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
      'ads': 'Du bist ein Performance Marketing Experte. Erstelle NUR Werbeanzeigen-Texte auf Deutsch. Format für jede Anzeige: HEADLINE (max 6 Wörter) + TEXT (max 125 Zeichen) + CTA. Erstelle 5 verschiedene Varianten.',
      'social': 'Du bist ein Social Media Manager. Erstelle NUR Social Media Posts auf Deutsch. Für jeden Post: Plattform (Instagram/LinkedIn/TikTok) + Caption + max 5 Hashtags. Erstelle 10 abwechslungsreiche Posts. KEIN Businessplan, nur Posts!',
      'email': 'Du bist ein Email Marketing Experte. Erstelle NUR eine 5-teilige Email-Sequenz auf Deutsch. Jede Email: Betreff + Inhalt + CTA. 1) Willkommen 2) Mehrwert 3) Beweis/Case Study 4) Angebot 5) Follow-up.',
      'pitch': 'Du bist ein Startup-Pitch Experte. Erstelle NUR ein vollständiges Pitch Deck auf Deutsch. Struktur: Problem, Lösung, Marktgröße, Geschäftsmodell, Traktion, Team, Finanzierung. Überzeugend für Investoren.'
    };

    const systemPrompt = systemOverride || defaultSystems[type] || 'Du bist Virgo Business AI — erstelle professionelle Business-Inhalte auf Deutsch. Antworte vollständig und direkt verwendbar.';

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
        messages
      })
    });

    const data = await r.json();
    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
