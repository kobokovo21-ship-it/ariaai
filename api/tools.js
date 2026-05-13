export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { tool } = req.body;

  // ── TEXT TO SPEECH ──
  if (tool === 'tts') {
    const KEY = process.env.ELEVENLABS_API_KEY;
    try {
      const { text, voice_id = 'pNInz6obpgDQGcFmaJgB', model_id = 'eleven_multilingual_v2' } = req.body;
      if (!text) return res.status(400).json({ error: 'Kein Text angegeben' });
      if (text.length > 5000) return res.status(400).json({ error: 'Text zu lang (max. 5000 Zeichen)' });

      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': KEY },
        body: JSON.stringify({ text, model_id, voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
      });

      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        return res.status(500).json({ error: err.detail?.message || 'TTS fehlgeschlagen' });
      }

      const audioBuffer = await r.arrayBuffer();
      const base64 = Buffer.from(audioBuffer).toString('base64');
      return res.status(200).json({ success: true, audio: base64, mime: 'audio/mpeg' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── SEND EMAIL ──
  if (tool === 'email') {
    const KEY = process.env.RESEND_API_KEY;
    try {
      const { type, to, data = {} } = req.body;
      if (!to) return res.status(400).json({ error: 'Kein Empfänger angegeben' });

      let subject, html;

      if (type === 'welcome') {
        subject = '🎉 Willkommen bei Virgo AI!';
        html = `<div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px">
          <h1 style="font-size:13px;font-weight:200;letter-spacing:8px;color:#111;margin-bottom:24px">V I R G O</h1>
          <h2 style="font-size:24px;font-weight:300;color:#111;margin-bottom:16px">Willkommen bei Virgo AI!</h2>
          <p style="font-size:14px;color:#888;line-height:1.7;margin-bottom:24px">Du hast 10 Start-Credits erhalten. Generiere Videos, Bilder und nutze den KI-Chat für alles.</p>
          <a href="https://virgoio.com" style="display:inline-block;padding:12px 24px;background:#111;color:#fff;text-decoration:none;border-radius:8px;font-size:13px">Jetzt starten →</a>
          <p style="font-size:11px;color:#bbb;margin-top:32px">Virgo AI · virgoio.com</p>
        </div>`;
      } else if (type === 'lead') {
        subject = '🔔 Neuer Lead: ' + (data.versicherung || 'Versicherung');
        html = `<div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px">
          <h1 style="font-size:13px;font-weight:200;letter-spacing:8px;color:#111;margin-bottom:24px">V I R G O</h1>
          <h2 style="font-size:20px;font-weight:500;color:#111;margin-bottom:16px">Neuer Lead eingegangen!</h2>
          <div style="background:#f7f7f7;border-radius:12px;padding:20px;margin-bottom:20px">
            <p style="font-size:13px;margin-bottom:8px"><strong>Name:</strong> ${data.name || '—'}</p>
            <p style="font-size:13px;margin-bottom:8px"><strong>Telefon:</strong> ${data.telefon || '—'}</p>
            <p style="font-size:13px;margin-bottom:8px"><strong>Email:</strong> ${data.email || '—'}</p>
            <p style="font-size:13px;margin-bottom:8px"><strong>Versicherung:</strong> ${data.versicherung || '—'}</p>
            <p style="font-size:13px"><strong>Notiz:</strong> ${data.notiz || '—'}</p>
          </div>
          <a href="https://virgoio.com/leads.html" style="display:inline-block;padding:12px 24px;background:#111;color:#fff;text-decoration:none;border-radius:8px;font-size:13px">Lead anzeigen →</a>
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

  return res.status(400).json({ error: 'Unbekanntes Tool. Nutze: tts, email' });
}
