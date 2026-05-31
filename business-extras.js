// ═══════════════════════════════════════════════════════
// VIRGO BUSINESS EXTRAS — business-extras.js
// Einbinden in index.html direkt vor </body>:
// <script src="/business-extras.js"></script>
// ═══════════════════════════════════════════════════════

(function(){

  // ── PDF Upload: img-btn direkt patchen ──
  let refPDF = null;

  // Warte bis DOM bereit, dann Button-Handler überschreiben
  function patchUploadBtn(){
    const imgBtn = document.getElementById('img-btn');
    if(!imgBtn) return;

    // Original onclick merken
    const _origOnclick = imgBtn.onclick;

    imgBtn.onclick = function(e){
      const model = (typeof state !== 'undefined') ? state.model : '';
      const isPlanMode = model === 'business-plan' || model === 'business-pitch' || model === 'business-angebot';

      if(isPlanMode){
        e.preventDefault();
        e.stopPropagation();
        // PDF oder Bild-Picker öffnen
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'application/pdf,image/*';
        inp.onchange = function(ev){
          const file = ev.target.files[0];
          if(!file) return;

          if(file.type === 'application/pdf'){
            if(file.size > 10 * 1024 * 1024){ alert('PDF max. 10MB'); return; }
            const reader = new FileReader();
            reader.onload = function(e2){
              const b64 = e2.target.result.split(',')[1];
              refPDF = { b64, name: file.name, mime: 'application/pdf' };
              showPDFBadge(file.name);
            };
            reader.readAsDataURL(file);
          } else {
            // Bild — original Verhalten aufrufen
            if(typeof compressImg === 'function' && typeof refImages !== 'undefined'){
              if(refImages.length >= 4){ alert('Max. 4 Bilder'); return; }
              compressImg(file).then(c => {
                refImages.push(c);
                if(typeof renderRefZone === 'function') renderRefZone();
              });
            }
          }
        };
        inp.click();
      } else {
        // Original Verhalten
        if(typeof uploadRef === 'function') uploadRef();
      }
    };
  }

  function showPDFBadge(name){
    const zone = document.getElementById('rz');
    const container = document.getElementById('ref-imgs');
    if(!zone || !container) return;

    let badge = document.getElementById('pdf-badge');
    if(!badge){
      badge = document.createElement('div');
      badge.id = 'pdf-badge';
      badge.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;background:#dbeafe;border:1px solid #93c5fd;border-radius:8px;font-size:12px;color:#1d4ed8;flex-shrink:0';
      container.appendChild(badge);
    }
    badge.innerHTML = '📄 ' + name.replace(/</g,'&lt;') + ' <button onclick="window.clearPDF()" style="background:transparent;border:none;cursor:pointer;color:#1d4ed8;font-size:16px;line-height:1">×</button>';

    zone.classList.add('vis');
    const imgBtn = document.getElementById('img-btn');
    if(imgBtn){ imgBtn.classList.add('has'); imgBtn.textContent = '📎 PDF'; }
  }

  window.clearPDF = function(){
    refPDF = null;
    const badge = document.getElementById('pdf-badge');
    if(badge) badge.remove();
    const imgBtn = document.getElementById('img-btn');
    const hasImgs = typeof refImages !== 'undefined' && refImages.length > 0;
    if(imgBtn && !hasImgs){ imgBtn.classList.remove('has'); imgBtn.textContent = '📎'; }
    const zone = document.getElementById('rz');
    if(zone && !hasImgs) zone.classList.remove('vis');
  };

  // ── send() patchen: PDF mitschicken ──
  const _origSend = window.send;
  window.send = async function(){
    if(!refPDF) return _origSend ? _origSend() : undefined;

    const inp = document.getElementById('prompt');
    const txt = (inp ? inp.value : '').trim();
    if(!txt) return;
    if(typeof state !== 'undefined' && state.generating) return;

    // Chat starten
    if(typeof state !== 'undefined' && !state.chatStarted){
      state.chatStarted = true;
      const _l = document.getElementById('landing');
      if(_l) _l.style.display = 'none';
      document.getElementById('chat-title').textContent = txt.substring(0,40);
    }

    const pdfData = refPDF;
    if(inp) inp.value = '';
    if(inp) inp.style.height = '24px';
    window.clearPDF();

    // User-Nachricht anzeigen
    if(typeof addUserMsg === 'function') addUserMsg('📄 ' + pdfData.name + '\n\n' + txt);

    // In History
    const userMsg = {
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: pdfData.mime, data: pdfData.b64 } },
        { type: 'text', text: txt }
      ]
    };
    if(typeof conversationHistory !== 'undefined') conversationHistory.push(userMsg);

    // System prompt je nach Modus
    const model = (typeof state !== 'undefined') ? state.model : 'business-plan';
    const sysMap = {
      'business-plan': 'Du bist ein Business-Experte. Analysiere das Dokument und hilf beim Businessplan auf Deutsch.',
      'business-pitch': 'Du bist ein Pitch-Experte. Analysiere das Dokument und erstelle ein Pitch Deck auf Deutsch.',
      'business-angebot': 'Du bist ein Experte für Angebote. Analysiere das Dokument auf Deutsch.'
    };

    if(typeof showTyping === 'function') showTyping();

    try{
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: typeof conversationHistory !== 'undefined' ? conversationHistory : [userMsg],
          systemOverride: sysMap[model] || 'Analysiere das Dokument und hilf dem Nutzer auf Deutsch.'
        })
      });
      const d = await r.json();
      if(typeof hideTyping === 'function') hideTyping();
      const reply = (d.content && d.content[0] && d.content[0].text) || 'Fehler beim Laden.';
      if(typeof conversationHistory !== 'undefined') conversationHistory.push({role:'assistant', content:reply});
      if(typeof addAIMsg === 'function' && typeof renderMD === 'function'){
        addAIMsg(renderMD(reply) + '<div style="margin-top:12px"><button onclick="exportPDF && exportPDF(\'\')" style="display:none"></button></div>');
      }
      if(typeof saveChat === 'function'){
        saveChat(document.getElementById('chat-title').textContent, conversationHistory);
      }
    }catch(e){
      if(typeof hideTyping === 'function') hideTyping();
      if(typeof showFallbackMsg === 'function') showFallbackMsg();
    }
  };

  // Patch nach kurzem Delay damit DOM geladen ist
  setTimeout(patchUploadBtn, 500);

})();
