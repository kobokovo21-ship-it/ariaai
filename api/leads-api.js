<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>VIRGO | Makler Login</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@200;300;400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#f7f7f7;color:#111;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px}
.logo{font-size:13px;font-weight:200;letter-spacing:8px;color:#bbb;margin-bottom:48px}
.card{background:#fff;border:1px solid #e8e8e8;border-radius:20px;padding:40px;width:100%;max-width:400px;box-shadow:0 4px 24px rgba(0,0,0,.06)}
.card h1{font-size:22px;font-weight:600;margin-bottom:8px}
.card p{font-size:13px;color:#888;margin-bottom:28px;line-height:1.6}
label{display:block;font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
input{width:100%;padding:12px 16px;border:1.5px solid #e8e8e8;border-radius:10px;font-family:'Inter',sans-serif;font-size:15px;color:#111;outline:none;transition:border-color .2s;background:#fff;margin-bottom:16px}
input:focus{border-color:#111}
.btn{width:100%;padding:14px;background:#111;color:#fff;border:none;border-radius:10px;font-family:'Inter',sans-serif;font-size:15px;font-weight:600;cursor:pointer;transition:opacity .15s}
.btn:hover{opacity:.85}
.btn:disabled{opacity:.4;cursor:not-allowed}
.msg{font-size:12px;padding:10px 14px;border-radius:8px;margin-bottom:16px;display:none}
.msg.error{background:#fef2f2;border:1px solid #fecaca;color:#991b1b}
.msg.success{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534}
.back-link{margin-top:20px;font-size:12px;color:#bbb;text-align:center}
.back-link a{color:#888;text-decoration:none}
#step-code{display:none}
.phone-hint{font-size:11px;color:#bbb;margin-top:-10px;margin-bottom:16px}
</style>
</head>
<body>

<div class="logo">V I R G O</div>

<div class="card">
  <div id="step-phone">
    <h1>Makler Login</h1>
    <p>Gib deine Handynummer ein — du bekommst einen SMS-Code.</p>
    <div id="msg-phone" class="msg"></div>
    <label>Handynummer</label>
    <input id="phone" type="tel" placeholder="+49 170 1234567" autocomplete="tel">
    <div class="phone-hint">Mit Ländervorwahl, z.B. +49 für Deutschland</div>
    <button class="btn" id="btn-send" onclick="sendCode()">SMS-Code senden</button>
  </div>

  <div id="step-code">
    <h1>Code eingeben</h1>
    <p id="code-hint">Wir haben einen 6-stelligen Code an <strong id="phone-display"></strong> gesendet.</p>
    <div id="msg-code" class="msg"></div>
    <label>SMS-Code</label>
    <input id="code" type="number" placeholder="123456" maxlength="6" autocomplete="one-time-code">
    <button class="btn" id="btn-verify" onclick="verifyCode()">Einloggen</button>
    <div style="text-align:center;margin-top:16px">
      <a href="#" onclick="resetToPhone()" style="font-size:12px;color:#888;text-decoration:none">Andere Nummer verwenden</a>
    </div>
  </div>
</div>

<div class="back-link"><a href="/">← Zurück zu Virgo</a></div>

<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script>
const supabase = window.supabase.createClient(
  'https://bluapvynnrmrtcnyszyh.supabase.co',
  'sb_publishable_R4eKdWtTWLp193irAL4ADA_fkdQm8hK'
);

const redirect = new URLSearchParams(window.location.search).get('redirect') || '/leads.html';

function showMsg(id, text, type) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = 'msg ' + type;
  el.style.display = 'block';
}

function resetToPhone() {
  document.getElementById('step-phone').style.display = 'block';
  document.getElementById('step-code').style.display = 'none';
  document.getElementById('msg-phone').style.display = 'none';
  document.getElementById('phone').value = '';
  document.getElementById('code').value = '';
}

async function sendCode() {
  const phone = document.getElementById('phone').value.trim();
  if (!phone) { showMsg('msg-phone', 'Bitte Handynummer eingeben.', 'error'); return; }

  const btn = document.getElementById('btn-send');
  btn.disabled = true; btn.textContent = 'Wird gesendet...';

  const { error } = await supabase.auth.signInWithOtp({ phone });

  if (error) {
    showMsg('msg-phone', error.message || 'Fehler beim Senden.', 'error');
    btn.disabled = false; btn.textContent = 'SMS-Code senden';
    return;
  }

  document.getElementById('phone-display').textContent = phone;
  document.getElementById('step-phone').style.display = 'none';
  document.getElementById('step-code').style.display = 'block';
  btn.disabled = false; btn.textContent = 'SMS-Code senden';
}

async function verifyCode() {
  const phone = document.getElementById('phone').value.trim();
  const token = document.getElementById('code').value.trim();
  if (!token) { showMsg('msg-code', 'Bitte Code eingeben.', 'error'); return; }

  const btn = document.getElementById('btn-verify');
  btn.disabled = true; btn.textContent = 'Wird geprüft...';

  const { data, error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });

  if (error) {
    showMsg('msg-code', 'Falscher Code oder abgelaufen.', 'error');
    btn.disabled = false; btn.textContent = 'Einloggen';
    return;
  }

  localStorage.setItem('virgo_token', data.session.access_token);
  window.location.href = redirect;
}

document.getElementById('code').addEventListener('keydown', e => {
  if (e.key === 'Enter') verifyCode();
});
document.getElementById('phone').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendCode();
});
</script>
</body>
</html>

