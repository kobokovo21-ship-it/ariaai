// ═══════════════════════════════════════════════════════
// VIRGO BUSINESS EXTRAS — business-extras.js
// Einbinden in index.html direkt vor </body>:
// <script src="/business-extras.js"></script>
// ═══════════════════════════════════════════════════════

(function(){

  // ── PDF Upload für Business Plan ──
  let refPDF = null; // { b64, name, mime }

  // Upload-Button patchen: PDF-Support wenn Business Plan aktiv
  const _origUploadRef = window.uploadRef;
  window.uploadRef = function(){
    const model = (typeof state !== 'undefined') ? state.model : '';
    const isPlanMode = model === 'business-plan' || model === 'business-pitch' || model === 'business-angebot';

    if(isPlanMode){
      // PDF oder Bild erlauben
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'application/pdf,image/*';
      inp.onchange = async function(e){
        const file = e.target.files[0];
        if(!file) return;

        if(file.type === 'application/pdf'){
          // PDF lesen
          const reader = new FileReader();
          reader.onload = function(ev){
            const b64 = ev.target.result.split(',')[1];
            refPDF = { b64, name: file.name, mime: 'application/pdf' };
            showPDFBadge(file.name);
          };
          reader.readAsDataURL(file);
        } else {
          // Bild — original Verhalten
          if(typeof compressImg === 'function'){
            const compressed = await compressImg(file);
            if(!window.refImages) window.refImages = [];
            window.refImages.push(compressed);
            if(typeof renderRefZone === 'function') renderRefZone();
          }
        }
      };
      inp.click();
    } else {
      // Original Verhalten
      if(typeof _origUploadRef === 'function') _origUploadRef();
    }
  };

  // PDF-Badge anzeigen
  function showPDFBadge(name){
    const zone = document.getElementById('rz');
    const container = document.getElementById('ref-imgs');
    if(!zone || !container) return;

    // PDF Badge hinzufügen
    let pdfBadge = document.getElementById('pdf-badge');
    if(!pdfBadge){
      pdfBadge = document.createElement('div');
      pdfBadge.id = 'pdf-badge';
      pdfBadge.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;background:#dbeafe;border:1px solid #93c5fd;border-radius:8px;font-size:12px;color:#1d4ed8';
      container.appendChild(pdfBadge);
    }
    pdfBadge.innerHTML = '📄 '+escOrDefault(name)+' <button onclick="clearPDF()" style="background:transparent;border:none;cursor:pointer;color:#1d4ed8;font-size:16px;margin-left:4px">×</button>';

    zone.classList.add('vis');
    const imgBtn = document.getElementById('img-btn');
    if(imgBtn){ imgBtn.classList.add('has'); imgBtn.textContent = '📎 PDF'; }
  }

  function escOrDefault(s){
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  window.clearPDF = function(){
    refPDF = null;
    const badge = document.getElementById('pdf-badge');
    if(badge) badge.remove();
    const imgBtn = document.getElementById('img-btn');
    if(imgBtn && !window.refImages?.length){ imgBtn.classList.remove('has'); imgBtn.textContent = '📎'; }
    const zone = document.getElementById('rz');
    if(zone && !window.refImages?.length) zone.classList.remove('vis');
  };

  // send() patchen: PDF in Message einbauen
  const _origSend = window.send;
  window.send = async function(){
    if(!refPDF){ return _origSend(); }

    // PDF-Modus: direkt mit Dokument senden
    const inp = document.getElementById('prompt');
    const txt = inp.value.trim();
    if(!txt || (typeof state !== 'undefined' && state.generating)) return;

    const chatTitle = document.getElementById('chat-title').textContent;
    if(typeof state !== 'undefined' && !state.chatStarted){
      state.chatStarted = true;
      const _l = document.getElementById('landing');
      if(_l) _l.style.display = 'none';
      document.getElementById('chat-title').textContent = txt.substring(0,40);
    }

    // Message mit PDF-Dokument bauen
    const userMessage = {
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: refPDF.mime, data: refPDF.b64 }
        },
        { type: 'text', text: txt }
      ]
    };

    if(typeof conversationHistory !== 'undefined') conversationHistory.push(userMessage);
    if(typeof addUserMsg === 'function') addUserMsg('📄 '+refPDF.name+'\n\n'+txt);
    inp.value = ''; inp.style.height = '24px';

    const pdfName = refPDF.name;
    clearPDF();

    // API Call mit Dokument
    if(typeof showTyping === 'function') showTyping();

    const model = (typeof state !== 'undefined') ? state.model : 'business-plan';
    const bSysMap = {
      'business-plan': 'Du bist ein Business-Experte. Analysiere das Dokument und hilf beim Businessplan. Antworte auf Deutsch.',
      'business-pitch': 'Du bist ein Pitch-Experte. Analysiere das Dokument und erstelle ein Pitch Deck. Antworte auf Deutsch.',
      'business-angebot': 'Du bist ein Experte für Angebote. Analysiere das Dokument und erstelle ein professionelles Angebot. Antworte auf Deutsch.'
    };

    try{
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: typeof conversationHistory !== 'undefined' ? conversationHistory : [userMessage],
          systemOverride: bSysMap[model] || 'Du bist Virgo, ein KI-Assistent. Analysiere das Dokument und helfe dem Nutzer. Antworte auf Deutsch.'
        })
      });
      const d = await r.json();
      if(typeof hideTyping === 'function') hideTyping();
      const reply = (d.content && d.content[0] && d.content[0].text) || 'Fehler beim Laden.';
      if(typeof conversationHistory !== 'undefined') conversationHistory.push({role:'assistant', content:reply});
      if(typeof addAIMsg === 'function' && typeof renderMD === 'function'){
        const extra = '<div style="margin-top:12px"><button onclick="exportPDF && exportPDF(\''+reply.replace(/'/g,"\\'")+'\')" style="padding:6px 14px;border:1px solid var(--bd);border-radius:6px;background:var(--t);color:#fff;font-family:Inter,sans-serif;font-size:11px;cursor:pointer">Als PDF speichern</button></div>';
        addAIMsg(renderMD(reply)+extra);
      }
      if(typeof saveChat === 'function'){
        saveChat(document.getElementById('chat-title').textContent, conversationHistory||[]);
      }
    } catch(e){
      if(typeof hideTyping === 'function') hideTyping();
      if(typeof showFallbackMsg === 'function') showFallbackMsg();
    }
  };

  // Upload-Button Tooltip updaten je nach Modus
  document.addEventListener('click', function(){
    const model = (typeof state !== 'undefined') ? state.model : '';
    const isPlanMode = model === 'business-plan' || model === 'business-pitch' || model === 'business-angebot';
    const imgBtn = document.getElementById('img-btn');
    if(imgBtn && !refPDF && !(window.refImages && window.refImages.length)){
      imgBtn.title = isPlanMode ? 'PDF oder Bild hochladen' : 'Bild hochladen';
    }
  }, true);

})();
