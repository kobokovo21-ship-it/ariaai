export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const KEY = process.env.ELEVENLABS_API_KEY;

  try {
    const { text, voice_id = 'pNInz6obpgDQGcFmaJgB', model_id = 'eleven_multilingual_v2' } = req.body;
    if (!text) return res.status(400).json({ error: 'Kein Text angegeben' });
    if (text.length > 5000) return res.status(400).json({ error: 'Text zu lang (max. 5000 Zeichen)' });

    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': KEY
      },
      body: JSON.stringify({
        text,
        model_id,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      })
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return res.status(500).json({ error: err.detail?.message || 'TTS fehlgeschlagen' });
    }

    const audioBuffer = await r.arrayBuffer();
    const base64 = Buffer.from(audioBuffer).toString('base64');
    return res.status(200).json({ success: true, audio: base64, mime: 'audio/mpeg' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
