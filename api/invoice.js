export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { 
      invoice_nr, kunde, kunde_adresse, leistung, 
      betrag, mwst = 19, datum, faellig, absender_name,
      absender_adresse, absender_email, absender_steuer
    } = req.body;

    if (!kunde || !leistung || !betrag) {
      return res.status(400).json({ error: 'Pflichtfelder fehlen: Kunde, Leistung, Betrag' });
    }
    if (!absender_name) {
      return res.status(400).json({ error: 'Absender (Firmenname) fehlt — er erscheint oben auf der Rechnung.' });
    }

    const netto = parseFloat(betrag);
    const mwstBetrag = (netto * mwst / 100).toFixed(2);
    const brutto = (netto + parseFloat(mwstBetrag)).toFixed(2);
    const today = datum || new Date().toLocaleDateString('de-DE');
    const fällig = faellig || new Date(Date.now() + 14*24*60*60*1000).toLocaleDateString('de-DE');
    const rNr = invoice_nr || 'INV-' + Date.now();

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
  .addresses{display:flex;justify-content:space-between;margin-bottom:40px}
  .addr h3{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:8px}
  .addr p{font-size:13px;line-height:1.6;color:#111}
  table{width:100%;border-collapse:collapse;margin-bottom:24px}
  th{text-align:left;padding:10px;background:#f7f7f7;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#888;border-bottom:2px solid #e8e8e8}
  td{padding:12px 10px;font-size:13px;border-bottom:1px solid #f0f0f0}
  .totals{margin-left:auto;width:300px}
  .total-row{display:flex;justify-content:space-between;padding:8px 0;font-size:13px;border-bottom:1px solid #f0f0f0}
  .total-row.final{font-size:16px;font-weight:700;border-bottom:none;padding-top:12px}
  .footer{margin-top:60px;font-size:11px;color:#bbb;text-align:center}
  .badge{display:inline-block;background:#111;color:#fff;padding:4px 10px;border-radius:4px;font-size:10px;letter-spacing:1px}
</style>
</head>
<body>
  <div class="header">
    <div class="logo">${absender_name}</div>
    <div>
      <div class="title">RECHNUNG</div>
      <div class="nr">${rNr}</div>
    </div>
  </div>

  <div class="addresses">
    <div class="addr">
      <h3>Von</h3>
      <p><strong>${absender_name}</strong><br>
      ${absender_adresse || ''}<br>
      ${absender_email || ''}<br>
      ${absender_steuer ? 'StNr: ' + absender_steuer : ''}</p>
    </div>
    <div class="addr">
      <h3>An</h3>
      <p><strong>${kunde}</strong><br>
      ${kunde_adresse ? kunde_adresse.replace(/\n/g,'<br>') : ''}</p>
    </div>
    <div class="addr">
      <h3>Details</h3>
      <p>Datum: ${today}<br>
      Fällig: ${fällig}<br>
      <span class="badge">OFFEN</span></p>
    </div>
  </div>

  <table>
    <thead><tr><th>Beschreibung</th><th>Betrag</th></tr></thead>
    <tbody><tr><td>${leistung}</td><td>${netto.toFixed(2)} €</td></tr></tbody>
  </table>

  <div class="totals">
    <div class="total-row"><span>Netto</span><span>${netto.toFixed(2)} €</span></div>
    <div class="total-row"><span>MwSt. ${mwst}%</span><span>${mwstBetrag} €</span></div>
    <div class="total-row final"><span>Gesamt</span><span>${brutto} €</span></div>
  </div>

  <div class="footer">
    Vielen Dank für Ihr Vertrauen · ${absender_name}${absender_email ? ' · ' + absender_email : ''}
  </div>
</body>
</html>`;

    return res.status(200).json({ 
      success: true, 
      html,
      invoice_nr: rNr,
      brutto,
      kunde,
      leistung
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
