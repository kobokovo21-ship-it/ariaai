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
        prompt,
        negative_prompt: negative_prompt || 'blurry, bad quality, distorted, watermark, text',
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

    return res.status(200).json({ imageUrl, taskId });

  } catch (err) {
    console.error('generate-image error:', err);
    return res.status(500).json({ error: err.message });
  }
}
