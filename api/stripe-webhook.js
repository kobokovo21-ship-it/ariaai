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
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const email = session.customer_details?.email;
      const amount = session.amount_total;
      let creditsToAdd = 0;
      if (amount >= 24999) creditsToAdd = 15000;
      else if (amount >= 14999) creditsToAdd = 8000;
      else if (amount >= 9999) creditsToAdd = 5000;
      else if (amount >= 4999) creditsToAdd = 2000;
      else if (amount >= 1999) creditsToAdd = 500;
      if (email && creditsToAdd > 0) {
        const usersRes = await fetch(`${BASE}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=id,credits&limit=1`, {
          headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
        });
        const users = await usersRes.json();
        if (Array.isArray(users) && users.length > 0) {
          const user = users[0];
          await fetch(`${BASE}/rest/v1/users?id=eq.${user.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'apikey': SVC, 'Authorization': `Bearer ${SVC}` },
            body: JSON.stringify({ credits: user.credits + creditsToAdd })
          });
        }
      }
    }
    return res.status(200).json({ received: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

