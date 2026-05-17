export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const BASE = process.env.SUPABASE_URL;
  const SVC = process.env.SUPABASE_SERVICE_KEY;
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Nicht eingeloggt' });
  const userRes = await fetch(`${BASE}/auth/v1/user`, {
    headers: { 'apikey': SVC, 'Authorization': `Bearer ${token}` }
  });
  const user = await userRes.json();
  if (!user?.id) return res.status(401).json({ error: 'Ungültiger Token' });
  try {
    if (req.method === 'GET') {
      // ── GALLERY ──
      if (req.query.gallery === 'true') {
        const r = await fetch(`${BASE}/rest/v1/generations?user_id=eq.${user.id}&order=created_at.desc&limit=100`, {
          headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
        });
        const data = await r.json();
        return res.status(200).json(data);
      }
      // ── CHATS ──
      const r = await fetch(`${BASE}/rest/v1/chats?user_id=eq.${user.id}&order=updated_at.desc&limit=50`, {
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
      });
      const data = await r.json();
      return res.status(200).json(data);
    }
    if (req.method === 'POST') {
      // ── GALLERY SAVE ──
      if (req.body.gallery === true) {
        const { type, url, prompt, model } = req.body;
        if (!type || !url) return res.status(400).json({ error: 'type und url erforderlich' });
        const r = await fetch(`${BASE}/rest/v1/generations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SVC, 'Authorization': `Bearer ${SVC}`, 'Prefer': 'return=representation' },
          body: JSON.stringify({ user_id: user.id, type, url, prompt, model })
        });
        const data = await r.json();
        return res.status(200).json(data?.[0] || {});
      }
      // ── CHAT SAVE ──
      const { title, messages } = req.body;
      const r = await fetch(`${BASE}/rest/v1/chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SVC, 'Authorization': `Bearer ${SVC}`, 'Prefer': 'return=representation' },
        body: JSON.stringify({ user_id: user.id, title, messages })
      });
      if (!r.ok) return res.status(500).json({ error: 'Chat konnte nicht erstellt werden' });
      const data = await r.json();
      return res.status(200).json(data?.[0] || {});
    }
    if (req.method === 'PUT') {
      const { id, messages, title } = req.body;
      const r = await fetch(`${BASE}/rest/v1/chats?id=eq.${id}&user_id=eq.${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SVC, 'Authorization': `Bearer ${SVC}`, 'Prefer': 'return=representation' },
        body: JSON.stringify({ messages, title, updated_at: new Date().toISOString() })
      });
      if (!r.ok) return res.status(500).json({ error: 'Chat konnte nicht aktualisiert werden' });
      const data = await r.json();
      return res.status(200).json(data?.[0] || {});
    }
    if (req.method === 'DELETE') {
      const { id } = req.body;
      await fetch(`${BASE}/rest/v1/chats?id=eq.${id}&user_id=eq.${user.id}`, {
        method: 'DELETE',
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
      });
      return res.status(200).json({ success: true });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
