export const config = { maxDuration: 60 };

import { validateToken, extractToken, isAdminEmail } from '../lib/auth.js';
import { deductCredits } from '../lib/credits.js';
import { enforceRateLimit, clientIp } from '../lib/rate-limit.js';

const ALLOWED_ORIGINS = ['https://virgoio.com', 'https://www.virgoio.com'];
const IMAGE_COST = 1;

// Interne Aufrufe (aus /api/chat, wenn dort bereits Credits verbucht wurden)
// dürfen Doppelverbuchung überspringen. Geheimer Header, per env-Var geteilt.
function isInternalCall(req) {
  const secret = process.env.INTERNAL_API_SECRET;
  return !!secret && req.headers['x-internal-secret'] === secret;
}

async function enhanceImagePrompt(userPrompt) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: `You convert user requests (usually in German) into a single optimized English prompt for an AI image generator (Flux).

STRICT RULES:
- Output ONLY the image prompt. No explanations, no quotes, no preamble.
- The image must NEVER contain text, letters, words, logos, UI elements, buttons, or website layouts. Always end the prompt with: "no text, no letters, no logos, no UI elements"
- If the user mentions "Landingpage", "Website", "Header", "Hero" or similar: they want a HERO IMAGE for that topic — a photographic scene, NEVER a screenshot or mockup of a webpage.

INDUSTRY MAPPING — HIGHEST PRIORITY:
Before writing the prompt, IDENTIFY the specific business/industry mentioned by the user (German or English) and choose a scene that VISUALLY makes that industry unmistakable at first glance. The industry MUST be the visual subject of the photo, not a background detail. Examples of the required specificity:
- Autohändler / Autohaus / car dealer / Autohandel → modern car showroom with new/luxury cars in view, glossy floor, spot lighting; optionally a salesperson greeting customers
- Friseur / Friseursalon / hair salon / hair stylist → bright modern hair salon interior with styling chairs, mirrors, a stylist working on a client's hair
- Restaurant / Gastronomie / Bistro / Café → warm restaurant or café interior, plated food on a table, ambient light, chef or waiter in view
- Bäckerei / bakery → warm bakery display with fresh bread, pastries, croissants
- Handwerker / Tischler / Schreiner / craftsman → workshop scene with wood/metal/tools, hands working on the craft
- Anwalt / Kanzlei / lawyer → modern law-office interior, books, professional in a suit at a desk
- Arzt / Arztpraxis / Zahnarzt / doctor → clean modern medical practice, doctor with patient, warm professional atmosphere
- Fitness / Gym / Personal Trainer → modern gym floor with equipment, trainer coaching an athlete
- Beauty / Kosmetik / Nagelstudio → premium beauty studio, cosmetic treatment in progress
- Immobilien / real estate / Makler(nicht Versicherung) → elegant modern home interior or exterior, warm daylight
- Versicherung / Versicherungsmakler / insurance broker → confident advisor with clients, a protected happy family, a modern bright insurance office, or a secure home
- Tech / IT / Software / SaaS → modern tech workspace, laptops, focused team collaborating
- Handel / Retail / Onlineshop → curated product display in a boutique setting
- Coach / Berater / Consultant → confident professional consulting in a bright modern meeting space
- Fotograf / Photographer → photographer at work with camera, studio lighting
- Musiker / Band → musician performing on stage, cinematic concert lighting
- Yoga / Wellness / Spa → serene wellness studio with soft natural light, person in a yoga pose
- Bau / Bauunternehmen / construction → construction site with workers, cranes, modern architecture
- Reise / Travel Agency → travel scene relevant to destinations (skyline, beach, mountains)
If NONE of the above fits, invent a scene that is UNMISTAKABLY specific to the mentioned business. If the request is truly generic ("modern business"), pick a modern bright co-working / office scene with real people — NEVER default to forest, trees, mountain landscape, sunset over water, or any generic nature photography.

HARD BANS (unless the business itself is nature-related, e.g. arborist, hiking gear, forestry): forest, woods, trees as the main subject, mountain vistas, sunset landscapes, empty nature scenes.

- Style: photorealistic, professional commercial photography, soft natural light, high detail, 16:9 composition feel.
- Keep it under 90 words.`,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });
    if (!r.ok) return null;
    const d = await r.json();
    const text = d?.content?.find(c => c.type === 'text')?.text?.trim();
    return text || null;
  } catch (e) {
    console.error('Prompt enhancement error:', e);
    return null;
  }
}

export default async function handler(req, res) {
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
    console.warn('⛔ Blocked generate-image. origin=' + origin + ' referer=' + referer);
    return res.status(403).json({ error: 'Forbidden' });
  }

  // ── Auth + Credits + Rate-Limit ─────────────────────────
  const internal = isInternalCall(req);
  let user = null;
  if (!internal) {
    user = await validateToken(extractToken(req));
    if (!user) return res.status(401).json({ error: 'Nicht eingeloggt' });
    if (!(await enforceRateLimit(req, res, { name: 'genimg:user:' + user.id, windowSec: 60, max: 20 }))) return;
    if (!(await enforceRateLimit(req, res, { name: 'genimg:ip:' + clientIp(req), windowSec: 60, max: 40 }))) return;
    if (!isAdminEmail(user.email)) {
      const charge = await deductCredits(user.id, IMAGE_COST);
      if (!charge.success) return res.status(402).json({ error: 'Nicht genug Credits — bitte Plan upgraden.', credits: charge.credits });
    }
  }

  try {
    const { prompt, model = 'nano', negative_prompt = '', ref_images = [] } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Kein Prompt' });
    if (typeof prompt !== 'string' || prompt.length > 2000) {
      return res.status(400).json({ error: 'Prompt zu lang' });
    }
    const PIAPI_KEY = process.env.PIAPI_KEY;
    if (!PIAPI_KEY) return res.status(500).json({ error: 'Kein PiAPI Key' });

    const enhanced = await enhanceImagePrompt(prompt);
    const finalPrompt = enhanced
      || (prompt + ', professional commercial photography, photorealistic, no text, no letters, no logos, no UI elements');

    const hardNegatives = 'text, letters, words, typography, writing, captions, ui, user interface, website, webpage, screenshot, browser window, buttons, logo, watermark, signature, blurry, bad quality, distorted';
    const finalNegative = negative_prompt
      ? negative_prompt + ', ' + hardNegatives
      : hardNegatives;

    const modelMap = {
      'nano': 'Qubico/flux1-schnell',
      'seed': 'Qubico/flux1-schnell',
      'img-nano': 'Qubico/flux1-schnell',
      'img-seed': 'Qubico/flux1-schnell'
    };
    const piModel = modelMap[model] || 'Qubico/flux1-schnell';

    const taskBody = {
      model: piModel,
      task_type: 'txt2img',
      input: {
        prompt: finalPrompt,
        negative_prompt: finalNegative,
        width: 1024,
        height: 1024,
        guidance_scale: 3.5,
        num_inference_steps: 4
      }
    };
    if (ref_images && ref_images.length > 0) {
      taskBody.task_type = 'img2img';
      taskBody.input.image_url = ref_images[0];
      taskBody.input.strength = 0.75;
    }
    const createRes = await fetch('https://api.piapi.ai/api/v1/task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': PIAPI_KEY
      },
      body: JSON.stringify(taskBody)
    });
    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error('PiAPI create error:', errText);
      return res.status(500).json({ error: 'Bilderstellung fehlgeschlagen: ' + errText });
    }
    const createData = await createRes.json();
    const taskId = createData?.data?.task_id || createData?.task_id;
    if (!taskId) {
      console.error('Kein Task ID:', JSON.stringify(createData));
      return res.status(500).json({ error: 'Kein Task ID von PiAPI' });
    }

    let imageUrl = null;
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch(`https://api.piapi.ai/api/v1/task/${taskId}`, {
        headers: { 'x-api-key': PIAPI_KEY }
      });
      if (!pollRes.ok) continue;
      const pollData = await pollRes.json();
      const status = pollData?.data?.status || pollData?.status;
      if (status === 'completed' || status === 'success') {
        imageUrl = pollData?.data?.output?.image_url
          || pollData?.data?.output?.images?.[0]
          || pollData?.output?.image_url
          || pollData?.output?.images?.[0];
        if (imageUrl) break;
      }
      if (status === 'failed' || status === 'error') {
        return res.status(500).json({ error: 'Bildgenerierung fehlgeschlagen' });
      }
    }
    if (!imageUrl) {
      return res.status(500).json({ error: 'Timeout — Bild konnte nicht generiert werden' });
    }
    return res.status(200).json({ imageUrl, taskId, enhancedPrompt: finalPrompt });
  } catch (err) {
    console.error('generate-image error:', err);
    return res.status(500).json({ error: err.message });
  }
}
