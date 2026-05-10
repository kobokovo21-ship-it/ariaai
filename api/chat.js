export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { prompt, model = 'ARIA Vision', image_base64, image_mime } = req.body;

    // Map ARIA model names to PiAPI model/task_type
    let piModel = 'gemini';
    let taskType = 'nano-banana-2';

    if (model === 'ARIA Vision' || model === 'gpt-image-2') {
      piModel = 'gpt-image-2';
      taskType = 'text-to-image';
    } else if (model === 'ARIA Pro Max' || model === 'nano-banana-pro') {
      piModel = 'gemini';
      taskType = 'nano-banana-pro';
    } else if (model === 'ARIA Creative' || model === 'seedream-5-lite') {
      piModel = 'seedream';
      taskType = 'seedream-5-lite';
    } else if (model === 'ARIA Artistic' || model === 'flux-dev') {
      piModel = 'flux';
      taskType = 'text-to-image';
    }

    if (image_base64) {
      taskType = 'image-to-image';
    }

    const input = image_base64
      ? { prompt, image_url: `data:${image_mime};base64,${image_base64}` }
      : { prompt };

    const response = await fetch('https://api.piapi.ai/api/v1/task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': process.env.PIAPI_KEY
      },
      body: JSON.stringify({ model: piModel, task_type: taskType, input })
    });

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

   
