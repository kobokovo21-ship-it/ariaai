import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Ungültiger Token' });

  // GET - Chats laden
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('chats')
      .select('id, title, model, created_at, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data || []);
  }

  // POST - Chat speichern
  if (req.method === 'POST') {
    const { id, title, messages, model } = req.body;
    if (!id || !messages) return res.status(400).json({ error: 'id und messages erforderlich' });

    // Prüfe ob Chat existiert
    const { data: existing } = await supabase
      .from('chats')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    let result;
    if (existing) {
      // Update
      const { data, error } = await supabase
        .from('chats')
        .update({
          title: title || 'Neuer Chat',
          messages,
          model: model || 'chat',
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('user_id', user.id)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      result = data;
    } else {
      // Insert
      const { data, error } = await supabase
        .from('chats')
        .insert({
          id,
          user_id: user.id,
          title: title || 'Neuer Chat',
          messages,
          model: model || 'chat',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      result = data;
    }

    return res.status(200).json(result);
  }

  // DELETE - Chat löschen
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id erforderlich' });
    const { error } = await supabase
      .from('chats')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
