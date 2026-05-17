import crypto from 'crypto';
export const config = {
  api: { bodyParser: false }
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  const parts = sigHeader.split(',');
  const tPart = parts.find(p => p.startsWith('t='));
  if (!tPart) return false;
  const timestamp = tPart.replace('t=', '');
  const signatures = parts.filter(p => p.startsWith('v1=')).map(p => p.replace('v1=', ''));
  if (!signatures.length) return false;
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) return false;
  const signedPayload = `${timestamp}.${payload}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  return signatures.some(sig => {
    try {
      const sigBuf = Buffer.from(sig, 'hex');
      return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
    } catch { return false; }
  });
}

async function getUserByEmail(BASE, SVC, email) {
  const r = await fetch(`${BASE}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=id,credits&limit=1`, {
    headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
  });
  const users = await r.json();
  return Array.isArray(users) && users.length > 0 ? users[0] : null;
}

async function setPlan(BASE, SVC, userId, plan) {
  await fetch(`${BASE}/rest/v1/users?id=eq.${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'apikey': SVC, 'Authorization': `Bearer ${SVC}` },
    body: JSON.stringify({ plan })
  });
}

async function addCredits(BASE, SVC, userId, currentCredits, creditsToAdd) {
  await fetch(`${BASE}/rest/v1/users?id=eq.${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'apikey': SVC, 'Authorization': `Bearer ${SVC}` },
    body: JSON.stringify({ credits: currentCredits + creditsToAdd })
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const BASE = process.env.SUPABASE_URL;
  const SVC = process.env.SUPABASE_SERVICE_KEY;
  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

  try {
    const rawBody = await getRawBody(req);
    const sigHeader = req.headers['stripe-signature'];

    if (!WEBHOOK_SECRET) return res.status(500).json({ error: 'Webhook-Secret nicht konfiguriert' });
    if (!verifyStripeSignature(rawBody, sigHeader, WEBHOOK_SECRET)) return res.status(400).json({ error: 'Ungültige Stripe-Signatur' });

    let event;
    try { event = JSON.parse(rawBody); } catch { return res.status(400).json({ error: 'Ungültiger JSON-Body' }); }

    // ── KAUF ABGESCHLOSSEN ──
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const email = session.customer_details?.email;
      const amount = session.amount_total;
      const currency = (session.currency || '').toLowerCase();

      if (!email) return res.status(200).json({ received: true });

      const user = await getUserByEmail(BASE, SVC, email);
      if (!user) return res.status(200).json({ received: true });

      // ── MAKLER PLÄNE (EUR) ──
      if (currency === 'eur') {
        let plan = null;
        if (amount >= 24900) plan = 'makler-business';     // €249
        else if (amount >= 14900) plan = 'makler-pro';     // €149

        if (plan) {
          await setPlan(BASE, SVC, user.id, plan);
        }

      // ── REGULÄRE CREDIT PLÄNE (USD) ──
      } else {
        let creditsToAdd = 0;
        let plan = 'free';

        if (amount >= 24999) { creditsToAdd = 15000; plan = 'max'; }
        else if (amount >= 14999) { creditsToAdd = 8000; plan = 'ultra'; }
        else if (amount >= 9999) { creditsToAdd = 5000; plan = 'master'; }
        else if (amount >= 4999) { creditsToAdd = 2000; plan = 'pro'; }
        else if (amount >= 1999) { creditsToAdd = 500; plan = 'standard'; }

        if (creditsToAdd > 0) {
          await addCredits(BASE, SVC, user.id, user.credits || 0, creditsToAdd);
          await setPlan(BASE, SVC, user.id, plan);
        }
      }
    }

    // ── ABO GEKÜNDIGT → Plan auf free zurücksetzen ──
    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      const customerId = subscription.customer;
      try {
        const stripeRes = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
          headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}` }
        });
        const customer = await stripeRes.json();
        const email = customer.email;
        if (email) {
          const user = await getUserByEmail(BASE, SVC, email);
          if (user) await setPlan(BASE, SVC, user.id, 'free');
        }
      } catch(e) {}
    }

    return res.status(200).json({ received: true });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
