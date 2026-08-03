// api/admin-generate-codes.js — Admin-only: erzeugt auf einmal N Zugangscodes
// (z.B. 100 Stück für ein Jobcenter). Jeder Code ist genau einmal einlösbar
// und schaltet beim Einlösen automatisch den hinterlegten Plan frei.
//
// Workflow: Admin ruft diesen Endpoint auf → bekommt eine Liste von Codes
// zurück → gibt die Codes (Papier, Liste, PDF — egal wie) ans Jobcenter →
// jede Person löst ihren eigenen Code über /api/redeem-code ein.

import { requireUser, isAdminEmail } from '../lib/auth.js';
import { enforceRateLimit } from '../lib/rate-limit.js';
import crypto from 'crypto';

export const config = { maxDuration: 30 };

const ALLOWED_ORIGINS = ['https://virgoio.com', 'https://www.virgoio.com'];
// NUR Business-Tarife dürfen per Code vergeben werden — keine Makler-Tarife.
// Achtung, Namensfalle: "makler-business" heißt zwar "business" im Namen,
// gehört aber zur Makler-Produktlinie (makler-starter/-pro/-business sind die
// drei Makler-Stufen). Der eigentliche Business-Workspace-Tarif ist 'pro'
// bzw. 'standard'. Falls das bei euch anders zugeordnet ist, hier anpassen.
const ALLOWED_PLANS = ['pro', 'standard'];
const MAX_BATCH = 500; // Sicherheitsdeckel gegen Versehen (z.B. 500 statt 50 eingetippt)

function generateCode() {
  // Format VIRGO-XXXX-XXXX — ohne verwechselbare Zeichen (0/O, 1/I/l)
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const part = () => {
    const bytes = crypto.randomBytes(4);
    let s = '';
    for (let i = 0; i < 4; i++) s += alphabet[bytes[i] % alphabet.length];
    return s;
  };
  return `VIRGO-${part()}-${part()}`;
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
  if (!isAdminEmail(user.email)) return res.status(403).json({ error: 'Nur für Admin verfügbar' });

  if (!(await enforceRateLimit(req, res, { name: 'admin-gen-codes:' + user.id, windowSec: 3600, max: 10 }))) return;

  try {
    const BASE = process.env.SUPABASE_URL;
    const SVC = process.env.SUPABASE_SERVICE_KEY;
    if (!BASE || !SVC) return res.status(500).json({ error: 'Storage nicht konfiguriert' });

    const { count, plan, batch_label } = req.body || {};
    const n = Math.trunc(Number(count));
    if (!Number.isFinite(n) || n < 1 || n > MAX_BATCH) {
      return res.status(400).json({ error: `Anzahl muss zwischen 1 und ${MAX_BATCH} liegen` });
    }
    const chosenPlan = ALLOWED_PLANS.includes(plan) ? plan : 'pro';
    const label = batch_label ? String(batch_label).trim().slice(0, 120) : null;

    // Codes generieren, Duplikate innerhalb des Batches ausschließen
    const codes = new Set();
    while (codes.size < n) codes.add(generateCode());
    const rows = Array.from(codes).map(code => ({
      code, plan: chosenPlan, batch_label: label, created_by: user.id
    }));

    const r = await fetch(`${BASE}/rest/v1/access_codes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SVC,
        'Authorization': `Bearer ${SVC}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(rows)
    });
    if (!r.ok) {
      const t = await r.text();
      console.error('access_codes insert failed:', r.status, t);
      return res.status(500).json({ error: 'Codes konnten nicht gespeichert werden' });
    }
    const inserted = await r.json();

    return res.status(200).json({
      success: true,
      count: inserted.length,
      plan: chosenPlan,
      batch_label: label,
      codes: inserted.map(row => row.code)
    });
  } catch (e) {
    console.error('admin-generate-codes error:', e.message);
    return res.status(500).json({ error: 'Server Fehler: ' + e.message });
  }
}
