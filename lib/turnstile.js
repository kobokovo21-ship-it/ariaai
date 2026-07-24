// lib/turnstile.js — Cloudflare Turnstile serverseitiger Verifier.
//
// Aktivierung: Setze in Vercel:
//   TURNSTILE_SITE_KEY    → öffentlich, wird per /api/config an den Client geliefert
//   TURNSTILE_SECRET_KEY  → geheim, hier zur Verifikation
//
// Verhalten:
//   • Ist TURNSTILE_SECRET_KEY NICHT gesetzt  → fail-open (verifyTurnstile → true).
//     So bricht die App nicht sofort, wenn Turnstile noch nicht konfiguriert ist.
//   • Ist es gesetzt                          → Token MUSS validieren, sonst 403.
//
// Der Client rendert das Turnstile-Widget und schickt den Token als Feld
// `cf_turnstile_token` mit dem Lead-Payload.

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function isTurnstileConfigured() {
  return !!process.env.TURNSTILE_SECRET_KEY;
}

export async function verifyTurnstile(token, remoteIp) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };
  if (!token || typeof token !== 'string') return { ok: false, error: 'missing_token' };

  try {
    const params = new URLSearchParams();
    params.append('secret', secret);
    params.append('response', token);
    if (remoteIp) params.append('remoteip', remoteIp);

    const r = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    if (!r.ok) return { ok: false, error: 'verify_http_' + r.status };
    const data = await r.json();
    if (data && data.success === true) return { ok: true };
    return { ok: false, error: 'invalid_token', codes: data && data['error-codes'] };
  } catch (e) {
    return { ok: false, error: 'verify_exception' };
  }
}

// Convenience: verifiziert + schreibt 403 auf `res` bei Fehler. true → weitermachen.
export async function enforceTurnstile(req, res, token, remoteIp) {
  const r = await verifyTurnstile(token, remoteIp);
  if (r.ok) return true;
  res.status(403).json({ error: 'Bot-Schutz fehlgeschlagen. Bitte Seite neu laden und erneut versuchen.' });
  return false;
}
