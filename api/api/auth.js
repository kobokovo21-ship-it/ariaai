export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const BASE = process.env.SUPABASE_URL;
  const ANON = process.env.SUPABASE_ANON_KEY;

  // Zeige ob Variables vorhanden sind
  if (!BASE || !ANON) {
    return res.status(500).json({ 
      error: 'Environment Variables fehlen',
      has_url: !!BASE,
      has_anon: !!ANON
    });
  }

  try {
    const r = await fetch(`${BASE}/auth/v1/settings`, {
      headers: { 'apikey': ANON, 'Authorization': `Bearer ${ANON}` }
    });
    const d = await r.json();
    return res.status(200).json({ 
      ok: r.ok, 
      status: r.status,
      supabase_connected: true,
      email_confirmation: d.external?.email ?? 'unknown'
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
