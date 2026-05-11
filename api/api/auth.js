export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  try {
    const { action, email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'E-Mail und Passwort erforderlich' });
    }

    if (action === 'register') {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': ANON_KEY,
          'Authorization': `Bearer ${ANON_KEY}`
        },
        body: JSON.stringify({ email, password })
      });

      const data = await r.json();

      if (!r.ok) {
        return res.status(400).json({ error: data.error_description || data.msg || 'Registrierung fehlgeschlagen' });
      }

      const userId = data.user?.id || data.id;

      // User in users Tabelle anlegen
      if (userId) {
        await fetch(`${SUPABASE_URL}/rest/v1/users`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SERVICE_KEY,
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ id: userId, email, credits: 10, plan: 'free' })
        });
      }

      return res.status(200).json({
        success: true,
        user: data.user || { id: userId, email },
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
          'apikey': ANON_KEY,
          'Authorization': `Bearer ${ANON_KEY}`
        },
        body: JSON.stringify({ email, password })
      });

      const data = await r.json();

      if (!r.ok) {
        return res.status(400).json({ error: data.error_description || data.error || 'Login fehlgeschlagen' });
      }

      // Credits laden
      const userId = data.user?.id;
      let credits = 10;
      let plan = 'free';

      if (userId) {
        const userRes = await fetch(
          `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=credits,plan`,
          {
            headers: {
              'apikey': SERVICE_KEY,
              'Authorization': `Bearer ${SERVICE_KEY}`
            }
          }
        );
        const users = await userRes.json();
        if (users?.[0]) {
          credits = users[0].credits ?? 10;
          plan = users[0].plan ?? 'free';
        }
      }

      return res.status(200).json({
        success: true,
        user: data.user,
        session: { access_token: data.access_token },
        credits,
        plan
      });
    }

    return res.status(400).json({ error: 'Unbekannte Aktion' });

  } catch (error) {
    return res.status(500).json({ error: 'Server Fehler: ' + error.message });
  }
}
        
   
