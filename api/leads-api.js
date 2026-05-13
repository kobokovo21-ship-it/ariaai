export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const BASE = process.env.SUPABASE_URL;
  const SVC = process.env.SUPABASE_SERVICE_KEY;

  try {
    // GET — alle Leads laden
    if (req.method === 'GET') {
      const r = await fetch(`${BASE}/rest/v1/leads?order=created_at.desc`, {
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
      });
      const data = await r.json();
      return res.status(200).json(data);
    }

    // POST — neuen Lead erstellen
    if (req.method === 'POST') {
      const { name, telefon, email, versicherung, status = 'neu', notiz } = req.body;
      if (!name || !telefon || !versicherung) {
        return res.status(400).json({ error: 'Name, Telefon und Versicherung sind Pflichtfelder' });
      }
      const r = await fetch(`${BASE}/rest/v1/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SVC, 'Authorization': `Bearer ${SVC}`, 'Prefer': 'return=representation' },
        body: JSON.stringify({ name, telefon, email: email || null, versicherung, status, notiz: notiz || null })
      });
      const data = await r.json();
      return res.status(200).json(data[0]);
    }

    // PUT — Lead aktualisieren
    if (req.method === 'PUT') {
      const { id, ...updates } = req.body;
      if (!id) return res.status(400).json({ error: 'ID fehlt' });
      const r = await fetch(`${BASE}/rest/v1/leads?id=eq.${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SVC, 'Authorization': `Bearer ${SVC}`, 'Prefer': 'return=representation' },
        body: JSON.stringify(updates)
      });
      const data = await r.json();
      return res.status(200).json(data[0]);
    }

    // DELETE — Lead löschen
    if (req.method === 'DELETE') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'ID fehlt' });
      await fetch(`${BASE}/rest/v1/leads?id=eq.${id}`, {
        method: 'DELETE',
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
      });
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Methode nicht erlaubt' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
