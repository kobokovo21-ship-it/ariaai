// /api/ads-checkout.js
//
// Virgo – Stripe Vorkasse-Checkout für Ads (die EINE neue Funktion → 11 wird 12)
// -----------------------------------------------------------------------------
// Der Makler zahlt ZUERST: Werbebudget + Virgo-Gebühr. Die Kampagnen-Daten
// landen in der Stripe-metadata. Deine bestehende stripe-webhook.js legt die
// Kampagne erst nach bestätigter Zahlung an (siehe Snippet, das ich dir gebe).
//
// Setup:
//   npm install stripe
//   Env Vars: STRIPE_SECRET_KEY (sk_test_…), APP_URL (z. B. https://www.virgoio.com)
// -----------------------------------------------------------------------------

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const VIRGO_FEE_RATE = 0.2; // 20 % Service-Fee auf das Werbebudget

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Nur POST erlaubt." });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      campaignName = "Virgo Kampagne",
      dailyBudgetEuros = 20,
      runDays = 30,
      keywords = [],
      geoTargetConstantId = "2276",
      finalUrl = process.env.APP_URL || "https://www.virgoio.com",
      maklerEmail = "",
    } = body;

    const budgetTotal = Number(dailyBudgetEuros) * Number(runDays);
    const fee = Math.round(budgetTotal * VIRGO_FEE_RATE * 100) / 100;
    const grandTotal = budgetTotal + fee;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: maklerEmail || undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: Math.round(grandTotal * 100),
            product_data: {
              name: `Google-Ads-Kampagne: ${campaignName}`,
              description: `Werbebudget ${budgetTotal.toFixed(2)} € + Virgo-Service ${fee.toFixed(2)} € (${runDays} Tage à ${dailyBudgetEuros} €)`,
            },
          },
        },
      ],
      // 'type' kennzeichnet dies als Ads-Zahlung, damit dein Webhook es erkennt:
      metadata: {
        type: "ads_campaign",
        campaignName,
        dailyBudgetEuros: String(dailyBudgetEuros),
        keywords: JSON.stringify(keywords),
        geoTargetConstantId: String(geoTargetConstantId),
        finalUrl,
        maklerEmail,
      },
      success_url: `${process.env.APP_URL || finalUrl}/erfolg.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL || finalUrl}/abbruch.html`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err.message || err) });
  }
}
