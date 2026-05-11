export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const KEY = process.env.PIAPI_KEY;

  try {
    const { url, type = 'image' } = req.body;

    const taskBody = type === 'video' ? {
      model: 'video-upscale',
      task_type: 'video-upscale',
      input: { video_url: url, scale: 2 }
    } : {
      model: 'image-upscale',
      task_type: 'super-resolution',
      input: { image_url: url, scale: 4 }
    };

    const createRes = await fetch('https://api.piapi.ai/api/v1/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': KEY },
      body: JSON.stringify(taskBody)
    });

    const createData = await createRes.json();
    const taskId = createData?.data?.task_id;
    if (!taskId) return res.status(500).json({ error: 'Upscale fehlgeschlagen', details: createData });

    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const pollRes = await fetch(`https://api.piapi.ai/api/v1/task/${taskId}`, {
        headers: { 'X-API-KEY': KEY }
      });
      const pollData = await pollRes.json();
      const status = pollData?.data?.status;
      const output = pollData?.data?.output;
      if (status === 'completed') {
        const resultUrl = output?.image_url || output?.video_url || output?.url;
        return res.status(200).json({ success: true, url: resultUrl });
      }
      if (status === 'failed') return res.status(500).json({ error: 'Upscale fehlgeschlagen' });
    }
    return res.status(504).json({ error: 'Timeout' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
