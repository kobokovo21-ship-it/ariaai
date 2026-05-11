export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  try {
    const { action, email, password } = req.body;

    if (action === 'register') {
      // Register via Supabase REST API
      const r = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify({ email, password })
      });
      const data = await r.json();
      if (data.error || data.msg) return res.status(400).json({ error: data.error_description || data.msg || data.error });

      // Credits in users Tabelle eintragen
      if (data.id) {
        await fetch(`${SUPABASE_URL}/rest/v1/users`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ id: data.id, email, credits: 10, plan: 'free' })
        });
      }

      return res.status(200).json({
        success: true,
        user: { id: data.id, email },
        session: data.session,
        credits: 10,
        plan: 'free'
      });
    }

    if (action === 'login') {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify({ email, password })
      });
      const data = await r.json();
      if (data.error || data.error_description) return res.status(400).json({ error: data.error_description || data.error });

      // Credits laden
      const userRes = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${data.user?.id}&select=credits,plan`, {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        }
      });
      const users = await userRes.json();
      const userData = users?.[0];

      return res.status(200).json({
        success: true,
        user: data.user,
        session: { access_token: data.access_token },
        credits: userData?.credits ?? 10,
        plan: userData?.plan ?? 'free'
      });
    }

    return res.status(400).json({ error: 'Unbekannte Aktion' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
        
