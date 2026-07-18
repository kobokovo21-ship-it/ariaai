export const config = { maxDuration: 60 };

const ALLOWED_ORIGINS = ['https://virgoio.com', 'https://www.virgoio.com'];

const MAX_URLS = 40;
const MAX_BYTES = 12 * 1024 * 1024; // 12 MB per image
const FETCH_TIMEOUT_MS = 15000;

// Block obvious SSRF targets. The URLs come from generated post HTML, which is
// attacker-influenceable, and this endpoint returns the fetched bytes to the
// caller -- so refuse anything that isn't a public https image host.
function isBlockedHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  // IPv4 literal in a private / link-local / loopback range
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;          // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true;          // private
    if (a >= 224) return true;                        // multicast / reserved
  }
  // IPv6 loopback / link-local / unique-local
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  return false;
}

async function fetchAsDataUri(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { error: 'invalid_url' };
  }
  if (url.protocol !== 'https:') return { error: 'not_https' };
  if (isBlockedHost(url.hostname)) return { error: 'blocked_host' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url.toString(), {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { Accept: 'image/*' },
    });
    if (!r.ok) return { error: 'http_' + r.status };

    const ct = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!ct.startsWith('image/')) return { error: 'not_an_image' };

    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length === 0) return { error: 'empty' };
    if (buf.length > MAX_BYTES) return { error: 'too_large' };

    return { dataUri: `data:${ct};base64,${buf.toString('base64')}` };
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'timeout' : 'fetch_failed' };
  } finally {
    clearTimeout(timer);
  }
}

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

  const urls = req.body && Array.isArray(req.body.urls) ? req.body.urls : null;
  if (!urls) return res.status(400).json({ error: 'urls[] required' });
  if (urls.length > MAX_URLS) return res.status(400).json({ error: 'too_many_urls' });

  const unique = [...new Set(urls.filter(u => typeof u === 'string'))];
  const map = {};
  const errors = {};
  await Promise.all(
    unique.map(async (u) => {
      const out = await fetchAsDataUri(u);
      if (out.dataUri) map[u] = out.dataUri;
      else errors[u] = out.error;
    }),
  );

  return res.status(200).json({ map, errors });
}
