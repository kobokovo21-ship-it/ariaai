// Issues a short-lived, signed token that authorizes ONE window of render calls
// against the remotion render service. The long-lived RENDER_API_SECRET stays
// here on the server; the browser only ever receives a token that expires in a
// few minutes. Only logged-in users can mint one, so the render endpoint is no
// longer callable by just anyone with its URL.
//
// Token: t1.<base64url(payload)>.<base64url(HMAC-SHA256)>
//   payload = {"exp": <unix seconds>, "sub": "<user id>"}
//   HMAC over "t1.<base64url(payload)>" keyed by RENDER_API_SECRET.
// This must stay byte-for-byte compatible with verifyRenderAuth() in the
// remotion-on-vercel render service (src/app/api/render/auth.ts).

import crypto from 'crypto';

export const config = { maxDuration: 10 };

const ALLOWED_ORIGINS = ['https://virgoio.com', 'https://www.virgoio.com'];
const TOKEN_TTL_SEC = 300; // 5 minutes

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!ALLOWED_ORIGINS.includes(origin) && !ALLOWED_ORIGINS.some((o) => referer.startsWith(o))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.RENDER_API_SECRET;
  // Not configured yet: tell the client to proceed without a key. The render
  // service is likewise open until its own RENDER_API_SECRET is set, so this
  // keeps MP4 export working during a staged rollout (set the secret on the
  // render service first, then here).
  if (!secret) return res.status(200).json({ token: null });

  // Only a logged-in user may mint a render token. Verified via Supabase, which
  // checks the JWT signature server-side (a forged token yields no user).
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const BASE = process.env.SUPABASE_URL;
  const SVC = process.env.SUPABASE_SERVICE_KEY;
  let user = null;
  try {
    const r = await fetch(`${BASE}/auth/v1/user`, {
      headers: { apikey: SVC, Authorization: 'Bearer ' + token },
    });
    const u = await r.json();
    if (u && u.id) user = u;
  } catch (e) {}
  if (!user) return res.status(401).json({ error: 'Bitte einloggen für den MP4-Export.' });

  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC;
  const payloadB64 = b64url(JSON.stringify({ exp, sub: user.id }));
  const sig = b64url(
    crypto.createHmac('sha256', secret).update('t1.' + payloadB64).digest()
  );
  return res.status(200).json({ token: `t1.${payloadB64}.${sig}`, exp });
}
