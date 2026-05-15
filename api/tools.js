export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const BASE = process.env.SUPABASE_URL;
  const SVC = process.env.SUPABASE_SERVICE_KEY;
  const RESEND = process.env.RESEND_API_KEY;
  const ELEVEN = process.env.ELEVENLABS_API_KEY;
  const MAKLER_PLANS = ['makler-starter', 'makler-pro', 'makler-business'];
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'holyencore@gmail.com';

  const body = req.method !== 'GET' ? (req.body || {}) : {};
  const tool = req.method === 'GET' ? req.query.tool : body.tool;

  // ── TEXT TO SPEECH ──
  if (tool === 'tts') {
    try {
      const { text, voice_id = 'pNInz6obpgDQGcFmaJgB', model_id = 'eleven_multilingual_v2' } = body;
      if (!text) return res.status(400).json({ error: 'Kein Text angegeben' });
      if (text.length > 5000) return res.status(400).json({ error: 'Text zu lang (max. 5000 Zeichen)' });
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': ELEVEN },
        body: JSON.stringify({ text, model_id, voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        return res.status(500).json({ error: err.detail?.message || 'TTS fehlgeschlagen' });
      }
      const buf = await r.arrayBuffer();
      const base64 = Buffer.from(buf).toString('base64');
      return res.status(200).json({ success: true, audio: base64, mime: 'audio/mpeg' });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── SEND EMAIL ──
  if (tool === 'email') {
    try {
      const { type, to, data = {} } = body;
      if (!to) return res.status(400).json({ error: 'Kein Empfänger angegeben' });
      let subject, html;
      if (type === 'welcome') {
        subject = 'Willkommen bei Virgo AI!';
        html = `<div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px">
          <h1 style="font-size:13px;font-weight:200;letter-spacing:8px;color:#111;margin-bottom:24px">V I R G O</h1>
          <h2 style="font-size:24px;font-weight:300;margin-bottom:16px">Willkommen!</h2>
          <p style="font-size:14px;color:#888;line-height:1.7;margin-bottom:24px">Du hast 10 Start-Credits. Generiere Videos, Bilder und nutze den KI-Chat.</p>
          <a href="https://virgoio.com" style="padding:12px 24px;background:#111;color:#fff;text-decoration:none;border-radius:8px;font-size:13px">Jetzt starten</a>
          <p style="font-size:11px;color:#bbb;margin-top:32px">Virgo AI · virgoio.com</p></div>`;
      } else if (type === 'lead') {
        subject = 'Neuer Lead: ' + (data.versicherung || 'Versicherung');
        html = `<div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px">
          <h1 style="font-size:13px;font-weight:200;letter-spacing:8px;color:#111;margin-bottom:24px">V I R G O</h1>
          <h2 style="font-size:20px;font-weight:500;margin-bottom:16px">Neuer Lead!</h2>
          <div style="background:#f7f7f7;border-radius:12px;padding:20px;margin-bottom:20px">
            <p style="font-size:13px;margin-bottom:8px"><strong>Name:</strong> ${data.name||'—'}</p>
            <p style="font-size:13px;margin-bottom:8px"><strong>Telefon:</strong> ${data.telefon||'—'}</p>
            <p style="font-size:13px;margin-bottom:8px"><strong>Email:</strong> ${data.email||'—'}</p>
            <p style="font-size:13px"><strong>Versicherung:</strong> ${data.versicherung||'—'}</p>
          </div>
          <a href="https://virgoio.com/leads.html" style="padding:12px 24px;background:#111;color:#fff;text-decoration:none;border-radius:8px;font-size:13px">Dashboard öffnen</a>
          <p style="font-size:11px;color:#bbb;margin-top:32px">Virgo AI · virgoio.com</p></div>`;
      } else if (type === 'makler-lead') {
        subject = 'Neuer Lead für ' + (data.makler_name || 'deine Landing Page');
        html = `<div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px">
          <h1 style="font-size:13px;font-weight:200;letter-spacing:8px;color:#111;margin-bottom:24px">V I R G O</h1>
          <h2 style="font-size:20px;font-weight:500;margin-bottom:16px">Neuer Lead!</h2>
          <div style="background:#f7f7f7;border-radius:12px;padding:20px;margin-bottom:20px">
            <p style="font-size:13px;margin-bottom:8px"><strong>Name:</strong> ${data.name||'—'}</p>
            <p style="font-size:13px;margin-bottom:8px"><strong>Telefon:</strong> ${data.telefon||'—'}</p>
            <p style="font-size:13px;margin-bottom:8px"><strong>Email:</strong> ${data.email||'—'}</p>
            <p style="font-size:13px;margin-bottom:8px"><strong>Versicherung:</strong> ${data.versicherung||'—'}</p>
            <p style="font-size:13px;margin-bottom:8px"><strong>Adresse:</strong> ${data.adresse||'—'}</p>
            <p style="font-size:13px"><strong>Nachricht:</strong> ${data.nachricht||'—'}</p>
          </div>
          <p style="font-size:11px;color:#bbb;margin-top:32px">Virgo AI · virgoio.com</p></div>`;
      } else if (type === 'custom') {
        subject = data.subject || 'Nachricht von Virgo AI';
        html = `<div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px">
          <h1 style="font-size:13px;font-weight:200;letter-spacing:8px;color:#111;margin-bottom:24px">V I R G O</h1>
          <div style="font-size:14px;color:#111;line-height:1.7">${data.body||''}</div>
          <p style="font-size:11px;color:#bbb;margin-top:32px">Virgo AI · virgoio.com</p></div>`;
      } else {
        return res.status(400).json({ error: 'Unbekannter Email-Typ' });
      }
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + RESEND },
        body: JSON.stringify({ from: 'Virgo AI <onboarding@resend.dev>', to, subject, html })
      });
      const d = await r.json();
      if (!r.ok) return res.status(500).json({ error: d.message || 'Email fehlgeschlagen' });
      return res.status(200).json({ success: true, id: d.id });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── MAKLER — GET PROFILE BY SLUG (with plan check) ──
  if (tool === 'makler-get' || (req.method === 'GET' && req.query.slug)) {
    try {
      const slug = req.query.slug;
      if (!slug) return res.status(400).json({ error: 'Slug fehlt' });
      if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'Ungültiger Slug' });

      // Makler-Profil laden
      const r = await fetch(`${BASE}/rest/v1/makler?slug=eq.${encodeURIComponent(slug)}&select=*`, {
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
      });
      if (!r.ok) return res.status(500).json({ error: 'Datenbankfehler beim Laden des Maklers' });
      const data = await r.json();
      if (!Array.isArray(data) || !data.length) return res.status(404).json({ error: 'Makler nicht gefunden' });

      const makler = data[0];

      // Plan prüfen — Admin immer erlaubt
      if (makler.user_id) {
        const userRes = await fetch(`${BASE}/rest/v1/users?id=eq.${makler.user_id}&select=plan,email`, {
          headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
        });
        const userData = await userRes.json();
        const userEmail = userData?.[0]?.email || '';
        const plan = userData?.[0]?.plan || 'free';

        // Wenn kein Makler-Plan und kein Admin → Link ungültig
        if (!MAKLER_PLANS.includes(plan) && userEmail !== ADMIN_EMAIL) {
          return res.status(403).json({ error: 'Diese Landing Page ist nicht mehr aktiv.' });
        }
      }

      return res.status(200).json(makler);
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── MAKLER — GET MY PROFILE ──
  if (tool === 'makler-mine') {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) return res.status(401).json({ error: 'Nicht eingeloggt' });
      const userRes = await fetch(`${BASE}/auth/v1/user`, {
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${token}` }
      });
      const user = await userRes.json();
      if (!user?.id) return res.status(401).json({ error: 'Ungültiger Token' });
      const r = await fetch(`${BASE}/rest/v1/makler?user_id=eq.${user.id}&select=*`, {
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
      });
      const data = await r.json();
      return res.status(200).json(data[0] || null);
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── MAKLER — CREATE/UPDATE PROFILE ──
  if (tool === 'makler-save') {
    try {
      const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
      if (!token) return res.status(401).json({ error: 'Nicht eingeloggt — bitte neu anmelden' });

      let user = null;
      try {
        const userRes = await fetch(`${BASE}/auth/v1/user`, {
          headers: { 'apikey': SVC, 'Authorization': `Bearer ${token}` }
        });
        user = await userRes.json();
      } catch(e) {}

      if (!user?.id) {
        try {
          const parts = token.split('.');
          if (parts.length === 3) {
            let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            while (b64.length % 4) b64 += '=';
            const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
            if (payload.email === ADMIN_EMAIL && payload.sub) {
              user = { id: payload.sub, email: payload.email };
            }
          }
        } catch(e) {}
      }

      if (!user?.id) return res.status(401).json({ error: 'Token abgelaufen — bitte neu anmelden auf virgoio.com' });

      const { name, firma, telefon, email, beschreibung, versicherungen, farbe, slug, header_image } = body;
      if (!name || !slug) return res.status(400).json({ error: 'Name und Slug sind Pflichtfelder' });

      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRe.test(user.id)) return res.status(401).json({ error: 'Ungültige User-ID — bitte neu anmelden auf virgoio.com' });

      const checkR = await fetch(`${BASE}/rest/v1/makler?user_id=eq.${user.id}&select=id`, {
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
      });
      if (!checkR.ok) {
        const errBody = await checkR.json().catch(() => ({}));
        return res.status(500).json({ error: 'DB-Fehler: ' + (errBody.message || errBody.hint || errBody.details || JSON.stringify(errBody)) });
      }
      const existing = await checkR.json();

      const profileData = {
        name, firma: firma||null, telefon, email,
        beschreibung: beschreibung||null,
        versicherungen: Array.isArray(versicherungen) ? versicherungen : [],
        farbe: farbe||'#111111',
        slug: slug.toLowerCase().replace(/[^a-z0-9-]/g,'-'),
        header_image: header_image||null
      };

      let r;
      if (existing.length) {
        r = await fetch(`${BASE}/rest/v1/makler?user_id=eq.${user.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'apikey': SVC, 'Authorization': `Bearer ${SVC}`, 'Prefer': 'return=representation' },
          body: JSON.stringify(profileData)
        });
      } else {
        r = await fetch(`${BASE}/rest/v1/makler`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SVC, 'Authorization': `Bearer ${SVC}`, 'Prefer': 'return=representation' },
          body: JSON.stringify({ ...profileData, user_id: user.id })
        });
      }
      if (!r.ok) return res.status(500).json({ error: 'Datenbankfehler beim Speichern des Profils' });
      const data = await r.json();
      return res.status(200).json(data[0] || {});
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── MAKLER — SUBMIT LEAD FROM LANDING PAGE ──
  if (tool === 'makler-lead') {
    try {
      const { makler_id, makler_email, makler_name, name, telefon, email, versicherung, nachricht, adresse } = body;
      if (!name || !telefon) return res.status(400).json({ error: 'Name und Telefon sind Pflichtfelder' });

      // Lead in Supabase speichern
      await fetch(`${BASE}/rest/v1/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SVC, 'Authorization': `Bearer ${SVC}` },
        body: JSON.stringify({
          name,
          telefon,
          email: email||null,
          versicherung: versicherung||'Allgemein',
          notiz: nachricht||null,
          adresse: adresse||null,
          makler_id: makler_id||null
        })
      });

      // Email an Makler
      if (makler_email && RESEND) {
        const emailHtml = `<div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px">
          <h1 style="font-size:13px;font-weight:200;letter-spacing:8px;color:#111;margin-bottom:24px">V I R G O</h1>
          <h2 style="font-size:20px;font-weight:500;margin-bottom:16px">Neuer Lead!</h2>
          <div style="background:#f7f7f7;border-radius:12px;padding:20px;margin-bottom:20px">
            <p style="font-size:13px;margin-bottom:8px"><strong>Name:</strong> ${name||'—'}</p>
            <p style="font-size:13px;margin-bottom:8px"><strong>Telefon:</strong> ${telefon||'—'}</p>
            <p style="font-size:13px;margin-bottom:8px"><strong>Email:</strong> ${email||'—'}</p>
            <p style="font-size:13px;margin-bottom:8px"><strong>Adresse:</strong> ${adresse||'—'}</p>
            <p style="font-size:13px;margin-bottom:8px"><strong>Versicherung:</strong> ${versicherung||'—'}</p>
            <p style="font-size:13px"><strong>Nachricht:</strong> ${nachricht||'—'}</p>
          </div>
          <p style="font-size:11px;color:#bbb;margin-top:32px">Virgo AI · virgoio.com</p></div>`;
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + RESEND },
          body: JSON.stringify({
            from: 'Virgo AI <onboarding@resend.dev>',
            to: makler_email,
            subject: 'Neuer Lead für ' + (makler_name || 'deine Landing Page'),
            html: emailHtml
          })
        }).catch(() => {});
      }

      return res.status(200).json({ success: true });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  return res.status(400).json({ error: 'Unbekanntes Tool: ' + tool });
}
