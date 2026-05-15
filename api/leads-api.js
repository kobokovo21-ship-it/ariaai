export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const BASE = process.env.SUPABASE_URL;
  const SVC = process.env.SUPABASE_SERVICE_KEY;
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'holyencore@gmail.com';
  const MAKLER_PLANS = ['makler-starter', 'makler-pro', 'makler-business'];

  const token = req.headers.authorization?.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Nicht eingeloggt' });

  try {
    const userRes = await fetch(`${BASE}/auth/v1/user`, {
      headers: { 'apikey': SVC, 'Authorization': `Bearer ${token}` }
    });
    const user = await userRes.json();
    if (!user?.id) return res.status(401).json({ error: 'Ungültiger Token' });

    const isAdmin = !!(ADMIN_EMAIL && user.email === ADMIN_EMAIL);

    if (!isAdmin) {
      const planRes = await fetch(`${BASE}/rest/v1/users?id=eq.${user.id}&select=plan`, {
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
      });
      const planData = await planRes.json();
      const plan = planData?.[0]?.plan || 'free';
      if (!MAKLER_PLANS.includes(plan)) {
        return res.status(403).json({ error: 'Kein Makler-Plan' });
      }
    }

    let maklerId = null;
    if (!isAdmin) {
      const mkRes = await fetch(`${BASE}/rest/v1/makler?user_id=eq.${user.id}&select=id`, {
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
      });
      const mkData = await mkRes.json();
      maklerId = mkData?.[0]?.id || null;
    }

    const filter = maklerId ? `&makler_id=eq.${maklerId}` : '';

    if (req.method === 'GET') {
      const r = await fetch(`${BASE}/rest/v1/leads?order=created_at.desc${filter}`, {
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
      });
      if (!r.ok) return res.status(500).json({ error: 'Datenbankfehler beim Laden' });
      return res.status(200).json(await r.json());
    }

    if (req.method === 'POST') {
      const { name, telefon, email, versicherung, status = 'neu', notiz } = req.body;
      if (!name || !telefon || !versicherung) {
        return res.status(400).json({ error: 'Name, Telefon und Versicherung sind Pflichtfelder' });
      }
      const r = await fetch(`${BASE}/rest/v1/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SVC, 'Authorization': `Bearer ${SVC}`, 'Prefer': 'return=representation' },
        body: JSON.stringify({ name, telefon, email: email || null, versicherung, status, notiz: notiz || null, makler_id: maklerId })
      });
      if (!r.ok) return res.status(500).json({ error: 'Datenbankfehler beim Erstellen' });
      const data = await r.json();
      return res.status(200).json(data[0] || {});
    }

    if (req.method === 'PUT') {
      const { id, ...updates } = req.body;
      if (!id) return res.status(400).json({ error: 'ID fehlt' });
      const query = maklerId ? `id=eq.${id}&makler_id=eq.${maklerId}` : `id=eq.${id}`;
      const r = await fetch(`${BASE}/rest/v1/leads?${query}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SVC, 'Authorization': `Bearer ${SVC}`, 'Prefer': 'return=representation' },
        body: JSON.stringify(updates)
      });
      if (!r.ok) return res.status(500).json({ error: 'Datenbankfehler beim Aktualisieren' });
      const data = await r.json();
      return res.status(200).json(data[0] || {});
    }

    if (req.method === 'DELETE') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'ID fehlt' });
      const query = maklerId ? `id=eq.${id}&makler_id=eq.${maklerId}` : `id=eq.${id}`;
      const r = await fetch(`${BASE}/rest/v1/leads?${query}`, {
        method: 'DELETE',
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
      });
      if (!r.ok) return res.status(500).json({ error: 'Datenbankfehler beim Löschen' });
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Methode nicht erlaubt' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
