import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  try {
    const { action, email, password } = req.body;

    if (action === 'register') {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ success: true, user: data.user, session: data.session });
    }

    if (action === 'login') {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return res.status(400).json({ error: error.message });
      
      // Credits laden
      const { data: userData } = await supabase
        .from('users')
        .select('credits, plan')
        .eq('id', data.user.id)
        .single();

      return res.status(200).json({ 
        success: true, 
        user: data.user, 
        session: data.session,
        credits: userData?.credits || 5,
        plan: userData?.plan || 'free'
      });
    }

    if (action === 'logout') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (token) await supabase.auth.admin.signOut(token);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unbekannte Aktion' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
