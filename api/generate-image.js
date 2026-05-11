export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const KEY = process.env.PIAPI_KEY;

  try {
    let { prompt, model = 'nano', negative_prompt = '', image_base64, image_mime } = req.body;

    // Prompt max 800 chars
    if (prompt && prompt.length > 800) prompt = prompt.substring(0, 800);

    let taskBody;

    if (model === 'seedream') {
      taskBody = {
        model: 'Qubico/seedream-5-lite',
        task_type: 'txt2img',
        input: {
          prompt,
          negative_prompt: negative_prompt || 'blurry, low quality, deformed',
          width: 832,
          height: 1216
        }
      };
    } else {
      // Nano Banana Pro (default — also handles midjourney, modelia)
      const input = {
        prompt,
        output_format: 'jpg',
        aspect_ratio: '2:3',
        resolution: '2K',
        safety_level: 'high'
      };
      if (negative_prompt) input.negative_prompt = negative_prompt;
      if (image_base64) {
        input.image_base64 = image_base64;
        input.image_mime = image_mime || 'image/jpeg';
      }
      taskBody = {
        model: 'gemini',
        task_type: 'nano-banana-pro',
        input,
        config: { service_mode: 'public' }
      };
    }

    const createRes = await fetch('https://api.piapi.ai/api/v1/task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': KEY
      },
      body: JSON.stringify(taskBody)
    });

    const createData = await createRes.json();
    const taskId = createData?.data?.task_id;

    if (!taskId) {
      const errMsg = createData?.error?.message || createData?.message || 'Task konnte nicht erstellt werden';
      return res.status(500).json({ error: errMsg });
    }

    // Poll max 90 seconds
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 3000));

      const pollRes = await fetch(`https://api.piapi.ai/api/v1/task/${taskId}`, {
        headers: { 'X-API-KEY': KEY }
      });
      const pollData = await pollRes.json();
      const status = pollData?.data?.status;
      const output = pollData?.data?.output;

      if (status === 'completed') {
        const imageUrl = output?.image_url
          || (output?.image_urls && output.image_urls[0])
          || output?.images?.[0]
          || output?.url;
        if (!imageUrl) return res.status(500).json({ error: 'Kein Bild in der Antwort' });
        return res.status(200).json({ success: true, imageUrl, taskId });
      }

      if (status === 'failed') {
        const reason = pollData?.data?.error?.message || 'Generierung fehlgeschlagen';
        return res.status(500).json({ error: reason });
      }
    }

    return res.status(504).json({ error: 'Timeout — bitte nochmal versuchen' });

  } catch (error) {
    return res.status(500).json({ error: 'Server Fehler: ' + error.message });
  }
}
