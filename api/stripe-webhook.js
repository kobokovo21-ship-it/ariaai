import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  try {
    const event = req.body;

    // Stripe Checkout completed
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const email = session.customer_details?.email;
      const amount = session.amount_total; // in cents

      // Credits basierend auf Preis
      let creditsToAdd = 0;
      if (amount >= 24999) creditsToAdd = 15000;      // Max $249.99
      else if (amount >= 14999) creditsToAdd = 8000;  // Ultra $149.99
      else if (amount >= 9999) creditsToAdd = 5000;   // Master $99.99
      else if (amount >= 4999) creditsToAdd = 2000;   // Pro $49.99
      else if (amount >= 1999) creditsToAdd = 500;    // Standard $19.99

      if (email && creditsToAdd > 0) {
        // User finden
        const { data: users } = await supabase
          .from('users')
          .select('id, credits')
          .eq('email', email)
          .limit(1);

        if (users && users.length > 0) {
          const user = users[0];
          await supabase
            .from('users')
            .update({ credits: user.credits + creditsToAdd })
            .eq('id', user.id);
        }
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
