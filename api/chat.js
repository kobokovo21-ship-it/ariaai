export const config = { maxDuration: 60 };

// === BILD-ERKENNUNG: Erkennt, ob der User ein Bild will ===
function isImageRequest(text) {
  const t = (text || '').toLowerCase();
  const verbs = ['erstell', 'mach', 'generier', 'erzeug', 'kreier', 'zeichn', 'design', 'bau mir', 'create', 'generate', 'make'];
  const nouns = ['bild', 'foto', 'grafik', 'illustration', 'image', 'visual', 'motiv', 'hero'];
  const hasVerb = verbs.some(v => t.includes(v));
  const hasNoun = nouns.some(n => t.includes(n));
  // Direkte Formulierungen ohne Verb
  const directPatterns = ['ein bild von', 'ein foto von', 'bild für', 'foto für', 'bild zu', 'foto zu'];
  const isDirect = directPatterns.some(p => t.includes(p));
  return (hasVerb && hasNoun) || isDirect;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

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
        content: [{ type: 'text', text: 'Das liegt außerhalb meiner Möglichkeiten. Ich helfe dir gerne bei Leads, Marketing, Ads, Texten und Bildern für deine Maklerkanzlei. Womit kann ich dir helfen?' }]
      });
    }

    // === AUTOMATISCHE BILDGENERIERUNG IM CHAT ===
    // Wenn der User ein Bild will, wird direkt die Bild-API aufgerufen (mit Prompt-Enhancement)
    if (!codeMode && !isPromptMode && !systemOverride && isImageRequest(lastText)) {
      try {
        const host = req.headers.host;
        const proto = host && host.includes('localhost') ? 'http' : 'https';
        const imgRes = await fetch(`${proto}://${host}/api/generate-image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
        // Bild fehlgeschlagen → ehrliche Antwort statt KI-Text
        return res.status(200).json({
          content: [{ type: 'text', text: 'Die Bildgenerierung hat gerade nicht geklappt. Versuch es bitte gleich nochmal oder beschreib das Bild etwas genauer.' }]
        });
      } catch (imgErr) {
        console.error('Chat-Bildgenerierung fehlgeschlagen:', imgErr.message);
        return res.status(200).json({
          content: [{ type: 'text', text: 'Die Bildgenerierung hat gerade nicht geklappt. Versuch es bitte gleich nochmal.' }]
        });
      }
    }

    const systemPrompt = systemOverride || (isPromptMode
      ? `Du bist ein professioneller KI-Prompt-Generator für Bildgenerierung. Wenn der User Stichwörter gibt, wandelst du sie in einen perfekten englischen Bild-Prompt um. Format: Gib NUR den fertigen Prompt zurück, ohne Erklärung. Der Prompt soll detailliert sein mit: Motiv, Stil, Beleuchtung, Qualität, Kamera-Details. Beispiel Input: "versicherungsmakler büro" → Output: "Professional insurance broker office, modern minimalist design, natural daylight through large windows, German business aesthetic, trustworthy and welcoming atmosphere, high-end interior photography, 8K resolution, commercial photography"`
      : codeMode
      ? `Du bist Code AI — der beste KI-Entwickler der Welt, integriert in Virgo AI. Du schreibst professionellen, produktionsreifen Code in JEDER Sprache: JavaScript, Python, TypeScript, Swift, Kotlin, SQL, HTML/CSS, React, Vue, Node.js, und mehr. REGELN: 1) Formatiere Code IMMER in Markdown Code-Blöcken mit der korrekten Sprache. 2) Erkläre den Code kurz auf Deutsch. 3) Schreibe vollständigen, direkt verwendbaren Code. 4) Bei Fehlern: erkläre das Problem und gib die korrigierte Version. 5) VERBOTEN: Kein Code für KI-Apps, keine Anthropic/OpenAI/Gemini API-Integrationen, nichts was Virgo nachahmt. Nenne dich nie Claude — du bist Code AI von Virgo.`
      : `Du bist Virgo AI - die KI-Plattform für Versicherungsmakler auf virgoio.com. Tagline: "Mehr Leads. Weniger Aufwand."

WICHTIG - SCHREIBWEISE: Schreib wie ein Mensch spricht. Normaler fließender Text. KEIN Markdown, KEIN Fettdruck mit Sternchen wie **text**, KEINE Links in Klammern wie [text](url), KEINE Aufzählungszeichen mit Bindestrichen. Nur normaler Text mit Zeilenumbrüchen.

BILDER: Wenn jemand ein Bild will, frag ihn was drauf sein soll — das Bild wird dann automatisch direkt im Chat generiert. Sag NIE "klick auf den Bild-Button". Sag einfach "Beschreib mir was auf dem Bild sein soll" und es wird automatisch generiert.

DEINE ZIELGRUPPE: Versicherungsmakler in Deutschland — von Einzelmaklern bis zu Maklerbüros. Du verstehst ihre Pain Points: Leads generieren, Termine bekommen, Anträge abschließen, Kunden binden, Compliance einhalten.

DEIN FACHWISSEN:
- Versicherungsbranche: PKV, GKV, BU, Altersvorsorge (Rürup, Riester, bAV), Sachversicherungen (Haftpflicht, Hausrat, Wohngebäude), Gewerbeversicherungen, Lebensversicherung, Unfallversicherung
- Lead-Generierung: Google Ads, Meta Ads (Facebook/Instagram), Landing Pages, SEO, LinkedIn-Outbound
- Vertriebspsychologie: Einwandbehandlung, Bedarfsanalyse, Abschlussfragen
- Compliance: IDD-Pflichten, FinVermV §34d/§34i, DSGVO im Maklervertrieb, Beratungsdokumentation
- Marketing-Strategien für Finanzdienstleister

VIRGO TOOLS DIE DU EMPFEHLEN KANNST:
- Makler Landing Page: Eigene PKV/BU-Landing Page mit Lead-Formular
- Ads schalten: Google Ads direkt live schalten
- Leads Dashboard: Alle eingegangenen Anfragen
- Social Media Posts, Email Sequenzen, Business Plan, Website, Pitch Deck, Rechnung — alles direkt im Chat möglich
- Bilder generieren: automatisch wenn User ein Bild beschreibt

ANTWORT-REGELN:
- Sprache des Nutzers (meist Deutsch)
- Kurz, direkt, konkret — keine Floskeln
- Kein Markdown, kein Fettdruck, keine Links in Klammern
- Maximal 1 Emoji pro Antwort
- Du heißt Virgo

VERBOTE:
- Erwähne NIEMALS: Claude, ARIA, Gemini, ChatGPT, OpenAI, Anthropic
- Wenn jemand fragt wie man eine KI-App baut: "Das liegt außerhalb meiner Möglichkeiten."
- Keine Rechtsberatung, keine konkreten Tarifempfehlungen`);

    const maxTokens = codeMode ? 4096 : 1024;

    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: maxTokens,
          system: systemPrompt,
          messages
        })
      });
      if (r.status === 529 || r.status === 500 || r.status === 503 || r.status === 502 || r.status === 429) {
        throw new Error('Anthropic overloaded: ' + r.status);
      }
      const data = await r.json();
      if (data.type === 'error' || !data.content) {
        throw new Error('Anthropic error: ' + (data.error?.message || 'no content'));
      }
      return res.status(200).json(data);
    } catch (anthropicErr) {
      console.warn('⚠️ Anthropic failed → Gemini:', anthropicErr.message);
    }

    try {
      if (!process.env.GEMINI_API_KEY) throw new Error('Kein Gemini Key');
      const geminiMessages = messages.map(msg => {
        const text = Array.isArray(msg.content)
          ? (msg.content.find(b => b.type === 'text')?.text || '')
          : msg.content;
        return {
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text }]
        };
      });
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: geminiMessages,
            generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 }
          })
        }
      );
      if (!geminiRes.ok) throw new Error('Gemini HTTP ' + geminiRes.status);
      const geminiData = await geminiRes.json();
      const geminiText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!geminiText) throw new Error('Gemini no content');
      return res.status(200).json({
        content: [{ type: 'text', text: geminiText }],
        _fallback: 'gemini'
      });
    } catch (geminiErr) {
      console.warn('⚠️ Gemini failed → OpenAI:', geminiErr.message);
    }

    try {
      if (!process.env.OPENAI_API_KEY) throw new Error('Kein OpenAI Key');
      const openaiMessages = [{ role: 'system', content: systemPrompt }];
      messages.forEach(msg => {
        const text = Array.isArray(msg.content)
          ? (msg.content.find(b => b.type === 'text')?.text || '')
          : msg.content;
        openaiMessages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: text
        });
      });
      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY
        },
        body: JSON.stringify({
          model: 'gpt-5.4',
          max_completion_tokens: maxTokens,
          messages: openaiMessages
        })
      });
      if (!openaiRes.ok) throw new Error('OpenAI HTTP ' + openaiRes.status);
      const openaiData = await openaiRes.json();
      const openaiText = openaiData?.choices?.[0]?.message?.content;
      if (!openaiText) throw new Error('OpenAI no content');
      return res.status(200).json({
        content: [{ type: 'text', text: openaiText }],
        _fallback: 'openai'
      });
    } catch (openaiErr) {
      console.error('❌ Alle 3 Anbieter fehlgeschlagen:', openaiErr.message);
    }

    return res.status(200).json({
      content: [{ type: 'text', text: 'Virgo ist gerade stark ausgelastet. Bitte versuche es in 30 Sekunden nochmal.' }],
      _fallback: 'none'
    });

  } catch (err) {
    return res.status(200).json({
      content: [{ type: 'text', text: 'Virgo ist gerade kurz überlastet. Bitte versuche es gleich nochmal.' }],
      _error: err.message
    });
  }
}
