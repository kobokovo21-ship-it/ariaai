export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const KEY = process.env.PIAPI_KEY;

  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'Keine URL angegeben' });

    const createRes = await fetch('https://api.piapi.ai/api/v1/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': KEY },
      body: JSON.stringify({
        model: 'Qubico/image-toolkit',
        task_type: 'upscale',
        input: {
          image_url: url,
          upscale_factor: 4
        }
      })
    });

    const cd = await createRes.json();
    const taskId = cd?.data?.task_id;
    if (!taskId) return res.status(500).json({ error: cd?.data?.error?.message || 'Upscale Task fehlgeschlagen' });

    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const pd = await (await fetch(`https://api.piapi.ai/api/v1/task/${taskId}`, { headers: { 'X-API-KEY': KEY } })).json();
      const status = pd?.data?.status;
      const output = pd?.data?.output;
      if (status === 'completed') {
        const imageUrl = output?.image_url || output?.url || output?.image;
        return res.status(200).json({ success: true, url: imageUrl });
      }
      if (status === 'failed') return res.status(500).json({ error: pd?.data?.error?.message || 'Upscale fehlgeschlagen' });
    }
    return res.status(504).json({ error: 'Timeout — bitte nochmal versuchen' });

  } catch (error) {
    return res.status(500).json({ error: 'Server Fehler: ' + error.message });
  }
}
