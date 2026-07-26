// lib/auth.js — gemeinsame Auth-Helper (JWT signaturvalidiert)
//
// Prüfreihenfolge:
//   1) Lokale HS256-Signaturprüfung mit SUPABASE_JWT_SECRET (schnell, offline).
//      Zusätzlich: exp, iat/nbf, aud='authenticated', role='authenticated'.
//   2) Falls kein JWT_SECRET gesetzt → Fallback auf Supabase /auth/v1/user.
//   3) Nach lokaler Signatur wird zusätzlich /auth/v1/user gefragt, damit
//      wiederrufene/gelöschte User (Signatur noch gültig, User weg) rausfliegen.

import crypto from 'crypto';

const ACTIVE_PAID_PLANS = ['makler-starter', 'makler-pro', 'makler-business', 'pro', 'standard'];

function b64urlDecode(str) {
  // JWT ist base64url — Padding + URL-Alphabet korrigieren
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function timingSafeEqualB64u(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Verifiziert HS256-JWT lokal. Wirft NICHT — gibt Payload zurück oder null.
function verifyHs256(token, secret) {
  if (!token || typeof token !== 'string' || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  let header, payload;
  try {
    header = JSON.parse(b64urlDecode(h).toString('utf8'));
    payload = JSON.parse(b64urlDecode(p).toString('utf8'));
  } catch { return null; }
  if (!header || header.alg !== 'HS256' || header.typ !== 'JWT') return null;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${h}.${p}`)
    .digest('base64')
    .replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
  if (!timingSafeEqualB64u(s, expected)) return null;
  const now = Math.floor(Date.now() / 1000);
  const skew = 30; // 30s clock-skew Toleranz
  if (typeof payload.exp === 'number' && now > payload.exp + skew) return null;
  if (typeof payload.nbf === 'number' && now + skew < payload.nbf) return null;
  if (typeof payload.iat === 'number' && payload.iat - skew > now) return null;
  // Supabase-Access-Tokens haben aud='authenticated' und role='authenticated'
  if (payload.aud && payload.aud !== 'authenticated') return null;
  if (payload.role && payload.role !== 'authenticated') return null;
  if (!payload.sub) return null;
  return payload;
}

export async function validateToken(token) {
  if (!token) return null;
  const BASE = process.env.SUPABASE_URL;
  const SVC = process.env.SUPABASE_SERVICE_KEY;
  const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
  if (!BASE || !SVC) return null;

  // 1) Lokale Signaturprüfung wenn Secret vorhanden
  if (JWT_SECRET) {
    const payload = verifyHs256(token, JWT_SECRET);
    if (!payload) return null; // Signatur ungültig / abgelaufen → hart raus
    // 2) Zusätzlich User-Existenz + aktuelle Metadaten (email!) via Supabase holen.
    //    So werden gelöschte/gesperrte User erkannt.
    try {
      const r = await fetch(`${BASE}/auth/v1/user`, {
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${token}` }
      });
      if (!r.ok) return null;
      const user = await r.json();
      if (!user?.id || user.id !== payload.sub) return null;
      return user;
    } catch { return null; }
  }

  // Fallback: nur Supabase (verifiziert Signatur serverseitig)
  try {
    const r = await fetch(`${BASE}/auth/v1/user`, {
      headers: { 'apikey': SVC, 'Authorization': `Bearer ${token}` }
    });
    if (!r.ok) return null;
    const user = await r.json();
    return user?.id ? user : null;
  } catch { return null; }
}

export function extractToken(req) {
  return (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim() || null;
}

export async function requireUser(req, res) {
  const user = await validateToken(extractToken(req));
  if (!user) {
    res.status(401).json({ error: 'Nicht eingeloggt oder Sitzung abgelaufen' });
    return null;
  }
  return user;
}

export async function getUserPlan(userId) {
  const BASE = process.env.SUPABASE_URL;
  const SVC = process.env.SUPABASE_SERVICE_KEY;
  try {
    const r = await fetch(`${BASE}/rest/v1/users?id=eq.${userId}&select=plan,credits&limit=1`, {
      headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
    });
    if (!r.ok) return { plan: 'free', credits: 0 };
    const arr = await r.json();
    const row = Array.isArray(arr) && arr[0] ? arr[0] : {};
    return { plan: row.plan || 'free', credits: row.credits ?? 0 };
  } catch {
    return { plan: 'free', credits: 0 };
  }
}

export function isPayingPlan(plan) {
  return ACTIVE_PAID_PLANS.includes(plan);
}

export function isAdminEmail(email) {
  const ADMIN = process.env.ADMIN_EMAIL || 'holyencore@gmail.com';
  return !!email && email === ADMIN;
}
