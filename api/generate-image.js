// === PROMPT-ENHANCEMENT: Claude macht aus dem User-Wunsch einen echten Bild-Prompt ===
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
- If the user mentions "Landingpage", "Website", "Header" or similar: they want a HERO IMAGE for that topic — a photographic scene, NEVER a screenshot or mockup of a webpage.
- If the user mentions an insurance company or insurance topic (e.g. Hansemerkur, Versicherung, Makler): create a professional, trustworthy insurance-marketing scene, e.g. a confident advisor with clients, a happy protected family, a modern bright office, a secure home — depending on context.
- Style: photorealistic, professional commercial photography, soft natural light, high detail, 16:9 composition feel.
- Keep it under 80 words.`,
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { prompt, model = 'nano', negative_prompt = '', ref_images = [] } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Kein Prompt' });
    const PIAPI_KEY = process.env.PIAPI_KEY;
    if (!PIAPI_KEY) return res.status(500).json({ error: 'Kein PiAPI Key' });

    // === Prompt verbessern (Fallback: Original-Prompt + Sicherheits-Zusatz) ===
    const enhanced = await enhanceImagePrompt(prompt);
    const finalPrompt = enhanced
      || (prompt + ', professional commercial photography, photorealistic, no text, no letters, no logos, no UI elements');

    // === Harte Negative gegen Fake-Webseiten & Kauderwelsch-Text ===
    const hardNegatives = 'text, letters, words, typography, writing, captions, ui, user interface, website, webpage, screenshot, browser window, buttons, logo, watermark, signature, blurry, bad quality, distorted';
    const finalNegative = negative_prompt
      ? negative_prompt + ', ' + hardNegatives
      : hardNegatives;

    // Modell auswählen
    const modelMap = {
      'nano': 'Qubico/flux1-dev',
      'seed': 'Qubico/flux1-dev',
      'img-nano': 'Qubico/flux1-dev',
      'img-seed': 'Qubico/flux1-dev'
    };
    const piModel = modelMap[model] || 'Qubico/flux1-dev';
    // Task erstellen
    const taskBody = {
      model: piModel,
      task_type: 'txt2img',
      input: {
        prompt: finalPrompt,
        negative_prompt: finalNegative,
        width: 1024,
        height: 1024,
        guidance_scale: 3.5,
        num_inference_steps: 28
      }
    };
    // Ref-Bild falls vorhanden
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
    // Polling bis fertig (max 60 Sekunden)
    let imageUrl = null;
    for (let i = 0; i < 30; i++) {
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

