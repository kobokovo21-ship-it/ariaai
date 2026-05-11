export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const PIAPI_KEY = process.env.PIAPI_KEY;
  const HF_KEY_ID = process.env.HIGGSFIELD_KEY_ID;
  const HF_KEY_SECRET = process.env.HIGGSFIELD_KEY_SECRET;

  try {
    const { prompt, model = 'hailuo', duration = 6, resolution = 768, imageUrl = null } = req.body;

    // ── HIGGSFIELD — Ultra/Max Premium ──
    if (model === 'higgsfield') {
      const credentials = `${HF_KEY_ID}:${HF_KEY_SECRET}`;
      const body = {
        prompt,
        duration: 5,
        resolution: '720p'
      };
      if (imageUrl) body.image_url = imageUrl;

      const createRes = await fetch('https://cloud.higgsfield.ai/v1/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${Buffer.from(credentials).toString('base64')}`
        },
        body: JSON.stringify(body)
      });
      const createData = await createRes.json();
      const jobId = createData?.id || createData?.job_id || createData?.request_id;

      if (!jobId) return res.status(500).json({ error: 'Higgsfield Task fehlgeschlagen', details: createData });

      // Poll for result
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const pollRes = await fetch(`https://cloud.higgsfield.ai/v1/generate/${jobId}`, {
          headers: { 'Authorization': `Basic ${Buffer.from(credentials).toString('base64')}` }
        });
        const pollData = await pollRes.json();
        const status = (pollData?.status || '').toUpperCase();
        if (status === 'COMPLETED' || status === 'DONE') {
          const videoUrl = pollData?.output?.url || pollData?.video_url || pollData?.url;
          return res.status(200).json({ success: true, videoUrl, model: 'higgsfield' });
        }
        if (status === 'FAILED' || status === 'ERROR') {
          return res.status(500).json({ error: 'Higgsfield Generierung fehlgeschlagen' });
        }
      }
      return res.status(504).json({ error: 'Timeout — bitte nochmal versuchen' });
    }

    // ── SORA 2 — Streaming ──
    if (model === 'sora') {
      const soraRes = await fetch('https://api.piapi.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${PIAPI_KEY}`
        },
        body: JSON.stringify({
          model: 'sora-2-preview',
          messages: [{ role: 'user', content: prompt + ' without watermark' }],
          stream: true
        })
      });
      const text = await soraRes.text();
      let fullContent = '';
      for (const line of text.split('\n')) {
        if (line.startsWith('data: ') && !line.includes('[DONE]')) {
          try {
            const data = JSON.parse(line.slice(6));
            const content = data?.choices?.[0]?.delta?.content;
            if (content) fullContent += content;
          } catch {}
        }
      }
      const mp4Match = fullContent.match(/https?:\/\/[^\s\)]+\.mp4/);
      const videoUrl = mp4Match ? mp4Match[0] : null;
      if (videoUrl) return res.status(200).json({ success: true, videoUrl, model: 'sora' });
      return res.status(500).json({ error: 'Sora konnte kein Video generieren.' });
    }

    // ── VEO 3.1 ──
    if (model === 'veo') {
      const taskBody = {
        model: 'veo3.1',
        task_type: imageUrl ? 'img2video' : 'txt2video',
        input: { prompt, ...(imageUrl && { image_url: imageUrl }) },
        config: { service_mode: 'public' }
      };
      const createRes = await fetch('https://api.piapi.ai/api/v1/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': PIAPI_KEY },
        body: JSON.stringify(taskBody)
      });
      const createData = await createRes.json();
      const taskId = createData?.data?.task_id;
      if (!taskId) return res.status(500).json({ error: 'Veo Task fehlgeschlagen', details: createData });
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const p = await (await fetch(`https://api.piapi.ai/api/v1/task/${taskId}`, { headers: { 'X-API-KEY': PIAPI_KEY } })).json();
        if (p?.data?.status === 'completed') return res.status(200).json({ success: true, videoUrl: p?.data?.output?.video, model: 'veo' });
        if (p?.data?.status === 'failed') return res.status(500).json({ error: 'Veo fehlgeschlagen' });
      }
      return res.status(504).json({ error: 'Timeout' });
    }

    // ── HAILUO 2.3 (default) — Text & Image-to-Video ──
    const hailuoInput = { prompt, model: 'v2.3', expand_prompt: true, duration, resolution };
    if (imageUrl) hailuoInput.image_url = imageUrl;

    const createRes = await fetch('https://api.piapi.ai/api/v1/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': PIAPI_KEY },
      body: JSON.stringify({ model: 'hailuo', task_type: 'video_generation', input: hailuoInput, config: { service_mode: 'public' } })
    });
    const createData = await createRes.json();
    const taskId = createData?.data?.task_id;
    if (!taskId) return res.status(500).json({ error: 'Hailuo Task fehlgeschlagen', details: createData });

    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const p = await (await fetch(`https://api.piapi.ai/api/v1/task/${taskId}`, { headers: { 'X-API-KEY': PIAPI_KEY } })).json();
      if (p?.data?.status === 'completed') return res.status(200).json({ success: true, videoUrl: p?.data?.output?.video, model: 'hailuo' });
      if (p?.data?.status === 'failed') return res.status(500).json({ error: 'Hailuo fehlgeschlagen' });
    }
    return res.status(504).json({ error: 'Timeout' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
