export const config = { maxDuration: 60 };

const ALLOWED_ORIGINS = ['https://virgoio.com', 'https://www.virgoio.com'];

// === MODELL-STEUERUNG ===
// ANTHROPIC_MODEL_PAID = Modell für zahlende Kunden + Admin (Standard: Fable 5)
// ANTHROPIC_MODEL_FREE = Modell für alle anderen (Standard: Opus 4.8)
const MODEL_PAID = process.env.ANTHROPIC_MODEL_PAID || 'claude-fable-5';
const MODEL_FREE = process.env.ANTHROPIC_MODEL_FREE || 'claude-opus-4-8';
const MODEL_REFUSAL_FALLBACK = 'claude-opus-4-8';

// Pläne, die als "zahlend" gelten (gleiche Liste wie in tools.js)
const ACTIVE_PLANS = ['makler-starter', 'makler-pro', 'makler-business'];

// Prüft Token + Plan des Users über Supabase.
async function getUserAccess(req) {
  try {
    const BASE = process.env.SUPABASE_URL;
    const SVC = process.env.SUPABASE_SERVICE_KEY;
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!token || !BASE || !SVC) return { user: null, isPaying: false };

    const r = await fetch(`${BASE}/auth/v1/user`, {
      headers: { 'apikey': SVC, 'Authorization': 'Bearer ' + token }
    });
    if (!r.ok) return { user: null, isPaying: false };
    const user = await r.json();
    if (!user || !user.id) return { user: null, isPaying: false };

    const ADMIN = process.env.ADMIN_EMAIL || 'holyencore@gmail.com';
    if (user.email === ADMIN) return { user, isPaying: true };

    let isPaying = false;
    try {
      const planR = await fetch(`${BASE}/rest/v1/users?id=eq.${user.id}&select=plan&limit=1`, {
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
      });
      if (planR.ok) {
        const planData = await planR.json();
        if (Array.isArray(planData) && planData.length > 0) {
          isPaying = ACTIVE_PLANS.includes(planData[0].plan);
        }
      }
    } catch (e) {}
    return { user, isPaying };
  } catch (e) {
    return { user: null, isPaying: false };
  }
}

// Ein einzelner Anthropic-Call inkl. Web-Suche-Tool.
async function callAnthropic(model, systemPrompt, messages) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system: systemPrompt,
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search'
        }
      ],
      messages
    })
  });
  const data = await r.json();
  if (data.type === 'error' || !data.content) {
    throw new Error('Anthropic error: ' + (data.error?.message || 'no content'));
  }
  return data;
}

export default async function handler(req, res) {
  // === ZUGRIFFSSCHUTZ (vorher war dieser Endpunkt komplett offen!) ===
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
  const ok = ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.some(o => referer.startsWith(o));
  if (!ok) {
    console.warn('⛔ Blocked agent. origin=' + origin + ' referer=' + referer);
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const { messages = [], goal } = req.body;
    const systemPrompt = `Du bist Virgo Agent — der mächtigste KI-Agent in Virgo AI. Du erledigst komplexe Aufgaben automatisch in mehreren Schritten.
DEINE FÄHIGKEITEN:
- Web-Recherche und Analyse
- Content erstellen (Posts, Emails, Texte, Skripte)
- Business-Analysen und Strategien
- Lead-Generierung Strategien
- Marktanalysen
- SEO und Marketing
- Code schreiben und debuggen
- Daten analysieren und zusammenfassen
ARBEITSWEISE:
1. Verstehe das Ziel des Users
2. Plane die Schritte
3. Führe jeden Schritt aus
4. Gib ein vollständiges, verwendbares Ergebnis zurück
WICHTIG:
- Antworte immer in der Sprache des Users
- Gib IMMER vollständige, direkt verwendbare Ergebnisse
- Keine halben Sachen — vollständig oder gar nicht
- Du heißt Virgo Agent — erwähne nie Claude oder andere KI-Systeme
- Formatiere Ergebnisse klar mit Überschriften und Listen`;

    // === MODELLWAHL: zahlender Plan oder Admin = PAID-Modell, sonst FREE-Modell ===
    const { isPaying } = await getUserAccess(req);
    const chosenModel = isPaying ? MODEL_PAID : MODEL_FREE;

    let data = await callAnthropic(chosenModel, systemPrompt, messages);
    let usedModel = chosenModel;

    // === REFUSAL-FALLBACK ===
    if (data.stop_reason === 'refusal' && chosenModel !== MODEL_REFUSAL_FALLBACK) {
      console.warn('Refusal von ' + chosenModel + ' → Retry mit ' + MODEL_REFUSAL_FALLBACK);
      data = await callAnthropic(MODEL_REFUSAL_FALLBACK, systemPrompt, messages);
      usedModel = MODEL_REFUSAL_FALLBACK;
    }

    // Text aus der Antwort ziehen (inkl. Antworten nach Web-Suche)
    let fullResponse = '';
    if (data.content) {
      for (const block of data.content) {
        if (block.type === 'text') {
          fullResponse += block.text;
        }
      }
    }

    if (data.stop_reason === 'refusal' || !fullResponse) {
      return res.status(200).json({
        content: [{ type: 'text', text: 'Bei dieser Anfrage kann ich nicht helfen. Formuliere sie bitte etwas anders.' }],
        _model: usedModel,
        _refusal: data.stop_reason === 'refusal'
      });
    }

    return res.status(200).json({
      content: [{ type: 'text', text: fullResponse }],
      stop_reason: data.stop_reason,
      _model: usedModel
    });
  } catch (err) {
    return res.status(200).json({
      content: [{ type: 'text', text: 'Virgo Agent ist gerade kurz überlastet. Bitte versuche es gleich nochmal.' }],
      _error: err.message
    });
  }
}
