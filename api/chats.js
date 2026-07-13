import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
export default async function handler(req, res) {
  const ALLOWED_ORIGINS = ['https://virgoio.com', 'https://www.virgoio.com'];
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!ALLOWED_ORIGINS.includes(origin) && !ALLOWED_ORIGINS.some(o => referer.startsWith(o))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
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
    const { data } = await supabase.from('chats').select('id, title, model, messages, website_html, website_name, is_social, created_at, updated_at').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(50);
    return res.status(200).json(data || []);
  }
  // POST - Chat speichern
  if (req.method === 'POST') {
    const { id, title, messages, model, website_html, website_name, is_social } = req.body;
    if (!messages) return res.status(200).json({ local: true });

    const chatId = id || require('crypto').randomUUID();
    const { data: existing } = await supabase.from('chats').select('id').eq('id', chatId).eq('user_id', user.id).single();

    if (existing) {
      const { data } = await supabase.from('chats').update({ title: title || 'Chat', messages, model: model || 'chat', website_html: website_html || null, website_name: website_name || null, is_social: !!is_social, updated_at: new Date().toISOString() }).eq('id', chatId).eq('user_id', user.id).select().single();
      return res.status(200).json(data || { id: chatId });
    } else {
      const { data } = await supabase.from('chats').insert({ id: chatId, user_id: user.id, title: title || 'Chat', messages, model: model || 'chat', website_html: website_html || null, website_name: website_name || null, is_social: !!is_social, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).select().single();
      return res.status(200).json(data || { id: chatId });
    }
  }
  // PUT - Chat updaten
  if (req.method === 'PUT') {
    const { id, title, messages, website_html, website_name, is_social } = req.body;
    if (!id) return res.status(200).json({ local: true });
    const fields = { title: title || 'Chat', messages, updated_at: new Date().toISOString() };
    if (website_html !== undefined) fields.website_html = website_html || null;
    if (website_name !== undefined) fields.website_name = website_name || null;
    if (is_social !== undefined) fields.is_social = !!is_social;
    const { data } = await supabase.from('chats').update(fields).eq('id', id).eq('user_id', user.id).select().single();
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
