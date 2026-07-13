// api/upload.js — lädt ein Bild in den Supabase Storage Bucket "uploads"
const config = { maxDuration: 60 };

const ALLOWED_ORIGINS = ['https://virgoio.com', 'https://www.virgoio.com'];
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

async function handler(req, res) {
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';

  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const ok = ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.some(o => referer.startsWith(o));
  if (!ok) {
    console.warn('⛔ Blocked upload. origin=' + origin + ' referer=' + referer);
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const BASE = process.env.SUPABASE_URL;
    const SVC = process.env.SUPABASE_SERVICE_KEY;
    if (!BASE || !SVC) {
      return res.status(500).json({ error: 'Storage nicht konfiguriert' });
    }
    const { image_base64, mime } = req.body || {};
    if (!image_base64) {
      return res.status(400).json({ error: 'Kein Bild übergeben' });
    }

    const binary = Buffer.from(image_base64, 'base64');
    if (binary.length > MAX_BYTES) {
      return res.status(400).json({ error: 'Bild zu groß (max. 5 MB)' });
    }

    const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
    const contentType = ALLOWED_MIME.includes(mime) ? mime : 'image/jpeg';
    const ext = contentType.includes('png') ? 'png'
      : contentType.includes('webp') ? 'webp'
      : 'jpg';

    const fileName = 'site-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;

    const uploadUrl = `${BASE}/storage/v1/object/uploads/${fileName}`;
    const r = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SVC}`,
        'apikey': SVC,
        'Content-Type': contentType,
        'x-upsert': 'true'
      },
      body: binary
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error('Storage upload failed:', r.status, txt);
      return res.status(500).json({ error: 'Upload fehlgeschlagen: ' + r.status });
    }

    const publicUrl = `${BASE}/storage/v1/object/public/uploads/${fileName}`;
    return res.status(200).json({ url: publicUrl });
  } catch (e) {
    console.error('upload.js error:', e.message);
    return res.status(500).json({ error: 'Server Fehler: ' + e.message });
  }
}

module.exports = handler;
exports.config = config;
