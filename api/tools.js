import { generateVideoForUser } from '../lib/higgsfield.js';
export const config = { maxDuration: 60 };

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
  const BASE = process.env.SUPABASE_URL;
  const SVC = process.env.SUPABASE_SERVICE_KEY;
  const RESEND = process.env.RESEND_API_KEY;
  const ELEVEN = process.env.ELEVENLABS_API_KEY;
  const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
  const TWILIO_KEY = process.env.TWILIO_API_KEY;
  const TWILIO_SECRET = process.env.TWILIO_API_SECRET;
  const TWILIO_FROM = process.env.TWILIO_FROM_NUMBER;
  const body = req.method !== 'GET' ? (req.body || {}) : {};
  const tool = req.method === 'GET' ? req.query.tool : body.tool;
  // ─── HELPER: Token validieren ───
  async function validateToken(token) {
    if (!token) return null;
    try {
      const r = await fetch(`${BASE}/auth/v1/user`, {
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${token}` }
      });
      const user = await r.json();
      return user?.id ? user : null;
    } catch(e) { return null; }
  }
  // ─── HELPER: SMS via Twilio ───
  async function sendSMS(to, message) {
    if (!TWILIO_SID || !TWILIO_KEY || !TWILIO_SECRET || !TWILIO_FROM) return false;
    if (!to || !to.startsWith('+')) return false;
    try {
      const auth = Buffer.from(TWILIO_KEY + ':' + TWILIO_SECRET).toString('base64');
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
        method: 'POST',
        headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ From: TWILIO_FROM, To: to, Body: message })
      });
      return r.ok;
    } catch(e) { return false; }
  }
  // ─── HELPER: Email via Resend ───
  async function sendEmail(to, subject, html) {
    if (!RESEND || !to) return false;
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + RESEND },
        body: JSON.stringify({ from: 'Virgo AI <noreply@virgoio.com>', to, subject, html })
      });
      return r.ok;
    } catch(e) { return false; }
  }
  // ─── HELPER: Lead Email HTML ───
  function buildLeadEmail(data) {
    const safe = (s) => String(s || '—').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return `<div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px">
      <h1 style="font-size:13px;font-weight:200;letter-spacing:8px;color:#111;margin-bottom:24px">V I R G O</h1>
      <h2 style="font-size:20px;font-weight:500;margin-bottom:16px">Neuer Lead!</h2>
      <div style="background:#f7f7f7;border-radius:12px;padding:20px;margin-bottom:20px">
        <p style="font-size:13px;margin-bottom:8px"><strong>Name:</strong> ${safe(data.name)}</p>
        <p style="font-size:13px;margin-bottom:8px"><strong>Telefon:</strong> ${safe(data.telefon)}</p>
        <p style="font-size:13px;margin-bottom:8px"><strong>Email:</strong> ${safe(data.email)}</p>
        <p style="font-size:13px;margin-bottom:8px"><strong>Versicherung:</strong> ${safe(data.versicherung)}</p>
        <p style="font-size:13px"><strong>Nachricht:</strong> ${safe(data.nachricht)}</p>
      </div>
      <a href="https://virgoio.com/leads.html" style="padding:12px 24px;background:#111;color:#fff;text-decoration:none;border-radius:8px;font-size:13px">Dashboard oeffnen</a>
      <p style="font-size:11px;color:#bbb;margin-top:32px">Virgo AI · virgoio.com</p>
    </div>`;
  }
  // ─── TEXT TO SPEECH ───
  if (tool === 'tts') {
    try {
      const { text, voice_id = 'pNInz6obpgDQGcFmaJgB', model_id = 'eleven_multilingual_v2' } = body;
      if (!text) return res.status(400).json({ error: 'Kein Text angegeben' });
      if (text.length > 5000) return res.status(400).json({ error: 'Text zu lang (max. 5000 Zeichen)' });
      if (!ELEVEN) return res.status(500).json({ error: 'Audio-Engine nicht konfiguriert' });
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice_id)}`, {
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
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }
  // ─── EMAIL ───
  if (tool === 'email') {
    try {
      const { type, to, data = {} } = body;
      if (!to) return res.status(400).json({ error: 'Kein Empfaenger angegeben' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: 'Ungueltige Email-Adresse' });
      let subject, html;
      const safe = (s) => String(s || '—').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      if (type === 'welcome') {
        subject = 'Willkommen bei Virgo AI!';
        html = `<div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px">
          <h1 style="font-size:13px;font-weight:200;letter-spacing:8px;color:#111;margin-bottom:24px">V I R G O</h1>
          <h2 style="font-size:24px;font-weight:300;margin-bottom:16px">Willkommen!</h2>
          <p style="font-size:14px;color:#888;line-height:1.7;margin-bottom:24px">Du hast 10 Start-Credits. Generiere Bilder, Ads und nutze den KI-Chat.</p>
          <a href="https://virgoio.com" style="padding:12px 24px;background:#111;color:#fff;text-decoration:none;border-radius:8px;font-size:13px">Jetzt starten</a>
          <p style="font-size:11px;color:#bbb;margin-top:32px">Virgo AI · virgoio.com</p></div>`;
      } else if (type === 'lead') {
        subject = 'Neuer Lead: ' + safe(data.versicherung);
        html = buildLeadEmail(data);
      } else if (type === 'makler-lead') {
        subject = 'Neuer Lead fuer ' + safe(data.makler_name || 'deine Landing Page');
        html = buildLeadEmail(data);
      } else if (type === 'custom') {
        subject = safe(data.subject) || 'Nachricht von Virgo AI';
        html = `<div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px">
          <h1 style="font-size:13px;font-weight:200;letter-spacing:8px;color:#111;margin-bottom:24px">V I R G O</h1>
          <div style="font-size:14px;color:#111;line-height:1.7">${safe(data.body)}</div>
          <p style="font-size:11px;color:#bbb;margin-top:32px">Virgo AI · virgoio.com</p></div>`;
      } else {
        return res.status(400).json({ error: 'Unbekannter Email-Typ' });
      }
      const ok = await sendEmail(to, subject, html);
      if (!ok) return res.status(500).json({ error: 'Email fehlgeschlagen' });
      return res.status(200).json({ success: true });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }
  // ─── MAKLER — PROFIL PER SLUG ───
  if (tool === 'makler-get' || (req.method === 'GET' && req.query.slug)) {
    try {
      const slug = req.query.slug;
      if (!slug) return res.status(400).json({ error: 'Slug fehlt' });
      if (!/^[a-z0-9-]{1,80}$/.test(slug)) return res.status(400).json({ error: 'Ungültiger Slug' });
      const r = await fetch(`${BASE}/rest/v1/makler?slug=eq.${encodeURIComponent(slug)}&select=*&limit=1`, {
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
      });
      if (!r.ok) return res.status(500).json({ error: 'Datenbankfehler' });
      const data = await r.json();
      if (!Array.isArray(data) || !data.length) return res.status(404).json({ error: 'Makler nicht gefunden' });
      const makler = data[0];
      if (makler.active === false) {
        return res.status(200).json({ active: false, name: makler.name });
      }
      if (makler.user_id) {
        try {
          const planR = await fetch(`${BASE}/rest/v1/users?id=eq.${makler.user_id}&select=plan&limit=1`, {
            headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
          });
          if (planR.ok) {
            const planData = await planR.json();
            if (Array.isArray(planData) && planData.length > 0 && planData[0].plan) {
              const plan = planData[0].plan;
              const ACTIVE_PLANS = ['makler-starter', 'makler-pro', 'makler-business'];
              if (!ACTIVE_PLANS.includes(plan)) {
                return res.status(200).json({ active: false, name: makler.name });
              }
            }
          }
        } catch(planErr) {}
      }
      const { alert_email, whatsapp_number, user_id, ...safeMakler } = makler;
      return res.status(200).json({ ...safeMakler, active: true });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }
  // ─── MAKLER — EIGENES PROFIL LADEN ───
  if (tool === 'makler-mine') {
    try {
      const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
      const user = await validateToken(token);
      if (!user) return res.status(401).json({ error: 'Nicht eingeloggt' });
      const r = await fetch(`${BASE}/rest/v1/makler?user_id=eq.${user.id}&select=*&limit=1`, {
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
      });
      if (!r.ok) return res.status(500).json({ error: 'Datenbankfehler' });
      const data = await r.json();
      return res.status(200).json(data[0] || null);
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }
  // ─── MAKLER — PROFIL SPEICHERN ───
  if (tool === 'makler-save') {
    try {
      const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
      let user = await validateToken(token);
      if (!user) {
        const ADMIN = process.env.ADMIN_EMAIL || 'holyencore@gmail.com';
        try {
          const parts = token.split('.');
          if (parts.length === 3) {
            let b64 = parts[1].replace(/-/g,'+').replace(/_/g,'/');
            while (b64.length % 4) b64 += '=';
            const payload = JSON.parse(Buffer.from(b64,'base64').toString('utf8'));
            if (payload.email === ADMIN && payload.sub) user = { id: payload.sub, email: payload.email };
          }
        } catch(e) {}
      }
      if (!user) return res.status(401).json({ error: 'Token abgelaufen — bitte neu anmelden' });
      const { name, firma, telefon, email, beschreibung, headline, custom_sections, versicherungen, farbe, slug, header_image, alert_email, whatsapp_number } = body;
      if (!name || !slug) return res.status(400).json({ error: 'Name und Slug sind Pflichtfelder' });
      if (!/^[a-z0-9-]{1,80}$/.test(slug)) return res.status(400).json({ error: 'Ungültiger Slug' });
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id)) {
        return res.status(401).json({ error: 'Ungültige User-ID' });
      }
      const slugCheck = await fetch(`${BASE}/rest/v1/makler?slug=eq.${encodeURIComponent(slug)}&user_id=neq.${user.id}&select=id&limit=1`, {
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
      });
      const slugData = await slugCheck.json();
      if (Array.isArray(slugData) && slugData.length > 0) {
        return res.status(400).json({ error: 'Diese URL-Adresse ist bereits vergeben. Bitte eine andere waehlen.' });
      }
      const profileData = {
        name: name.trim(),
        firma: firma ? firma.trim() : null,
        telefon: telefon ? telefon.trim() : null,
        email: email ? email.trim() : null,
        beschreibung: beschreibung ? beschreibung.trim() : null,
        headline: headline ? headline.trim() : null,
        custom_sections: custom_sections || null,
        versicherungen: Array.isArray(versicherungen) ? versicherungen : [],
        farbe: /^#[0-9a-fA-F]{6}$/.test(farbe) ? farbe : '#111111',
        slug: slug,
        header_image: header_image || null,
        alert_email: alert_email || null,
        whatsapp_number: whatsapp_number || null,
        active: true
      };
      const checkR = await fetch(`${BASE}/rest/v1/makler?user_id=eq.${user.id}&select=id&limit=1`, {
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
      });
      if (!checkR.ok) return res.status(500).json({ error: 'Datenbankfehler beim Prüfen' });
      const existing = await checkR.json();
      let r;
      if (Array.isArray(existing) && existing.length > 0) {
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
      if (!r.ok) {
        const errBody = await r.json().catch(() => ({}));
        return res.status(500).json({ error: 'Datenbankfehler: ' + (errBody.message || errBody.hint || JSON.stringify(errBody)) });
      }
      const data = await r.json();
      return res.status(200).json(data[0] || {});
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }
  // ─── MAKLER — NUR BENACHRICHTIGUNGEN SPEICHERN ───
  if (tool === 'makler-notifications') {
    try {
      const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
      const user = await validateToken(token);
      if (!user) return res.status(401).json({ error: 'Nicht eingeloggt' });
      const { alert_email, whatsapp_number } = body;
      if (alert_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alert_email)) {
        return res.status(400).json({ error: 'Ungueltige Email-Adresse' });
      }
      if (whatsapp_number && !/^\+[0-9]{8,15}$/.test(whatsapp_number)) {
        return res.status(400).json({ error: 'Nummer im Format +49... eingeben' });
      }
      const checkR = await fetch(`${BASE}/rest/v1/makler?user_id=eq.${user.id}&select=id&limit=1`, {
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
      });
      const existing = await checkR.json();
      if (!Array.isArray(existing) || !existing.length) {
        return res.status(400).json({ error: 'Bitte zuerst das Profil speichern.' });
      }
      const r = await fetch(`${BASE}/rest/v1/makler?user_id=eq.${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SVC, 'Authorization': `Bearer ${SVC}`, 'Prefer': 'return=representation' },
        body: JSON.stringify({
          alert_email: alert_email || null,
          whatsapp_number: whatsapp_number || null
        })
      });
      if (!r.ok) return res.status(500).json({ error: 'Datenbankfehler beim Speichern' });
      return res.status(200).json({ success: true });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }
  // ─── MAKLER — LEAD VON LANDING PAGE ───
  if (tool === 'makler-lead') {
    try {
      const { makler_slug, name, telefon, email, versicherung, nachricht } = body;
      if (!name || !telefon) return res.status(400).json({ error: 'Name und Telefon sind Pflichtfelder' });
      if (name.length > 200 || telefon.length > 50) return res.status(400).json({ error: 'Eingabe zu lang' });
      if (!makler_slug || !/^[a-z0-9-]{1,80}$/.test(makler_slug)) return res.status(400).json({ error: 'Ungültiger Makler' });
      const maklerR = await fetch(`${BASE}/rest/v1/makler?slug=eq.${encodeURIComponent(makler_slug)}&select=*&limit=1`, {
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
      });
      const maklerDataArr = await maklerR.json();
      const makler = Array.isArray(maklerDataArr) && maklerDataArr.length ? maklerDataArr[0] : null;
      if (!makler) return res.status(404).json({ error: 'Makler nicht gefunden' });
      if (makler.active === false) {
        return res.status(403).json({ error: 'Makler-Profil nicht aktiv' });
      }
      await fetch(`${BASE}/rest/v1/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SVC, 'Authorization': `Bearer ${SVC}` },
        body: JSON.stringify({
          name: name.trim(),
          telefon: telefon.trim(),
          email: email ? email.trim() : null,
          versicherung: versicherung || 'Allgemein',
          notiz: nachricht ? nachricht.trim() : null,
          makler_id: makler.id || null,
          status: 'neu'
        })
      });
      const leadData = { name, telefon, email, versicherung, nachricht, makler_name: makler.name };
      if (makler.alert_email) {
        const subject = 'Neuer Lead fuer ' + (makler.name || 'deine Landing Page');
        await sendEmail(makler.alert_email, subject, buildLeadEmail(leadData)).catch(() => {});
      }
      if (makler.whatsapp_number) {
        const smsText = 'Neuer Lead! ' + name.trim() + ' - ' + versicherung + ' - Tel: ' + telefon.trim() + ' - Virgo Dashboard: virgoio.com/leads.html';
        await sendSMS(makler.whatsapp_number, smsText).catch(() => {});
      }
      return res.status(200).json({ success: true });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }
  // ─── MAKLER — TERMIN BUCHEN ───
  if (tool === 'makler-booking') {
    try {
      const { makler_slug, name, telefon, email, versicherung, nachricht, date, time } = body;
      if (!name || !telefon) return res.status(400).json({ error: 'Name und Telefon sind Pflichtfelder' });
      if (!date || !time) return res.status(400).json({ error: 'Datum und Uhrzeit fehlen' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Ungultiges Datum' });
      if (!/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: 'Ungultige Uhrzeit' });
      if (!makler_slug || !/^[a-z0-9-]{1,80}$/.test(makler_slug)) return res.status(400).json({ error: 'Ungultiger Makler' });
      const maklerR = await fetch(`${BASE}/rest/v1/makler?slug=eq.${encodeURIComponent(makler_slug)}&select=*&limit=1`, {
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
      });
      const maklerDataArr = await maklerR.json();
      const makler = Array.isArray(maklerDataArr) && maklerDataArr.length ? maklerDataArr[0] : null;
      if (!makler) return res.status(404).json({ error: 'Makler nicht gefunden' });
      if (!makler.booking_enabled) return res.status(400).json({ error: 'Terminbuchung nicht verfugbar' });
      await fetch(`${BASE}/rest/v1/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SVC, 'Authorization': `Bearer ${SVC}` },
        body: JSON.stringify({
          makler_id: makler.id,
          name: name.trim(),
          telefon: telefon.trim(),
          email: email ? email.trim() : null,
          versicherung: versicherung || null,
          nachricht: nachricht ? nachricht.trim() : null,
          date, time, status: 'neu'
        })
      });
      const alertEmail = makler.alert_email || makler.email;
      if (alertEmail) {
        const safe = (s) => String(s || '-').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const html = `<div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px">
          <h1 style="font-size:13px;font-weight:200;letter-spacing:8px;color:#111;margin-bottom:24px">V I R G O</h1>
          <h2 style="font-size:20px;font-weight:500;margin-bottom:16px">Neuer Termin!</h2>
          <div style="background:#f7f7f7;border-radius:12px;padding:20px;margin-bottom:20px">
            <p style="font-size:13px;margin-bottom:8px"><strong>Termin:</strong> ${safe(date)} um ${safe(time)} Uhr (60 Min.)</p>
            <p style="font-size:13px;margin-bottom:8px"><strong>Name:</strong> ${safe(name)}</p>
            <p style="font-size:13px;margin-bottom:8px"><strong>Telefon:</strong> ${safe(telefon)}</p>
            <p style="font-size:13px;margin-bottom:8px"><strong>Email:</strong> ${safe(email)}</p>
            <p style="font-size:13px"><strong>Versicherung:</strong> ${safe(versicherung)}</p>
          </div>
          <p style="font-size:11px;color:#bbb;margin-top:32px">Virgo AI - virgoio.com</p>
        </div>`;
        await sendEmail(alertEmail, 'Neuer Termin: ' + date + ' um ' + time + ' Uhr', html).catch(() => {});
      }
      if (makler.whatsapp_number) {
        const sms = 'Neuer Termin! ' + name.trim() + ' - ' + date + ' um ' + time + ' Uhr - Tel: ' + telefon.trim();
        await sendSMS(makler.whatsapp_number, sms).catch(() => {});
      }
      return res.status(200).json({ success: true });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }
  // ─── MAKLER — BUCHUNGS-EINSTELLUNGEN SPEICHERN ───
  if (tool === 'makler-booking-settings') {
    try {
      const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
      const user = await validateToken(token);
      if (!user) return res.status(401).json({ error: 'Nicht eingeloggt' });
      const { booking_enabled, booking_days, booking_start, booking_end } = body;
      if (booking_enabled) {
        if (!Array.isArray(booking_days) || !booking_days.length) {
          return res.status(400).json({ error: 'Mindestens einen Wochentag auswaehlen' });
        }
        const validDays = ['mo','di','mi','do','fr','sa','so'];
        for (const d of booking_days) {
          if (!validDays.includes(d)) return res.status(400).json({ error: 'Ungültiger Wochentag' });
        }
        if (booking_start && booking_end && booking_start >= booking_end) {
          return res.status(400).json({ error: 'Endzeit muss nach der Startzeit liegen' });
        }
      }
      const checkR = await fetch(`${BASE}/rest/v1/makler?user_id=eq.${user.id}&select=id&limit=1`, {
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
      });
      const existing = await checkR.json();
      if (!Array.isArray(existing) || !existing.length) {
        return res.status(400).json({ error: 'Bitte zuerst das Profil speichern.' });
      }
      const r = await fetch(`${BASE}/rest/v1/makler?user_id=eq.${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SVC, 'Authorization': `Bearer ${SVC}`, 'Prefer': 'return=representation' },
        body: JSON.stringify({
          booking_enabled: !!booking_enabled,
          booking_days: Array.isArray(booking_days) ? booking_days : [],
          booking_start: booking_start || '09:00',
          booking_end: booking_end || '17:00'
        })
      });
      if (!r.ok) return res.status(500).json({ error: 'Datenbankfehler beim Speichern' });
      return res.status(200).json({ success: true });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }
  // ─── MAKLER — PROFIL LÖSCHEN ───
  if (tool === 'makler-delete') {
    try {
      const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
      const user = await validateToken(token);
      if (!user) return res.status(401).json({ error: 'Nicht eingeloggt' });
      const r = await fetch(`${BASE}/rest/v1/makler?user_id=eq.${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SVC, 'Authorization': `Bearer ${SVC}` },
        body: JSON.stringify({ active: false })
      });
      if (!r.ok) return res.status(500).json({ error: 'Datenbankfehler' });
      return res.status(200).json({ success: true });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }
  // ─── VIDEO GENERIEREN (Higgsfield) ───
  // POST /api/tools  Body: { tool:'generate-video', prompt, imageUrl?, workspace }
  // Header: Authorization: Bearer <session-token>
  if (tool === 'generate-video') {
    try {
      const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
      const user = await validateToken(token);
      if (!user) return res.status(401).json({ error: 'Nicht eingeloggt' });

      // Plan des Users laden
      let plan = null;
      try {
        const planR = await fetch(`${BASE}/rest/v1/users?id=eq.${user.id}&select=plan&limit=1`, {
          headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
        });
        if (planR.ok) {
          const planData = await planR.json();
          if (Array.isArray(planData) && planData.length > 0) plan = planData[0].plan;
        }
      } catch(e) {}

      const ADMIN = process.env.ADMIN_EMAIL || 'holyencore@gmail.com';
      const result = await generateVideoForUser({
        userId: user.id,
        plan,
        isAdmin: user.email === ADMIN,
        workspace: body.workspace,
        prompt: body.prompt,
        imageUrl: body.imageUrl,
      });
      return res.status(result.status).json(result.body);
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }
  return res.status(400).json({ error: 'Unbekanntes Tool: ' + (tool || 'keines angegeben') });
}
