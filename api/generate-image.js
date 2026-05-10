export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const KEY = process.env.PIAPI_KEY;

  try {
    const { prompt, model = 'nano' } = req.body;

    let taskBody;

    if (model === 'midjourney' || model === 'mj' || model === 'niji') {
      // Midjourney V7 / Niji 7
      taskBody = {
        model: 'midjourney',
        task_type: 'imagine',
        input: {
          prompt: prompt + (model === 'niji' ? ' --niji 7' : ' --v 7'),
          aspect_ratio: '2:3',
          process_mode: 'turbo',
          skip_prompt_check: false
        }
      };
    } else if (model === 'seedream') {
      // Seedream 5 Lite
      taskBody = {
        model: 'Qubico/seedream-5-lite',
        task_type: 'txt2img',
        input: {
          prompt: prompt,
          width: 832,
          height: 1216
        }
      };
    } else {
      // Nano Banana Pro (default)
      taskBody = {
        model: 'gemini',
        task_type: 'nano-banana-pro',
        input: {
          prompt: prompt,
          output_format: 'jpg',
          aspect_ratio: '9:16',
          resolution: '2K',
          safety_level: 'high'
        }
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
      return res.status(500).json({ error: 'Task konnte nicht erstellt werden', details: createData });
    }

    // Server-seitiges Polling — max 90 Sekunden
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 3000));

      const pollRes = await fetch(`https://api.piapi.ai/api/v1/task/${taskId}`, {
        headers: { 'X-API-KEY': KEY }
      });
      const pollData = await pollRes.json();
      const status = pollData?.data?.status;
      const output = pollData?.data?.output;

      if (status === 'completed') {
        // Midjourney gibt image_url (Grid) und image_urls (einzelne Bilder)
        const imageUrl = output?.image_url
          || (output?.image_urls && output.image_urls[0])
          || output?.images?.[0];
        const imageUrls = output?.image_urls || null;
        return res.status(200).json({ success: true, imageUrl, imageUrls, taskId });
      }

      if (status === 'failed') {
        return res.status(500).json({ error: 'Generierung fehlgeschlagen' });
      }
    }

    return res.status(504).json({ error: 'Timeout — bitte nochmal versuchen' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
