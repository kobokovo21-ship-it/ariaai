// api/upload.js — lädt ein Bild ODER Hero-Video in den Supabase Storage Bucket "uploads"
//
// SICHERHEITS-HARDENING (2026-07):
//   • Echte Auth-Pflicht (Supabase JWT, signaturvalidiert)
//   • Rate-Limit pro User (verhindert Storage-Missbrauch)
//   • Magic-Byte-Prüfung zusätzlich zur MIME-Angabe des Clients
//
// UPDATE (2026-07-29): Video-Upload (MP4/MOV) für Kunden-Hero-Videos hinzugefügt.
// UPDATE (2026-07-30): Signierte Direkt-Upload-URL für Video ergänzt (action:'sign').
//   Grund: Videos als Base64 durch diese Funktion schlagen bei Vercels
//   Payload-Limit mit HTTP 413 fehl. Der 'sign'-Pfad schickt keine Videodaten
//   durch Vercel — er gibt nur eine kurzlebige Supabase-Upload-URL zurück,
//   die das Frontend direkt (Browser → Supabase) für den echten Upload nutzt.
//   Der alte Base64-Video-Pfad bleibt als Fallback für kleine Dateien erhalten.

import { requireUser } from '../lib/auth.js';
import { enforceRateLimit } from '../lib/rate-limit.js';

export const config = { maxDuration: 60 };

const ALLOWED_ORIGINS = ['https://virgoio.com', 'https://www.virgoio.com'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;   // 5 MB für Bilder (unverändert)
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;  // 60 MB für Hero-Videos

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

// MP4/MOV liegen als ISO-BMFF vor: Byte 4-7 ist immer "ftyp", danach ein
// 4-Byte "Major Brand" (mp42, isom, qt  , M4V , etc). Das ist zuverlässiger
// als die vom Client gesendete MIME-Angabe, die sich fälschen lässt.
function detectVideoMime(buf) {
  if (!buf || buf.length < 12) return null;
  const ftyp = buf.slice(4, 8).toString('ascii');
  if (ftyp !== 'ftyp') return null;
  const brand = buf.slice(8, 12).toString('ascii').trim().toLowerCase();
  if (brand === 'qt') return 'video/quicktime';
  // mp42, isom, mp41, msnv, M4V, avc1, iso2, iso5, iso6, dash usw. → alles MP4-Familie
  return 'video/mp4';
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

  // ── SIGNIERTE DIREKT-UPLOAD-URL (Video) ──────────────────────────────────
  // Grund: Vercel-Functions haben ein Payload-Limit (~4,5 MB). Ein Video als
  // Base64 durch diese Funktion zu schicken schlägt bei größeren Dateien mit
  // HTTP 413 fehl, BEVOR unser Code überhaupt läuft. Lösung: dieser Endpoint
  // schickt selbst KEINE Videodaten — er fragt Supabase nur nach einer
  // kurzlebigen, signierten Upload-URL (winzige Antwort) und gibt sie ans
  // Frontend zurück. Das Frontend lädt die Videodatei dann DIREKT zu
  // Supabase Storage hoch, komplett an Vercel vorbei.
  if (req.body && req.body.action === 'sign') {
    const { kind: signKind, mime: signMime } = req.body;
    if (signKind !== 'video') return res.status(400).json({ error: 'Signierte Upload-URL nur für Video verfügbar' });
    if (!/^video\/(mp4|quicktime)$/i.test(signMime || '')) return res.status(400).json({ error: 'Nur MP4/MOV erlaubt' });

    // Gleiches Limit wie beim (jetzt nicht mehr genutzten) Base64-Video-Pfad.
    if (!(await enforceRateLimit(req, res, { name: 'upload-video-sign:' + user.id, windowSec: 600, max: 10 }))) return;

    const BASE = process.env.SUPABASE_URL;
    const SVC = process.env.SUPABASE_SERVICE_KEY;
    const ANON = process.env.SUPABASE_ANON_KEY;
    if (!BASE || !SVC || !ANON) return res.status(500).json({ error: 'Storage nicht konfiguriert (SUPABASE_ANON_KEY fehlt?)' });

    const ext = signMime === 'video/quicktime' ? 'mov' : 'mp4';
    const rand = Math.random().toString(36).slice(2, 10);
    const fileName = `v-${user.id.slice(0, 8)}-${Date.now()}-${rand}.${ext}`;

    try {
      // Supabase Storage: POST .../object/upload/sign/{bucket}/{path} (Service-Key,
      // NUR serverseitig — der Service-Key darf nie ans Frontend). Antwort enthält
      // eine relative signierte URL mit Einmal-Token für den eigentlichen Upload.
      const signRes = await fetch(`${BASE}/storage/v1/object/upload/sign/uploads/${fileName}`, {
        method: 'POST',
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!signRes.ok) {
        const t = await signRes.text();
        console.error('Signed URL creation failed:', signRes.status, t);
        return res.status(500).json({ error: 'Signierte Upload-URL konnte nicht erstellt werden' });
      }
      const signData = await signRes.json();
      if (!signData || !signData.url) return res.status(500).json({ error: 'Unerwartete Antwort von Supabase (kein url-Feld)' });

      const uploadUrl = `${BASE}/storage/v1${signData.url}`;
      const publicUrl = `${BASE}/storage/v1/object/public/uploads/${fileName}`;
      // ANON-Key ist bewusst öffentlich/sicher zu teilen (Supabase-Designprinzip,
      // durch Row-Level-Security abgesichert) — kein Sicherheitsrisiko.
      return res.status(200).json({ uploadUrl, publicUrl, anonKey: ANON });
    } catch (e) {
      console.error('upload sign error:', e.message);
      return res.status(500).json({ error: 'Server Fehler bei Signierung' });
    }
  }

  // Video-Uploads sind teurer (Storage + Bandbreite) → eigenes, engeres Limit.
  const { image_base64, mime, kind } = req.body || {};
  const isVideo = kind === 'video';

  if (isVideo) {
    // 10 Video-Uploads pro 10 Minuten pro User
    if (!(await enforceRateLimit(req, res, { name: 'upload-video:' + user.id, windowSec: 600, max: 10 }))) return;
  } else {
    // 30 Bild-Uploads pro 5 Minuten pro User — normaler Betrieb, kein Storage-Flood
    if (!(await enforceRateLimit(req, res, { name: 'upload:' + user.id, windowSec: 300, max: 30 }))) return;
  }

  try {
    const BASE = process.env.SUPABASE_URL;
    const SVC = process.env.SUPABASE_SERVICE_KEY;
    if (!BASE || !SVC) return res.status(500).json({ error: 'Storage nicht konfiguriert' });

    if (!image_base64 || typeof image_base64 !== 'string') return res.status(400).json({ error: isVideo ? 'Kein Video übergeben' : 'Kein Bild übergeben' });

    const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (image_base64.length > (maxBytes / 3) * 4 + 100) {
      return res.status(400).json({ error: isVideo ? 'Video zu groß (max. 60 MB)' : 'Bild zu groß' });
    }

    let binary;
    try { binary = Buffer.from(image_base64, 'base64'); }
    catch { return res.status(400).json({ error: isVideo ? 'Ungültige Video-Daten' : 'Ungültige Bild-Daten' }); }

    if (!binary.length) return res.status(400).json({ error: isVideo ? 'Leeres Video' : 'Leeres Bild' });
    if (binary.length > maxBytes) return res.status(400).json({ error: isVideo ? 'Video zu groß (max. 60 MB)' : 'Bild zu groß (max. 5 MB)' });

    let contentType, ext;

    if (isVideo) {
      // Magic-Byte-Prüfung für Video: verhindert getarnte Dateien mit gefaktem MIME-Header.
      const detected = detectVideoMime(binary);
      if (!detected) return res.status(400).json({ error: 'Datei ist kein gültiges MP4/MOV-Video' });
      contentType = detected;
      ext = contentType === 'video/quicktime' ? 'mov' : 'mp4';
    } else {
      // Magic-Byte-Prüfung: verhindert das Hochladen beliebiger Dateien mit
      // gefaktem MIME-Header (z.B. HTML, JS, SVG mit Skripten).
      const detected = detectImageMime(binary);
      if (!detected) return res.status(400).json({ error: 'Datei ist kein gültiges JPEG/PNG/WebP' });
      contentType = detected;
      ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
    }

    const rand = Math.random().toString(36).slice(2, 10);
    const prefix = isVideo ? 'v' : 'u';
    const fileName = `${prefix}-${user.id.slice(0, 8)}-${Date.now()}-${rand}.${ext}`;

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
    return res.status(200).json({ url: publicUrl, kind: isVideo ? 'video' : 'image' });
  } catch (e) {
    console.error('upload.js error:', e.message);
    return res.status(500).json({ error: 'Server Fehler' });
  }
}
