export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const KEY = process.env.PIAPI_KEY;

  try {
    const { prompt, duration = 6, resolution = 768, model = 'v2.3' } = req.body;

    // Task erstellen
    const createRes = await fetch('https://api.piapi.ai/api/v1/task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': KEY
      },
      body: JSON.stringify({
        model: 'hailuo',
        task_type: 'video_generation',
        input: {
          prompt: prompt || 'cinematic video',
          model: model,
          expand_prompt: true,
          duration: duration,
          resolution: resolution
        },
        config: { service_mode: 'public' }
      })
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
        headers: { 'X-API-KEY': KEY }
      });
      const pollData = await pollRes.json();
      const status = pollData?.data?.status;
      const output = pollData?.data?.output;

      if (status === 'completed') {
        const videoUrl = output?.video;
        return res.status(200).json({ success: true, videoUrl, taskId });
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
