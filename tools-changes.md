# ÄNDERUNGEN IN tools.js — 3 gezielte Stellen

## ÄNDERUNG 1 — headline in makler-save

Suche:
const { name, firma, telefon, email, beschreibung, versicherungen, farbe, slug, header_image, alert_email, whatsapp_number } = body;

Ersetze durch:
const { name, firma, telefon, email, beschreibung, headline, versicherungen, farbe, slug, header_image, alert_email, whatsapp_number } = body;


## ÄNDERUNG 2 — headline in profileData speichern

Suche:
        header_image: header_image || null,
        alert_email: alert_email || null,

Ersetze durch:
        headline: headline ? headline.trim() : null,
        header_image: header_image || null,
        alert_email: alert_email || null,


## ÄNDERUNG 3 — Email Absender fixen

Suche:
        body: JSON.stringify({ from: 'Virgo AI <onboarding@resend.dev>', to, subject, html })

Ersetze durch:
        body: JSON.stringify({ from: 'Virgo AI <noreply@virgoio.com>', to, subject, html })

HINWEIS: Dafür muss virgoio.com auf Resend verifiziert sein.
Falls nicht verifiziert → vorerst bei onboarding@resend.dev lassen,
aber dann kann Resend nur an deine eigene Email senden.


## EMAIL PROBLEM — Warum der Makler keine Email bekam

Das Problem: Resend's "onboarding@resend.dev" Absender funktioniert
nur für E-Mails an die verifizierte Email des Resend-Accounts
(holyencore@gmail.com). Externe Adressen wie Jozef's Email werden
von Resend blockiert wenn keine eigene Domain verifiziert ist.

LÖSUNG:
1. Geh auf resend.com → Domains → virgoio.com verifizieren
2. DNS-Einträge bei Namecheap setzen (Resend zeigt dir welche)
3. Dann Änderung 3 oben anwenden: from = noreply@virgoio.com

ODER: Makler trägt ihre eigene Email als alert_email ein UND
du fügst diese Email als verified recipient in Resend hinzu.
