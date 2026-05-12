export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const KEY = process.env.RESEND_API_KEY;

  try {
    const { type, to, data = {} } = req.body;
    if (!to) return res.status(400).json({ error: 'Kein Empfänger angegeben' });

    let subject, html;

    if (type === 'welcome') {
      subject = '🎉 Willkommen bei Virgo AI!';
      html = `<div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;background:#fff">
        <h1 style="font-size:13px;font-weight:200;letter-spacing:8px;color:#111;margin-bottom:24px">V I R G O</h1>
        <h2 style="font-size:24px;font-weight:300;color:#111;margin-bottom:16px">Willkommen bei Virgo AI!</h2>
        <p style="font-size:14px;color:#888;line-height:1.7;margin-bottom:24px">Du hast 10 Start-Credits erhalten. Generiere Videos mit Hailuo 2.3, Bilder mit Nano Banana Pro und nutze den KI-Chat für alles.</p>
        <a href="https://virgoio.com" style="display:inline-block;padding:12px 24px;background:#111;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:500">Jetzt starten →</a>
        <p style="font-size:11px;color:#bbb;margin-top:32px">Virgo AI · virgoio.com</p>
      </div>`;
    } else if (type === 'lead') {
      subject = '🔔 Neuer Lead: ' + (data.versicherung || 'Versicherung');
      html = `<div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;background:#fff">
        <h1 style="font-size:13px;font-weight:200;letter-spacing:8px;color:#111;margin-bottom:24px">V I R G O</h1>
        <h2 style="font-size:20px;font-weight:500;color:#111;margin-bottom:16px">Neuer Lead eingegangen!</h2>
        <div style="background:#f7f7f7;border-radius:12px;padding:20px;margin-bottom:20px">
          <p style="font-size:13px;color:#111;margin-bottom:8px"><strong>Name:</strong> ${data.name || '—'}</p>
          <p style="font-size:13px;color:#111;margin-bottom:8px"><strong>Telefon:</strong> ${data.telefon || '—'}</p>
          <p style="font-size:13px;color:#111;margin-bottom:8px"><strong>Email:</strong> ${data.email || '—'}</p>
          <p style="font-size:13px;color:#111;margin-bottom:8px"><strong>Versicherung:</strong> ${data.versicherung || '—'}</p>
          <p style="font-size:13px;color:#111"><strong>Notiz:</strong> ${data.notiz || '—'}</p>
        </div>
        <a href="https://virgoio.com/leads.html" style="display:inline-block;padding:12px 24px;background:#111;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:500">Lead anzeigen →</a>
        <p style="font-size:11px;color:#bbb;margin-top:32px">Virgo AI · virgoio.com</p>
      </div>`;
    } else if (type === 'invoice') {
      subject = 'Ihre Rechnung von Virgo AI — ' + (data.invoice_nr || '');
      html = `<div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;background:#fff">
        <h1 style="font-size:13px;font-weight:200;letter-spacing:8px;color:#111;margin-bottom:24px">V I R G O</h1>
        <h2 style="font-size:20px;font-weight:500;color:#111;margin-bottom:4px">Rechnung ${data.invoice_nr || ''}</h2>
        <p style="font-size:13px;color:#888;margin-bottom:24px">Vielen Dank für Ihr Vertrauen.</p>
        <div style="background:#f7f7f7;border-radius:12px;padding:20px;margin-bottom:20px">
          <p style="font-size:13px;color:#111;margin-bottom:8px"><strong>Kunde:</strong> ${data.kunde || '—'}</p>
          <p style="font-size:13px;color:#111;margin-bottom:8px"><strong>Leistung:</strong> ${data.leistung || '—'}</p>
          <p style="font-size:18px;font-weight:600;color:#111"><strong>Betrag:</strong> ${data.betrag || '—'} €</p>
        </div>
        <p style="font-size:11px;color:#bbb;margin-top:32px">Virgo AI · virgoio.com</p>
      </div>`;
    } else if (type === 'custom') {
      subject = data.subject || 'Nachricht von Virgo AI';
      html = `<div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px">
        <h1 style="font-size:13px;font-weight:200;letter-spacing:8px;color:#111;margin-bottom:24px">V I R G O</h1>
        <div style="font-size:14px;color:#111;line-height:1.7">${data.body || ''}</div>
        <p style="font-size:11px;color:#bbb;margin-top:32px">Virgo AI · virgoio.com</p>
      </div>`;
    } else {
      return res.status(400).json({ error: 'Unbekannter Email-Typ' });
    }

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY },
      body: JSON.stringify({ from: 'Virgo AI <onboarding@resend.dev>', to, subject, html })
    });

    const d = await r.json();
    if (!r.ok) return res.status(500).json({ error: d.message || 'Email fehlgeschlagen' });
    return res.status(200).json({ success: true, id: d.id });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
