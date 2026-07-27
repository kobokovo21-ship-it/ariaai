// lib/turnstile.js — Cloudflare Turnstile serverseitiger Verifier.
//
// Aktivierung: Setze in Vercel:
//   TURNSTILE_SITE_KEY    → öffentlich, wird per /api/config an den Client geliefert
//   TURNSTILE_SECRET_KEY  → geheim, hier zur Verifikation
//
// Verhalten:
//   • Prod (VERCEL_ENV=production) OHNE TURNSTILE_SECRET_KEY → fail-CLOSED (403).
//     So können in Produktion niemals öffentliche Endpoints ohne Bot-Schutz laufen,
//     nur weil jemand vergessen hat, die Env-Var zu setzen.
//   • Andere Umgebungen ohne Secret → fail-open (verifyTurnstile → true) plus Warnung,
//     damit lokale Entwicklung nicht bricht.
//   • Ist das Secret gesetzt → Token MUSS validieren, sonst 403.
//
// Zusätzliches Override: REQUIRE_TURNSTILE=1 → fail-closed unabhängig von VERCEL_ENV.
//
// Der Client rendert das Turnstile-Widget und schickt den Token als Feld
// `cf_turnstile_token` mit dem Lead-Payload.

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function isTurnstileConfigured() {
  return !!process.env.TURNSTILE_SECRET_KEY;
}

function isTurnstileRequired() {
  if (process.env.REQUIRE_TURNSTILE === '1') return true;
  if (process.env.VERCEL_ENV === 'production') return true;
  if (process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV) return true;
  return false;
}

let _warned = false;

export async function verifyTurnstile(token, remoteIp) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (isTurnstileRequired()) {
      // Produktion ohne Turnstile-Konfig → hart ablehnen, statt still durchzulassen.
      console.error('[turnstile] FAIL-CLOSED: TURNSTILE_SECRET_KEY fehlt in Produktion.');
      return { ok: false, error: 'not_configured' };
    }
    if (!_warned) {
      console.warn('[turnstile] Kein SECRET_KEY gesetzt → fail-open (nur außerhalb von Produktion erlaubt).');
      _warned = true;
    }
    return { ok: true, skipped: true };
  }
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

// Convenience für LEAD-Formulare: verifiziert zur Beobachtung, BLOCKT aber NIE.
// Ein Lead, der nicht ankommt, ist verlorener Umsatz — deshalb darf Turnstile
// hier niemals ein Formular abweisen (z.B. wenn das Widget auf einer Domain
// nicht lädt oder Cloudflare kurz nicht erreichbar ist). Spam-Schutz übernehmen
// Honeypot, Zeitfalle und IP-Rate-Limit in den Lead-Endpoints selbst.
export async function enforceTurnstile(req, res, token, remoteIp) {
  try {
    const r = await verifyTurnstile(token, remoteIp);
    if (!r.ok) {
      console.warn('[turnstile] nicht verifiziert (' + (r.error || '?') + ') — Lead wird trotzdem angenommen (fail-open).');
    }
  } catch (e) {
    console.warn('[turnstile] Ausnahme bei der Prüfung — Lead wird trotzdem angenommen.');
  }
  return true; // niemals blocken
}
