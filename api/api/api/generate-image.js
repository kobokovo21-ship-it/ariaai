export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { prompt, model = 'Qubico/flux1-dev' } = req.body;

    // 1. Task erstellen
    const createRes = await fetch('https://api.piapi.ai/api/v1/task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': process.env.PIAPI_KEY
      },
      body: JSON.stringify({
        model,
        task_type: 'txt2img',
        input: { prompt }
      })
    });

    const createData = await createRes.json();
    const taskId = createData?.data?.task_id;

    if (!taskId) {
      return res.status(500).json({ error: 'Task konnte nicht erstellt werden', details: createData });
    }

    // 2. Polling bis Bild fertig ist (max 60 Sekunden)
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));

      const pollRes = await fetch(`https://api.piapi.ai/api/v1/task/${taskId}`, {
        headers: { 'X-API-KEY': process.env.PIAPI_KEY }
      });

      const pollData = await pollRes.json();
      const status = pollData?.data?.status;

      if (status === 'completed') {
        const imageUrl = pollData?.data?.output?.image_url
          || pollData?.data?.output?.images?.[0];
        return res.status(200).json({ imageUrl });
      }

      if (status === 'failed') {
        return res.status(500).json({ error: 'Bildgenerierung fehlgeschlagen' });
      }
    }

    return res.status(504).json({ error: 'Timeout - Bild dauert zu lange' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
