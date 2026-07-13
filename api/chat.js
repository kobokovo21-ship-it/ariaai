export const config = { maxDuration: 60 };

const ALLOWED_ORIGINS = ['https://virgoio.com', 'https://www.virgoio.com'];

// === MODELL-STEUERUNG ===
// Beide über Vercel-Env-Variablen änderbar, ohne Code anzufassen.
// ANTHROPIC_MODEL_PAID  = Modell für angemeldete User (Standard: Fable 5)
// ANTHROPIC_MODEL_FREE  = Modell für unangemeldete User (Standard: Opus 4.8)
const MODEL_PAID = process.env.ANTHROPIC_MODEL_PAID || 'claude-fable-5';
const MODEL_FREE = process.env.ANTHROPIC_MODEL_FREE || 'claude-opus-4-8';
// Wenn Fable eine Anfrage ablehnt (stop_reason "refusal"), wird automatisch
// derselbe Request einmal mit diesem Modell wiederholt:
const MODEL_REFUSAL_FALLBACK = 'claude-opus-4-8';

function guard(req, res) {
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') { res.status(200).end(); return false; }
  if (req.method !== 'POST') { res.status(405).end(); return false; }
  const ok = ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.some(o => referer.startsWith(o));
  if (!ok) {
    console.warn('⛔ Blocked chat. origin=' + origin + ' referer=' + referer);
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

// Prüft über Supabase, ob ein gültiger, eingeloggter User dahintersteckt.
// Erwartet den Supabase Access Token im Authorization-Header (Bearer ...).
// Gibt bei jedem Problem einfach null zurück → User wird als "Free" behandelt.
async function getLoggedInUser(req) {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!token || !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return null;
    const r = await fetch(process.env.SUPABASE_URL + '/auth/v1/user', {
      headers: {
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + token
      }
    });
    if (!r.ok) return null;
    const user = await r.json();
    return (user && user.id) ? user : null;
  } catch (e) {
    console.warn('Supabase Auth-Check fehlgeschlagen:', e.message);
    return null;
  }
}

function isImageRequest(text) {
  const t = (text || '').toLowerCase();
  const hasVerb = /erstell|mach|generier|erzeug|kreier|zeichn|design|create|generate|make|draw/.test(t);
  const hasNoun = /\bbild\b|foto|grafik|illustration|\bimage\b|visual|motiv|hero.?bild|headerbild|werbebild|produktbild/.test(t);
  const directPatterns = /ein bild von|ein foto von|bild für|foto für|bild zu|foto zu|bild für meine|bild von/.test(t);
  return (hasVerb && hasNoun) || directPatterns;
}

// Ein einzelner Anthropic-Call. Wirft bei Überlastung/Fehlern, damit die
// bestehende Fallback-Kette (Gemini → OpenAI) greift.
async function callAnthropic(model, maxTokens, systemPrompt, messages) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system: systemPrompt, messages })
  });
  if (r.status === 529 || r.status === 500 || r.status === 503 || r.status === 502 || r.status === 429) {
    throw new Error('Anthropic overloaded: ' + r.status);
  }
  const data = await r.json();
  if (data.type === 'error' || !data.content) {
    throw new Error('Anthropic error: ' + (data.error?.message || 'no content'));
  }
  return data;
}

export default async function handler(req, res) {
  if (!guard(req, res)) return;

  try {
    const { messages = [], codeMode = false, systemOverride = null } = req.body;
    const lastContent = messages[messages.length - 1]?.content || '';
    const lastText = Array.isArray(lastContent)
      ? (lastContent.find(b => b.type === 'text')?.text || '')
      : lastContent;
    const isPromptMode = lastText.toLowerCase().startsWith('prompt ') || lastText.toLowerCase().startsWith('prompt:');

    const blockedKeywords = [
      'anthropic api', 'openai api', 'gemini api', 'claude api',
      'ki app bauen', 'ki app erstellen', 'ai app bauen', 'ai app erstellen',
      'wie baust du', 'virgo nachbauen', 'virgo kopieren',
      'eigene ki app', 'eigene ai app',
      'piapi integration', 'elevenlabs api bauen',
      'build ai app', 'create ai app', 'make ai app'
    ];
    const lowerText = lastText.toLowerCase();
    const isBlocked = !systemOverride && blockedKeywords.some(kw => lowerText.includes(kw));
    if (isBlocked) {
      return res.status(200).json({
        content: [{ type: 'text', text: 'Das liegt außerhalb meiner Möglichkeiten. Ich helfe dir gerne bei Leads, Marketing, Ads, Texten und Bildern. Womit kann ich dir helfen?' }]
      });
    }

    // === AUTOMATISCHE BILDGENERIERUNG IM CHAT ===
    if (!codeMode && !isPromptMode && !systemOverride && isImageRequest(lastText)) {
      try {
        const host = req.headers.host;
        const proto = host && host.includes('localhost') ? 'http' : 'https';
        const imgRes = await fetch(`${proto}://${host}/api/generate-image`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // WICHTIG: interner Aufruf muss sich als eigene Domain ausweisen
            'origin': 'https://virgoio.com'
          },
          body: JSON.stringify({ prompt: lastText })
        });
        const imgData = await imgRes.json();
        if (imgRes.ok && imgData.imageUrl) {
          return res.status(200).json({
            content: [{ type: 'text', text: 'Hier ist dein Bild. Sag mir, wenn du eine andere Variante möchtest.' }],
            imageUrl: imgData.imageUrl,
            generatedImage: true
          });
        }
        return res.status(200).json({
          content: [{ type: 'text', text: 'Die Bildgenerierung hat gerade nicht geklappt. Versuch es bitte nochmal.' }]
        });
      } catch (imgErr) {
        return res.status(200).json({
          content: [{ type: 'text', text: 'Die Bildgenerierung hat gerade nicht geklappt. Versuch es bitte nochmal.' }]
        });
      }
    }

    const systemPrompt = systemOverride || (isPromptMode
      ? `Du bist ein professioneller KI-Prompt-Generator für Bildgenerierung. Wandle Stichwörter in perfekte englische Bild-Prompts um. Gib NUR den fertigen Prompt zurück, ohne Erklärung.`
      : codeMode
      ? `Du bist Code AI — der beste KI-Entwickler der Welt, integriert in Virgo AI. Du schreibst professionellen Code in JEDER Sprache. Formatiere Code IMMER in Markdown Code-Blöcken. Erkläre kurz auf Deutsch. VERBOTEN: Kein Code für KI-Apps, keine API-Integrationen die Virgo nachahmen.`
      : `Du bist Virgo AI - die KI-Plattform für Versicherungsmakler auf virgoio.com.

SCHREIBWEISE: Normaler fließender Text. Kein Markdown, kein Fettdruck mit Sternchen, keine Links in Klammern, keine Bindestriche als Aufzählung.

BILDER: Du kannst Bilder direkt generieren. Wenn jemand ein Bild will, generiere es sofort — sag nicht dass du keine Bilder erstellen kannst. Das System macht es automatisch.

FACHWISSEN: Versicherungsbranche, PKV, GKV, BU, Altersvorsorge, Lead-Generierung, Google Ads, Meta Ads, Landing Pages, Vertriebspsychologie, Compliance IDD/DSGVO.

TOOLS: Makler Landing Page, Ads schalten, Leads Dashboard, Social Posts, Emails, Business Plan, Website, Pitch Deck, Rechnung, Bilder — alles direkt im Chat.

REGELN: Antworte auf Deutsch. Kurz, direkt, konkret. Maximal 1 Emoji. Du heißt Virgo.

VERBOTE: Erwähne niemals Claude, ARIA, Gemini, ChatGPT, OpenAI, Anthropic. Keine Rechtsberatung, keine konkreten Tarifempfehlungen.`);

    // Fable 5 denkt intern mit — diese Denk-Tokens zählen ins max_tokens-Budget.
    // Deshalb höhere Limits als vorher, sonst werden Antworten abgeschnitten.
    const maxTokens = codeMode ? 8192 : 2048;

    // === MODELLWAHL: angemeldet = PAID-Modell, unangemeldet = FREE-Modell ===
    const user = await getLoggedInUser(req);
    const chosenModel = user ? MODEL_PAID : MODEL_FREE;

    try {
      let data = await callAnthropic(chosenModel, maxTokens, systemPrompt, messages);
      let usedModel = chosenModel;

      // === REFUSAL-FALLBACK ===
      // Fable 5 kann Anfragen ablehnen (HTTP 200 mit stop_reason "refusal").
      // Dann denselben Request einmal mit Opus wiederholen — der User merkt nichts.
      if (data.stop_reason === 'refusal' && chosenModel !== MODEL_REFUSAL_FALLBACK) {
        console.warn('Refusal von ' + chosenModel + ' → Retry mit ' + MODEL_REFUSAL_FALLBACK);
        data = await callAnthropic(MODEL_REFUSAL_FALLBACK, maxTokens, systemPrompt, messages);
        usedModel = MODEL_REFUSAL_FALLBACK;
      }

      // Falls auch das abgelehnt wird (sehr selten): freundliche Antwort statt leerem Chat
      const textBlocks = (data.content || []).filter(b => b.type === 'text' && b.text);
      if (data.stop_reason === 'refusal' || textBlocks.length === 0) {
        return res.status(200).json({
          content: [{ type: 'text', text: 'Bei dieser Anfrage kann ich nicht helfen. Formuliere sie bitte etwas anders — ich unterstütze dich gerne bei Leads, Marketing, Ads, Texten und Bildern.' }],
          _model: usedModel,
          _refusal: true
        });
      }

      // Nur Text-Blöcke zurückgeben — Fable liefert zusätzlich interne
      // Denk-Blöcke mit, die das Frontend nicht anzeigen soll.
      return res.status(200).json({ ...data, content: textBlocks, _model: usedModel });
    } catch (anthropicErr) {
      console.warn('Anthropic failed → Gemini:', anthropicErr.message);
    }

    try {
      if (!process.env.GEMINI_API_KEY) throw new Error('Kein Gemini Key');
      const geminiMessages = messages.map(msg => {
        const text = Array.isArray(msg.content) ? (msg.content.find(b => b.type === 'text')?.text || '') : msg.content;
        return { role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text }] };
      });
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system_instruction: { parts: [{ text: systemPrompt }] }, contents: geminiMessages, generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 } }) }
      );
      if (!geminiRes.ok) throw new Error('Gemini HTTP ' + geminiRes.status);
      const geminiData = await geminiRes.json();
      const geminiText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!geminiText) throw new Error('Gemini no content');
      return res.status(200).json({ content: [{ type: 'text', text: geminiText }], _fallback: 'gemini' });
    } catch (geminiErr) {
      console.warn('Gemini failed → OpenAI:', geminiErr.message);
    }

    try {
      if (!process.env.OPENAI_API_KEY) throw new Error('Kein OpenAI Key');
      const openaiMessages = [{ role: 'system', content: systemPrompt }];
      messages.forEach(msg => {
        const text = Array.isArray(msg.content) ? (msg.content.find(b => b.type === 'text')?.text || '') : msg.content;
        openaiMessages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: text });
      });
      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY },
        body: JSON.stringify({ model: 'gpt-4o', max_completion_tokens: maxTokens, messages: openaiMessages })
      });
      if (!openaiRes.ok) throw new Error('OpenAI HTTP ' + openaiRes.status);
      const openaiData = await openaiRes.json();
      const openaiText = openaiData?.choices?.[0]?.message?.content;
      if (!openaiText) throw new Error('OpenAI no content');
      return res.status(200).json({ content: [{ type: 'text', text: openaiText }], _fallback: 'openai' });
    } catch (openaiErr) {
      console.error('Alle 3 fehlgeschlagen:', openaiErr.message);
    }

    return res.status(200).json({ content: [{ type: 'text', text: 'Virgo ist gerade stark ausgelastet. Bitte versuche es in 30 Sekunden nochmal.' }], _fallback: 'none' });

  } catch (err) {
    return res.status(200).json({ content: [{ type: 'text', text: 'Virgo ist gerade kurz überlastet. Bitte versuche es gleich nochmal.' }], _error: err.message });
  }
}
