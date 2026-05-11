export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const BASE = process.env.SUPABASE_URL;
  const SVC = process.env.SUPABASE_SERVICE_KEY;
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Nicht eingeloggt' });

  // Get user from token
  const userRes = await fetch(`${BASE}/auth/v1/user`, {
    headers: { 'apikey': SVC, 'Authorization': `Bearer ${token}` }
  });
  const user = await userRes.json();
  if (!user?.id) return res.status(401).json({ error: 'Ungültiger Token' });

  try {
    // GET — alle Chats laden
    if (req.method === 'GET') {
      const r = await fetch(`${BASE}/rest/v1/chats?user_id=eq.${user.id}&order=updated_at.desc&limit=50`, {
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
      });
      const data = await r.json();
      return res.status(200).json(data);
    }

    // POST — neuen Chat speichern
    if (req.method === 'POST') {
      const { title, messages } = req.body;
      const r = await fetch(`${BASE}/rest/v1/chats`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SVC,
          'Authorization': `Bearer ${SVC}`,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({ user_id: user.id, title, messages })
      });
      const data = await r.json();
      return res.status(200).json(data[0]);
    }

    // PUT — Chat aktualisieren
    if (req.method === 'PUT') {
      const { id, messages, title } = req.body;
      const r = await fetch(`${BASE}/rest/v1/chats?id=eq.${id}&user_id=eq.${user.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SVC,
          'Authorization': `Bearer ${SVC}`,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({ messages, title, updated_at: new Date().toISOString() })
      });
      const data = await r.json();
      return res.status(200).json(data[0]);
    }

    // DELETE — Chat löschen
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
