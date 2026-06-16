export const config = { maxDuration: 30 };

const store = new Map();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    const { html, id } = req.body || {};
    if (!html || !id) return res.status(400).json({ error: 'Missing html or id' });
    store.set(id, { html, ts: Date.now() });
    // Clean old entries
    for (const [k, v] of store.entries()) {
      if (Date.now() - v.ts > 3600000) store.delete(k);
    }
    return res.status(200).json({ ok: true, url: '/preview?id=' + id });
  }

  if (req.method === 'GET') {
    const id = req.query.id;
    if (!id) return res.status(400).send('Missing id');
    const entry = store.get(id);
    if (!entry) return res.status(404).send('Not found');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    return res.status(200).send(entry.html);
  }

  return res.status(405).end();
}
