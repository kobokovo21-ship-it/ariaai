export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const taskId = req.query.task_id;
  try {
    const response = await fetch(`https://api.piapi.ai/api/v1/task/${taskId}`, {
      headers: { 'X-API-KEY': process.env.PIAPI_KEY }
    });
    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
