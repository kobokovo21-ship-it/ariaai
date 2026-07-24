// api/config.js — liefert öffentliche Client-Konfiguration.
// Enthält NUR Werte, die im Browser sichtbar sein dürfen (z.B. Turnstile-Site-Key).

const ALLOWED_ORIGINS = ['https://virgoio.com', 'https://www.virgoio.com'];

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'public, max-age=60');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  return res.status(200).json({
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || null
  });
}
