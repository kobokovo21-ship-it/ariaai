export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const taskId = req.query.task_id;
  try {
    const response = await fetch(`https://api.piapi.ai/api/v1/task/${taskId}`, {
      headers: { 'X-API-KEY': process.env.PIAPI_KEY }
    });
    const data = await response.json();
    // Flatten nested structure so frontend can access result.status directly
    const taskData = data?.data || data;
    return res.status(200).json({
      status: taskData?.status,
      output: taskData?.output,
      ...data
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
