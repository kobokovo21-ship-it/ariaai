// /api/public-lead.js — v2 AUTOMATISCHE VERTEILUNG
// Leads von versicherungenpruefen.de werden automatisch verteilt:
//   1. ?ref=SLUG im Link → Lead geht an genau diesen Makler (wenn aktiver Makler-Plan)
//   2. Kein ref → Round-Robin: aktiver Makler mit den wenigsten Leads diesen Monat
//   3. Kein aktiver Makler vorhanden → Pool (makler_id null), Admin bekommt Mail
// Kontingent: INCLUDED_LEADS pro Monat inklusive. Leads darüber werden TROTZDEM
// zugewiesen (heiße Leads verfallen nicht!), aber als ZUSATZ-LEAD markiert —
// Makler und Admin bekommen das in der Mail mitgeteilt (Abrechnung separat).
// E-Mails laufen über Resend (RESEND_API_KEY), Absender wie in tools.js.

const INCLUDED_LEADS = 5; // im Makler-Abo enthaltene Leads pro Monat
const MAKLER_PLANS = ['makler-starter', 'makler-pro', 'makler-business'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://virgoio.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Methode nicht erlaubt' });

  const BASE = process.env.SUPABASE_URL;
  const SVC = process.env.SUPABASE_SERVICE_KEY;
  const RESEND = process.env.RESEND_API_KEY;
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'holyencore@gmail.com';

  const sb = (path, opts = {}) => fetch(`${BASE}/rest/v1/${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SVC,
      'Authorization': `Bearer ${SVC}`,
      ...(opts.headers || {})
    }
  });

  async function sendEmail(to, subject, html) {
    if (!RESEND || !to) return false;
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + RESEND },
        body: JSON.stringify({ from: 'Virgo AI <noreply@virgoio.com>', to, subject, html })
      });
      return r.ok;
    } catch (e) { return false; }
  }

  // Leads eines Maklers im laufenden Monat zählen
  async function countLeadsThisMonth(maklerId) {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    try {
      const r = await sb(
        `leads?makler_id=eq.${maklerId}&created_at=gte.${encodeURIComponent(monthStart)}&select=id`,
        { headers: { 'Prefer': 'count=exact', 'Range': '0-0' } }
      );
      const cr = r.headers.get('content-range'); // z.B. "0-0/7"
      const total = cr ? parseInt(cr.split('/')[1], 10) : 0;
      return Number.isFinite(total) ? total : 0;
    } catch (e) { return 0; }
  }

  // Hat der Makler einen aktiven Makler-Plan?
  async function hasActivePlan(userId) {
    try {
      const r = await sb(`users?id=eq.${userId}&select=plan&limit=1`);
      const d = await r.json();
      return MAKLER_PLANS.includes(d?.[0]?.plan);
    } catch (e) { return false; }
  }

  const {
    name, telefon, email,
    berufsstatus, aktuellVersichert, einkommenUeberGrenze,
    quelle, utm, consent, consentText, timestamp,
    website,        // Honeypot
    formStartedAt   // Zeitfalle
  } = req.body || {};

  // ---- Spam-Bremsen ---------------------------------------------------
  if (website) return res.status(200).json({ ok: true });
  if (formStartedAt && Date.now() - Number(formStartedAt) < 5000) {
    return res.status(200).json({ ok: true });
  }

  // ---- Validierung -----------------------------------------------------
  if (!consent) return res.status(400).json({ error: 'Einwilligung fehlt' });
  if (!name || typeof name !== 'string' || name.trim().length < 2 || name.length > 120) {
    return res.status(400).json({ error: 'Name ungültig' });
  }
  if (!telefon || !/^[+0-9 ()/-]{6,25}$/.test(String(telefon).trim())) {
    return res.status(400).json({ error: 'Telefonnummer ungültig' });
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email).trim()) || email.length > 160) {
    return res.status(400).json({ error: 'E-Mail ungültig' });
  }

  // ---- Zuweisungslogik --------------------------------------------------
  let makler = null;        // {id, name, email, alert_email, user_id}
  let assignVia = 'pool';   // 'ref' | 'roundrobin' | 'pool'
  let isExtraLead = false;  // über dem Monats-Kontingent?
  let leadsThisMonth = 0;

  // 1) ref=SLUG aus dem UTM-String ziehen (utm = window.location.search)
  let refSlug = null;
  try {
    const params = new URLSearchParams(String(utm || ''));
    refSlug = (params.get('ref') || '').toLowerCase().replace(/[^a-z0-9-]/g, '') || null;
  } catch (e) { /* utm unbrauchbar → egal */ }

  if (refSlug) {
    try {
      const r = await sb(`makler?slug=eq.${encodeURIComponent(refSlug)}&select=id,name,email,alert_email,user_id&limit=1`);
      const d = await r.json();
      if (d?.[0] && await hasActivePlan(d[0].user_id)) {
        makler = d[0];
        assignVia = 'ref';
      }
    } catch (e) { /* fällt auf Round-Robin zurück */ }
  }

  // 2) Kein (gültiger) ref → Round-Robin unter aktiven Maklern
  if (!makler) {
    try {
      const r = await sb(`makler?select=id,name,email,alert_email,user_id&limit=50`);
      const all = await r.json();
      const candidates = [];
      for (const m of (all || [])) {
        if (await hasActivePlan(m.user_id)) {
          const cnt = await countLeadsThisMonth(m.id);
          candidates.push({ ...m, cnt });
        }
      }
      if (candidates.length) {
        candidates.sort((a, b) => a.cnt - b.cnt); // wenigste Leads zuerst
        makler = candidates[0];
        leadsThisMonth = candidates[0].cnt;
        assignVia = 'roundrobin';
      }
    } catch (e) { /* bleibt Pool */ }
  }

  // 3) Kontingent prüfen (bei ref wurde noch nicht gezählt)
  if (makler && assignVia === 'ref') {
    leadsThisMonth = await countLeadsThisMonth(makler.id);
  }
  if (makler && leadsThisMonth >= INCLUDED_LEADS) {
    isExtraLead = true; // trotzdem zuweisen – heiße Leads verfallen nicht
  }

  // ---- Notiz zusammenbauen ----------------------------------------------
  const statusMap = { angestellt: 'Angestellt', selbststaendig: 'Selbstständig', beamter: 'Beamt:in', student: 'Student:in' };
  const versichertMap = { gkv: 'GKV', pkv: 'PKV (Bestand)' };
  const einkommenMap = { ja: 'über 77.400 €', nein: 'unter 77.400 € / unsicher', 'nicht-relevant': 'n. r.' };

  const notiz = [
    `Quelle: ${quelle || 'pkv-check-landingpage'}`,
    `Status: ${statusMap[berufsstatus] || berufsstatus || '–'}`,
    `Aktuell: ${versichertMap[aktuellVersichert] || aktuellVersichert || '–'}`,
    `Einkommen: ${einkommenMap[einkommenUeberGrenze] || '–'}`,
    `Zuweisung: ${assignVia}${refSlug ? ' (' + refSlug + ')' : ''}`,
    isExtraLead ? `ZUSATZ-LEAD (Lead Nr. ${leadsThisMonth + 1} diesen Monat, ${INCLUDED_LEADS} inklusive)` : `Lead Nr. ${leadsThisMonth + 1} von ${INCLUDED_LEADS} inklusive`,
    `Consent: ${timestamp || new Date().toISOString()} (${consentText || 'Datenweitergabe an §34d-Makler'})`,
    utm ? `UTM: ${String(utm).slice(0, 300)}` : null
  ].filter(Boolean).join(' | ');

  // ---- Lead speichern -----------------------------------------------------
  try {
    const r = await sb('leads', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({
        name: name.trim(),
        telefon: String(telefon).trim(),
        email: String(email).trim(),
        versicherung: 'PKV',
        status: 'neu',
        notiz,
        makler_id: makler ? makler.id : null
      })
    });
    if (!r.ok) return res.status(500).json({ error: 'Datenbankfehler beim Erstellen' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  // ---- Benachrichtigungen (Fehler hier dürfen den Lead nie gefährden) -----
  const leadInfoHtml = `
    <p><strong>${name.trim()}</strong><br>
    Telefon: <a href="tel:${String(telefon).trim()}">${String(telefon).trim()}</a><br>
    E-Mail: ${String(email).trim()}<br>
    Status: ${statusMap[berufsstatus] || '–'} · Aktuell: ${versichertMap[aktuellVersichert] || '–'} · Einkommen: ${einkommenMap[einkommenUeberGrenze] || '–'}</p>`;

  try {
    if (makler) {
      const to = makler.alert_email || makler.email;
      const extraHinweis = isExtraLead
        ? `<p style="color:#B3402E"><strong>Hinweis:</strong> Dies ist Lead Nr. ${leadsThisMonth + 1} in diesem Monat. In deinem Abo sind ${INCLUDED_LEADS} Leads enthalten – dieser Zusatz-Lead wird separat berechnet.</p>`
        : `<p>Lead ${leadsThisMonth + 1} von ${INCLUDED_LEADS} in deinem Monats-Kontingent.</p>`;
      await sendEmail(
        to,
        `🔥 Neuer PKV-Lead: ${name.trim()} – jetzt anrufen!`,
        `<h2>Neuer Lead für dich${makler.name ? ', ' + makler.name : ''}!</h2>
         ${leadInfoHtml}
         ${extraHinweis}
         <p><strong>Tipp:</strong> Leads, die innerhalb von 15 Minuten angerufen werden, konvertieren am besten.</p>
         <p><a href="https://virgoio.com" style="background:#111;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none">Zum Leads Dashboard</a></p>`
      );
    }
    // Admin bekommt immer eine Kopie mit Zuweisungs-Info
    await sendEmail(
      ADMIN_EMAIL,
      makler
        ? `Lead zugewiesen an ${makler.name || makler.id}${isExtraLead ? ' (ZUSATZ-LEAD!)' : ''}: ${name.trim()}`
        : `⚠️ Lead im POOL (kein aktiver Makler): ${name.trim()}`,
      `${leadInfoHtml}
       <p>Zuweisung: <strong>${assignVia}</strong>${refSlug ? ' (ref=' + refSlug + ')' : ''}<br>
       ${makler ? `Makler: ${makler.name || makler.id} – Lead ${leadsThisMonth + 1}/${INCLUDED_LEADS}${isExtraLead ? ' → <strong>separat abrechnen!</strong>' : ''}` : 'Kein aktiver Makler-Plan gefunden – bitte manuell im Dashboard zuweisen.'}</p>`
    );
  } catch (e) { /* E-Mail-Fehler ignorieren, Lead ist gespeichert */ }

  return res.status(200).json({ ok: true });
}
