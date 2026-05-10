export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { prompt, image_base64, image_mime, imageBase64, imageType } = req.body;
    const imgB64 = image_base64 || imageBase64;
    const imgMime = image_mime || imageType || 'image/jpeg';

    let body;
    if (imgB64) {
      // Image-to-Image mit GPT Image 2
      body = {
        model: 'gpt-image-2',
        task_type: 'edit-image',
        input: {
          prompt: prompt || 'fashion model wearing this clothing, professional photography, clean background, high quality',
          image: `data:${imgMime};base64,${imgB64}`
        }
      };
    } else {
      // Text-to-Image mit GPT Image 2
      body = {
        model: 'gpt-image-2',
        task_type: 'text-to-image',
        input: {
          prompt: prompt || 'beautiful image'
        }
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
    const taskId = data?.data?.task_id || data?.task_id;
    return res.status(200).json({ task_id: taskId, ...data });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
