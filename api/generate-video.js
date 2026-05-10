export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const KEY = process.env.PIAPI_KEY;

  try {
    const { prompt, model = 'hailuo', duration = 6, resolution = 768, imageUrl = null } = req.body;

    // SORA 2 — Streaming API
    if (model === 'sora') {
      const soraRes = await fetch('https://api.piapi.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${KEY}`
        },
        body: JSON.stringify({
          model: 'sora-2-preview',
          messages: [{ role: 'user', content: prompt + ' without watermark' }],
          stream: true
        })
      });

      // Parse SSE stream to find video URL
      const text = await soraRes.text();
      const lines = text.split('\n');
      let fullContent = '';

      for (const line of lines) {
        if (line.startsWith('data: ') && !line.includes('[DONE]')) {
          try {
            const data = JSON.parse(line.slice(6));
            const content = data?.choices?.[0]?.delta?.content;
            if (content) fullContent += content;
          } catch {}
        }
      }

      // Extract MP4 URL from markdown content
      const mp4Match = fullContent.match(/https?:\/\/[^\s\)]+\.mp4/);
      const videoUrl = mp4Match ? mp4Match[0] : null;

      if (videoUrl) {
        return res.status(200).json({ success: true, videoUrl, model: 'sora' });
      } else {
        return res.status(500).json({ error: 'Sora konnte kein Video generieren. Bitte nochmal versuchen.' });
      }
    }

    // VEO 3.1 — Task API
    if (model === 'veo') {
      const taskBody = {
        model: 'veo3.1',
        task_type: imageUrl ? 'img2video' : 'txt2video',
        input: {
          prompt: prompt,
          ...(imageUrl && { image_url: imageUrl })
        },
        config: { service_mode: 'public' }
      };

      const createRes = await fetch('https://api.piapi.ai/api/v1/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': KEY },
        body: JSON.stringify(taskBody)
      });
      const createData = await createRes.json();
      const taskId = createData?.data?.task_id;
      if (!taskId) return res.status(500).json({ error: 'Veo Task fehlgeschlagen', details: createData });

      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const pollRes = await fetch(`https://api.piapi.ai/api/v1/task/${taskId}`, { headers: { 'X-API-KEY': KEY } });
        const pollData = await pollRes.json();
        const status = pollData?.data?.status;
        const output = pollData?.data?.output;
        if (status === 'completed') {
          const videoUrl = output?.video || output?.video_url;
          return res.status(200).json({ success: true, videoUrl, model: 'veo' });
        }
        if (status === 'failed') return res.status(500).json({ error: 'Veo Generierung fehlgeschlagen' });
      }
      return res.status(504).json({ error: 'Timeout — bitte nochmal versuchen' });
    }

    // HAILUO 2.3 — Standard + Image-to-Video
    const hailuoInput = {
      prompt,
      model: 'v2.3',
      expand_prompt: true,
      duration,
      resolution
    };
    if (imageUrl) hailuoInput.image_url = imageUrl;

    const createRes = await fetch('https://api.piapi.ai/api/v1/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': KEY },
      body: JSON.stringify({
        model: 'hailuo',
        task_type: 'video_generation',
        input: hailuoInput,
        config: { service_mode: 'public' }
      })
    });

    const createData = await createRes.json();
    const taskId = createData?.data?.task_id;
    if (!taskId) return res.status(500).json({ error: 'Hailuo Task fehlgeschlagen', details: createData });

    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const pollRes = await fetch(`https://api.piapi.ai/api/v1/task/${taskId}`, { headers: { 'X-API-KEY': KEY } });
      const pollData = await pollRes.json();
      const status = pollData?.data?.status;
      const output = pollData?.data?.output;
      if (status === 'completed') {
        const videoUrl = output?.video;
        return res.status(200).json({ success: true, videoUrl, model: 'hailuo' });
      }
      if (status === 'failed') return res.status(500).json({ error: 'Hailuo Generierung fehlgeschlagen' });
    }
    return res.status(504).json({ error: 'Timeout — bitte nochmal versuchen' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
