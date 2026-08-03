// api/redeem-code.js — jeder eingeloggte Nutzer kann hier seinen Zugangscode
// einlösen (z.B. vom Jobcenter bekommen) und bekommt sofort den hinterlegten
// Plan freigeschaltet. Jeder Code funktioniert genau EINMAL.

import { requireUser } from '../lib/auth.js';
import { enforceRateLimit, clientIp } from '../lib/rate-limit.js';

export const config = { maxDuration: 30 };

const ALLOWED_ORIGINS = ['https://virgoio.com', 'https://www.virgoio.com'];
const DEFAULT_CREDITS = 5000; // wie bei admin-create-access — kein Stripe-Abo dahinter, siehe Hinweis dort

function normalizeCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
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

  // Brute-Force-Schutz: Codes erraten wird so unattraktiv (pro User UND pro IP begrenzt)
  if (!(await enforceRateLimit(req, res, { name: 'redeem:user:' + user.id, windowSec: 300, max: 10 }))) return;
  if (!(await enforceRateLimit(req, res, { name: 'redeem:ip:' + clientIp(req), windowSec: 300, max: 20 }))) return;

  try {
    const BASE = process.env.SUPABASE_URL;
    const SVC = process.env.SUPABASE_SERVICE_KEY;
    if (!BASE || !SVC) return res.status(500).json({ error: 'Storage nicht konfiguriert' });

    const code = normalizeCode(req.body?.code);
    if (!code) return res.status(400).json({ error: 'Bitte einen Code eingeben' });

    // Code nachschlagen
    const lookupRes = await fetch(`${BASE}/rest/v1/access_codes?code=eq.${encodeURIComponent(code)}&select=code,plan,used`, {
      headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
    });
    if (!lookupRes.ok) return res.status(500).json({ error: 'Code konnte nicht geprüft werden' });
    const rows = await lookupRes.json();
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Dieser Code ist ungültig' });
    if (row.used) return res.status(400).json({ error: 'Dieser Code wurde bereits eingelöst' });

    // Atomar als "benutzt" markieren — der Filter used=eq.false verhindert,
    // dass derselbe Code zweimal fast gleichzeitig eingelöst wird (Race-Schutz).
    const claimRes = await fetch(`${BASE}/rest/v1/access_codes?code=eq.${encodeURIComponent(code)}&used=eq.false`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SVC,
        'Authorization': `Bearer ${SVC}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ used: true, used_by: user.id, used_at: new Date().toISOString() })
    });
    if (!claimRes.ok) return res.status(500).json({ error: 'Code konnte nicht eingelöst werden' });
    const claimed = await claimRes.json();
    if (!claimed.length) return res.status(400).json({ error: 'Dieser Code wurde gerade eben schon eingelöst' });

    // Plan + Credits beim Nutzer setzen
    const updateRes = await fetch(`${BASE}/rest/v1/users?id=eq.${user.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SVC,
        'Authorization': `Bearer ${SVC}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ plan: row.plan, credits: DEFAULT_CREDITS })
    });
    if (!updateRes.ok) {
      console.error('user plan update after redeem failed:', await updateRes.text());
      return res.status(500).json({ error: 'Code eingelöst, aber Plan konnte nicht gesetzt werden — bitte melde dich beim Support' });
    }

    return res.status(200).json({ success: true, plan: row.plan, credits: DEFAULT_CREDITS });
  } catch (e) {
    console.error('redeem-code error:', e.message);
    return res.status(500).json({ error: 'Server Fehler: ' + e.message });
  }
}
