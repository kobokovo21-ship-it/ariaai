// /lib/google-ads.js
//
// Virgo – Google Ads Kampagnen-Logik (HILFSMODUL, kein API-Endpunkt!)
// -----------------------------------------------------------------------------
// Liegt bewusst in /lib und NICHT in /api -> zählt NICHT als Vercel-Funktion.
// Wird von api/stripe-webhook.js importiert und aufgerufen.
//
// Baut eine komplette Such-Kampagne über die Google Ads REST API:
//   1. Budget  2. Kampagne (PAUSED)  3. Geo-Targeting
//   4. Anzeigengruppe  5. Keywords   6. Responsive Search Ad
//
// Läuft im TEST-Modus (Test-Zugriff) nur gegen Google-Testkonten.
// Nach der Basic-Freigabe derselbe Code gegen echte Konten – ohne Änderung.
//
// Benötigte Env Vars:
//   GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET,
//   GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_LOGIN_CUSTOMER_ID,
//   GOOGLE_ADS_TEST_CUSTOMER_ID
// -----------------------------------------------------------------------------

// Falls Google "unsupported version" meldet -> nur hier hochsetzen (z. B. "v19").
const API_VERSION = "v18";
const ADS_HOST = `https://googleads.googleapis.com/${API_VERSION}`;
const TOKEN_URL = "https://oauth2.googleapis.com/token";

async function getAccessToken() {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Token-Refresh fehlgeschlagen: " + JSON.stringify(data));
  return data.access_token;
}

async function mutate(accessToken, customerId, resource, operations) {
  const res = await fetch(`${ADS_HOST}/customers/${customerId}/${resource}:mutate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
      "login-customer-id": process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ operations }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Fehler bei ${resource}: ` + JSON.stringify(data?.error || data));
  return data.results.map((r) => r.resourceName);
}

export async function createCampaign({
  customerId,
  campaignName = "Virgo Kampagne",
  dailyBudgetEuros = 20,
  keywords = ["versicherung beratung"],
  geoTargetConstantId = "2276", // 2276 = Deutschland
  headlines = ["Jetzt kostenlos beraten lassen", "Ihr Versicherungsexperte", "Persönliche Beratung"],
  descriptions = ["Unverbindliche Beratung in Ihrer Region.", "Schnell, persönlich, kompetent."],
  finalUrl = "https://www.virgoio.com",
}) {
  if (!customerId) throw new Error("customerId (Ziel-Kontonummer) fehlt.");

  const accessToken = await getAccessToken();
  const micros = Math.round(dailyBudgetEuros * 1_000_000);
  const stamp = Date.now();
  const kw = keywords && keywords.length ? keywords : ["versicherung beratung"];

  const [budget] = await mutate(accessToken, customerId, "campaignBudgets", [
    { create: { name: `${campaignName} – Budget ${stamp}`, amountMicros: micros, deliveryMethod: "STANDARD", explicitlyShared: false } },
  ]);

  const [campaign] = await mutate(accessToken, customerId, "campaigns", [
    {
      create: {
        name: `${campaignName} ${stamp}`,
        status: "PAUSED",
        advertisingChannelType: "SEARCH",
        campaignBudget: budget,
        networkSettings: { targetGoogleSearch: true, targetSearchNetwork: true, targetContentNetwork: false, targetPartnerSearchNetwork: false },
        manualCpc: {},
      },
    },
  ]);

  await mutate(accessToken, customerId, "campaignCriteria", [
    { create: { campaign, location: { geoTargetConstant: `geoTargetConstants/${geoTargetConstantId}` } } },
  ]);

  const [adGroup] = await mutate(accessToken, customerId, "adGroups", [
    { create: { name: `${campaignName} – Anzeigengruppe ${stamp}`, campaign, status: "ENABLED", type: "SEARCH_STANDARD", cpcBidMicros: 1_000_000 } },
  ]);

  await mutate(
    accessToken,
    customerId,
    "adGroupCriteria",
    kw.map((k) => ({ create: { adGroup, status: "ENABLED", keyword: { text: k, matchType: "PHRASE" } } }))
  );

  const [ad] = await mutate(accessToken, customerId, "adGroupAds", [
    {
      create: {
        adGroup,
        status: "ENABLED",
        ad: {
          finalUrls: [finalUrl],
          responsiveSearchAd: {
            headlines: headlines.slice(0, 15).map((t) => ({ text: t })),
            descriptions: descriptions.slice(0, 4).map((t) => ({ text: t })),
          },
        },
      },
    },
  ]);

  return { budget, campaign, adGroup, ad };
}

// Geo-IDs: Deutschland 2276 | Düsseldorf 1004979 | Köln 1004959 | Berlin 1003854
