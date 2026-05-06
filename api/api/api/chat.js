export const config = { runtime: 'edge' };

export default async function handler(req) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const { messages } = await req.json();

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: 'Du bist ARIA - eine leistungsstarke KI Super-App. Du kannst Chat, Bilder, Videos, Webseiten und Code erstellen. Antworte IMMER in der Sprache des Nutzers. Benutze maximal 1-2 Emojis pro Antwort. Sei direkt und präzise. Du bist ARIA - nenne dich niemals Claude oder erwähne Anthropic.',
        messages
      })
    });

    const data = await response.json();
    return new Response(JSON.stringify(data), { headers });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}
