// lib/higgsfield.js
// Wird von api/tools.js aufgerufen (zählt NICHT als eigene Serverless-Function,
// weil außerhalb von /api).
//
// Vorher einmalig:
//   - In package.json bei "dependencies" hinzufügen:  "@higgsfield/client": "latest"
//   - Vercel Env-Vars setzen: HIGGSFIELD_CREDENTIALS, HIGGSFIELD_VIDEO_MODEL
//   - SUPABASE_URL + SUPABASE_SERVICE_KEY hast du schon.

import { higgsfield, config } from '@higgsfield/client/v2';

config({ credentials: process.env.HIGGSFIELD_CREDENTIALS });

const BASE = process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;

// ─── KOSTEN-KONTROLLE: Videos pro Monat ────────────────────────────────
// ⚠️ WICHTIG: An DEINE echten Plan-Strings aus der users.plan-Spalte anpassen!
// Unbekannte/leere Pläne bekommen automatisch 0 (gesperrt) — bewusst so,
// weil Video teuer ist. Lieber zu wenig freischalten als zu viel.
const MONTHLY_VIDEO_LIMITS = {
  'makler-starter': 15,
  'makler-pro': 40,
  'makler-business': 120,
  'pro': 20,
  'standard': 50,
};
// ───────────────────────────────────────────────────────────────────────

// Gibt { status, body } zurück. tools.js macht daraus res.status(status).json(body).
export async function generateVideoForUser({ userId, plan, workspace, prompt, imageUrl }) {
  if (!userId) return { status: 400, body: { error: 'missing_userId' } };
  if (!prompt)  return { status: 400, body: { error: 'Kein Prompt angegeben' } };

  const limit = MONTHLY_VIDEO_LIMITS[plan] || 0;
  if (limit === 0) {
    return { status: 402, body: { error: 'locked', message: 'Video-Generierung ist in deinem Plan nicht enthalten.' } };
  }

  const used = await getMonthlyUsage(userId);
  if (used >= limit) {
    return {
      status: 402,
      body: { error: 'limit_reached', message: `Monatslimit erreicht (${used}/${limit}). Upgrade für mehr Videos.`, used, limit },
    };
  }

  const model = process.env.HIGGSFIELD_VIDEO_MODEL;
  const input = imageUrl
    ? { prompt, start_image_url: imageUrl, enhance_prompt: true }
    : { prompt, enhance_prompt: true };

  let jobSet;
  try {
    jobSet = await higgsfield.subscribe(model, { input, withPolling: true });
  } catch (e) {
    return { status: 502, body: { error: 'generation_failed', detail: String(e?.message || e) } };
  }
  if (!jobSet?.isCompleted) {
    return { status: 502, body: { error: 'generation_failed', detail: jobSet?.status } };
  }

  const out = jobSet.jobs?.[0]?.results?.raw;
  const videoUrl = out?.url || out?.video_url;
  if (!videoUrl) return { status: 502, body: { error: 'no_output' } };

  // Nutzung loggen (raw fetch — gleicher Stil wie im Rest deiner App)
  try {
    await fetch(`${BASE}/rest/v1/video_usage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SVC, 'Authorization': `Bearer ${SVC}` },
      body: JSON.stringify({
        user_id: userId,
        workspace: workspace || null,
        prompt,
        video_url: videoUrl,
        plan: plan || null,
      }),
    });
  } catch (e) { /* Logging-Fehler ist nicht fatal */ }

  return { status: 200, body: { videoUrl, used: used + 1, limit } };
}

// Zählt die Videos des laufenden Kalendermonats für einen User
async function getMonthlyUsage(userId) {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  try {
    const r = await fetch(
      `${BASE}/rest/v1/video_usage?user_id=eq.${userId}&created_at=gte.${start.toISOString()}&select=id`,
      { headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` } }
    );
    if (!r.ok) return 0;
    const rows = await r.json();
    return Array.isArray(rows) ? rows.length : 0;
  } catch (e) { return 0; }
}

