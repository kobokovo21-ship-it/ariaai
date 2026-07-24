// lib/credits.js — atomarer Credit-Abzug via Postgres-RPC.
// Nutzt die SQL-Funktion deduct_credits(p_user_id, p_amount) aus db/schema.sql.
// Verhindert Race-Conditions und negative-amount Bypasses aus dem Client.

export async function deductCredits(userId, amount) {
  if (!userId) return { success: false, credits: 0, error: 'no_user' };
  const n = Math.trunc(Number(amount));
  if (!Number.isFinite(n) || n <= 0) {
    return { success: false, credits: 0, error: 'invalid_amount' };
  }
  const BASE = process.env.SUPABASE_URL;
  const SVC = process.env.SUPABASE_SERVICE_KEY;
  if (!BASE || !SVC) return { success: false, credits: 0, error: 'no_db' };
  try {
    const r = await fetch(`${BASE}/rest/v1/rpc/deduct_credits`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SVC,
        'Authorization': `Bearer ${SVC}`
      },
      body: JSON.stringify({ p_user_id: userId, p_amount: n })
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error('deduct_credits RPC failed:', r.status, t.slice(0, 200));
      return { success: false, credits: 0, error: 'rpc_failed' };
    }
    const data = await r.json();
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { success: false, credits: 0, error: 'no_row' };
    return { success: !!row.success, credits: row.credits ?? 0 };
  } catch (e) {
    console.error('deduct_credits error:', e.message);
    return { success: false, credits: 0, error: 'exception' };
  }
}

// Prüft Credits + zieht ab in einem Aufruf. Antwortet mit dem korrekten
// HTTP-Statuscode auf `res`, wenn nicht genug Credits — Handler kann sofort
// return.
export async function chargeOr402(res, userId, amount) {
  const r = await deductCredits(userId, amount);
  if (r.success) return true;
  if (r.error === 'invalid_amount') {
    res.status(400).json({ error: 'Ungültiger Credit-Betrag' });
  } else if (r.error === 'no_user') {
    res.status(401).json({ error: 'Nicht eingeloggt' });
  } else if (r.error === 'rpc_failed' || r.error === 'no_db' || r.error === 'exception') {
    res.status(500).json({ error: 'Credit-System nicht erreichbar' });
  } else {
    res.status(402).json({ error: 'Nicht genug Credits — bitte Plan upgraden.' });
  }
  return false;
}
