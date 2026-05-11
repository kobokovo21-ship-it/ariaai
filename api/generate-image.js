export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const KEY = process.env.PIAPI_KEY;

  try {
    let { prompt, model = 'nano', image_base64, image_mime } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Kein Prompt angegeben' });
    if (prompt.length > 800) prompt = prompt.substring(0, 800);

    // ── IMAGE-TO-IMAGE via Flux Kontext ──
    // When reference image uploaded, always use Flux Kontext regardless of model
    if (image_base64) {
      let enhancedPrompt = prompt;
      if (model === 'modelia') {
        enhancedPrompt = prompt + ', vogue editorial style, high-end fashion photography, hyper-realistic skin texture, professional studio lighting, 8k resolution, cinematic color grading';
      }

      const mime = image_mime || 'image/jpeg';
      const dataUrl = `data:${mime};base64,${image_base64}`;

      const taskBody = {
        model: 'Qubico/flux1-dev-advanced',
        task_type: 'kontext',
        input: {
          prompt: enhancedPrompt,
          image: dataUrl,
          width: 1024,
          height: 1024,
          steps: 20,
          seed: -1
        },
        config: { service_mode: 'public' }
      };

      const createRes = await fetch('https://api.piapi.ai/api/v1/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': KEY },
        body: JSON.stringify(taskBody)
      });

      const cd = await createRes.json();
      const taskId = cd?.data?.task_id;
      if (!taskId) return res.status(500).json({ error: 'Flux Kontext: ' + (cd?.data?.error?.message || JSON.stringify(cd)) });

      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const pd = await (await fetch(`https://api.piapi.ai/api/v1/task/${taskId}`, { headers: { 'X-API-KEY': KEY } })).json();
        const status = pd?.data?.status;
        const output = pd?.data?.output;
        if (status === 'completed') {
          const imageUrl = output?.image_url || output?.url || output?.image;
          if (!imageUrl) return res.status(500).json({ error: 'Kein Bild: ' + JSON.stringify(output) });
          return res.status(200).json({ success: true, imageUrl, model: 'flux-kontext' });
        }
        if (status === 'failed') return res.status(500).json({ error: pd?.data?.error?.message || 'Flux Kontext fehlgeschlagen' });
      }
      return res.status(504).json({ error: 'Timeout — bitte nochmal versuchen' });
    }

    // ── TEXT-TO-IMAGE ──
    let taskBody;

    if (model === 'seedream') {
      taskBody = {
        model: 'seedream',
        task_type: 'seedream-5-lite',
        input: { prompt, aspect_ratio: '2:3', output_format: 'png', size: '2K' }
      };
    } else {
      // Nano Banana Pro — for nano, midjourney, modelia
      let finalPrompt = prompt;
      if (model === 'modelia') {
        finalPrompt = prompt + ', shot on 35mm lens f/1.8, vogue editorial style, high-end fashion photography, hyper-realistic skin texture, professional studio lighting, 8k resolution, cinematic color grading';
      }
      taskBody = {
        model: 'gemini',
        task_type: 'nano-banana-pro',
        input: { prompt: finalPrompt, output_format: 'png', aspect_ratio: '2:3', resolution: '2K', safety_level: 'high' },
        config: { service_mode: 'public' }
      };
    }

    const createRes = await fetch('https://api.piapi.ai/api/v1/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': KEY },
      body: JSON.stringify(taskBody)
    });

    const cd = await createRes.json();
    const taskId = cd?.data?.task_id;
    if (!taskId) return res.status(500).json({ error: cd?.data?.error?.message || 'Task fehlgeschlagen' });

    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const pd = await (await fetch(`https://api.piapi.ai/api/v1/task/${taskId}`, { headers: { 'X-API-KEY': KEY } })).json();
      const status = pd?.data?.status;
      const output = pd?.data?.output;
      if (status === 'completed') {
        const imageUrl = output?.image_url || output?.url || output?.image
          || (Array.isArray(output?.images) && output.images[0])
          || (Array.isArray(output?.image_urls) && output.image_urls[0]);
        if (!imageUrl) return res.status(500).json({ error: 'Kein Bild: ' + JSON.stringify(output) });
        return res.status(200).json({ success: true, imageUrl, taskId });
      }
      if (status === 'failed') return res.status(500).json({ error: pd?.data?.error?.message || 'Generierung fehlgeschlagen' });
    }
    return res.status(504).json({ error: 'Timeout — bitte nochmal versuchen' });

  } catch (error) {
    return res.status(500).json({ error: 'Server Fehler: ' + error.message });
  }
}
