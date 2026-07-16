export const config = { maxDuration: 120 };

const ALLOWED_ORIGINS = ['https://virgoio.com', 'https://www.virgoio.com'];

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();
  const ok = ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.some(o => referer.startsWith(o));
  if (!ok) return res.status(403).json({ error: 'Forbidden' });

  const CREATOMATE_KEY = process.env.CREATOMATE_API_KEY;
  if (!CREATOMATE_KEY) {
    return res.status(500).json({ error: 'CREATOMATE_API_KEY fehlt in den Vercel-Umgebungsvariablen.' });
  }

  const { html, aspect = '9/16' } = req.body || {};
  if (!html) return res.status(400).json({ error: 'html fehlt' });

  // Auflösung je nach Format (9:16 für Reels, 1:1 für Posts)
  const width  = aspect === '1/1' ? 1080 : 608;
  const height = aspect === '1/1' ? 1080 : 1080;

  try {
    // Job bei Creatomate starten
    const start = await fetch('https://api.creatomate.com/v1/renders', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + CREATOMATE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        source: {
          output_format: 'mp4',
          width,
          height,
          duration: 15,
          elements: [{
            type: 'html',
            html,
            width: '100%',
            height: '100%',
            x: '50%',
            y: '50%'
          }]
        }
      })
    });

    if (!start.ok) {
      const err = await start.text();
      throw new Error('Render-Start fehlgeschlagen: ' + err.slice(0, 200));
    }

    const jobs = await start.json();
    const jobId = Array.isArray(jobs) ? jobs[0]?.id : jobs?.id;
    if (!jobId) throw new Error('Keine Job-ID von Creatomate erhalten');

    // Polling bis fertig (max. 90 Sekunden)
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 4000));
      const check = await fetch(`https://api.creatomate.com/v1/renders/${jobId}`, {
        headers: { 'Authorization': 'Bearer ' + CREATOMATE_KEY }
      });
      if (!check.ok) continue;
      const job = await check.json();
      if (job.status === 'succeeded' && job.url) {
        return res.status(200).json({ url: job.url });
      }
      if (job.status === 'failed') {
        throw new Error('Render fehlgeschlagen: ' + (job.error_message || 'unbekannter Fehler'));
      }
    }
    throw new Error('Zeitüberschreitung beim Rendern — bitte nochmal versuchen');
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
