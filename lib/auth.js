// lib/auth.js — gemeinsame Auth-Helper (JWT signaturvalidiert via Supabase)
// Nutzt Supabase /auth/v1/user als Signatur-Verifier. Ungültige/gefälschte
// Tokens ergeben !r.ok — wir lehnen sie hart ab.

const ACTIVE_PAID_PLANS = ['makler-starter', 'makler-pro', 'makler-business', 'pro', 'standard'];

export async function validateToken(token) {
  if (!token) return null;
  const BASE = process.env.SUPABASE_URL;
  const SVC = process.env.SUPABASE_SERVICE_KEY;
  if (!BASE || !SVC) return null;
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
