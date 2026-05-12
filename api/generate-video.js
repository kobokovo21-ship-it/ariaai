export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const PIAPI_KEY = process.env.PIAPI_KEY;

  try {
    let { prompt, model = 'hailuo', duration = 6, resolution = 768, imageUrl = null, taskId = null } = req.body;

    if (!prompt && !taskId) return res.status(400).json({ error: 'Kein Prompt angegeben' });
    if (prompt && prompt.length > 500) prompt = prompt.substring(0, 500);

    // ── POLL existing task ──
    if (taskId) {
      // Higgsfield uses different endpoint
      if (model === 'higgsfield') {
        const HF_KEY_ID = process.env.HIGGSFIELD_KEY_ID;
        const HF_KEY_SECRET = process.env.HIGGSFIELD_KEY_SECRET;
        const credentials = Buffer.from(`${HF_KEY_ID}:${HF_KEY_SECRET}`).toString('base64');
        const pollRes = await fetch(`https://cloud.higgsfield.ai/v1/generate/${taskId}`, {
          headers: { 'Authorization': `Basic ${credentials}` }
        });
        const pd = await pollRes.json();
        const status = (pd?.status || '').toUpperCase();
        if (status === 'COMPLETED' || status === 'DONE') {
          const videoUrl = pd?.output?.url || pd?.video_url || pd?.url;
          return res.status(200).json({ success: true, videoUrl, status: 'completed' });
        }
        if (status === 'FAILED' || status === 'ERROR') {
          return res.status(500).json({ error: pd?.message || 'Higgsfield fehlgeschlagen', status: 'failed' });
        }
        return res.status(200).json({ status: 'processing', taskId, model: 'higgsfield' });
      }

      // PiAPI polling (Veo, Hailuo)
      const pollRes = await fetch(`https://api.piapi.ai/api/v1/task/${taskId}`, {
        headers: { 'X-API-KEY': PIAPI_KEY }
      });
      const pd = await pollRes.json();
      const status = pd?.data?.status;
      const output = pd?.data?.output;
      if (status === 'completed') {
        const videoUrl = output?.video || output?.video_url || output?.url;
        return res.status(200).json({ success: true, videoUrl, status: 'completed' });
      }
      if (status === 'failed') {
        return res.status(500).json({ error: pd?.data?.error?.message || 'Fehlgeschlagen', status: 'failed' });
      }
      return res.status(200).json({ status: status || 'processing', taskId });
    }

    // ── SORA — not available ──
    if (model === 'sora') {
      return res.status(503).json({ error: 'Sora 2.0 ist noch nicht öffentlich verfügbar. Nutze Hailuo 2.3 oder Veo 3.1.' });
    }

    // ── VEO 3.1 — correct API format ──
    if (model === 'veo') {
      const taskBody = {
        model: 'veo3.1',
        task_type: 'veo3.1-video-fast',
        input: {
          prompt,
          negative_prompt: 'blurry, low quality, static',
          aspect_ratio: '16:9',
          duration: '8s',
          resolution: '720p',
          generate_audio: false
        }
      };

      const createRes = await fetch('https://api.piapi.ai/api/v1/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': PIAPI_KEY },
        body: JSON.stringify(taskBody)
      });
      const cd = await createRes.json();
      const tid = cd?.data?.task_id;
      if (!tid) return res.status(500).json({ error: cd?.data?.error?.message || 'Veo 3.1: Task fehlgeschlagen — ' + JSON.stringify(cd) });

      // Return task_id for client-side polling (Veo takes 2-3 min)
      return res.status(200).json({ status: 'processing', taskId: tid, model: 'veo' });
    }

    // ── HIGGSFIELD ──
    if (model === 'higgsfield') {
      const HF_KEY_ID = process.env.HIGGSFIELD_KEY_ID;
      const HF_KEY_SECRET = process.env.HIGGSFIELD_KEY_SECRET;
      if (!HF_KEY_ID || !HF_KEY_SECRET) return res.status(500).json({ error: 'Higgsfield Key fehlt' });

      const credentials = Buffer.from(`${HF_KEY_ID}:${HF_KEY_SECRET}`).toString('base64');
      const body = { prompt, duration: 5, resolution: '720p' };
      if (imageUrl) body.image_url = imageUrl;

      const createRes = await fetch('https://cloud.higgsfield.ai/v1/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${credentials}` },
        body: JSON.stringify(body)
      });
      const cd = await createRes.json();
      if (!createRes.ok) return res.status(500).json({ error: cd?.message || 'Higgsfield fehlgeschlagen' });
      const jobId = cd?.id || cd?.job_id;
      if (!jobId) return res.status(500).json({ error: 'Higgsfield: Keine Job-ID' });
      return res.status(200).json({ status: 'processing', taskId: jobId, model: 'higgsfield' });
    }

    // ── HAILUO 2.3 — server-side polling ──
    const hailuoInput = { prompt, model: 'v2.3', expand_prompt: true, duration, resolution };
    if (imageUrl) hailuoInput.image_url = imageUrl;

    const createRes = await fetch('https://api.piapi.ai/api/v1/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': PIAPI_KEY },
      body: JSON.stringify({ model: 'hailuo', task_type: 'video_generation', input: hailuoInput, config: { service_mode: 'public' } })
    });
    const cd = await createRes.json();
    const tid = cd?.data?.task_id;
    if (!tid) return res.status(500).json({ error: cd?.data?.error?.message || 'Hailuo: Task fehlgeschlagen' });

    // Poll server-side for Hailuo (usually fast enough)
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 4000));
      const pd = await (await fetch(`https://api.piapi.ai/api/v1/task/${tid}`, { headers: { 'X-API-KEY': PIAPI_KEY } })).json();
      if (pd?.data?.status === 'completed') {
        return res.status(200).json({ success: true, videoUrl: pd?.data?.output?.video, model: 'hailuo' });
      }
      if (pd?.data?.status === 'failed') {
        return res.status(500).json({ error: pd?.data?.error?.message || 'Hailuo fehlgeschlagen' });
      }
    }
    // If still processing after 60s, return taskId for client polling
    return res.status(200).json({ status: 'processing', taskId: tid, model: 'hailuo' });

  } catch (error) {
    return res.status(500).json({ error: 'Server Fehler: ' + error.message });
  }
}
