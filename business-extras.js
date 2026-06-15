// ═══════════════════════════════════════════════════════
// VIRGO BUSINESS EXTRAS — business-extras.js  (v3 bulletproof)
// PDF-Upload im Business Chat — fängt Button, Enter UND Senden ab
// ═══════════════════════════════════════════════════════
(function(){
  let refPDF = null;

  // PDF-Upload immer erlauben wenn im Business-Workspace
  function pdfAllowed(){
    const ws = localStorage.getItem('virgo_workspace') || 'makler';
    if(ws === 'business') return true;
    if(typeof state !== 'undefined' && state.model &&
       ['business-plan','business-pitch','business-angebot'].includes(state.model)) return true;
    return false;
  }

  function openFilePicker(){
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/pdf,image/jpeg,image/png,image/webp';
    inp.style.position = 'fixed';
    inp.style.left = '-9999px';
    inp.onchange = function(ev){
      const file = ev.target.files[0];
      if(inp.parentNode) inp.parentNode.removeChild(inp);
      if(!file) return;
      if(file.type === 'application/pdf'){
        if(file.size > 15*1024*1024){ alert('PDF max. 15MB'); return; }
        const reader = new FileReader();
        reader.onload = function(e){
          refPDF = { b64: e.target.result.split(',')[1], name: file.name, mime: 'application/pdf' };
          showPDFBadge(file.name);
        };
        reader.readAsDataURL(file);
      } else {
        if(typeof compressImg === 'function'){
          if(typeof refImages !== 'undefined' && refImages.length >= 4){ alert('Max. 4 Bilder'); return; }
          compressImg(file).then(c => {
            if(typeof refImages !== 'undefined') refImages.push(c);
            if(typeof renderRefZone === 'function') renderRefZone();
          });
        }
      }
    };
    document.body.appendChild(inp);
    inp.click();
  }

  function showPDFBadge(name){
    const zone = document.getElementById('rz');
    const container = document.getElementById('ref-imgs');
    if(!zone || !container) return;
    let badge = document.getElementById('pdf-badge');
    if(!badge){
      badge = document.createElement('div');
      badge.id = 'pdf-badge';
      badge.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 10px;background:#dbeafe;border:1px solid #93c5fd;border-radius:8px;font-size:12px;color:#1d4ed8';
      container.appendChild(badge);
    }
    badge.innerHTML = '📄 ' + name.substring(0,28) + ' <span onclick="window._clearPDF()" style="cursor:pointer;font-size:15px;padding:0 2px">×</span>';
    zone.classList.add('vis');
    // "Referenzbilder (max. 4)" + "Weiteres" Text ausblenden solange PDF da ist
    const rp = zone.querySelector('.rp');
    if(rp){
      Array.from(rp.children).forEach(child => {
        if(child.id !== 'ref-imgs' && !child.classList.contains('rr')){
          child.dataset._hidden = '1';
          child.style.display = 'none';
        }
      });
    }
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
    if(zone){
      // ausgeblendete Texte wieder einblenden
      const rp = zone.querySelector('.rp');
      if(rp) Array.from(rp.children).forEach(child => {
        if(child.dataset._hidden){ child.style.display = ''; delete child.dataset._hidden; }
      });
      if(!hasImgs) zone.classList.remove('vis');
    }
  };

  // ── PDF an die KI schicken ──
  async function sendWithPDF(){
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

    const model = typeof state !== 'undefined' ? state.model : 'chat';
    const sysMap = {
      'business-plan': 'Du bist ein Business-Experte. Analysiere das hochgeladene Dokument gründlich und hilf beim Businessplan auf Deutsch.',
      'business-pitch': 'Du bist ein Pitch-Experte. Analysiere das hochgeladene Dokument auf Deutsch.',
      'business-angebot': 'Du bist ein Angebots-Experte. Analysiere das hochgeladene Dokument auf Deutsch.'
    };

    if(typeof showTyping === 'function') showTyping();
    try{
      const r = await fetch('/api/chat',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          messages: typeof conversationHistory !== 'undefined' ? conversationHistory : [userMsg],
          systemOverride: sysMap[model] || 'Analysiere das hochgeladene Dokument gründlich und hilf dem Nutzer auf Deutsch.'
        })
      });
      const d = await r.json();
      if(typeof hideTyping === 'function') hideTyping();
      const reply = (d.content&&d.content[0]&&d.content[0].text)||'Konnte das Dokument nicht analysieren. Bitte nochmal versuchen.';
      if(typeof conversationHistory !== 'undefined') conversationHistory.push({role:'assistant',content:reply});
      if(typeof addAIMsg === 'function' && typeof renderMD === 'function') addAIMsg(renderMD(reply));
      if(typeof saveChat === 'function') saveChat(document.getElementById('chat-title').textContent, conversationHistory);
    }catch(e){
      if(typeof hideTyping === 'function') hideTyping();
      if(typeof addAIMsg === 'function') addAIMsg('Fehler beim Analysieren des Dokuments. Bitte nochmal versuchen.');
    }
  }

  // ── Alle Eingabewege abfangen ──
  function patchAll(){
    const imgBtn = document.getElementById('img-btn');
    const sendBtn = document.getElementById('send-btn');
    const prompt = document.getElementById('prompt');

    if(!imgBtn || !sendBtn || !prompt){ setTimeout(patchAll, 300); return; }

    // 1. 📎 Button
    imgBtn.removeAttribute('onclick');
    imgBtn.addEventListener('click', function(e){
      e.preventDefault(); e.stopPropagation();
      if(pdfAllowed()) openFilePicker();
      else if(typeof uploadRef === 'function') uploadRef();
    }, true);

    // 2. Senden-Button (capture phase, fängt VOR original send)
    sendBtn.addEventListener('click', function(e){
      if(refPDF){
        e.preventDefault(); e.stopPropagation();
        sendWithPDF();
      }
    }, true);

    // 3. Enter-Taste (capture phase)
    prompt.addEventListener('keydown', function(e){
      if(e.key === 'Enter' && !e.shiftKey && refPDF){
        e.preventDefault(); e.stopPropagation();
        sendWithPDF();
      }
    }, true);

    console.log('✅ Virgo PDF-Upload aktiv (v3)');
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', patchAll);
  } else {
    patchAll();
  }
})();
