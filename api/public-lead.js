// /api/public-lead.js
// Öffentlicher Endpoint für Leads von der PKV-Check-Landingpage.
// KEIN Login nötig (anonyme Besucher). Schreibt in die bestehende
// `leads`-Tabelle mit makler_id = null → Pool, nur Admin sieht sie
// im Dashboard und weist sie per Bearbeiten einem Makler zu.
// Keine Schema-Änderung in Supabase nötig.

export default async function handler(req, res) {
  // Wenn die Landingpage auf einer anderen Domain als virgoio.com liegt,
  // hier die Domain eintragen. Liegt sie auf virgoio.com selbst, ist
  // CORS egal (same-origin), schadet aber nicht.
  res.setHeader('Access-Control-Allow-Origin', 'https://virgoio.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Methode nicht erlaubt' });

  const BASE = process.env.SUPABASE_URL;
  const SVC = process.env.SUPABASE_SERVICE_KEY;

  const {
    name, telefon, email,
    berufsstatus, aktuellVersichert, einkommenUeberGrenze,
    quelle, utm, consent, consentText, timestamp,
    website,        // Honeypot – muss leer sein
    formStartedAt   // Zeitfalle – Formular-Ladezeitpunkt (ms)
  } = req.body || {};

  // ---- Spam-Bremsen -------------------------------------------------
  // Honeypot ausgefüllt → Bot. Still verwerfen, 200 zurück,
  // damit der Bot nichts lernt.
  if (website) return res.status(200).json({ ok: true });

  // Formular in unter 5 Sekunden abgeschickt → Bot.
  if (formStartedAt && Date.now() - Number(formStartedAt) < 5000) {
    return res.status(200).json({ ok: true });
  }

  // ---- Validierung ---------------------------------------------------
  if (!consent) {
    return res.status(400).json({ error: 'Einwilligung fehlt' });
  }
  if (!name || typeof name !== 'string' || name.trim().length < 2 || name.length > 120) {
    return res.status(400).json({ error: 'Name ungültig' });
  }
  if (!telefon || !/^[+0-9 ()/-]{6,25}$/.test(String(telefon).trim())) {
    return res.status(400).json({ error: 'Telefonnummer ungültig' });
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email).trim()) || email.length > 160) {
    return res.status(400).json({ error: 'E-Mail ungültig' });
  }

  // ---- Mapping auf bestehendes leads-Schema ---------------------------
  // Wizard-Antworten strukturiert in `notiz`, damit keine neuen
  // Spalten nötig sind. Consent-Zeitpunkt wird mitgespeichert
  // (DSGVO: Einwilligung muss nachweisbar sein).
  const statusMap = {
    angestellt: 'Angestellt',
    selbststaendig: 'Selbstständig',
    beamter: 'Beamt:in',
    student: 'Student:in'
  };
  const versichertMap = { gkv: 'GKV', pkv: 'PKV (Bestand)' };
  const einkommenMap = {
    ja: 'über 77.400 €',
    nein: 'unter 77.400 € / unsicher',
    'nicht-relevant': 'n. r.'
  };

  const notiz = [
    `Quelle: ${quelle || 'pkv-check-landingpage'}`,
    `Status: ${statusMap[berufsstatus] || berufsstatus || '–'}`,
    `Aktuell: ${versichertMap[aktuellVersichert] || aktuellVersichert || '–'}`,
    `Einkommen: ${einkommenMap[einkommenUeberGrenze] || '–'}`,
    `Consent: ${timestamp || new Date().toISOString()} (${consentText || 'Datenweitergabe an §34d-Makler'})`,
    utm ? `UTM: ${String(utm).slice(0, 300)}` : null
  ].filter(Boolean).join(' | ');

  try {
    const r = await fetch(`${BASE}/rest/v1/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SVC,
        'Authorization': `Bearer ${SVC}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        name: name.trim(),
        telefon: String(telefon).trim(),
        email: String(email).trim(),
        versicherung: 'PKV',
        status: 'neu',
        notiz,
        makler_id: null // Pool – Admin weist im Dashboard zu
      })
    });
    if (!r.ok) return res.status(500).json({ error: 'Datenbankfehler beim Erstellen' });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
