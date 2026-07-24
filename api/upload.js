// api/upload.js — lädt ein Bild in den Supabase Storage Bucket "uploads"
//
// SICHERHEITS-HARDENING (2026-07):
//   • Echte Auth-Pflicht (Supabase JWT, signaturvalidiert)
//   • Rate-Limit pro User (verhindert Storage-Missbrauch)
//   • Magic-Byte-Prüfung zusätzlich zur MIME-Angabe des Clients

import { requireUser } from '../lib/auth.js';
import { enforceRateLimit } from '../lib/rate-limit.js';

export const config = { maxDuration: 60 };

const ALLOWED_ORIGINS = ['https://virgoio.com', 'https://www.virgoio.com'];
const MAX_BYTES = 5 * 1024 * 1024;

function detectImageMime(buf) {
  if (!buf || buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  // WebP: 52 49 46 46 xx xx xx xx 57 45 42 50
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  return null;
}

export default async function handler(req, res) {
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

  const originOk = ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.some(o => referer.startsWith(o));
  if (!originOk) return res.status(403).json({ error: 'Forbidden' });

  const user = await requireUser(req, res);
  if (!user) return;

  // 30 Uploads pro 5 Minuten pro User — normaler Betrieb, kein Storage-Flood
  if (!(await enforceRateLimit(req, res, { name: 'upload:' + user.id, windowSec: 300, max: 30 }))) return;

  try {
    const BASE = process.env.SUPABASE_URL;
    const SVC = process.env.SUPABASE_SERVICE_KEY;
    if (!BASE || !SVC) return res.status(500).json({ error: 'Storage nicht konfiguriert' });

    const { image_base64, mime } = req.body || {};
    if (!image_base64 || typeof image_base64 !== 'string') return res.status(400).json({ error: 'Kein Bild übergeben' });
    if (image_base64.length > (MAX_BYTES / 3) * 4 + 100) return res.status(400).json({ error: 'Bild zu groß' });

    let binary;
    try { binary = Buffer.from(image_base64, 'base64'); }
    catch { return res.status(400).json({ error: 'Ungültige Bild-Daten' }); }

    if (!binary.length) return res.status(400).json({ error: 'Leeres Bild' });
    if (binary.length > MAX_BYTES) return res.status(400).json({ error: 'Bild zu groß (max. 5 MB)' });

    // Magic-Byte-Prüfung: verhindert das Hochladen beliebiger Dateien mit
    // gefaktem MIME-Header (z.B. HTML, JS, SVG mit Skripten).
    const detected = detectImageMime(binary);
    if (!detected) return res.status(400).json({ error: 'Datei ist kein gültiges JPEG/PNG/WebP' });
    const contentType = detected;
    const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';

    const rand = Math.random().toString(36).slice(2, 10);
    const fileName = `u-${user.id.slice(0, 8)}-${Date.now()}-${rand}.${ext}`;

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
      return res.status(500).json({ error: 'Upload fehlgeschlagen' });
    }

    const publicUrl = `${BASE}/storage/v1/object/public/uploads/${fileName}`;
    return res.status(200).json({ url: publicUrl });
  } catch (e) {
    console.error('upload.js error:', e.message);
    return res.status(500).json({ error: 'Server Fehler' });
  }
}
