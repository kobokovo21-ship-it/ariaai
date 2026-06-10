import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.headers.authorization?.replace('Bearer ', '');
  
  // Ohne Token — lokale Chats, kein Supabase
  if (!token) {
    if (req.method === 'GET') return res.status(200).json([]);
    if (req.method === 'POST') return res.status(200).json({ id: null, local: true });
    if (req.method === 'DELETE') return res.status(200).json({ success: true });
    return res.status(200).json({});
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(200).json([]);

  // GET - Chats laden
  if (req.method === 'GET') {
    if (req.query.gallery === 'true') {
      const { data } = await supabase.from('generations').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50);
      return res.status(200).json(data || []);
    }
    const { data } = await supabase.from('chats').select('id, title, model, created_at, updated_at').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(50);
    return res.status(200).json(data || []);
  }

  // POST - Chat speichern
  if (req.method === 'POST') {
    const { id, title, messages, model } = req.body;
    if (!messages) return res.status(200).json({ local: true });
    
    const chatId = id || require('crypto').randomUUID();
    const { data: existing } = await supabase.from('chats').select('id').eq('id', chatId).eq('user_id', user.id).single();
    
    if (existing) {
      const { data } = await supabase.from('chats').update({ title: title || 'Chat', messages, model: model || 'chat', updated_at: new Date().toISOString() }).eq('id', chatId).eq('user_id', user.id).select().single();
      return res.status(200).json(data || { id: chatId });
    } else {
      const { data } = await supabase.from('chats').insert({ id: chatId, user_id: user.id, title: title || 'Chat', messages, model: model || 'chat', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).select().single();
      return res.status(200).json(data || { id: chatId });
    }
  }

  // PUT - Chat updaten
  if (req.method === 'PUT') {
    const { id, title, messages } = req.body;
    if (!id) return res.status(200).json({ local: true });
    const { data } = await supabase.from('chats').update({ title: title || 'Chat', messages, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id).select().single();
    return res.status(200).json(data || { id });
  }

  // DELETE - Chat löschen
  if (req.method === 'DELETE') {
    const id = req.query.id || req.body?.id;
    if (!id) return res.status(200).json({ success: true });
    await supabase.from('chats').delete().eq('id', id).eq('user_id', user.id);
    return res.status(200).json({ success: true });
  }

  return res.status(200).json({});
}

