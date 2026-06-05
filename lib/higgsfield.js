// lib/higgsfield.js
// WICHTIG: Diese Datei liegt in /lib (NICHT in /api), damit Vercel sie nicht
// als eigene Serverless-Function zählt. Sie wird von einer bestehenden
// Function (z.B. api/tools.js) importiert und aufgerufen.
//
// Vorher einmalig:
//   npm i @higgsfield/client @supabase/supabase-js
//   Vercel Env-Vars: HIGGSFIELD_CREDENTIALS, HIGGSFIELD_VIDEO_MODEL,
//                    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { higgsfield, config } from '@higgsfield/client/v2';
import { createClient } from '@supabase/supabase-js';

config({ credentials: process.env.HIGGSFIELD_CREDENTIALS });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --- KOSTEN-KONTROLLE (Videos pro Monat) -------------------------------
const MONTHLY_VIDEO_LIMITS = {
  free: 0,
  pro: 5,
  premium: 20,
};
// -----------------------------------------------------------------------

// Gibt { status, body } zurück. Der aufrufende Endpoint macht daraus
// res.status(status).json(body).
export async function generateVideoForUser({ userId, plan = 'free', workspace, prompt, imageUrl }) {
  if (!userId) return { status: 400, body: { error: 'missing_userId' } };
  if (!prompt)  return { status: 400, body: { error: 'missing_prompt' } };

  const limit = MONTHLY_VIDEO_LIMITS[plan] ?? 0;
  if (limit === 0) {
    return { status: 402, body: { error: 'locked', message: 'Video ist in deinem Plan nicht enthalten.' } };
  }

  const used = await getMonthlyUsage(userId);
  if (used >= limit) {
    return {
      status: 402,
      body: { error: 'limit_reached', message: `Monatslimit erreicht (${used}/${limit}).`, used, limit },
    };
  }

  const model = process.env.HIGGSFIELD_VIDEO_MODEL;
  const input = imageUrl
    ? { prompt, start_image_url: imageUrl, enhance_prompt: true }
    : { prompt, enhance_prompt: true };

  const jobSet = await higgsfield.subscribe(model, { input, withPolling: true });
  if (!jobSet.isCompleted) {
    return { status: 502, body: { error: 'generation_failed', detail: jobSet.status } };
  }

  const out = jobSet.jobs?.[0]?.results?.raw;
  const videoUrl = out?.url || out?.video_url;
  if (!videoUrl) return { status: 502, body: { error: 'no_output' } };

  await supabase.from('video_usage').insert({
    user_id: userId, workspace, prompt, video_url: videoUrl, plan,
  });

  return { status: 200, body: { videoUrl, used: used + 1, limit } };
}

async function getMonthlyUsage(userId) {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from('video_usage')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', start.toISOString());

  if (error) {
    console.error('usage query error:', error);
    return 0;
  }
  return count || 0;
}
