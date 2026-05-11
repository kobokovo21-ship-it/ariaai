export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const BASE = process.env.SUPABASE_URL;
  const ANON = process.env.SUPABASE_ANON_KEY;
  const SVC  = process.env.SUPABASE_SERVICE_KEY;

  const { action, email, password } = req.body || {};

  if (!action || !email || !password) {
    return res.status(400).json({ error: 'E-Mail und Passwort erforderlich' });
  }

  try {
    if (action === 'register') {
      const r = await fetch(`${BASE}/auth/v1/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': ANON,
          'Authorization': `Bearer ${ANON}`
        },
        body: JSON.stringify({ email, password })
      });
      const d = await r.json();
      if (!r.ok) return res.status(400).json({ error: d.error_description || d.msg || 'Registrierung fehlgeschlagen' });

      const uid = d.user?.id;
      if (uid) {
        await fetch(`${BASE}/rest/v1/users`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SVC,
            'Authorization': `Bearer ${SVC}`,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ id: uid, email, credits: 10, plan: 'free' })
        });
      }

      return res.status(200).json({
        success: true,
        user: d.user || { email },
        session: d.session || null,
        credits: 10,
        plan: 'free'
      });
    }

    if (action === 'login') {
      const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': ANON,
          'Authorization': `Bearer ${ANON}`
        },
        body: JSON.stringify({ email, password })
      });
      const d = await r.json();
      if (!r.ok) return res.status(400).json({ error: d.error_description || d.error || 'Login fehlgeschlagen' });

      let credits = 10, plan = 'free';
      if (d.user?.id) {
        const ur = await fetch(`${BASE}/rest/v1/users?id=eq.${d.user.id}&select=credits,plan`, {
          headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
        });
        const ud = await ur.json();
        if (ud?.[0]) { credits = ud[0].credits ?? 10; plan = ud[0].plan ?? 'free'; }
      }

      return res.status(200).json({
        success: true,
        user: d.user,
        session: { access_token: d.access_token },
        credits,
        plan
      });
    }

    return res.status(400).json({ error: 'Unbekannte Aktion' });

  } catch (e) {
    return res.status(500).json({ error: 'Server Fehler: ' + e.message });
  }
}
