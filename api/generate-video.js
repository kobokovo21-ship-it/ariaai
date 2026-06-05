// api/generate-video.js
// Vercel Serverless Function — Higgsfield Video-Generierung für Virgo.
// EIN Endpoint für Business- UND Makler-App.
//
// Setup (einmalig):
//   1) npm i @higgsfield/client @supabase/supabase-js
//   2) Vercel → Settings → Environment Variables:
//        HIGGSFIELD_CREDENTIALS  = "KEY_ID:KEY_SECRET"   (aus cloud.higgsfield.ai)
//        HIGGSFIELD_VIDEO_MODEL  = aktueller Video-Model-Slug aus den Higgsfield-Docs
//        SUPABASE_URL                = (hast du schon)
//        SUPABASE_SERVICE_ROLE_KEY   = (hast du schon — nur serverseitig!)
//   3) supabase-video-setup.sql im Supabase SQL-Editor ausführen.

import { higgsfield, config } from '@higgsfield/client/v2';
import { createClient } from '@supabase/supabase-js';

// Higgsfield-Authentifizierung
config({ credentials: process.env.HIGGSFIELD_CREDENTIALS });

// Supabase mit Service-Role (umgeht RLS — NIE im Browser verwenden)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --- KOSTEN-KONTROLLE ---------------------------------------------------
// Video ist teuer. Limits bewusst niedrig halten und an deine Marge anpassen.
const MONTHLY_VIDEO_LIMITS = {
  free: 0,      // Free-User: gesperrt -> Upgrade-Modal
  pro: 5,       // Virgo Pro  (19,99 €)
  premium: 20,  // Virgo Premium (49,99 €)
};
// -----------------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const {
      userId,            // ID des Maklers / Business-Users
      plan = 'free',     // 'free' | 'pro' | 'premium'
      workspace,         // 'business' | 'makler'  (nur fürs Logging)
      prompt,            // Textbeschreibung des Videos
      imageUrl,          // optional: Startbild (Logo/Produktbild) -> image-to-video
    } = req.body || {};

    // ⚠️ WIRE-UP 1: userId/plan idealerweise aus deiner bestehenden
    //    Auth/Session ableiten (wie in api/business.js), nicht blind vom Client.
    if (!userId) return res.status(400).json({ error: 'missing_userId' });
    if (!prompt) return res.status(400).json({ error: 'missing_prompt' });

    // 1) Limit prüfen
    const limit = MONTHLY_VIDEO_LIMITS[plan] ?? 0;
    if (limit === 0) {
      return res.status(402).json({
        error: 'locked',
        message: 'Video-Generierung ist in deinem Plan nicht enthalten.',
      });
    }

    const used = await getMonthlyUsage(userId);
    if (used >= limit) {
      return res.status(402).json({
        error: 'limit_reached',
        message: `Monatslimit erreicht (${used}/${limit}). Upgrade für mehr Videos.`,
        used,
        limit,
      });
    }

    // 2) Higgsfield-Generierung (wartet via Polling bis fertig)
    const model = process.env.HIGGSFIELD_VIDEO_MODEL;
    const input = imageUrl
      ? { prompt, start_image_url: imageUrl, enhance_prompt: true }
      : { prompt, enhance_prompt: true };

    const jobSet = await higgsfield.subscribe(model, { input, withPolling: true });

    if (!jobSet.isCompleted) {
      return res.status(502).json({ error: 'generation_failed', detail: jobSet.status });
    }

    const out = jobSet.jobs?.[0]?.results?.raw;
    const videoUrl = out?.url || out?.video_url; // je nach Model-Output
    if (!videoUrl) {
      return res.status(502).json({ error: 'no_output' });
    }

    // 3) Nutzung loggen (zählt fürs Limit + Historie)
    await supabase.from('video_usage').insert({
      user_id: userId,
      workspace,
      prompt,
      video_url: videoUrl,
      plan,
    });

    return res.status(200).json({ videoUrl, used: used + 1, limit });
  } catch (err) {
    console.error('generate-video error:', err);
    return res.status(500).json({ error: 'server_error', detail: String(err?.message || err) });
  }
}

// Zählt die Videos des laufenden Kalendermonats für einen User
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
    return 0; // im Zweifel nicht hart blockieren, aber Fehler loggen
  }
  return count || 0;
}
