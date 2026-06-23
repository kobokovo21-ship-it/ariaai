// api/upload.js — lädt ein Bild in den Supabase Storage Bucket "uploads"
// und gibt die öffentliche URL zurück.
const config = { maxDuration: 60 };

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

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

    // Dateiendung aus MIME bestimmen
    const ext = (mime && mime.includes('png')) ? 'png'
      : (mime && mime.includes('webp')) ? 'webp'
      : 'jpg';
    const contentType = mime || 'image/jpeg';

    // Eindeutiger Dateiname
    const fileName = 'site-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;

    // base64 → Binärdaten
    const binary = Buffer.from(image_base64, 'base64');

    // Upload zu Supabase Storage
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

    // Öffentliche URL zusammenbauen
    const publicUrl = `${BASE}/storage/v1/object/public/uploads/${fileName}`;
    return res.status(200).json({ url: publicUrl });

  } catch (e) {
    console.error('upload.js error:', e.message);
    return res.status(500).json({ error: 'Server Fehler: ' + e.message });
  }
}

module.exports = handler;
exports.config = config;
