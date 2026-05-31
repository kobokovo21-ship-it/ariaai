// ═══════════════════════════════════════════════════════
// VIRGO MAKLER KOMPLETT-SETUP — makler-setup.js
// Einbinden in index.html direkt vor </body>:
// <script src="/makler-setup.js"></script>
// ═══════════════════════════════════════════════════════

(function(){
  // ── 1. Starter Button in Landing nachrüsten ──
  const _origLanding = window.landingHTML;
  if(typeof _origLanding === 'function'){
    window.landingHTML = function(){
      let html = _origLanding();
      // Setup-Button vor "Google Ads erstellen" einfügen
      html = html.replace(
        'onclick="openMaklerAds()">Google Ads erstellen</button>',
        'onclick="startMaklerSetup()" style="background:var(--t);color:#fff;border-color:var(--t)">\uD83D\uDE80 Alles einrichten</button><button class="starter" onclick="openMaklerAds()">Google Ads erstellen</button>'
      );
      return html;
    };
  }

  // ── 2. genChat patchen: Setup erkennen + Makler Prompt updaten ──
  const _origGenChat = window.genChat;
  if(typeof _origGenChat === 'function'){
    window.genChat = function(txt){
      // Makler Workspace prüfen
      const _ws = localStorage.getItem('virgo_workspace') || 'makler';
      if(_ws !== 'makler'){ return _origGenChat(txt); }

      // Nur im normalen Chat-Modus (nicht Business-Tools)
      const isBusinessMode = (typeof state !== 'undefined') && state.model && state.model.startsWith('business-');
      if(isBusinessMode){ return _origGenChat(txt); }

      // Virgo Setup System-Prompt (erweitert)
      const MAKLER_SETUP_SYS = 'Du bist Virgo, ein KI-Assistent spezialisiert auf Versicherungsmakler. Du hilfst bei Lead-Generierung, Vertrieb, Marketing und Versicherungsthemen (PKV, BU, Altersvorsorge etc.). Antworte auf Deutsch, konkret und praxisnah.\n\nWICHTIG - SETUP ERKENNEN: Wenn der Makler eine Landing Page und/oder Google Ads einrichten moechte (z.B. "bau mir eine Landing Page", "richte alles ein", "ich will Google Ads schalten", "starte mein Setup", "Komplett-Setup"), dann starte den gefuehrten Setup-Prozess:\n\nSETUP-PROZESS (EIN Schritt pro Antwort, freundlich und kurz):\n1. Frage nach Name / Firmenname\n2. Frage nach URL-Slug — erklaere: "Deine fertige URL wird: virgoio.com/makler/DEIN-NAME. Nur Kleinbuchstaben und Bindestriche."\n3. Frage welche Versicherungen er anbietet (PKV, KFZ, Hausrat, BU, Altersvorsorge usw.)\n4. Frage nach Hauptangebot (z.B. "PKV fuer Selbstaendige")\n5. Frage nach Zielgruppe (optional)\n6. Frage nach USP / Besonderheit (optional)\n7. Fasse alles zusammen und frage: "Soll ich das jetzt einrichten?"\n\nWenn der Makler bestaetigt (Ja / OK / Mach das / Los), antworte NUR mit diesem JSON (nichts davor, nichts danach, kein Markdown):\n{"virgo_setup":true,"name":"...","slug":"name-in-kleinbuchstaben-mit-bindestrich","versicherungen":["PKV","KFZ"],"angebot":"...","zielgruppe":"...","usp":"..."}\n\nBei allen anderen Fragen: normal helfen.';

      // Eigene fetch-Logik für Makler Chat mit Setup-Erkennung
      const conversationHistory = window._convHistory || [];
      if(!window._convHistory){
        console.warn('makler-setup.js: conversationHistory nicht gefunden, nutze Original');
        return _origGenChat(txt);
      }

      showTyping();
      const isFreePlanActive = (typeof isFreePlan === 'function') && isFreePlan();
      const chatSys = isFreePlanActive ? undefined : MAKLER_SETUP_SYS;

      fetchWithRetry('/api/chat', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          messages: conversationHistory,
          systemOverride: chatSys
        })
      })
      .then(r => r.json())
      .then(d => {
        hideTyping();
        const reply = (d.content && d.content[0] && d.content[0].text) || 'Fehler beim Laden.';
        conversationHistory.push({role:'assistant', content:reply});
        if(conversationHistory.length > 30) conversationHistory.splice(0, conversationHistory.length - 30);

        // Setup JSON erkennen
        try{
          let sc = reply.replace(/```json|```/g,'').trim();
          const bi = sc.indexOf('{');
          if(bi >= 0) sc = sc.substring(bi);
          const parsed = JSON.parse(sc);
          if(parsed.virgo_setup === true){
            completeMaklerSetup(parsed);
            if(typeof saveChat === 'function'){
              saveChat(document.getElementById('chat-title').textContent, conversationHistory);
            }
            return;
          }
        }catch(e){}

        // Normale Antwort
        if(typeof addAIMsg === 'function') addAIMsg(renderMD ? renderMD(reply) : reply);
        if(typeof saveChat === 'function'){
          saveChat(document.getElementById('chat-title').textContent, conversationHistory);
        }
      })
      .catch(() => {
        hideTyping();
        if(typeof showFallbackMsg === 'function') showFallbackMsg();
      });
    };
  }
})();

// ── 3. startMaklerSetup ──
window.startMaklerSetup = function(){
  if(typeof state !== 'undefined'){
    state.produktMode = false;
    state.agentMode = false;
    state.model = 'chat';
    state.modelName = 'Virgo Chat';
    if(!state.chatStarted){
      state.chatStarted = true;
      const _l = document.getElementById('landing');
      if(_l) _l.style.display = 'none';
      document.getElementById('chat-title').textContent = 'Makler Setup';
    }
  }
  if(typeof addAIMsg === 'function'){
    addAIMsg('\uD83D\uDC4B <b>Makler Komplett-Setup</b><br><br>Ich richte in einem Gespräch alles für dich ein:<br>\u2705 Deine Landing Page live schalten<br>\u2705 Google Ads Texte generieren<br>\u2705 Meta Ads Texte generieren<br>\u2705 Dein Bild-Creative erstellen<br><br>Am Ende bekommst du deinen fertigen Link für Google & Meta Ads.<br><br><b>Wie heißt du oder deine Firma?</b>');
  }
  const inp = document.getElementById('prompt');
  if(inp){ inp.placeholder = 'Deine Antwort...'; inp.focus(); }
  if(typeof closeSb === 'function') closeSb();
};

// ── 4. completeMaklerSetup ──
window.completeMaklerSetup = async function(data){
  const esc = typeof escHtml === 'function' ? escHtml : (s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'));
  const fullUrl = 'https://virgoio.com/makler/' + (data.slug || '');

  if(typeof addAIMsg === 'function') addAIMsg('\u2699\uFE0F <b>Einen Moment...</b> Ich richte jetzt alles ein.');

  // Profil speichern
  try{
    await fetch('/api/tools',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+(window.authToken||localStorage.getItem('virgo_token')||'')},
      body:JSON.stringify({
        tool:'makler-save',
        name:data.name||'',
        slug:data.slug||'',
        telefon:'',
        email:(window.currentUser && window.currentUser.email)||'',
        versicherungen:data.versicherungen||[],
        beschreibung:data.angebot||'',
        farbe:'#111111',
        alert_email:(window.currentUser && window.currentUser.email)||'',
        land:'DE'
      })
    });
  }catch(e){}

  // Ads generieren
  let adData = null;
  try{
    const adPrompt = `Erstelle professionelle Google UND Meta Ads fuer einen Versicherungsmakler.\nMakler: ${data.name}\nAngebot: ${data.angebot}\nZielgruppe: ${data.zielgruppe||'Privatpersonen in Deutschland'}\nUSP: ${data.usp||'Kostenlose unverbindliche Beratung'}\nWerbeziel: Erstgespraech buchen, Rueckruf anfordern, Termin vereinbaren\nJSON:\n{"google":{"headlines":["max 30 Zeichen","max 30 Zeichen","max 30 Zeichen"],"descriptions":["max 90 Zeichen","max 90 Zeichen"],"cta":"Jetzt Termin"},"meta":{"primary_text":"max 125 Zeichen","headline":"max 40 Zeichen","description":"max 30 Zeichen","cta":"Mehr erfahren"}}`;
    const ar = await fetch('/api/business',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'ads',messages:[{role:'user',content:adPrompt}],systemOverride:'Du bist ein Google Ads Experte. Antworte NUR mit validem JSON.'})});
    const ad = await ar.json();
    adData = JSON.parse(((ad.content&&ad.content[0]&&ad.content[0].text)||'{}').replace(/```json|```/g,'').trim());
  }catch(e){}

  // Bild generieren
  let imgUrl = null;
  try{
    const ir = await fetch('/api/generate-image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'professional insurance broker advertisement, clean modern corporate design, trust, German business, white blue, photorealistic, 4K, no text, no logos',model:'nano',negative_prompt:'cartoon,deformed,text,watermark'})});
    const id = await ir.json();
    if(id.imageUrl) imgUrl = id.imageUrl;
  }catch(e){}

  // Ergebnis HTML
  let html = '<div style="font-size:14px;font-weight:600;margin-bottom:16px">\uD83C\uDF89 Fertig, '+esc(data.name)+'!</div>';

  // URL Box
  html += '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px;margin-bottom:16px">'
        + '<div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#166534;margin-bottom:8px;font-weight:600">Deine Ziel-URL für Google & Meta Ads</div>'
        + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
        + '<span style="font-size:13px;font-family:monospace;color:#166534;flex:1;word-break:break-all">'+esc(fullUrl)+'</span>'
        + '<button onclick="navigator.clipboard.writeText(\''+fullUrl+'\').then(()=>{this.textContent=\'Kopiert!\';setTimeout(()=>this.textContent=\'Kopieren\',2000)})" style="padding:7px 14px;background:#166534;color:#fff;border:none;border-radius:6px;font-family:Inter,sans-serif;font-size:11px;cursor:pointer;white-space:nowrap">Kopieren</button>'
        + '</div>'
        + '<div style="font-size:10px;color:#16a34a;margin-top:6px">Diese URL bei Google Ads und Meta Ads als Ziel-URL eintragen.</div>'
        + '</div>';

  // Google Ads
  if(adData && adData.google){
    const g = adData.google;
    html += '<div style="border:1px solid var(--bd);border-radius:10px;padding:14px;margin-bottom:12px">'
          + '<div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#2563eb;font-weight:600;margin-bottom:10px;padding:4px 8px;background:#dbeafe;border-radius:5px;display:inline-block">Google Ads</div>'
          + (g.headlines||[]).map(h => '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bd);font-size:12px"><span>'+esc(h)+'</span><span style="font-size:10px;color:'+(h.length<=30?'var(--green)':'var(--red)')+'">'+h.length+'/30</span></div>').join('')
          + (g.descriptions||[]).map(d => '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bd);font-size:12px"><span>'+esc(d)+'</span><span style="font-size:10px;color:'+(d.length<=90?'var(--green)':'var(--red)')+'">'+d.length+'/90</span></div>').join('')
          + '<div style="font-size:12px;font-weight:500;padding:5px 0;color:#2563eb">CTA: '+esc(g.cta||'')+'</div>'
          + '<button onclick="navigator.clipboard.writeText([\'=== GOOGLE ADS ===\',...'+JSON.stringify(g.headlines||[]).replace(/'/g,"\\'")+'.map((h,i)=>\'H\'+(i+1)+\': \'+h),\'\',...'+JSON.stringify(g.descriptions||[]).replace(/'/g,"\\'")+'.map((d,i)=>\'D\'+(i+1)+\': \'+d),\'CTA: '+esc(g.cta||'')+'\'].join(\'\\n\')).then(()=>{this.textContent=\'Kopiert!\';setTimeout(()=>this.textContent=\'Google Ads kopieren\',2000)})" style="margin-top:8px;padding:7px 14px;background:var(--t);color:#fff;border:none;border-radius:6px;font-family:Inter,sans-serif;font-size:11px;cursor:pointer;font-weight:500">Google Ads kopieren</button>'
          + '</div>';
  }

  // Meta Ads
  if(adData && adData.meta){
    const m = adData.meta;
    html += '<div style="border:1px solid var(--bd);border-radius:10px;padding:14px;margin-bottom:12px">'
          + '<div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#9333ea;font-weight:600;margin-bottom:10px;padding:4px 8px;background:#f3e8ff;border-radius:5px;display:inline-block">Meta Ads</div>'
          + '<div style="font-size:12px;padding:5px 0;border-bottom:1px solid var(--bd)">'+esc(m.primary_text||'')+'<span style="font-size:10px;color:'+(((m.primary_text||'').length)<=125?'var(--green)':'var(--red)')+'"> '+(m.primary_text||'').length+'/125</span></div>'
          + '<div style="font-size:12px;font-weight:500;padding:5px 0;border-bottom:1px solid var(--bd)">'+esc(m.headline||'')+'<span style="font-size:10px;color:'+(((m.headline||'').length)<=40?'var(--green)':'var(--red)')+'"> '+(m.headline||'').length+'/40</span></div>'
          + '<div style="font-size:12px;padding:5px 0;color:#9333ea">CTA: '+esc(m.cta||'')+'</div>'
          + '<button onclick="navigator.clipboard.writeText(\'=== META ADS ===\\nPrimary Text: '+esc(m.primary_text||'')+'\\nHeadline: '+esc(m.headline||'')+'\\nDescription: '+esc(m.description||'')+'\\nCTA: '+esc(m.cta||'')+'\').then(()=>{this.textContent=\'Kopiert!\';setTimeout(()=>this.textContent=\'Meta Ads kopieren\',2000)})" style="margin-top:8px;padding:7px 14px;background:var(--t);color:#fff;border:none;border-radius:6px;font-family:Inter,sans-serif;font-size:11px;cursor:pointer;font-weight:500">Meta Ads kopieren</button>'
          + '</div>';
  }

  // Bild
  if(imgUrl){
    html += '<div style="margin-bottom:12px"><img src="'+esc(imgUrl)+'" style="width:100%;border-radius:8px;border:1px solid var(--bd)">'
          + '<a href="'+esc(imgUrl)+'" download style="display:block;margin-top:8px;padding:9px;background:var(--t);color:#fff;border-radius:8px;text-align:center;font-size:12px;font-weight:500;text-decoration:none">Bild herunterladen</a></div>';
    if(typeof saveGeneration === 'function') saveGeneration('image', imgUrl, 'Makler Setup', 'Virgo');
  }

  // Nächste Schritte
  html += '<div style="font-size:11px;color:var(--tm);line-height:1.8;margin-top:8px;padding:12px;background:var(--sf);border-radius:8px">'
        + '<b>Nächste Schritte:</b><br>'
        + '1. URL kopieren → in Google Ads & Meta Ads als Ziel-URL eintragen<br>'
        + '2. Ad-Texte kopieren → in Google/Meta Ads einfügen<br>'
        + '3. Budget festlegen und live schalten \uD83D\uDE80'
        + '</div>';

  // Loading-Nachricht ersetzen
  const msgs = document.getElementById('fi').querySelectorAll('.mw.ai');
  if(msgs.length) msgs[msgs.length-1].remove();

  if(typeof addAIMsg === 'function') addAIMsg(html);
  document.getElementById('chat-title').textContent = 'Makler Setup \u2014 ' + data.name;
  if(typeof saveChat === 'function'){
    saveChat('Makler Setup \u2014 ' + data.name, window._convHistory || []);
  }
};
