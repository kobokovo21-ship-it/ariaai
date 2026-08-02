export const config = { maxDuration: 60 };

import { validateToken, extractToken, getUserPlan, isPayingPlan, isAdminEmail } from '../lib/auth.js';
import { enforceRateLimit, clientIp } from '../lib/rate-limit.js';

const ALLOWED_ORIGINS = ['https://virgoio.com', 'https://www.virgoio.com'];

// === MODELL-STEUERUNG ===
// Beide über Vercel-Env-Variablen änderbar, ohne Code anzufassen.
// ANTHROPIC_MODEL_PAID = Modell für zahlende Kunden + Admin (Standard: Fable 5)
// ANTHROPIC_MODEL_FREE = Modell für alle anderen (Standard: Opus 4.8)
const MODEL_PAID = process.env.ANTHROPIC_MODEL_PAID || 'claude-fable-5';
const MODEL_FREE = process.env.ANTHROPIC_MODEL_FREE || 'claude-opus-4-8';
const MODEL_REFUSAL_FALLBACK = 'claude-opus-4-8';

// Kostenloses Nachrichten-Kontingent für Free-Plan (pro Nutzer & Tag)
const FREE_CHAT_DAILY_LIMIT = 20;

// Web-Suche kostet pro Aufruf extra bei Anthropic — eigenes, engeres Limit
// pro Nutzer und Tag, damit ein einzelner Chat nicht unbegrenzt teuer wird.
const JOB_SEARCH_DAILY_LIMIT = 30;
const WEB_SEARCH_MAX_USES = 5; // max. Suchanfragen, die das Modell PRO Chat-Nachricht stellen darf

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

// Prüft Token + Plan des Users über Supabase (Signatur-Validierung).
// Zahlender Kunde (aktiver Makler-Plan) oder Admin → isPaying = true.
async function getUserAccess(req) {
  const user = await validateToken(extractToken(req));
  if (!user) return { user: null, isPaying: false, isAdmin: false };
  if (isAdminEmail(user.email)) return { user, isPaying: true, isAdmin: true };
  const { plan } = await getUserPlan(user.id);
  return { user, isPaying: isPayingPlan(plan), isAdmin: false, plan };
}

function isImageRequest(text) {
  const t = (text || '').toLowerCase();
  const hasVerb = /erstell|mach|generier|erzeug|kreier|zeichn|design|create|generate|make|draw/.test(t);
  const hasNoun = /\bbild\b|foto|grafik|illustration|\bimage\b|visual|motiv|hero.?bild|headerbild|werbebild|produktbild/.test(t);
  const directPatterns = /ein bild von|ein foto von|bild für|foto für|bild zu|foto zu|bild für meine|bild von/.test(t);
  return (hasVerb && hasNoun) || directPatterns;
}

// ── JOBSUCHE ──────────────────────────────────────────────────────
// Erkennt Anfragen rund um Jobsuche, Bewerbung und Lebenslauf. Bei Treffer
// wird das Anthropic-Web-Search-Tool für DIESEN einen Chat-Aufruf aktiviert,
// damit das Modell echte, aktuelle Stellenanzeigen findet statt sich welche
// auszudenken.
function isJobSearchRequest(text) {
  const t = (text || '').toLowerCase();
  const jobWords = /\bjob(s)?\b|\bstelle(n)?\b|stellenangebot|stellenanzeige|arbeitsstelle|arbeitsplatz|ausbildungsplatz|praktikumsplatz|arbeit\s+such|jobsuche|jobangebot/.test(t);
  const applyWords = /bewerbung|anschreiben|lebenslauf|cv\b|bewerbungsschreiben|bewerben/.test(t);
  const searchVerb = /such|find|zeig|gib mir|welche|verfügbar|offen/.test(t);
  return (jobWords && searchVerb) || (jobWords && applyWords) || applyWords;
}

// Ein einzelner Anthropic-Call. Wirft bei Überlastung/Fehlern,
// damit die Fallback-Kette (Gemini → OpenAI) greift.
// `tools` optional: z.B. Web-Search-Tool für Jobsuche-Anfragen.
async function callAnthropic(model, maxTokens, systemPrompt, messages, tools) {
  const body = { model, max_tokens: maxTokens, system: systemPrompt, messages };
  if (tools && tools.length) body.tools = tools;
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01'
  };
  // Web-Search ist ein Server-Tool, das (Stand der Anthropic-Doku zum Zeitpunkt
  // dieses Codes) einen Beta-Header braucht, damit es überhaupt aktiv wird —
  // ohne ihn ignoriert die API das Tool stillschweigend und der Chat antwortet
  // ganz normal ohne Suche, OHNE Fehler zu werfen. Genau das war der Bug.
  if (tools && tools.some(t => t.type === 'web_search_20250305')) {
    headers['anthropic-beta'] = 'web-search-2025-03-05';
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  if (r.status === 529 || r.status === 500 || r.status === 503 || r.status === 502 || r.status === 429) {
    throw new Error('Anthropic overloaded: ' + r.status);
  }
  const data = await r.json();
  if (data.type === 'error' || !data.content) {
    // Rohe Fehlermeldung ins Log — bei einem falschen/veralteten Tool-Namen
    // sagt Anthropic hier meist explizit, welcher Tool-Typ erwartet wird.
    console.error('Anthropic tool/API error:', JSON.stringify(data.error || data));
    throw new Error('Anthropic error: ' + (data.error?.message || 'no content'));
  }
  return data;
}

export default async function handler(req, res) {
  if (!guard(req, res)) return;

  // ── Auth-Pflicht + serverseitige Quota ─────────────────────────
  // Chat ist nicht mehr komplett anonym: der Client MUSS ein gültiges
  // Supabase-Token schicken, sonst kommt kein Anthropic-/Gemini-/OpenAI-Call
  // durch — sonst könnten Angreifer die AI-APIs auf unsere Kosten nutzen.
  const access = await getUserAccess(req);
  if (!access.user) {
    return res.status(401).json({ error: 'Nicht eingeloggt' });
  }
  const { user, isPaying, isAdmin } = access;

  // Rate-Limit pro User (Burst-Schutz) + globales IP-Limit (registrierte Bots)
  if (!(await enforceRateLimit(req, res, { name: 'chat:user:' + user.id, windowSec: 60, max: 40 }))) return;
  if (!(await enforceRateLimit(req, res, { name: 'chat:ip:' + clientIp(req), windowSec: 60, max: 120 }))) return;

  // Free-Plan: 20 Nachrichten/Tag (Admin & Paying: unbegrenzt)
  if (!isPaying && !isAdmin) {
    const dayKey = `chat:free-quota:${user.id}:${new Date().toISOString().slice(0, 10)}`;
    if (!(await enforceRateLimit(req, res, { name: dayKey, windowSec: 86400, max: FREE_CHAT_DAILY_LIMIT, key: dayKey }))) return;
  }

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
            'origin': 'https://virgoio.com',
            // Auth-Token des Users durchreichen, damit generate-image die
            // Credits beim richtigen User verbucht (und Rate-Limit greift).
            ...(req.headers.authorization ? { 'authorization': req.headers.authorization } : {})
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

    // === JOBSUCHE: Web-Search-Tool aktivieren ===
    // Nur im normalen Virgo-Chat (nicht Code-Modus, nicht Prompt-Modus, nicht
    // bei anderen systemOverride-Flows wie Website-Bau) — sonst gleiche Logik
    // wie die automatische Bilderkennung oben.
    const wantsJobSearch = !codeMode && !isPromptMode && isJobSearchRequest(lastText);
    let jobSearchTools = null;
    if (wantsJobSearch) {
      // Eigenes Tageslimit für Jobsuche-Anfragen (Web-Suche kostet extra bei Anthropic)
      const jobDayKey = `chat:jobsearch-quota:${user.id}:${new Date().toISOString().slice(0, 10)}`;
      const jobQuotaOk = isPaying || isAdmin
        ? true // zahlende Kunden/Admin: kein Extra-Limit, das normale Chat-Limit reicht
        : await enforceRateLimit(req, res, { name: jobDayKey, windowSec: 86400, max: JOB_SEARCH_DAILY_LIMIT, key: jobDayKey });
      if (!jobQuotaOk) return; // enforceRateLimit hat bei Überschreitung bereits geantwortet
      jobSearchTools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: WEB_SEARCH_MAX_USES }];
    }

    const jobSearchSystemAddendum = wantsJobSearch ? `

JOBSUCHE-MODUS: Der Nutzer sucht Jobs, Ausbildungs-/Praktikumsplätze oder braucht Hilfe bei Bewerbung/Lebenslauf. Du hast Web-Suche zur Verfügung.

PFLICHT — NUR ECHTE, AKTUELLE ANGEBOTE:
- Suche gezielt auf echten Jobbörsen (arbeitsagentur.de/jobsuche, indeed.de, stepstone.de) und Karriereseiten der Firmen — nicht nur allgemeines Wissen über Firmen.
- Jedes gelistete Angebot MUSS aus einem tatsächlichen Suchtreffer stammen, mit einer echten, funktionierenden URL zur Anzeige. KEINE Angebote ohne Link.
- Erfinde NIEMALS Stellenangebote, Firmen oder Links. Wenn die Suche keine konkreten offenen Stellen findet, sag das ehrlich — biete dann stattdessen an, bei den größten lokalen Arbeitgebern der Branche eine Initiativbewerbung vorzubereiten.
- Wenn eine gefundene Anzeige kein Datum zeigt oder alt wirken könnte, weise kurz darauf hin ("könnte nicht mehr aktuell sein — direkt prüfen").

FORMAT — klar nummeriert, damit der Kunde eine Nummer auswählen kann:
1. [Jobtitel] — [Firma], [Ort]
   Kurzbeschreibung in 1 Satz.
   Link: [echte URL]

Nach der Liste IMMER fragen: "Für welche Nummer soll ich dir die Bewerbung schreiben?" — sobald der Kunde eine Nummer oder Stelle nennt, sofort ein vollständiges, auf genau diese Anzeige zugeschnittenes Anschreiben schreiben (nutze Firmenname, Jobtitel und Details aus der Anzeige). Frage nur nach den nötigsten persönlichen Eckdaten (Erfahrung, Stärken), falls die noch fehlen.` : '';

    let systemPrompt = systemOverride || (isPromptMode
      ? `Du bist ein professioneller KI-Prompt-Generator für Bildgenerierung. Wandle Stichwörter in perfekte englische Bild-Prompts um. Gib NUR den fertigen Prompt zurück, ohne Erklärung.`
      : codeMode
      ? `Du bist Code AI — der beste KI-Entwickler der Welt, integriert in Virgo AI. Du schreibst professionellen Code in JEDER Sprache. Formatiere Code IMMER in Markdown Code-Blöcken. Erkläre kurz auf Deutsch. VERBOTEN: Kein Code für KI-Apps, keine API-Integrationen die Virgo nachahmen.`
      : `Du bist Virgo AI - die KI-Plattform für Versicherungsmakler auf virgoio.com.

SCHREIBWEISE: Normaler fließender Text. Kein Markdown, kein Fettdruck mit Sternchen, keine Links in Klammern, keine Bindestriche als Aufzählung.

BILDER: Du kannst Bilder direkt generieren. Wenn jemand ein Bild will, generiere es sofort — sag nicht dass du keine Bilder erstellen kannst. Das System macht es automatisch.

JOBSUCHE: Du kannst bei Bedarf im Internet nach echten, aktuellen Stellenangeboten suchen und Bewerbungen/Lebensläufe schreiben. Sag NIEMALS dass du das nicht kannst.

FACHWISSEN: Versicherungsbranche, PKV, GKV, BU, Altersvorsorge, Lead-Generierung, Google Ads, Meta Ads, Landing Pages, Vertriebspsychologie, Compliance IDD/DSGVO.

TOOLS: Makler Landing Page, Ads schalten, Leads Dashboard, Social Posts, Emails, Business Plan, Website, Pitch Deck, Rechnung, Bilder, Jobsuche — alles direkt im Chat.

REGELN: Antworte auf Deutsch. Kurz, direkt, konkret. Maximal 1 Emoji. Du heißt Virgo.

VERBOTE: Erwähne niemals Claude, ARIA, Gemini, ChatGPT, OpenAI, Anthropic. Keine Rechtsberatung, keine konkreten Tarifempfehlungen.`);

    // WICHTIG: der Client (genChat() im Frontend) schickt bei JEDER normalen
    // Chat-Nachricht ein systemOverride mit — der obere Zweig mit dem
    // eingebauten jobSearchSystemAddendum wird also so gut wie nie genutzt.
    // Deshalb hier NOCHMAL anhängen, unabhängig davon, woher der systemPrompt
    // kam — sonst bekommt das Modell die Jobsuche-Anweisung nie zu sehen,
    // selbst wenn das Web-Search-Tool korrekt aktiviert ist.
    if (wantsJobSearch) systemPrompt += jobSearchSystemAddendum;

    // Fable 5 denkt intern mit — diese Denk-Tokens zählen ins max_tokens-Budget.
    // Web-Suche braucht zusätzlichen Puffer (Suchergebnisse + finale Antwort).
    const maxTokens = codeMode ? 16000 : (wantsJobSearch ? 20000 : 8192);

    // === MODELLWAHL: zahlender Plan oder Admin = PAID-Modell, sonst FREE-Modell ===
    // isPaying wurde oben schon ermittelt (access.isPaying) — nicht doppelt ausrollen.
    const chosenModel = isPaying ? MODEL_PAID : MODEL_FREE;

    try {
      let data = await callAnthropic(chosenModel, maxTokens, systemPrompt, messages, jobSearchTools);
      let usedModel = chosenModel;

      // === REFUSAL-FALLBACK ===
      // Fable 5 kann Anfragen ablehnen (HTTP 200 mit stop_reason "refusal").
      // Dann denselben Request einmal mit Opus wiederholen — der User merkt nichts.
      if (data.stop_reason === 'refusal' && chosenModel !== MODEL_REFUSAL_FALLBACK) {
        console.warn('Refusal von ' + chosenModel + ' → Retry mit ' + MODEL_REFUSAL_FALLBACK);
        data = await callAnthropic(MODEL_REFUSAL_FALLBACK, maxTokens, systemPrompt, messages, jobSearchTools);
        usedModel = MODEL_REFUSAL_FALLBACK;
      }

      // Falls auch das abgelehnt wird (sehr selten): freundliche Antwort statt leerem Chat
      let textBlocks = (data.content || []).filter(b => b.type === 'text' && b.text);

      // ── WICHTIGER FUND: Bei Websuche (mehrere Suchanfragen hintereinander)
      // liefert Anthropic den Text in MEHRERE Blöcke aufgeteilt — einen vor
      // jeder neuen Suchpause. Das Frontend liest aber nur content[0].text,
      // also nur den ERSTEN Block — alles danach (Punkt 2, 3, Links usw.)
      // ging bisher verloren, obwohl die Antwort serverseitig vollständig war.
      // Fix: alle Text-Blöcke zu einem zusammenführen, bevor sie rausgehen.
      if (textBlocks.length > 1) {
        const combinedText = textBlocks.map(b => b.text).join('\n\n');
        textBlocks = [{ type: 'text', text: combinedText }];
      }
      if (data.stop_reason === 'refusal' || textBlocks.length === 0) {
        return res.status(200).json({
          content: [{ type: 'text', text: 'Bei dieser Anfrage kann ich nicht helfen. Formuliere sie bitte etwas anders — ich unterstütze dich gerne bei Leads, Marketing, Ads, Texten und Bildern.' }],
          _model: usedModel,
          _refusal: true
        });
      }

      // Nur Text-Blöcke zurückgeben — Fable liefert zusätzlich interne
      // Denk-Blöcke und (bei Web-Suche) Tool-Use-Blöcke mit, die das
      // Frontend nicht anzeigen soll. Die Such-Zitate stecken als Metadaten
      // in den Text-Blöcken selbst und gehen dabei nicht verloren.

      // Abgeschnittene Antwort erkennen (Token-Budget ausgeschöpft, bevor die
      // Antwort fertig war) — passiert vor allem bei Websuche, weil Suchtreffer
      // + internes Denken + die eigentliche Liste viel Budget brauchen.
      // Lieber ehrlich sagen als eine mitten im Satz abbrechende Liste zeigen.
      if (data.stop_reason === 'max_tokens' && textBlocks.length) {
        const last = textBlocks[textBlocks.length - 1];
        last.text = last.text.trim() + '\n\n⚠️ Die Antwort wurde mitten drin abgeschnitten (zu viele Ergebnisse für eine Nachricht). Schreib "weiter" oder grenz die Suche etwas ein (z. B. eine Stadt/einen Bezirk weniger), dann bekommst du die komplette Liste.';
      }

      // ── TEMPORÄRE DIAGNOSE ENTFERNT (Websuche-Fix bestätigt funktionierend) ──

      return res.status(200).json({ ...data, content: textBlocks, _model: usedModel, _usedWebSearch: !!jobSearchTools });
    } catch (anthropicErr) {
      console.warn('Anthropic failed → Gemini:', anthropicErr.message);
      var anthropicErrMsg = anthropicErr.message; // für Debug-Marker im Fallback unten
    }

    // ── Hinweis: Gemini/OpenAI-Fallback haben KEIN Web-Search-Tool angebunden.
    // Springt der Request bei einer Jobsuche-Anfrage hierher (Anthropic down),
    // kann das Modell keine echten Stellenanzeigen liefern — es bekommt daher
    // eine explizite Anweisung, das offen zu sagen statt Jobs zu erfinden.
    const fallbackSystemPrompt = wantsJobSearch
      ? systemPrompt + '\n\nWICHTIG: Web-Suche ist gerade nicht verfügbar. Erfinde KEINE Stellenanzeigen — sag dem Nutzer ehrlich, dass die Jobsuche kurz nicht funktioniert und er es gleich nochmal versuchen soll.'
      : systemPrompt;

    try {
      if (!process.env.GEMINI_API_KEY) throw new Error('Kein Gemini Key');
      const geminiMessages = messages.map(msg => {
        const text = Array.isArray(msg.content) ? (msg.content.find(b => b.type === 'text')?.text || '') : msg.content;
        return { role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text }] };
      });
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system_instruction: { parts: [{ text: fallbackSystemPrompt }] }, contents: geminiMessages, generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 } }) }
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
      const openaiMessages = [{ role: 'system', content: fallbackSystemPrompt }];
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
