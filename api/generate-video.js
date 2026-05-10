export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const PIAPI_KEY = process.env.PIAPI_KEY;

  try {
    const { prompt, model = 'hailuo', duration = 6, resolution = 768 } = req.body;

    let taskBody;

    if (model === 'veo') {
      // Veo 3.1 via PiAPI
      taskBody = {
        model: 'veo3.1',
        task_type: 'txt2video',
        input: {
          prompt: prompt || 'cinematic video',
          duration: 8,
          resolution: '1080p',
          generate_audio: true
        },
        config: { service_mode: 'public' }
      };
    } else {
      // Hailuo 2.3 (default)
      taskBody = {
        model: 'hailuo',
        task_type: 'video_generation',
        input: {
          prompt: prompt || 'cinematic video',
          model: 'v2.3',
          expand_prompt: true,
          duration: duration,
          resolution: resolution
        },
        config: { service_mode: 'public' }
      };
    }

    const createRes = await fetch('https://api.piapi.ai/api/v1/task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': PIAPI_KEY
      },
      body: JSON.stringify(taskBody)
    });

    const createData = await createRes.json();
    const taskId = createData?.data?.task_id;

    if (!taskId) {
      return res.status(500).json({ error: 'Task konnte nicht erstellt werden', details: createData });
    }

    // Server-seitiges Polling — max 3 Minuten
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000));

      const pollRes = await fetch(`https://api.piapi.ai/api/v1/task/${taskId}`, {
        headers: { 'X-API-KEY': PIAPI_KEY }
      });
      const pollData = await pollRes.json();
      const status = pollData?.data?.status;
      const output = pollData?.data?.output;

      if (status === 'completed') {
        const videoUrl = output?.video || output?.video_url;
        return res.status(200).json({ success: true, videoUrl, model, taskId });
      }

      if (status === 'failed') {
        return res.status(500).json({ error: 'Video-Generierung fehlgeschlagen' });
      }
    }

    return res.status(504).json({ error: 'Timeout — bitte nochmal versuchen' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

   
