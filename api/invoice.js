export const config = { maxDuration: 30 };

const ALLOWED_ORIGINS = ['https://virgoio.com', 'https://www.virgoio.com'];

// Alle Nutzereingaben escapen, bevor sie ins HTML wandern
function safe(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function euro(n) {
  return Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
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
  if (req.method !== 'POST') return res.status(405).end();
  const ok = ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.some(o => referer.startsWith(o));
  if (!ok) {
    console.warn('⛔ Blocked invoice. origin=' + origin + ' referer=' + referer);
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const {
      invoice_nr, kunde, kunde_adresse, datum, faellig,
      absender_name, absender_adresse, absender_email, absender_steuer,
      // NEU: mehrere Positionen [{ beschreibung, menge, einzelpreis }]
      positionen,
      // ALT (bleibt unterstützt): eine Position über leistung + betrag
      leistung, betrag,
      mwst = 19,
      // NEU: Leistungszeitraum, z.B. "Juni 2026" oder "01.06.–30.06.2026"
      leistungszeitraum,
      // NEU: Kleinunternehmer nach §19 UStG → keine MwSt., Pflichthinweis
      kleinunternehmer = false,
      // NEU: Freitext unter der Tabelle (Zahlungshinweis, Dankeszeile, ...)
      freitext,
      // NEU: Bankverbindung (IBAN etc.)
      bankverbindung
    } = req.body;

    // ── Positionen normalisieren (neu ODER alt) ──
    let items = [];
    if (Array.isArray(positionen) && positionen.length > 0) {
      items = positionen
        .filter(p => p && p.beschreibung && p.einzelpreis != null)
        .map(p => ({
          beschreibung: String(p.beschreibung),
          menge: Number(p.menge) > 0 ? Number(p.menge) : 1,
          einzelpreis: parseFloat(p.einzelpreis)
        }))
        .filter(p => !isNaN(p.einzelpreis));
    } else if (leistung && betrag != null) {
      items = [{ beschreibung: String(leistung), menge: 1, einzelpreis: parseFloat(betrag) }];
    }

    // ── Pflichtfelder prüfen ──
    if (!kunde || items.length === 0) {
      return res.status(400).json({ error: 'Pflichtfelder fehlen: Kunde und mindestens eine Position mit Beschreibung und Betrag' });
    }
    if (!absender_name) {
      return res.status(400).json({ error: 'Absender (Firmenname) fehlt — er erscheint oben auf der Rechnung.' });
    }
    if (!absender_adresse) {
      return res.status(400).json({ error: 'Absender-Anschrift fehlt — eine Rechnung ohne vollständige Anschrift des Ausstellers ist nicht gültig.' });
    }
    if (!absender_steuer) {
      return res.status(400).json({ error: 'Steuernummer oder USt-IdNr. des Ausstellers fehlt — Pflichtangabe auf jeder Rechnung.' });
    }

    // ── Beträge rechnen ──
    const netto = items.reduce((sum, p) => sum + p.menge * p.einzelpreis, 0);
    const steuersatz = kleinunternehmer ? 0 : parseFloat(mwst);
    const mwstBetrag = netto * steuersatz / 100;
    const brutto = netto + mwstBetrag;

    // Empfänger-Anschrift ist ab 250 € brutto Pflicht (darunter: Kleinbetragsrechnung)
    if (brutto > 250 && !kunde_adresse) {
      return res.status(400).json({ error: 'Anschrift des Kunden fehlt — ab 250 € Rechnungsbetrag ist sie Pflicht.' });
    }

    const today = datum || new Date().toLocaleDateString('de-DE');
    const fällig = faellig || new Date(Date.now() + 14*24*60*60*1000).toLocaleDateString('de-DE');
    const rNr = invoice_nr || 'INV-' + Date.now();
    // §14: Leistungszeitpunkt ist Pflicht — ohne Angabe gilt das Rechnungsdatum
    const zeitraumZeile = leistungszeitraum
      ? 'Leistungszeitraum: ' + safe(leistungszeitraum)
      : 'Das Leistungsdatum entspricht dem Rechnungsdatum.';

    const positionRows = items.map(p => `
      <tr>
        <td>${safe(p.beschreibung)}</td>
        <td class="num">${p.menge}</td>
        <td class="num">${euro(p.einzelpreis)}</td>
        <td class="num">${euro(p.menge * p.einzelpreis)}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<style>
  body{font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:40px;color:#111}
  .header{display:flex;justify-content:space-between;margin-bottom:40px}
  .logo{font-size:24px;font-weight:200;letter-spacing:8px;text-transform:uppercase}
  .title{font-size:32px;font-weight:700;color:#111;margin-bottom:4px}
  .nr{font-size:14px;color:#888}
  .addresses{display:flex;justify-content:space-between;gap:24px;margin-bottom:40px}
  .addr h3{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:8px}
  .addr p{font-size:13px;line-height:1.6;color:#111}
  table{width:100%;border-collapse:collapse;margin-bottom:12px}
  th{text-align:left;padding:10px;background:#f7f7f7;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#888;border-bottom:2px solid #e8e8e8}
  th.num,td.num{text-align:right;white-space:nowrap}
  td{padding:12px 10px;font-size:13px;border-bottom:1px solid #f0f0f0;vertical-align:top}
  .zeitraum{font-size:12px;color:#888;margin-bottom:24px}
  .totals{margin-left:auto;width:300px}
  .total-row{display:flex;justify-content:space-between;padding:8px 0;font-size:13px;border-bottom:1px solid #f0f0f0}
  .total-row.final{font-size:16px;font-weight:700;border-bottom:none;padding-top:12px}
  .hinweis{margin-top:24px;font-size:12px;color:#555;line-height:1.6}
  .bank{margin-top:16px;font-size:12px;color:#111;line-height:1.6}
  .footer{margin-top:60px;font-size:11px;color:#bbb;text-align:center}
  .badge{display:inline-block;background:#111;color:#fff;padding:4px 10px;border-radius:4px;font-size:10px;letter-spacing:1px}
</style>
</head>
<body>
  <div class="header">
    <div class="logo">${safe(absender_name)}</div>
    <div>
      <div class="title">RECHNUNG</div>
      <div class="nr">${safe(rNr)}</div>
    </div>
  </div>

  <div class="addresses">
    <div class="addr">
      <h3>Von</h3>
      <p><strong>${safe(absender_name)}</strong><br>
      ${safe(absender_adresse).replace(/\n/g,'<br>')}<br>
      ${absender_email ? safe(absender_email) + '<br>' : ''}
      ${'StNr/USt-IdNr: ' + safe(absender_steuer)}</p>
    </div>
    <div class="addr">
      <h3>An</h3>
      <p><strong>${safe(kunde)}</strong><br>
      ${kunde_adresse ? safe(kunde_adresse).replace(/\n/g,'<br>') : ''}</p>
    </div>
    <div class="addr">
      <h3>Details</h3>
      <p>Rechnungsdatum: ${safe(today)}<br>
      Fällig: ${safe(fällig)}<br>
      <span class="badge">OFFEN</span></p>
    </div>
  </div>

  <table>
    <thead><tr><th>Beschreibung</th><th class="num">Menge</th><th class="num">Einzelpreis</th><th class="num">Betrag</th></tr></thead>
    <tbody>${positionRows}</tbody>
  </table>

  <div class="zeitraum">${zeitraumZeile}</div>

  <div class="totals">
    <div class="total-row"><span>Netto</span><span>${euro(netto)}</span></div>
    ${kleinunternehmer ? '' : `<div class="total-row"><span>MwSt. ${steuersatz}%</span><span>${euro(mwstBetrag)}</span></div>`}
    <div class="total-row final"><span>Gesamt</span><span>${euro(brutto)}</span></div>
  </div>

  ${kleinunternehmer ? '<div class="hinweis">Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.</div>' : ''}
  ${freitext ? '<div class="hinweis">' + safe(freitext).replace(/\n/g,'<br>') + '</div>' : ''}
  ${bankverbindung ? '<div class="bank"><strong>Bankverbindung:</strong><br>' + safe(bankverbindung).replace(/\n/g,'<br>') + '</div>' : ''}

  <div class="footer">
    Vielen Dank für Ihr Vertrauen · ${safe(absender_name)}${absender_email ? ' · ' + safe(absender_email) : ''}
  </div>
</body>
</html>`;

    return res.status(200).json({
      success: true,
      html,
      invoice_nr: rNr,
      brutto: brutto.toFixed(2),
      kunde,
      leistung: items.map(p => p.beschreibung).join(', ')
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
