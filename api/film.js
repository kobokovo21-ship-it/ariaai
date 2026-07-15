// ════════════════════════════════════════════════════════════════
// VIRGO · FILM-PIPELINE  (api/film.js)
// Erzeugt filmische, lippensynchrone Charakter-Videos in 4 Schritten:
//   step "image"   → filmisches Startbild (FLUX, optional mit Charakter-Referenz)
//   step "video"   → Bild wird zu 5-Sek.-Video animiert (Kling)
//   step "voice"   → Skript wird zu Sprache (ElevenLabs)
//   step "lipsync" → Video + Stimme werden lippensynchron verschmolzen
//
// Das Frontend ruft die Schritte NACHEINANDER auf (jeder Schritt ist ein
// eigener Request), weil die Generierungen je 1–3 Minuten dauern können.
// Innerhalb eines Schritts wird bei fal.ai per Warteschlange gearbeitet:
// Job abschicken → Status abfragen (Polling) → Ergebnis holen.
//
// NÖTIGE ENV-VARIABLEN in Vercel:
//   FAL_KEY               → neu anlegen (Account bei fal.ai)
//   ELEVENLABS_API_KEY    → existiert bereits
//   SUPABASE_URL          → existiert bereits
//   SUPABASE_SERVICE_KEY  → existiert bereits
//
// WICHTIG (Recht): Nur für eigene/fiktive Charaktere oder Personen mit
// Einwilligung verwenden. Keine echten Prominenten, keine fremden Stimmen.
// ════════════════════════════════════════════════════════════════

export const config = { maxDuration: 300 };

const ALLOWED_ORIGINS = ['https://virgoio.com', 'https://www.virgoio.com'];

// ── Modelle als Env-steuerbare Konstanten (austauschbar ohne Code-Änderung).
// Falls fal.ai eine Modell-ID umbenennt, nur die Env-Variable anpassen.
const MODEL_IMAGE      = process.env.FAL_MODEL_IMAGE      || 'fal-ai/flux/dev';
const MODEL_IMAGE_REF  = process.env.FAL_MODEL_IMAGE_REF  || 'fal-ai/flux-pro/kontext';
const MODEL_VIDEO      = process.env.FAL_MODEL_VIDEO      || 'fal-ai/kling-video/v2.1/standard/image-to-video';
const MODEL_LIPSYNC    = process.env.FAL_MODEL_LIPSYNC    || 'fal-ai/sync-lipsync';

// ── Automatische filmische Anreicherung der Prompts
const CINEMATIC_SUFFIX = ', cinematic lighting, anamorphic lens, moody rainy atmosphere, volumetric light, highly detailed, realistic skin texture, shallow depth of field, subtle film grain, 8k';
const MOTION_SUFFIX    = '. slow cinematic camera movement, subtle rain falling in the background, natural blinking and micro-expressions, stable consistent face, no morphing';

// ── Pläne, die die Pipeline nutzen dürfen (teuer! nur zahlende Kunden + Admin)
const ACTIVE_PLANS = ['makler-starter', 'makler-pro', 'makler-business'];

// ════════════════════ ZUGRIFFSSCHUTZ ════════════════════
function guard(req, res) {
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') { res.status(200).end(); return false; }
  if (req.method !== 'POST') { res.status(405).end(); return false; }
  const ok = ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.some(o => referer.startsWith(o));
  if (!ok) {
    console.warn('⛔ Blocked film. origin=' + origin);
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

// Token + Plan prüfen — Pipeline nur für zahlende Kunden und Admin
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

// ════════════════════ FAL.AI WARTESCHLANGE ════════════════════
// Job abschicken, dann alle 4 Sekunden den Status abfragen, bis er fertig
// ist oder das Zeitlimit reißt. Wirft bei jedem Fehler eine klare Meldung.
async function falSubmitAndPoll(model, input, timeoutMs = 260000) {
  const FAL = process.env.FAL_KEY;
  if (!FAL) throw new Error('FAL_KEY fehlt in den Vercel-Umgebungsvariablen.');

  // 1) Job in die Warteschlange stellen
  const submit = await fetch(`https://queue.fal.run/${model}`, {
    method: 'POST',
    headers: { 'Authorization': 'Key ' + FAL, 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  if (!submit.ok) {
    const t = await submit.text().catch(() => '');
    throw new Error(`Job-Start fehlgeschlagen (${model}, HTTP ${submit.status}): ${t.slice(0, 300)}`);
  }
  const job = await submit.json();
  const requestId = job.request_id;
  if (!requestId) throw new Error('Keine request_id von fal.ai erhalten: ' + JSON.stringify(job).slice(0, 200));
  const statusUrl = job.status_url || `https://queue.fal.run/${model}/requests/${requestId}/status`;
  const resultUrl = job.response_url || `https://queue.fal.run/${model}/requests/${requestId}`;

  // 2) Polling bis fertig
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4000));
    const s = await fetch(statusUrl, { headers: { 'Authorization': 'Key ' + process.env.FAL_KEY } });
    if (!s.ok) continue; // kurzer Aussetzer → weiter pollen
    const sd = await s.json();
    if (sd.status === 'COMPLETED') {
      // 3) Ergebnis abholen
      const r = await fetch(resultUrl, { headers: { 'Authorization': 'Key ' + process.env.FAL_KEY } });
      if (!r.ok) throw new Error('Ergebnis-Abruf fehlgeschlagen: HTTP ' + r.status);
      return r.json();
    }
    if (sd.status === 'FAILED' || sd.status === 'ERROR' || sd.status === 'CANCELLED') {
      throw new Error('Generierung fehlgeschlagen (' + model + '): ' + JSON.stringify(sd).slice(0, 300));
    }
    // IN_QUEUE / IN_PROGRESS → weiter warten
  }
  throw new Error('Zeitüberschreitung bei ' + model + ' — die Generierung dauert gerade zu lange. Bitte nochmal versuchen.');
}

// Bild-/Video-URL aus den (leicht unterschiedlichen) fal-Antwortformaten ziehen
function extractImageUrl(data) {
  return data?.images?.[0]?.url || data?.image?.url || null;
}
function extractVideoUrl(data) {
  return data?.video?.url || data?.videos?.[0]?.url || data?.output?.video?.url || null;
}

// ════════════════════ HAUPT-HANDLER ════════════════════
export default async function handler(req, res) {
  if (!guard(req, res)) return;

  // Nur zahlende Kunden + Admin — jeder Aufruf kostet echtes Geld
  const { isPaying } = await getUserAccess(req);
  if (!isPaying) {
    return res.status(401).json({ error: 'Die Film-Pipeline ist Teil der Bezahl-Pläne. Bitte einloggen und Plan buchen.' });
  }

  const { step } = req.body || {};

  try {
    // ─────────────────────────────────────────────
    // SCHRITT 1: FILMISCHES STARTBILD
    // Body: { step:'image', prompt, referenceImageUrl? }
    // referenceImageUrl = Foto des Charakters für konsistente Gesichter
    // Antwort: { success, imageUrl }
    // ─────────────────────────────────────────────
    if (step === 'image') {
      const { prompt, referenceImageUrl } = req.body;
      if (!prompt) return res.status(400).json({ error: 'prompt fehlt' });
      const fullPrompt = prompt + CINEMATIC_SUFFIX;

      let data;
      if (referenceImageUrl) {
        // Mit Charakter-Referenz: FLUX Kontext hält das Gesicht konsistent
        data = await falSubmitAndPoll(MODEL_IMAGE_REF, {
          prompt: fullPrompt,
          image_url: referenceImageUrl
        });
      } else {
        // Ohne Referenz: normales FLUX, Hochformat für Reels
        data = await falSubmitAndPoll(MODEL_IMAGE, {
          prompt: fullPrompt,
          image_size: { width: 768, height: 1344 }
        });
      }
      const imageUrl = extractImageUrl(data);
      if (!imageUrl) throw new Error('Kein Bild in der Antwort: ' + JSON.stringify(data).slice(0, 200));
      return res.status(200).json({ success: true, imageUrl });
    }

    // ─────────────────────────────────────────────
    // SCHRITT 2: BILD → VIDEO (ca. 5 Sekunden)
    // Body: { step:'video', imageUrl, motionPrompt? }
    // Antwort: { success, videoUrl }
    // ─────────────────────────────────────────────
    if (step === 'video') {
      const { imageUrl, motionPrompt } = req.body;
      if (!imageUrl) return res.status(400).json({ error: 'imageUrl fehlt' });
      const data = await falSubmitAndPoll(MODEL_VIDEO, {
        prompt: (motionPrompt || 'the character looks thoughtful, breathing calmly') + MOTION_SUFFIX,
        image_url: imageUrl,
        duration: '5'
      });
      const videoUrl = extractVideoUrl(data);
      if (!videoUrl) throw new Error('Kein Video in der Antwort: ' + JSON.stringify(data).slice(0, 200));
      return res.status(200).json({ success: true, videoUrl });
    }

    // ─────────────────────────────────────────────
    // SCHRITT 3: SKRIPT → STIMME (ElevenLabs)
    // Body: { step:'voice', text, voiceId? }
    // Antwort: { success, audioBase64, mime }
    // ─────────────────────────────────────────────
    if (step === 'voice') {
      const { text, voiceId = 'pNInz6obpgDQGcFmaJgB', modelId = 'eleven_multilingual_v2' } = req.body;
      if (!text) return res.status(400).json({ error: 'text fehlt' });
      if (text.length > 2500) return res.status(400).json({ error: 'Text zu lang (max. 2500 Zeichen pro Clip)' });
      if (!process.env.ELEVENLABS_API_KEY) return res.status(500).json({ error: 'ELEVENLABS_API_KEY fehlt' });

      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': process.env.ELEVENLABS_API_KEY },
        body: JSON.stringify({
          text,
          model_id: modelId,
          // Etwas mehr Stabilität und Ausdruck für den emotionalen Kino-Ton
          voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35 }
        })
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        return res.status(500).json({ error: 'Sprachgenerierung fehlgeschlagen: ' + (err.detail?.message || 'HTTP ' + r.status) });
      }
      const buf = await r.arrayBuffer();
      const audioBase64 = Buffer.from(buf).toString('base64');
      return res.status(200).json({ success: true, audioBase64, mime: 'audio/mpeg' });
    }

    // ─────────────────────────────────────────────
    // SCHRITT 4: LIP-SYNC — Video + Stimme verschmelzen
    // Body: { step:'lipsync', videoUrl, audioBase64 }  (oder audioUrl)
    // Antwort: { success, videoUrl }  ← das fertige MP4
    // ─────────────────────────────────────────────
    if (step === 'lipsync') {
      const { videoUrl, audioBase64, audioUrl } = req.body;
      if (!videoUrl) return res.status(400).json({ error: 'videoUrl fehlt' });
      if (!audioBase64 && !audioUrl) return res.status(400).json({ error: 'audioBase64 oder audioUrl fehlt' });

      const data = await falSubmitAndPoll(MODEL_LIPSYNC, {
        video_url: videoUrl,
        // fal akzeptiert Daten-URIs — so sparen wir uns einen Datei-Upload
        audio_url: audioUrl || ('data:audio/mpeg;base64,' + audioBase64)
      }, 280000);
      const finalUrl = extractVideoUrl(data);
      if (!finalUrl) throw new Error('Kein fertiges Video in der Antwort: ' + JSON.stringify(data).slice(0, 200));
      return res.status(200).json({ success: true, videoUrl: finalUrl });
    }

    return res.status(400).json({ error: 'Unbekannter step: ' + (step || 'keiner') + ' (erlaubt: image, video, voice, lipsync)' });
  } catch (e) {
    console.error('Film-Pipeline Fehler (step=' + step + '):', e.message);
    return res.status(500).json({ error: e.message });
  }
}
