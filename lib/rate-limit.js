// lib/rate-limit.js — cross-instance Rate-Limiting via Supabase-RPC.
// Nutzt die SQL-Funktion rl_check(p_key, p_window_seconds, p_max) aus db/schema.sql.
// Fällt bei DB-Fehler auf in-memory (best effort, per-Instance) zurück, um bei
// Ausfällen der DB nicht die gesamte App zu blockieren.

const memBuckets = new Map();

function memCheck(key, windowSec, max) {
  const now = Date.now();
  const b = memBuckets.get(key);
  if (!b || now - b.start > windowSec * 1000) {
    memBuckets.set(key, { start: now, count: 1 });
    if (memBuckets.size > 5000) {
      // primitive Housekeeping: alte Buckets entfernen
      for (const [k, v] of memBuckets) {
        if (now - v.start > windowSec * 1000) memBuckets.delete(k);
        if (memBuckets.size < 3000) break;
      }
    }
    return { allowed: true, remaining: max - 1 };
  }
  b.count++;
  if (b.count > max) return { allowed: false, remaining: 0 };
  return { allowed: true, remaining: max - b.count };
}

export async function checkRateLimit({ key, windowSec, max }) {
  if (!key) return { allowed: true, remaining: max };
  const BASE = process.env.SUPABASE_URL;
  const SVC = process.env.SUPABASE_SERVICE_KEY;
  if (!BASE || !SVC) return memCheck(key, windowSec, max);
  try {
    const r = await fetch(`${BASE}/rest/v1/rpc/rl_check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SVC,
        'Authorization': `Bearer ${SVC}`
      },
      body: JSON.stringify({ p_key: key, p_window_seconds: windowSec, p_max: max })
    });
    if (!r.ok) return memCheck(key, windowSec, max);
    const data = await r.json();
    const row = Array.isArray(data) ? data[0] : data;
    if (row && typeof row.allowed === 'boolean') {
      return { allowed: row.allowed, remaining: row.remaining ?? 0 };
    }
    return memCheck(key, windowSec, max);
  } catch {
    return memCheck(key, windowSec, max);
  }
}

// Client-IP aus Vercel/Proxy-Headern.
export function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

// Convenience: rate-limit + optionalen Response schreiben. true = darf weitermachen.
export async function enforceRateLimit(req, res, { name, windowSec, max, key }) {
  const rlKey = key || `${name}:${clientIp(req)}`;
  const r = await checkRateLimit({ key: rlKey, windowSec, max });
  if (!r.allowed) {
    res.setHeader('Retry-After', String(windowSec));
    res.status(429).json({ error: 'Zu viele Anfragen. Bitte kurz warten und erneut versuchen.' });
    return false;
  }
  return true;
}
