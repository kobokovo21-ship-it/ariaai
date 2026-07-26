export const config = { maxDuration: 300 };

import { enforceRateLimit, clientIp } from '../lib/rate-limit.js';

const ALLOWED_ORIGINS = [
  'https://virgoio.com',
  'https://www.virgoio.com'
];

// === MODELL-STEUERUNG ===
// ANTHROPIC_MODEL_PAID = Modell für zahlende Kunden + Admin (Standard: Fable 5)
// ANTHROPIC_MODEL_FREE = Modell für alle anderen (Standard: Opus 4.8)
const MODEL_PAID = process.env.ANTHROPIC_MODEL_PAID || 'claude-fable-5';
const MODEL_FREE = process.env.ANTHROPIC_MODEL_FREE || 'claude-opus-4-8';
const MODEL_REFUSAL_FALLBACK = 'claude-opus-4-8';

// Pläne, die als "zahlend" gelten (gleiche Liste wie in tools.js)
const ACTIVE_PLANS = ['makler-starter', 'makler-pro', 'makler-business'];

// Prüft Token + Plan des Users über Supabase.
// Zahlender Kunde (aktiver Makler-Plan) oder Admin → isPaying = true.
async function getUserAccess(req) {
  try {
    const BASE = process.env.SUPABASE_URL;
    const SVC = process.env.SUPABASE_SERVICE_KEY;
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!token || !BASE || !SVC) return { user: null, isPaying: false };

    const r = await fetch(`${BASE}/auth/v1/user`, {
      headers: { 'apikey': SVC, 'Authorization': 'Bearer ' + token }
    });
    if (!r.ok) return { user: null, isPaying: false };
    const user = await r.json();
    if (!user || !user.id) return { user: null, isPaying: false };

    const ADMIN = process.env.ADMIN_EMAIL || 'holyencore@gmail.com';
    if (user.email === ADMIN) return { user, isPaying: true };

    let isPaying = false;
    try {
      const planR = await fetch(`${BASE}/rest/v1/users?id=eq.${user.id}&select=plan&limit=1`, {
        headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` }
      });
      if (planR.ok) {
        const planData = await planR.json();
        if (Array.isArray(planData) && planData.length > 0) {
          isPaying = ACTIVE_PLANS.includes(planData[0].plan);
        }
      }
    } catch (e) {}
    return { user, isPaying };
  } catch (e) {
    console.warn('Auth-Check fehlgeschlagen:', e.message);
    return { user: null, isPaying: false };
  }
}

// Ein einzelner Anthropic-Call. Wirft bei Überlastung/Fehlern,
// damit die Fallback-Kette (Gemini → OpenAI) greift.
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
  // 400 = Bad Request (z.B. max_tokens über Modell-Limit). Body loggen, damit
  // wir das nicht wieder als "Anthropic error" verschleiern und in Gemini-
  // Fallback rennen, wo dann bei 8k-Output das HTML abschneidet.
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    console.error(`[anthropic] HTTP ${r.status} model=${model} max_tokens=${maxTokens} body=${body.slice(0, 400)}`);
    throw new Error('Anthropic HTTP ' + r.status);
  }
  const data = await r.json();
  if (data.type === 'error' || !data.content) {
    console.error(`[anthropic] error response model=${model}:`, JSON.stringify(data).slice(0, 400));
    throw new Error('Anthropic error');
  }
  return data;
}

// Gestreamter Anthropic-Call für LANGE Outputs (website-html).
// Warum streamen: bei hohem max_tokens (große animierte Seite) kann ein
// nicht-gestreamter Request in HTTP-Read-Timeouts laufen, bevor die Antwort
// fertig ist. Streaming hält die Verbindung mit Bytes am Leben und lässt die
// Seite bis </html> vollständig generieren. Wir sammeln alle Text-Deltas und
// geben dieselbe Datenstruktur wie callAnthropic zurück ({content, stop_reason}).
async function callAnthropicStreaming(model, maxTokens, systemPrompt, messages) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system: systemPrompt, messages, stream: true })
  });
  if (r.status === 529 || r.status === 500 || r.status === 503 || r.status === 502 || r.status === 429) {
    throw new Error('Anthropic overloaded: ' + r.status);
  }
  if (!r.ok || !r.body) {
    const body = r.body ? await r.text().catch(() => '') : '';
    console.error(`[anthropic-stream] HTTP ${r.status} model=${model} max_tokens=${maxTokens} body=${body.slice(0, 400)}`);
    throw new Error('Anthropic HTTP ' + r.status);
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', text = '', stopReason = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let ev;
      try { ev = JSON.parse(payload); } catch { continue; }
      if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
        text += ev.delta.text;
      } else if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason) {
        stopReason = ev.delta.stop_reason;
      } else if (ev.type === 'error') {
        console.error(`[anthropic-stream] error event model=${model}:`, JSON.stringify(ev).slice(0, 400));
        throw new Error('Anthropic stream error');
      }
    }
  }
  if (!text) throw new Error('Anthropic stream: kein Text');
  return { content: [{ type: 'text', text }], stop_reason: stopReason };
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';

  // Nur eigene Domains dürfen CORS-Header bekommen
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // Harte Sperre: Anfrage muss von eigener Domain kommen
  const originOk = ALLOWED_ORIGINS.includes(origin);
  const refererOk = ALLOWED_ORIGINS.some(o => referer.startsWith(o));
  if (!originOk && !refererOk) {
    console.warn('⛔ Blocked request. origin=' + origin + ' referer=' + referer);
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Auth-Pflicht + Rate-Limit — sonst könnten Angreifer Anthropic auf unsere Kosten missbrauchen.
  const access = await getUserAccess(req);
  if (!access.user) return res.status(401).json({ error: 'Nicht eingeloggt' });
  if (!(await enforceRateLimit(req, res, { name: 'business:' + access.user.id, windowSec: 60, max: 30 }))) return;
  if (!(await enforceRateLimit(req, res, { name: 'business:ip:' + clientIp(req), windowSec: 60, max: 60 }))) return;

  try {
    const { type, messages = [], systemOverride } = req.body || {};

    const defaultSystems = {
      plan: 'Du bist ein Business-Experte. Erstelle NUR vollständige Businesspläne auf Deutsch. Struktur: 1) Executive Summary 2) Produkt/Dienstleistung 3) Marktanalyse 4) Zielgruppe 5) Wettbewerb 6) Marketing 7) Finanzen 8) Meilensteine. Direkt verwendbar, keine Platzhalter.',
      website: 'Du bist ein Copywriter. Erstelle NUR professionelle Website-Texte auf Deutsch. Struktur: Hero-Headline (max 8 Wörter), Subheadline, 3 USPs mit Erklärung, Über uns, Leistungen, CTA. Conversion-optimiert.',
      'website-html': 'Du bist ein MOTION DESIGN & WEB ANIMATION EXPERT. GENERIERE NUR WUNDERSCHÖNES, modernes HTML mit ECHTEN CSS/SVG Animationen. ANIMATIONEN SIND NICHT OPTIONAL — JEDE Website MUSS atemberaubend animiert sein! Antworte NUR mit vollständigem HTML-Code. Beginne direkt mit <!DOCTYPE html>. KEIN Text davor/danach, KEINE Backticks. PFLICHT-ANIMATIONEN in jeder Website: @keyframes (fade-in, slide-up, pulse, glow, float), Hover-Effekte auf ALLEN Buttons/Cards (scale + glow), Scroll-Reveal Animationen, animierte Hintergründe, SVG-Bewegungen, Gradient-Shifts, Parallax-Effekte. Keine statischen Seiten — ALLES MUSS SICH BEWEGEN. Das HTML muss luxuriös, modern und ständig in Bewegung sein.',
      ads: 'Du bist ein Performance Marketing Experte. Erstelle NUR Werbeanzeigen-Texte auf Deutsch. Format für jede Anzeige: HEADLINE (max 6 Wörter) + TEXT (max 125 Zeichen) + CTA. Erstelle 5 verschiedene Varianten.',
      social: 'Du bist ein Social Media Manager. Erstelle NUR Social Media Posts auf Deutsch. Für jeden Post: Plattform (Instagram/LinkedIn/TikTok) + Caption + max 5 Hashtags. Erstelle 10 abwechslungsreiche Posts. KEIN Businessplan, nur Posts!',
      email: 'Du bist ein Email Marketing Experte. Erstelle NUR eine 5-teilige Email-Sequenz auf Deutsch. Jede Email: Betreff + Inhalt + CTA. 1) Willkommen 2) Mehrwert 3) Beweis/Case Study 4) Angebot 5) Follow-up.',
      pitch: 'Du bist ein Startup-Pitch Experte. Erstelle NUR ein vollständiges Pitch Deck auf Deutsch. Struktur: Problem, Lösung, Marktgröße, Geschäftsmodell, Traktion, Team, Finanzierung. Überzeugend für Investoren.'
    };

    const systemPrompt =
      systemOverride ||
      defaultSystems[type] ||
      'Du bist Virgo Business AI — erstelle professionelle Business-Inhalte auf Deutsch. Antworte vollständig und direkt verwendbar.';

    // website-html braucht viel Output-Budget für eine vollständige animierte
    // Seite (mit </html>). Symptom "zweimal abgeschnitten" = 200 mit partiellem
    // HTML = stop_reason:max_tokens → das Budget war zu klein. Opus 4.8 kann bis
    // 128k Output; wir geben 64k (mehr als jede reale Landingpage braucht) und
    // STREAMEN den Call (Pflicht bei so hohem max_tokens, sonst HTTP-Timeout).
    const isWebsiteHtml = type === 'website-html';
    const maxTokens = isWebsiteHtml ? 64000 : 8192;
    // Fallback-Modelle sind pro-Provider gedeckelt — Gemini 2.0 Flash 8k, GPT-4o 16k.
    const geminiMaxTokens = Math.min(maxTokens, 8192);
    const openaiMaxTokens = Math.min(maxTokens, 16384);

    const extractText = (msg) => {
      if (!msg) return '';
      return Array.isArray(msg.content)
        ? (msg.content.find(b => b.type === 'text')?.text || '')
        : (msg.content || '');
    };

    // === MODELLWAHL: zahlender Plan oder Admin = PAID-Modell, sonst FREE-Modell ===
    const { isPaying } = access;
    let chosenModel = isPaying ? MODEL_PAID : MODEL_FREE;
    // Für website-html direkt Opus 4.8 nehmen — Fable's interne Denk-Tokens
    // fressen sonst so viel Budget, dass für vollständiges HTML kein Platz
    // mehr bleibt. Opus produziert die Seite in einem Rutsch, ohne Truncation.
    // Über ANTHROPIC_MODEL_WEBSITE_HTML lässt sich das per Env-Var overriden.
    if (type === 'website-html') {
      chosenModel = process.env.ANTHROPIC_MODEL_WEBSITE_HTML || MODEL_REFUSAL_FALLBACK;
    }

    // Anthropic API — website-html gestreamt (langer Output), Rest normal.
    const callModel = (m) => isWebsiteHtml
      ? callAnthropicStreaming(m, maxTokens, systemPrompt, messages)
      : callAnthropic(m, maxTokens, systemPrompt, messages);
    try {
      let data = await callModel(chosenModel);
      let usedModel = chosenModel;

      // === REFUSAL-FALLBACK ===
      if (data.stop_reason === 'refusal' && chosenModel !== MODEL_REFUSAL_FALLBACK) {
        console.warn('Refusal von ' + chosenModel + ' → Retry mit ' + MODEL_REFUSAL_FALLBACK);
        data = await callModel(MODEL_REFUSAL_FALLBACK);
        usedModel = MODEL_REFUSAL_FALLBACK;
      }

      const textBlocks = (data.content || []).filter(b => b.type === 'text' && b.text);
      if (data.stop_reason === 'refusal' || textBlocks.length === 0) {
        return res.status(200).json({
          content: [{ type: 'text', text: 'Bei dieser Anfrage kann ich nicht helfen. Formuliere sie bitte etwas anders.' }],
          _model: usedModel,
          _refusal: true
        });
      }

      const outLen = textBlocks.reduce((n, b) => n + b.text.length, 0);
      console.log(`✓ Anthropic (${usedModel}) ok, stop=${data.stop_reason}, type=${type}, chars=${outLen}`);
      if (data.stop_reason === 'max_tokens') {
        console.warn(`[business] max_tokens erreicht bei ${usedModel} (max=${maxTokens}, type=${type}) — Output evtl. abgeschnitten.`);
      }
      return res.status(200).json({
        ...data,
        content: textBlocks,
        _model: usedModel,
        _truncated: data.stop_reason === 'max_tokens'
      });
    } catch (anthropicErr) {
      console.warn('⚠️ Anthropic failed → Gemini:', anthropicErr.message);
    }

    // Gemini API
    try {
      if (!process.env.GEMINI_API_KEY) throw new Error('Kein Gemini Key');

      const geminiMessages = messages.map(msg => {
        const text = extractText(msg);
        return { role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text }] };
      });

      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: geminiMessages,
            generationConfig: { maxOutputTokens: geminiMaxTokens, temperature: 0.7 }
          })
        }
      );

      if (!geminiRes.ok) throw new Error('Gemini HTTP ' + geminiRes.status);

      const geminiData = await geminiRes.json();
      const geminiText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!geminiText) throw new Error('Gemini no content');

      console.log('✓ Gemini erfolgreich');
      return res.status(200).json({ content: [{ type: 'text', text: geminiText }], _fallback: 'gemini' });
    } catch (geminiErr) {
      console.warn('⚠️ Gemini failed → OpenAI:', geminiErr.message);
    }

    // OpenAI API (Fallback)
    try {
      if (!process.env.OPENAI_API_KEY) throw new Error('Kein OpenAI Key');

      const openaiMessages = [{ role: 'system', content: systemPrompt }];
      messages.forEach(msg => {
        const text = extractText(msg);
        openaiMessages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: text });
      });

      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || 'gpt-4o',
          max_tokens: openaiMaxTokens,
          messages: openaiMessages,
          temperature: 0.7
        })
      });

      if (!openaiRes.ok) throw new Error('OpenAI HTTP ' + openaiRes.status);

      const openaiData = await openaiRes.json();
      const openaiText = openaiData?.choices?.[0]?.message?.content;
      if (!openaiText) throw new Error('OpenAI no content');

      console.log('✓ OpenAI erfolgreich');
      return res.status(200).json({ content: [{ type: 'text', text: openaiText }], _fallback: 'openai' });
    } catch (openaiErr) {
      console.error('❌ Alle 3 APIs fehlgeschlagen:', openaiErr.message);
    }

    // Fallback wenn alle fehlschlagen
    return res.status(200).json({
      content: [{ type: 'text', text: 'Virgo ist gerade stark ausgelastet. Bitte versuche es in 30 Sekunden nochmal.' }],
      _fallback: 'none'
    });
  } catch (err) {
    console.error('Fatal error:', err.message);
    return res.status(200).json({
      content: [{ type: 'text', text: 'Virgo ist gerade kurz überlastet. Bitte versuche es gleich nochmal.' }],
      _error: err.message
    });
  }
}
