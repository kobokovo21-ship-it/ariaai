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
    if (prompt && prompt.length > 2000) prompt = prompt.substring(0, 2000);

    // ── POLL existing task ──
    if (taskId) {
      if (model === 'higgsfield') {
        const HF_KEY_ID = process.env.HIGGSFIELD_KEY_ID;
        const HF_KEY_SECRET = process.env.HIGGSFIELD_KEY_SECRET;
        const authHeader = `Key ${HF_KEY_ID}:${HF_KEY_SECRET}`;
        const pollRes = await fetch(`https://platform.higgsfield.ai/requests/${taskId}/status`, {
          headers: { 'Authorization': authHeader, 'User-Agent': 'higgsfield-server-js/2.0' }
        });
        const text = await pollRes.text();
        let pd;
        try { pd = JSON.parse(text); } catch(e) { return res.status(200).json({ status: 'processing', taskId, model: 'higgsfield' }); }
        const status = (pd?.status || '').toUpperCase();
        if (status === 'COMPLETED') {
          const videoUrl = pd?.output?.media_url?.[0] || pd?.output?.url || pd?.video_url;
          return res.status(200).json({ success: true, videoUrl, status: 'completed' });
        }
        if (status === 'FAILED' || status === 'ERROR') {
          return res.status(500).json({ error: pd?.error || 'Higgsfield fehlgeschlagen', status: 'failed' });
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

    // ── SORA ──
    if (model === 'sora') {
      return res.status(503).json({ error: 'Sora 2.0 ist noch nicht verfuegbar.' });
    }

    // ── VEO 3.1 ──
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
      if (!tid) return res.status(500).json({ error: cd?.data?.error?.message || 'Veo 3.1: Task fehlgeschlagen' });
      return res.status(200).json({ status: 'processing', taskId: tid, model: 'veo' });
    }

    // ── HIGGSFIELD ──
    if (model === 'higgsfield') {
      const HF_KEY_ID = process.env.HIGGSFIELD_KEY_ID;
      const HF_KEY_SECRET = process.env.HIGGSFIELD_KEY_SECRET;
      if (!HF_KEY_ID || !HF_KEY_SECRET) return res.status(500).json({ error: 'Higgsfield Key fehlt' });
      const authHeader = `Key ${HF_KEY_ID}:${HF_KEY_SECRET}`;
      const body = {
        model: 'dop-turbo',
        prompt: prompt,
        input_images: imageUrl ? [{ type: 'image_url', image_url: imageUrl }] : undefined
      };
      const endpoint = imageUrl
        ? 'https://platform.higgsfield.ai/v1/image2video/dop'
        : 'https://platform.higgsfield.ai/v1/text2video/dop';
      const createRes = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': authHeader, 'User-Agent': 'higgsfield-server-js/2.0' },
        body: JSON.stringify(body)
      });
      const text = await createRes.text();
      let cd;
      try { cd = JSON.parse(text); } catch(e) { return res.status(500).json({ error: 'Higgsfield: Ungueltige Antwort' }); }
      if (!createRes.ok) return res.status(500).json({ error: cd?.message || cd?.error || 'Higgsfield fehlgeschlagen' });
      const jobId = cd?.request_id || cd?.id || cd?.job_id;
      if (!jobId) return res.status(500).json({ error: 'Higgsfield: Keine Job-ID' });
      return res.status(200).json({ status: 'processing', taskId: jobId, model: 'higgsfield' });
    }

    // ── HAILUO 2.3 — direkt Task erstellen, kein Server-Polling ──
    const hailuoInput = {
      prompt,
      model: 'v2.3',
      expand_prompt: true,
      duration: parseInt(duration) || 6,
      resolution: parseInt(resolution) || 768
    };
    if (imageUrl) hailuoInput.image_url = imageUrl;

    const createRes = await fetch('https://api.piapi.ai/api/v1/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': PIAPI_KEY },
      body: JSON.stringify({
        model: 'hailuo',
        task_type: 'video_generation',
        input: hailuoInput,
        config: { service_mode: 'public' }
      })
    });

    const cd = await createRes.json();
    const tid = cd?.data?.task_id;

    if (!tid) {
      return res.status(500).json({
        error: cd?.data?.error?.message || cd?.message || 'Hailuo: Task konnte nicht erstellt werden'
      });
    }

    // Sofort Task-ID zurueckgeben — Client pollt selbst
    return res.status(200).json({ status: 'processing', taskId: tid, model: 'hailuo' });

  } catch (error) {
    return res.status(500).json({ error: 'Server Fehler: ' + error.message });
  }
}
