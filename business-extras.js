// ═══════════════════════════════════════════════════════
// VIRGO BUSINESS EXTRAS — business-extras.js
// ═══════════════════════════════════════════════════════
(function(){
  let refPDF = null;

  function isPlanMode(){
    if(typeof state === 'undefined') return false;
    return ['business-plan','business-pitch','business-angebot'].includes(state.model);
  }

  function openFilePicker(){
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/pdf,image/jpeg,image/png,image/webp';
    inp.onchange = function(ev){
      const file = ev.target.files[0];
      if(!file) return;
      if(file.type === 'application/pdf'){
        if(file.size > 10*1024*1024){ alert('PDF max. 10MB'); return; }
        const reader = new FileReader();
        reader.onload = function(e){
          refPDF = { b64: e.target.result.split(',')[1], name: file.name, mime: 'application/pdf' };
          showPDFBadge(file.name);
        };
        reader.readAsDataURL(file);
      } else {
        // Bild wie gehabt
        if(typeof compressImg === 'function'){
          if(window.refImages && window.refImages.length >= 4){ alert('Max. 4 Bilder'); return; }
          compressImg(file).then(c => {
            if(window.refImages) window.refImages.push(c);
            if(typeof renderRefZone === 'function') renderRefZone();
          });
        }
      }
    };
    inp.click();
  }

  function showPDFBadge(name){
    let zone = document.getElementById('rz');
    let container = document.getElementById('ref-imgs');
    if(!zone || !container) return;
    let badge = document.getElementById('pdf-badge');
    if(!badge){
      badge = document.createElement('div');
      badge.id = 'pdf-badge';
      badge.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 10px;background:#dbeafe;border:1px solid #93c5fd;border-radius:8px;font-size:12px;color:#1d4ed8';
      container.appendChild(badge);
    }
    badge.innerHTML = '📄 ' + name.substring(0,30) + ' <button onclick="window._clearPDF()" style="background:none;border:none;cursor:pointer;font-size:14px;color:#1d4ed8;padding:0 2px">×</button>';
    zone.classList.add('vis');
    const btn = document.getElementById('img-btn');
    if(btn){ btn.classList.add('has'); btn.textContent = '📎PDF'; }
  }

  window._clearPDF = function(){
    refPDF = null;
    const badge = document.getElementById('pdf-badge');
    if(badge) badge.remove();
    const btn = document.getElementById('img-btn');
    const hasImgs = window.refImages && window.refImages.length > 0;
    if(btn && !hasImgs){ btn.classList.remove('has'); btn.textContent = '📎'; }
    const zone = document.getElementById('rz');
    if(zone && !hasImgs) zone.classList.remove('vis');
  };

  // Button übernehmen — zuverlässig mit addEventListener
  function patchBtn(){
    const btn = document.getElementById('img-btn');
    if(!btn){ setTimeout(patchBtn, 300); return; }

    // Alten onclick entfernen und neuen setzen
    btn.removeAttribute('onclick');
    btn.addEventListener('click', function(e){
      e.preventDefault();
      e.stopPropagation();
      if(isPlanMode()){
        openFilePicker();
      } else {
        if(typeof uploadRef === 'function') uploadRef();
      }
    }, true);
    console.log('✅ Virgo: PDF Upload aktiv');
  }

  // send() patchen für PDF
  const _origSend = window.send;
  window.send = async function(){
    if(!refPDF) return _origSend ? _origSend() : undefined;

    const inp = document.getElementById('prompt');
    const txt = inp ? inp.value.trim() : '';
    if(!txt) return;
    if(typeof state !== 'undefined' && state.generating) return;

    if(typeof state !== 'undefined' && !state.chatStarted){
      state.chatStarted = true;
      const l = document.getElementById('landing');
      if(l) l.style.display = 'none';
      document.getElementById('chat-title').textContent = txt.substring(0,40);
    }

    const pdfSnap = refPDF;
    if(inp){ inp.value = ''; inp.style.height = '24px'; }
    window._clearPDF();

    if(typeof addUserMsg === 'function') addUserMsg('📄 ' + pdfSnap.name + '\n\n' + txt);

    const userMsg = {
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: pdfSnap.mime, data: pdfSnap.b64 } },
        { type: 'text', text: txt }
      ]
    };
    if(typeof conversationHistory !== 'undefined') conversationHistory.push(userMsg);

    const sysMap = {
      'business-plan': 'Du bist ein Business-Experte. Analysiere das Dokument und hilf beim Businessplan auf Deutsch.',
      'business-pitch': 'Du bist ein Pitch-Experte. Analysiere das Dokument auf Deutsch.',
      'business-angebot': 'Du bist ein Angebots-Experte. Analysiere das Dokument auf Deutsch.'
    };
    const model = typeof state !== 'undefined' ? state.model : 'business-plan';

    if(typeof showTyping === 'function') showTyping();
    try{
      const r = await fetch('/api/chat',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          messages: typeof conversationHistory !== 'undefined' ? conversationHistory : [userMsg],
          systemOverride: sysMap[model] || 'Analysiere das Dokument und hilf dem Nutzer auf Deutsch.'
        })
      });
      const d = await r.json();
      if(typeof hideTyping === 'function') hideTyping();
      const reply = (d.content&&d.content[0]&&d.content[0].text)||'Fehler.';
      if(typeof conversationHistory !== 'undefined') conversationHistory.push({role:'assistant',content:reply});
      if(typeof addAIMsg === 'function' && typeof renderMD === 'function') addAIMsg(renderMD(reply));
      if(typeof saveChat === 'function') saveChat(document.getElementById('chat-title').textContent, conversationHistory);
    }catch(e){
      if(typeof hideTyping === 'function') hideTyping();
      if(typeof showFallbackMsg === 'function') showFallbackMsg();
    }
  };

  // Start
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', patchBtn);
  } else {
    patchBtn();
  }
})();
