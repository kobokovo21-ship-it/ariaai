export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Nicht eingeloggt' });

  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${token}` }
    });
    const user = await userRes.json();
    if (!user?.id) return res.status(401).json({ error: 'Ungültiger Token' });

    if (req.method === 'GET') {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${user.id}&select=credits,plan`, {
        headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` }
      });
      const data = await r.json();
      const isAdmin = !!(process.env.ADMIN_EMAIL && user.email === process.env.ADMIN_EMAIL);
      return res.status(200).json({ credits: data?.[0]?.credits ?? 0, plan: data?.[0]?.plan ?? 'free', is_admin: isAdmin });
    }

    if (req.method === 'POST') {
      const { amount } = req.body;
      const r = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${user.id}&select=credits`, {
        headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` }
      });
      const data = await r.json();
      const current = data?.[0]?.credits ?? 0;
      if (current < amount) return res.status(402).json({ error: 'Nicht genug Credits' });

      const upd = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Prefer': 'return=representation' },
        body: JSON.stringify({ credits: current - amount })
      });
      const updated = await upd.json();
      return res.status(200).json({ success: true, credits: updated?.[0]?.credits ?? current - amount });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

