# Virgo AI — Freischalt-Checkliste vor dem Live-Gang

Diese Datei ist die Klick-für-Klick-Anleitung für alles, was **außerhalb des Codes** noch erledigt werden muss, bevor du die App aktiv bewerben kannst. Reihenfolge ist so gewählt, dass jeder Block einzeln verifizierbar ist.

---

## 1. Cloudflare Turnstile aktivieren (Bot-Schutz für Lead-Formulare)

**Zeitaufwand:** ~5 Minuten.
**Was es tut:** Blockiert Bot-Anmeldungen auf `pkv-check.html` und den Makler-Landingpages, sodass in einer Google-/Meta-Ads-Kampagne keine Fake-Leads eingehen. Der Code ist schon eingebaut, es fehlen nur zwei Env-Variablen.

1. Öffne https://dash.cloudflare.com/ → falls kein Account: kostenlos registrieren.
2. Linke Sidebar → **Turnstile** → **Add site**.
   - **Site name**: `Virgo AI`
   - **Hostnames**: `virgoio.com` und in einer neuen Zeile `www.virgoio.com`
   - **Widget mode**: **Managed** (Cloudflare wählt automatisch zwischen unsichtbar und Challenge)
   - **Pre-clearance**: aus lassen
3. **Create** → Cloudflare zeigt dir zwei Werte:
   - **Site Key** (fängt mit `0x4AA…` an)
   - **Secret Key** (fängt mit `0x4AA…` an)
4. Wechsle in Vercel → Projekt `virgo-ai` → **Settings** → **Environment Variables** → **Add**:
   - Name `TURNSTILE_SITE_KEY`, Value = Site Key, Environments: **Production + Preview**
   - Name `TURNSTILE_SECRET_KEY`, Value = Secret Key, Environments: **Production + Preview**
5. Vercel → **Deployments** → beim letzten Deploy `…` → **Redeploy**.
6. Testen:
   - `https://virgoio.com/pkv-check.html` — beim Kontaktformular sollte jetzt das Turnstile-Widget sichtbar sein (kleine Cloudflare-Box).
   - Formular ohne bestandene Challenge absenden → sollte mit „Bot-Schutz fehlgeschlagen" ablehnen.
   - Formular normal absenden → sollte durchgehen.
   - Dasselbe auf einer Makler-Landingpage `https://virgoio.com/makler?slug=<dein-slug>`.

**Wenn etwas nicht klappt:** Kein Widget sichtbar → prüfe Browser-Konsole auf `/api/config`-Fehler. Der Site Key kommt von dort. `TURNSTILE_SITE_KEY` in Vercel prüfen und erneut deployen.

---

## 2. fal.ai freischalten (für Sprecher-Video-Pipeline)

**Zeitaufwand:** ~10 Minuten. **Kosten:** einmalige Aufladung, ab $20 sinnvoll.
**Was es tut:** fal.ai liefert die drei teuren Pipeline-Schritte Bild (FLUX), Video (Kling) und Lipsync (`sync-lipsync`). Ohne aufgeladenes Guthaben bricht die Pipeline sofort ab.

1. Öffne https://fal.ai/dashboard → Account erstellen (GitHub- oder E-Mail-Login).
2. **Billing** → **Add payment method** → Karte hinterlegen.
3. **Billing** → **Add credits** → **$20** oder **$50** (ein 5s-Video kostet ~$0,10–0,30 je nach Modell, damit hast du ~100+ Testläufe).
4. **API Keys** → **Create key** → Name z.B. `virgo-production`. Cloudflare-artiger Wert (`fal-…`). Wert kopieren.
5. In Vercel Env-Variable setzen:
   - Name `FAL_KEY`, Value = der eben kopierte Key, Environments: **Production + Preview**
6. (Optional, nur wenn du bestimmte Modell-Varianten willst — sonst nutzt der Code die Defaults aus `api/film.js`:)
   - `FAL_MODEL_IMAGE` = `fal-ai/flux/dev`
   - `FAL_MODEL_IMAGE_REF` = `fal-ai/flux-pro/kontext`
   - `FAL_MODEL_VIDEO` = `fal-ai/kling-video/v2.1/standard/image-to-video`
   - `FAL_MODEL_LIPSYNC` = `fal-ai/sync-lipsync`
7. **Spending Limit** setzen: fal.ai → **Billing** → **Spending limits** → z.B. `$50/Monat`. Das ist die letzte Verteidigungslinie, falls doch mal etwas aus dem Ruder läuft.
8. Vercel → letzten Deploy → **Redeploy**.

---

## 3. ElevenLabs auf Bezahl-Plan (für die Stimme im Sprecher-Video)

**Zeitaufwand:** ~5 Minuten. **Kosten:** ab $5/Monat (Starter).
**Was es tut:** ElevenLabs liefert die deutsche Sprecher-Stimme im Sprecher-Video und im TTS-Tool. Der Free Plan (10.000 Zeichen/Monat) reicht für erste Tests, geht aber unter aktiver Werbung schnell aus.

1. Öffne https://elevenlabs.io/subscription → einloggen.
2. **Starter** ($5/Monat, 30.000 Zeichen) oder **Creator** ($22/Monat, 100.000 Zeichen).
   - Für erste Live-Nutzung mit ein paar Kunden: Starter reicht.
   - Sobald Google/Meta-Ads laufen und mehrere Makler die Voice-Videos nutzen: Creator.
3. Karte hinterlegen, buchen.
4. **API Key** kontrollieren: **Profile** → **API Keys** → falls du den Key noch nicht in Vercel als `ELEVENLABS_API_KEY` gesetzt hast, jetzt setzen.
5. **Usage Limits** (falls verfügbar): unter dem Nutzer-Menü ein monatliches Zeichen-Limit setzen, das dem Plan entspricht.
6. Kein Redeploy nötig, wenn die Env-Variable schon gesetzt war.

---

## 4. Erster End-to-End-Testlauf für „Sprecher-Video" (durch Admin)

Nach Schritt 2 + 3 → einmal komplett durchlaufen, bevor die Beta öffentlich vorgestellt wird.

1. In `virgoio.com` mit dem **Admin-Account** einloggen (Admin ist von Credit-Abzug ausgenommen — kostet also nur echte fal-/ElevenLabs-Gebühren).
2. Linke Sidebar → **Sprecher-Video (Beta)**.
3. Testeingabe:
   - Charakter: „Freundlicher Versicherungsberater Mitte 40, dunkelblauer Anzug, im modernen Büro, natürliches Lächeln"
   - Ref-Bild optional
   - Skript: „Hallo, ich bin Max von Virgo. Ich helfe Ihnen dabei, die richtige Krankenversicherung zu finden — kostenlos und unverbindlich."
4. **Video generieren**.
5. Erwartet: Progress-Modal wandert durch **Schritt 1 → 2 → 3 → 4** (dauert insgesamt 3–6 Minuten). Am Ende erscheint das Video im Player.

**Fehlerbilder:**
- Sofortiger Fehler „nur in Bezahl-Plänen" → dein Admin-Account hat nicht die richtige `email` (Env `ADMIN_EMAIL` in Vercel prüfen).
- Fehler bei Schritt 1/2/4 mit fal-Meldung → fal.ai-Guthaben fehlt oder Karte abgelehnt.
- Fehler bei Schritt 3 → `ELEVENLABS_API_KEY` fehlt oder Free-Kontingent verbraucht.

Erst wenn ein echter Durchlauf funktioniert, im Marketing sichtbar bewerben.

---

## 5. Ausgaben-Caps final festziehen

Zur Sicherheit noch einmal überall Caps setzen — auch bei den Anbietern, die aktuell laufen:

- **Anthropic**: https://console.anthropic.com/settings/billing → Spend Limit → z.B. $100/Monat.
- **PiAPI**: aktuell nicht aufgeladen (~$9,80 Rest). Vor Marketing-Start entweder aufladen (Auto-Reload aus lassen!) oder in der App den Bild-Generator im Free-Plan-UI ausgrauen.
- **Cloudflare Turnstile**: kein Cap nötig — Free Tier reicht bis 1 Mio. Requests/Monat.

---

## 6. Ampel-Check vor der Kampagne

Wenn alle vier Punkte grün sind, ist die App bereit für Google-/Meta-Ads:

- [ ] Turnstile-Widget erscheint auf `pkv-check.html` und Makler-Landingpage
- [ ] Ein Test-Lead mit bestandener Turnstile-Challenge geht durch, ein Test-Lead ohne wird abgelehnt
- [ ] Sprecher-Video-Pipeline ist einmal komplett durchgelaufen (nur wenn du sie bewerben willst)
- [ ] Anthropic-, fal-, ElevenLabs-Spending-Caps sind gesetzt

Wenn Zeile 3 offen ist: **Sprecher-Video nicht bewerben**, aber alles andere darf live.

---

Bei Fragen zu einzelnen Schritten: sag Bescheid, welche Zeile klemmt.
