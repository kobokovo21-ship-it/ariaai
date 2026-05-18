export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const PIAPI_KEY = process.env.PIAPI_KEY;

  try {
    let { prompt, model = 'kling', duration = 5, imageUrl = null, taskId = null } = req.body;

    if (!prompt && !taskId) return res.status(400).json({ error: 'Kein Prompt angegeben' });
    if (prompt && prompt.length > 2000) prompt = prompt.substring(0, 2000);

    // ── POLL existing task ──
    if (taskId) {
      if (model === 'higgsfield') {
        const HF_KEY_ID = process.env.HIGGSFIELD_KEY_ID;
        const HF_KEY_SECRET = process.env.HIGGSFIELD_KEY_SECRET;
        const authHeader = 'Key ' + HF_KEY_ID + ':' + HF_KEY_SECRET;
        const pollRes = await fetch('https://platform.higgsfield.ai/requests/' + taskId + '/status', {
          headers: { 'Authorization': authHeader, 'User-Agent': 'higgsfield-server-js/2.0' }
        });
        const text = await pollRes.text();
        let pd;
        try { pd = JSON.parse(text); } catch(e) {
          return res.status(200).json({ status: 'processing', taskId, model: 'higgsfield' });
        }
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

      // PiAPI polling (Kling, Wan)
      const pollRes = await fetch('https://api.piapi.ai/api/v1/task/' + taskId, {
        headers: { 'X-API-KEY': PIAPI_KEY }
      });
      const pd = await pollRes.json();
      const status = pd?.data?.status;
      const output = pd?.data?.output;
      if (status === 'completed') {
        const videoUrl = output?.video ||
          output?.video_url ||
          output?.works?.[0]?.video?.resource_without_watermark ||
          output?.works?.[0]?.video?.resource ||
          output?.url;
        return res.status(200).json({ success: true, videoUrl, status: 'completed' });
      }
      if (status === 'failed') {
        return res.status(500).json({ error: pd?.data?.error?.message || 'Fehlgeschlagen', status: 'failed' });
      }
      return res.status(200).json({ status: status || 'processing', taskId, model });
    }

    // ── HIGGSFIELD ──
    if (model === 'higgsfield') {
      const HF_KEY_ID = process.env.HIGGSFIELD_KEY_ID;
      const HF_KEY_SECRET = process.env.HIGGSFIELD_KEY_SECRET;
      if (!HF_KEY_ID || !HF_KEY_SECRET) return res.status(500).json({ error: 'Higgsfield Key fehlt' });
      const authHeader = 'Key ' + HF_KEY_ID + ':' + HF_KEY_SECRET;
      const hfBody = {
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
        body: JSON.stringify(hfBody)
      });
      const text = await createRes.text();
      let cd;
      try { cd = JSON.parse(text); } catch(e) {
        return res.status(500).json({ error: 'Higgsfield: Ungueltige Antwort' });
      }
      if (!createRes.ok) return res.status(500).json({ error: cd?.message || cd?.error || 'Higgsfield fehlgeschlagen' });
      const jobId = cd?.request_id || cd?.id || cd?.job_id;
      if (!jobId) return res.status(500).json({ error: 'Higgsfield: Keine Job-ID' });
      return res.status(200).json({ status: 'processing', taskId: jobId, model: 'higgsfield' });
    }

    // ── WAN 2.6 ──
    if (model === 'wan') {
      const createRes = await fetch('https://api.piapi.ai/api/v1/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': PIAPI_KEY },
        body: JSON.stringify({
          model: 'wan2.1',
          task_type: 'txt2video',
          input: {
            prompt,
            negative_prompt: 'blurry, low quality, watermark, text, logo',
            model: 'wan2.6-14B-t2v',
            size: '1280*720'
          },
          config: { service_mode: 'public' }
        })
      });
      const cd = await createRes.json();
      const tid = cd?.data?.task_id;
      if (!tid) return res.status(500).json({ error: cd?.data?.error?.message || cd?.message || 'Wan 2.6: Task fehlgeschlagen' });
      return res.status(200).json({ status: 'processing', taskId: tid, model: 'wan' });
    }

    // ── KLING 2.6 (Standard) ──
    const klingInput = {
      prompt,
      negative_prompt: 'blurry, low quality, watermark, text overlay, logo, nsfw',
      model: 'kling-v2-6',
      duration: String(parseInt(duration) || 5),
      aspect_ratio: '16:9',
      mode: 'std'
    };
    if (imageUrl) klingInput.image_url = imageUrl;

    const createRes = await fetch('https://api.piapi.ai/api/v1/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': PIAPI_KEY },
      body: JSON.stringify({
        model: 'kling',
        task_type: imageUrl ? 'image2video' : 'video_generation',
        input: klingInput,
        config: { service_mode: 'public' }
      })
    });

    const cd = await createRes.json();
    const tid = cd?.data?.task_id;

    if (!tid) {
      return res.status(500).json({
        error: cd?.data?.error?.message || cd?.message || 'Kling: Task fehlgeschlagen'
      });
    }

    return res.status(200).json({ status: 'processing', taskId: tid, model: 'kling' });

  } catch (error) {
    return res.status(500).json({ error: 'Server Fehler: ' + error.message });
  }
}

