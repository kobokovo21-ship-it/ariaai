export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { prompt, imageBase64, imageType } = req.body;

    let body;
    if (imageBase64) {
      body = {
        model: 'Qubico/flux1-dev',
        task_type: 'img2img-kontext',
        input: {
          prompt: prompt + ', fashion model wearing the product, professional fashion photography, editorial style, clean background',
          image: `data:${imageType || 'image/jpeg'};base64,${imageBase64}`
        }
      };
    } else {
      body = {
        model: 'Qubico/flux1-dev',
        task_type: 'txt2img',
        input: { prompt }
      };
    }

    const response = await fetch('https://api.piapi.ai/api/v1/task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': process.env.PIAPI_KEY
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    // Return task_id at top level so frontend can find it
    const taskId = data?.data?.task_id || data?.task_id;
    return res.status(200).json({ task_id: taskId, ...data });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
