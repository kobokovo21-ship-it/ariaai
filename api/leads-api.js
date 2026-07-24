// api/leads-api.js — Leads-Dashboard-API (Makler & Admin)
//
// SICHERHEITS-HARDENING (2026-07):
//   • Zahlender Makler ohne makler_id (kein Profil gespeichert) → 403.
//     Vorher: leerer Filter → er sah/löschte ALLE Leads aller Makler.
//   • Origin/Referer-Whitelist + Rate-Limit.

import { requireUser, getUserPlan, isPayingPlan, isAdminEmail } from '../lib/auth.js';
import { enforceRateLimit } from '../lib/rate-limit.js';

const ALLOWED_ORIGINS = ['https://virgoio.com', 'https://www.virgoio.com'];

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const originOk = ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.some(o => referer.startsWith(o));
  if (!originOk) return res.status(403).json({ error: 'Forbidden' });

  const BASE = process.env.SUPABASE_URL;
  const SVC = process.env.SUPABASE_SERVICE_KEY;

  const user = await requireUser(req, res);
  if (!user) return;

  if (!(await enforceRateLimit(req, res, { name: 'leads-api:' + user.id, windowSec: 60, max: 120 }))) return;

  const isAdmin = isAdminEmail(user.email);

  try {
    // ── Plan prüfen (Admin darf immer) ──────────────────
    if (!isAdmin) {
      const { plan } = await getUserPlan(user.id);
      if (!isPayingPlan(plan)) return res.status(403).json({ error: 'Kein aktiver Makler-Plan' });
    }

    // ── Makler-Zuordnung ───────────────────────────────
    // Admin: kein makler-Filter (sieht alles).
    // Nicht-Admin: MUSS ein Profil haben, sonst 403 — nie unfiltered.
    let maklerId = null;
    if (!isAdmin) {
      const mkRes = await fetch(`${BASE}/rest/v1/makler?user_id=eq.${user.id}&select=id&limit=1`, {
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
      });
      if (!mkRes.ok) return res.status(500).json({ error: 'Profil-Lookup fehlgeschlagen' });
      const mkData = await mkRes.json();
      maklerId = mkData?.[0]?.id || null;
      if (!maklerId) {
        return res.status(403).json({ error: 'Bitte zuerst ein Makler-Profil anlegen, bevor Leads verwaltet werden können.' });
      }
    }

    const scopeFilter = maklerId ? `&makler_id=eq.${maklerId}` : '';

    if (req.method === 'GET') {
      const r = await fetch(`${BASE}/rest/v1/leads?order=created_at.desc${scopeFilter}`, {
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
      });
      if (!r.ok) return res.status(500).json({ error: 'Datenbankfehler beim Laden' });
      return res.status(200).json(await r.json());
    }

    if (req.method === 'POST') {
      const { name, telefon, email, versicherung, status = 'neu', notiz } = req.body || {};
      if (!name || !telefon || !versicherung) {
        return res.status(400).json({ error: 'Name, Telefon und Versicherung sind Pflichtfelder' });
      }
      const r = await fetch(`${BASE}/rest/v1/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SVC, 'Authorization': `Bearer ${SVC}`, 'Prefer': 'return=representation' },
        body: JSON.stringify({
          name: String(name).slice(0, 200),
          telefon: String(telefon).slice(0, 50),
          email: email ? String(email).slice(0, 200) : null,
          versicherung: String(versicherung).slice(0, 100),
          status: String(status).slice(0, 30),
          notiz: notiz ? String(notiz).slice(0, 2000) : null,
          makler_id: maklerId
        })
      });
      if (!r.ok) return res.status(500).json({ error: 'Datenbankfehler beim Erstellen' });
      const data = await r.json();
      return res.status(200).json(data[0] || {});
    }

    if (req.method === 'PUT') {
      const { id, ...updates } = req.body || {};
      if (!id) return res.status(400).json({ error: 'ID fehlt' });
      // Ownership: makler_id-Filter für Nicht-Admin ist Pflicht
      const query = maklerId ? `id=eq.${id}&makler_id=eq.${maklerId}` : `id=eq.${id}`;
      // Erlaubte Felder fürs Update
      const allowedFields = ['name', 'telefon', 'email', 'versicherung', 'status', 'notiz'];
      const safeUpdates = {};
      for (const k of allowedFields) if (k in updates) safeUpdates[k] = updates[k];
      if (!Object.keys(safeUpdates).length) return res.status(400).json({ error: 'Keine gültigen Felder' });
      const r = await fetch(`${BASE}/rest/v1/leads?${query}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SVC, 'Authorization': `Bearer ${SVC}`, 'Prefer': 'return=representation' },
        body: JSON.stringify(safeUpdates)
      });
      if (!r.ok) return res.status(500).json({ error: 'Datenbankfehler beim Aktualisieren' });
      const data = await r.json();
      if (!Array.isArray(data) || !data.length) return res.status(404).json({ error: 'Lead nicht gefunden' });
      return res.status(200).json(data[0]);
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'ID fehlt' });
      const query = maklerId ? `id=eq.${id}&makler_id=eq.${maklerId}` : `id=eq.${id}`;
      const r = await fetch(`${BASE}/rest/v1/leads?${query}`, {
        method: 'DELETE',
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
      });
      if (!r.ok) return res.status(500).json({ error: 'Datenbankfehler beim Löschen' });
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Methode nicht erlaubt' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
