export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const KEY = process.env.PIAPI_KEY;

  try {
    const { url, type = 'image' } = req.body;
    if (!url) return res.status(400).json({ error: 'Keine URL angegeben' });

    const taskBody = type === 'video' ? {
      model: 'Qubico/video-toolkit',
      task_type: 'upscale',
      input: { video: url }
    } : {
      model: 'Qubico/image-toolkit',
      task_type: 'upscale',
      input: { image: url, scale: 2, face_enhance: true }
    };

    const createRes = await fetch('https://api.piapi.ai/api/v1/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': KEY },
      body: JSON.stringify(taskBody)
    });

    const text = await createRes.text();
    let cd;
    try { cd = JSON.parse(text); } catch(e) { return res.status(500).json({ error: 'Ungültige API Antwort: ' + text.substring(0,200) }); }

    const taskId = cd?.data?.task_id;
    if (!taskId) return res.status(500).json({ error: cd?.data?.error?.message || 'Task fehlgeschlagen: ' + JSON.stringify(cd).substring(0,200) });

    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const pollRes = await fetch(`https://api.piapi.ai/api/v1/task/${taskId}`, {
        headers: { 'X-API-KEY': KEY }
      });
      const pt = await pollRes.text();
      let pd;
      try { pd = JSON.parse(pt); } catch(e) { continue; }
      const status = pd?.data?.status;
      const output = pd?.data?.output;
      if (status === 'completed') {
        const resultUrl = output?.image_url || output?.image || output?.video_url || output?.video || output?.url;
        return res.status(200).json({ success: true, url: resultUrl });
      }
      if (status === 'failed') return res.status(500).json({ error: pd?.data?.error?.message || 'Upscale fehlgeschlagen' });
    }
    return res.status(504).json({ error: 'Timeout — bitte nochmal versuchen' });

  } catch (error) {
    return res.status(500).json({ error: 'Server Fehler: ' + error.message });
  }
}

