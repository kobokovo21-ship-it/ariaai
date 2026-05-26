// /api/ads-checkout.js
//
// Virgo – Stripe Vorkasse-Checkout für Ads
// -----------------------------------------------------------------------------
// OHNE stripe-Paket – nutzt die Stripe-API direkt per fetch (wie dein Webhook).
// Der Makler zahlt ZUERST: Werbebudget + 5 % Abwicklung. Die Kampagnen-Daten
// landen in der metadata; deine stripe-webhook.js startet die Kampagne nach
// bestätigter Zahlung (erkennt sie an metadata.type = "ads_campaign").
//
// Env Vars: STRIPE_SECRET_KEY (sk_test_…), APP_URL (z. B. https://www.virgoio.com)
// -----------------------------------------------------------------------------

const VIRGO_FEE_RATE = 0.05; // 5 % Abwicklung auf das Werbebudget

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Nur POST erlaubt.' });

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  const APP_URL    = process.env.APP_URL || 'https://www.virgoio.com';

  try {
    const raw  = await getRawBody(req);
    const body = raw ? JSON.parse(raw) : {};

    const {
      campaignName        = 'Virgo Kampagne',
      dailyBudgetEuros    = 20,
      runDays             = 30,
      keywords            = [],
      geoTargetConstantId = '2276',
      finalUrl            = APP_URL,
      maklerEmail         = ''
    } = body;

    const budgetTotal = Number(dailyBudgetEuros) * Number(runDays);
    const fee         = Math.round(budgetTotal * VIRGO_FEE_RATE * 100) / 100;
    const grandTotal  = budgetTotal + fee;

    // Stripe Checkout Session per Form-Encoding bauen
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
      `Werbebudget ${budgetTotal.toFixed(2)} \u20ac + Abwicklung ${fee.toFixed(2)} \u20ac (${runDays} Tage \u00e0 ${dailyBudgetEuros} \u20ac)`
    );
    // metadata — liest der Webhook aus:
    params.append('metadata[type]', 'ads_campaign');
    params.append('metadata[campaignName]', String(campaignName));
    params.append('metadata[dailyBudgetEuros]', String(dailyBudgetEuros));
    params.append('metadata[keywords]', JSON.stringify(keywords));
    params.append('metadata[geoTargetConstantId]', String(geoTargetConstantId));
    params.append('metadata[finalUrl]', String(finalUrl));
    params.append('metadata[maklerEmail]', String(maklerEmail));
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
