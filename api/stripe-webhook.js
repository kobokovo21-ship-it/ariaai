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

async function setCredits(BASE, SVC, userId, credits) {
  await fetch(`${BASE}/rest/v1/users?id=eq.${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'apikey': SVC, 'Authorization': `Bearer ${SVC}` },
    body: JSON.stringify({ credits })
  });
}

// ── Plan + Credits aus Betrag ermitteln ──
function getPlanFromAmount(amount, currency) {
  if (currency === 'eur') {
    if (amount >= 24900) return { plan: 'makler-business', credits: 3000 };
    if (amount >= 14900) return { plan: 'makler-pro',     credits: 1000 };
    return null;
  } else {
    // USD — monatliche Credits werden ERSETZT (nicht addiert) bei Verlängerung
    if (amount >= 24999) return { plan: 'max',      credits: 15000 };
    if (amount >= 14999) return { plan: 'ultra',    credits: 8000  };
    if (amount >= 9999)  return { plan: 'master',   credits: 5000  };
    if (amount >= 4999)  return { plan: 'pro',      credits: 2000  };
    if (amount >= 1999)  return { plan: 'standard', credits: 500   };
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const BASE           = process.env.SUPABASE_URL;
  const SVC            = process.env.SUPABASE_SERVICE_KEY;
  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  const STRIPE_KEY     = process.env.STRIPE_SECRET_KEY;

  try {
    const rawBody  = await getRawBody(req);
    const sigHeader = req.headers['stripe-signature'];

    if (!WEBHOOK_SECRET) return res.status(500).json({ error: 'Webhook-Secret fehlt' });
    if (!verifyStripeSignature(rawBody, sigHeader, WEBHOOK_SECRET))
      return res.status(400).json({ error: 'Ungültige Stripe-Signatur' });

    let event;
    try { event = JSON.parse(rawBody); }
    catch { return res.status(400).json({ error: 'Ungültiger JSON-Body' }); }

    // ════════════════════════════════════════
    // ERSTER KAUF — checkout.session.completed
    // ════════════════════════════════════════
    if (event.type === 'checkout.session.completed') {
      const session  = event.data.object;
      const email    = session.customer_details?.email;
      const amount   = session.amount_total;
      const currency = (session.currency || '').toLowerCase();

      if (!email) return res.status(200).json({ received: true });

      const user = await getUserByEmail(BASE, SVC, email);
      if (!user) return res.status(200).json({ received: true });

      const result = getPlanFromAmount(amount, currency);
      if (result) {
        await setPlan(BASE, SVC, user.id, result.plan);
        // Credits: bei erstem Kauf addieren
        await setCredits(BASE, SVC, user.id, (user.credits || 0) + result.credits);
        console.log(`✅ Erster Kauf: ${email} → ${result.plan} +${result.credits}cr`);
      }
    }

    // ════════════════════════════════════════
    // MONATLICHE VERLÄNGERUNG — invoice.payment_succeeded
    // ════════════════════════════════════════
    if (event.type === 'invoice.payment_succeeded') {
      const invoice  = event.data.object;
      const email    = invoice.customer_email;
      const amount   = invoice.amount_paid;
      const currency = (invoice.currency || '').toLowerCase();

      // Nur bei echten Abo-Verlängerungen (nicht bei erstem Kauf — der kommt via checkout.session)
      if (invoice.billing_reason === 'subscription_create')
        return res.status(200).json({ received: true });

      if (!email) return res.status(200).json({ received: true });

      const user = await getUserByEmail(BASE, SVC, email);
      if (!user) return res.status(200).json({ received: true });

      const result = getPlanFromAmount(amount, currency);
      if (result) {
        await setPlan(BASE, SVC, user.id, result.plan);
        // Credits: bei Verlängerung ERSETZEN (nicht addieren — sonst sammeln sie sich auf)
        await setCredits(BASE, SVC, user.id, result.credits);
        console.log(`🔄 Verlängerung: ${email} → ${result.plan} Credits reset auf ${result.credits}cr`);
      }
    }

    // ════════════════════════════════════════
    // ABO GEKÜNDIGT — auf free zurücksetzen
    // ════════════════════════════════════════
    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      const customerId   = subscription.customer;

      try {
        const stripeRes  = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
          headers: { 'Authorization': `Bearer ${STRIPE_KEY}` }
        });
        const customer = await stripeRes.json();
        const email    = customer.email;

        if (email) {
          const user = await getUserByEmail(BASE, SVC, email);
          if (user) {
            await setPlan(BASE, SVC, user.id, 'free');
            await setCredits(BASE, SVC, user.id, 0);
            console.log(`❌ Abo gekündigt: ${email} → free, Credits 0`);
          }
        }
      } catch(e) {
        console.error('Kündigung Fehler:', e.message);
      }
    }

    // ════════════════════════════════════════
    // ZAHLUNG FEHLGESCHLAGEN — Plan sperren
    // ════════════════════════════════════════
    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      const email   = invoice.customer_email;

      if (email) {
        const user = await getUserByEmail(BASE, SVC, email);
        if (user) {
          // Plan behalten aber Credits auf 0 — User wird aufgefordert zu bezahlen
          await setCredits(BASE, SVC, user.id, 0);
          console.log(`⚠️ Zahlung fehlgeschlagen: ${email} → Credits 0`);
        }
      }
    }

    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('Webhook Fehler:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
