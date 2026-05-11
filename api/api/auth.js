import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const supabaseAnon = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    const { action, email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'E-Mail und Passwort erforderlich' });
    }

    if (action === 'register') {
      const { data, error } = await supabaseAnon.auth.signUp({ email, password });
      if (error) return res.status(400).json({ error: error.message });

      const userId = data.user?.id;
      if (userId) {
        await supabaseAdmin.from('users').upsert({
          id: userId, email, credits: 10, plan: 'free'
        });
      }

      return res.status(200).json({
        success: true,
        user: data.user,
        session: data.session,
        credits: 10,
        plan: 'free'
      });
    }

    if (action === 'login') {
      const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });
      if (error) return res.status(400).json({ error: error.message });

      const { data: userData } = await supabaseAdmin
        .from('users')
        .select('credits, plan')
        .eq('id', data.user.id)
        .single();

      return res.status(200).json({
        success: true,
        user: data.user,
        session: { access_token: data.session?.access_token },
        credits: userData?.credits ?? 10,
        plan: userData?.plan ?? 'free'
      });
    }

    return res.status(400).json({ error: 'Unbekannte Aktion' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
   
