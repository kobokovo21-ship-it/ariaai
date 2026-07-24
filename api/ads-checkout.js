// /api/ads-checkout.js
// Virgo – Stripe Vorkasse-Checkout für Ads
//
// SICHERHEITS-HARDENING (2026-07):
//   • Auth-Token-Pflicht (Supabase JWT, signaturvalidiert)
//   • Origin/Referer-Whitelist
//   • Rate-Limit pro User
//   • Server-seitige Validierung ALLER Parameter (dailyBudgetEuros, runDays,
//     keywords, geoTargetConstantId, finalUrl, campaignName). Der Client kann
//     keine beliebigen Werte mehr in die Stripe-metadata schmuggeln, die dann
//     im Webhook eine Google-Ads-Kampagne auf beliebige URLs starten würden.
//   • finalUrl MUSS auf die eigene Makler-Landing-Page zeigen (slug im DB-
//     Profil des eingeloggten Users) — verhindert Missbrauch des Ads-Kontos
//     für Fremdwerbung.

import { requireUser } from '../lib/auth.js';
import { enforceRateLimit } from '../lib/rate-limit.js';

const ALLOWED_ORIGINS = ['https://virgoio.com', 'https://www.virgoio.com'];
const VIRGO_FEE_RATE = 0.05;

// Erlaubte Länder-Codes für Google Ads geoTargetConstantId
// (Auswahl DACH + größere EU-Märkte; erweitern falls nötig)
const ALLOWED_GEO_IDS = new Set([
  '2276', // Deutschland
  '2040', // Österreich
  '2756', // Schweiz
  '2528', // Niederlande
  '2250', // Frankreich
  '2724', // Spanien
  '2380', // Italien
  '2056', // Belgien
  '2442', // Luxemburg
]);

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export const config = { api: { bodyParser: false } };

function badRequest(res, msg) {
  return res.status(400).json({ error: msg });
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Nur POST erlaubt.' });

  const originOk = ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.some(o => referer.startsWith(o));
  if (!originOk) return res.status(403).json({ error: 'Forbidden' });

  const user = await requireUser(req, res);
  if (!user) return;

  if (!(await enforceRateLimit(req, res, { name: 'ads-checkout:' + user.id, windowSec: 300, max: 20 }))) return;

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  const APP_URL    = process.env.APP_URL || 'https://www.virgoio.com';
  if (!STRIPE_KEY) return res.status(500).json({ error: 'Zahlungssystem nicht konfiguriert' });

  try {
    const raw  = await getRawBody(req);
    const body = raw ? JSON.parse(raw) : {};

    // ── Server-seitige Validierung ──────────────────────────
    const campaignName = String(body.campaignName || 'Virgo Kampagne').slice(0, 120).replace(/[\r\n\t]/g, ' ').trim();
    if (!campaignName) return badRequest(res, 'Kampagnenname fehlt');

    const dailyBudgetEuros = Math.trunc(Number(body.dailyBudgetEuros));
    if (!Number.isFinite(dailyBudgetEuros) || dailyBudgetEuros < 5 || dailyBudgetEuros > 500) {
      return badRequest(res, 'Tagesbudget muss zwischen 5 und 500 EUR liegen');
    }

    const runDays = Math.trunc(Number(body.runDays));
    if (!Number.isFinite(runDays) || runDays < 1 || runDays > 90) {
      return badRequest(res, 'Laufzeit muss zwischen 1 und 90 Tagen liegen');
    }

    const geoTargetConstantId = String(body.geoTargetConstantId || '2276');
    if (!ALLOWED_GEO_IDS.has(geoTargetConstantId)) {
      return badRequest(res, 'Land nicht unterstützt');
    }

    // Keywords: Array, jedes 2..80 Zeichen, nur druckbare Zeichen, max. 30 Stück
    let keywords = Array.isArray(body.keywords) ? body.keywords : [];
    keywords = keywords
      .map(k => String(k || '').trim())
      .filter(k => k.length >= 2 && k.length <= 80 && /^[\p{L}\p{N}\s\-.'&+()/]+$/u.test(k))
      .slice(0, 30);
    if (!keywords.length) return badRequest(res, 'Mindestens ein gültiges Keyword nötig');

    // finalUrl: MUSS auf virgoio.com/makler/<eigener-slug> zeigen.
    // Damit können Ads nicht auf Fremd-URLs geleitet werden.
    const rawFinalUrl = String(body.finalUrl || '').trim();
    let finalUrl;
    try { finalUrl = new URL(rawFinalUrl); }
    catch { return badRequest(res, 'Zielseite ist keine gültige URL'); }
    if (finalUrl.protocol !== 'https:') return badRequest(res, 'Zielseite muss HTTPS verwenden');
    const allowedHosts = new Set(['virgoio.com', 'www.virgoio.com']);
    if (!allowedHosts.has(finalUrl.hostname)) {
      return badRequest(res, 'Zielseite muss auf virgoio.com liegen');
    }
    // Slug aus finalUrl ableiten und gegen den Makler-Slug des Users prüfen
    const pathMatch = finalUrl.pathname.match(/^\/makler\/([a-z0-9-]{1,80})\/?$/);
    if (!pathMatch) return badRequest(res, 'Zielseite muss die eigene Makler-Landingpage sein');
    const claimedSlug = pathMatch[1];

    // DB-Lookup: Makler-Slug des eingeloggten Users
    const BASE = process.env.SUPABASE_URL;
    const SVC  = process.env.SUPABASE_SERVICE_KEY;
    const mkRes = await fetch(`${BASE}/rest/v1/makler?user_id=eq.${user.id}&select=slug,active&limit=1`, {
      headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
    });
    if (!mkRes.ok) return res.status(500).json({ error: 'Makler-Profil konnte nicht geladen werden' });
    const mkData = await mkRes.json();
    const makler = Array.isArray(mkData) && mkData[0] ? mkData[0] : null;
    if (!makler) return res.status(400).json({ error: 'Kein Makler-Profil — bitte zuerst Profil speichern' });
    if (makler.active === false) return res.status(400).json({ error: 'Makler-Profil ist nicht aktiv' });
    if (makler.slug !== claimedSlug) {
      return res.status(403).json({ error: 'Zielseite muss der eigenen Makler-URL entsprechen' });
    }

    // Email des eingeloggten Users nutzen — NICHT client-controlled
    const maklerEmail = user.email || '';

    // ── Preisberechnung ─────────────────────────────────────
    const budgetTotal = dailyBudgetEuros * runDays;
    const fee         = Math.round(budgetTotal * VIRGO_FEE_RATE * 100) / 100;
    const grandTotal  = budgetTotal + fee;

    // ── Stripe Checkout Session ─────────────────────────────
    const params = new URLSearchParams();
    params.append('mode', 'payment');
    params.append('payment_method_types[0]', 'card');
    if (maklerEmail) params.append('customer_email', maklerEmail);
    params.append('line_items[0][quantity]', '1');
    params.append('line_items[0][price_data][currency]', 'eur');
    params.append('line_items[0][price_data][unit_amount]', String(Math.round(grandTotal * 100)));
    params.append('line_items[0][price_data][product_data][name]', `Google-Ads-Kampagne: ${campaignName}`);
    params.append(
      'line_items[0][price_data][product_data][description]',
      `Werbebudget ${budgetTotal.toFixed(2)} € + Abwicklung ${fee.toFixed(2)} € (${runDays} Tage à ${dailyBudgetEuros} €)`
    );
    params.append('metadata[type]', 'ads_campaign');
    params.append('metadata[userId]', user.id);
    params.append('metadata[campaignName]', campaignName);
    params.append('metadata[dailyBudgetEuros]', String(dailyBudgetEuros));
    params.append('metadata[runDays]', String(runDays));
    params.append('metadata[keywords]', JSON.stringify(keywords));
    params.append('metadata[geoTargetConstantId]', geoTargetConstantId);
    params.append('metadata[finalUrl]', finalUrl.toString());
    params.append('metadata[maklerEmail]', maklerEmail);
    params.append('success_url', `${APP_URL}/erfolg.html?session_id={CHECKOUT_SESSION_ID}`);
    params.append('cancel_url', `${APP_URL}/abbruch.html`);

    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const session = await r.json();
    if (!r.ok) {
      console.error('Stripe-Fehler:', session);
      return res.status(500).json({ error: session?.error?.message || 'Stripe-Fehler' });
    }
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err.message || err) });
  }
}
