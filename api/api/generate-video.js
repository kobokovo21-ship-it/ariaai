// ERSETZE function genVideo() in index.html mit diesem:
function genVideo(prompt){
  startGenStatus('Hailuo 2.3 generiert Video... (60-90 Sek.)');
  showTyping();
  fetch('/api/generate-video',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({prompt, duration:6, resolution:768, model:'v2.3'})
  })
  .then(r=>r.json())
  .then(data=>{
    hideTyping();endGenStatus();
    if(data.videoUrl){
      addVideoCard(prompt, data.videoUrl);
    } else {
      addAIMsg('Video konnte nicht generiert werden. Bitte nochmal versuchen.');
    }
  })
  .catch(()=>{hideTyping();endGenStatus();addAIMsg('Fehler bei der Video-Generierung.');});
}

// FÜGE DIESE NEUE FUNKTION HINZU (nach genVideo):
function addVideoCard(prompt, videoUrl){
  const fi=document.getElementById('feed-inner');
  const id='vc'+Date.now();
  const d=document.createElement('div');d.className='msg-wrap ai';
  d.innerHTML=`
  <div class="ai-av">V</div>
  <div>
    <div class="media-card" id="${id}">
      <div class="media-preview" style="aspect-ratio:16/9;background:#000">
        <video src="${videoUrl}" controls style="width:100%;height:100%;object-fit:cover" preload="metadata"></video>
      </div>
      <div class="media-meta">
        <div class="media-model">HAILUO 2.3 · VIDEO · 6S · 768P</div>
        <div class="media-prompt">${prompt.substring(0,80)}${prompt.length>80?'...':''}</div>
        <div class="media-actions">
          <a href="${videoUrl}" download class="mact primary">↓ Download</a>
          <button class="mact" onclick="showExport('${id}')">✂ Format</button>
          <button class="mact" onclick="upscaleMedia('${id}')">⬆ Upscale</button>
          <button class="mact" onclick="variantMedia('${prompt}')">↺ Variante</button>
          <button class="mact" onclick="lipsync('${id}')">👄 Lip Sync</button>
        </div>
        <div class="export-panel" id="exp-${id}">
          <div class="export-label">Zielformat wählen</div>
          <div class="format-btns">
            <button class="fmt-btn" onclick="exportFmt('TikTok')">📱 TikTok 9:16</button>
            <button class="fmt-btn" onclick="exportFmt('Reels')">📸 Reels</button>
            <button class="fmt-btn" onclick="exportFmt('Shorts')">▶ Shorts</button>
            <button class="fmt-btn" onclick="exportFmt('Feed')">🖼 Feed 1:1</button>
            <button class="fmt-btn" onclick="window.open('${videoUrl}','_blank')">💾 Original</button>
          </div>
        </div>
      </div>
    </div>
    <div class="msg-time">${now()}</div>
  </div>`;
  fi.appendChild(d);scrollFeed();
}
