// ═══════════════════════════════════════════════════════
// VIRGO ONBOARDING PATCH — onboarding-patch.js
// Einbinden in makler-onboarding.html direkt vor </body>:
// <script src="/onboarding-patch.js"></script>
// ═══════════════════════════════════════════════════════

(function(){

  // ── 1. Headline-Feld nach Beschreibung einfügen ──
  const beschreibungEl = document.getElementById('beschreibung');
  if(beschreibungEl){
    const wrapper = beschreibungEl.closest('.full') || beschreibungEl.parentElement;
    const headlineGroup = document.createElement('div');
    headlineGroup.className = 'full';
    headlineGroup.style.marginTop = '12px';
    headlineGroup.innerHTML = `
      <label style="display:block;font-size:11px;color:var(--tm);margin-bottom:5px;font-weight:500;text-transform:uppercase;letter-spacing:.5px">
        Landing Page Headline (optional)
      </label>
      <input id="headline"
        style="width:100%;padding:10px 14px;border:1px solid var(--bd);border-radius:8px;font-family:'Inter',sans-serif;font-size:13px;color:var(--t);outline:none;background:var(--bg)"
        placeholder="z.B. Ihre private Krankenversicherung – Ihr Experte für beste Absicherung">
      <div style="font-size:11px;color:var(--td);margin-top:6px;line-height:1.6">
        Erscheint als große Überschrift auf deiner Landing Page. Leer lassen = automatisch aus deinem Namen.
      </div>
    `;
    wrapper.parentElement.insertBefore(headlineGroup, wrapper.nextSibling);
  }

  // ── 2. Profil löschen Button im Link-Banner ──
  const bannerBtns = document.querySelector('.link-banner-btns');
  if(bannerBtns){
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Profil löschen';
    delBtn.style.cssText = 'padding:8px 16px;border-radius:7px;font-family:Inter,sans-serif;font-size:12px;font-weight:500;cursor:pointer;background:#ef4444;color:#fff;border:none';
    delBtn.onclick = deleteProfile;
    bannerBtns.appendChild(delBtn);
  }

  // ── 3. saveProfile patchen → headline mitsenden ──
  const _origSave = window.saveProfile;
  window.saveProfile = async function(){
    // Headline-Wert holen bevor original aufgerufen wird
    const headlineVal = (document.getElementById('headline')?.value || '').trim() || null;
    // original überschreiben um headline einzubauen
    const _origFetch = window.fetch;
    window.fetch = function(url, opts){
      if(url === '/api/tools' && opts?.body){
        try{
          const body = JSON.parse(opts.body);
          if(body.tool === 'makler-save'){
            body.headline = headlineVal;
            opts = {...opts, body: JSON.stringify(body)};
          }
        }catch(e){}
      }
      window.fetch = _origFetch; // restore immediately
      return _origFetch(url, opts);
    };
    return _origSave();
  };

  // ── 4. loadProfile patchen → headline laden ──
  const _origLoad = window.loadProfile || window.checkAccess;
  const _origCheckAccess = window.checkAccess;
  window.checkAccess = async function(){
    await _origCheckAccess();
    // Nach dem Laden: headline Feld befüllen
    setTimeout(async () => {
      try{
        const token = localStorage.getItem('virgo_token');
        if(!token) return;
        const r = await fetch('/api/tools?tool=makler-mine', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const d = await r.json();
        if(d?.headline){
          const inp = document.getElementById('headline');
          if(inp) inp.value = d.headline;
        }
      }catch(e){}
    }, 1000);
  };

  // ── 5. deleteProfile Funktion ──
  window.deleteProfile = async function(){
    if(!confirm('Profil wirklich löschen?\n\nDeine Landing Page wird deaktiviert. Diese Aktion kann nicht rückgängig gemacht werden.')) return;
    try{
      const token = localStorage.getItem('virgo_token');
      const r = await fetch('/api/tools', {
        method: 'POST',
        headers: {'Content-Type':'application/json','Authorization':'Bearer '+token},
        body: JSON.stringify({tool:'makler-delete'})
      });
      const d = await r.json();
      if(d.success || d.error?.includes('nicht gefunden')){
        alert('Profil gelöscht.');
        document.getElementById('link-banner').style.display = 'none';
      } else {
        alert('Fehler: ' + (d.error || 'Unbekannt'));
      }
    }catch(e){ alert('Fehler: ' + e.message); }
  };

})();
