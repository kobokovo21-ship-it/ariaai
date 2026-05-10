import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Nicht eingeloggt' });

  try {
    // User aus Token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Ungültiger Token' });

    // GET — Credits abfragen
    if (req.method === 'GET') {
      const { data } = await supabase
        .from('users')
        .select('credits, plan')
        .eq('id', user.id)
        .single();
      return res.status(200).json({ credits: data?.credits || 0, plan: data?.plan || 'free' });
    }

    // POST — Credits abziehen
    if (req.method === 'POST') {
      const { amount } = req.body;
      
      // Aktuelle Credits laden
      const { data: userData } = await supabase
        .from('users')
        .select('credits')
        .eq('id', user.id)
        .single();

      if (!userData || userData.credits < amount) {
        return res.status(402).json({ error: 'Nicht genug Credits' });
      }

      // Credits abziehen
      const { data: updated } = await supabase
        .from('users')
        .update({ credits: userData.credits - amount })
        .eq('id', user.id)
        .select('credits')
        .single();

      return res.status(200).json({ success: true, credits: updated.credits });
    }

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
