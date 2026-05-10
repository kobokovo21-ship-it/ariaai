export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const KEY = process.env.PIAPI_KEY;

  try {
    const { video_url, audio_url } = req.body;

    const createRes = await fetch('https://api.piapi.ai/api/v1/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': KEY },
      body: JSON.stringify({
        model: 'kling',
        task_type: 'lip-sync',
        input: {
          video_url,
          audio_url,
          mode: 'audio2video'
        },
        config: { service_mode: 'public' }
      })
    });

    const createData = await createRes.json();
    const taskId = createData?.data?.task_id;
    if (!taskId) return res.status(500).json({ error: 'Lip Sync fehlgeschlagen', details: createData });

    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const pollRes = await fetch(`https://api.piapi.ai/api/v1/task/${taskId}`, {
        headers: { 'X-API-KEY': KEY }
      });
      const pollData = await pollRes.json();
      const status = pollData?.data?.status;
      const output = pollData?.data?.output;
      if (status === 'completed') {
        const videoUrl = output?.video_url || output?.video;
        return res.status(200).json({ success: true, videoUrl });
      }
      if (status === 'failed') return res.status(500).json({ error: 'Lip Sync fehlgeschlagen' });
    }
    return res.status(504).json({ error: 'Timeout' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
