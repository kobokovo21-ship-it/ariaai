export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { prompt, model = 'gpt-image-2', image_base64, image_mime } = req.body;

    // Model to task_type mapping
    const taskTypes = {
      'gpt-image-2': 'text-to-image',
      'nano-banana-pro': 'text-to-image', 
      'seedream-5-lite': 'text-to-image',
      'flux-dev': 'text-to-image'
    };

    const task_type = image_base64 ? 'image-to-image' : (taskTypes[model] || 'text-to-image');

    const input = image_base64 
      ? { prompt, image_url: `data:${image_mime};base64,${image_base64}` }
      : { prompt };

    const response = await fetch('https://api.piapi.ai/api/v1/task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': process.env.PIAPI_KEY
      },
      body: JSON.stringify({ model, task_type, input })
    });

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
