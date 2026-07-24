import { requireUser, getUserPlan, isAdminEmail } from '../lib/auth.js';
import { deductCredits } from '../lib/credits.js';
import { enforceRateLimit } from '../lib/rate-limit.js';

const ALLOWED_ORIGINS = ['https://virgoio.com', 'https://www.virgoio.com'];

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const originOk = ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.some(o => referer.startsWith(o));
  if (!originOk) return res.status(403).json({ error: 'Forbidden' });

  const user = await requireUser(req, res);
  if (!user) return;

  if (!(await enforceRateLimit(req, res, { name: 'credits:' + user.id, windowSec: 60, max: 120 }))) return;

  try {
    if (req.method === 'GET') {
      const { plan, credits } = await getUserPlan(user.id);
      return res.status(200).json({ credits, plan, is_admin: isAdminEmail(user.email) });
    }

    if (req.method === 'POST') {
      const raw = req.body?.amount;
      const amount = Math.trunc(Number(raw));
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: 'Ungültiger Credit-Betrag' });
      }
      if (amount > 1000) {
        return res.status(400).json({ error: 'Betrag zu hoch' });
      }
      const r = await deductCredits(user.id, amount);
      if (!r.success) return res.status(402).json({ error: 'Nicht genug Credits', credits: r.credits });
      return res.status(200).json({ success: true, credits: r.credits });
    }

    return res.status(405).json({ error: 'Methode nicht erlaubt' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
