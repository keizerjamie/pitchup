# Pitchup online zetten (Vercel)

De Supabase-database staat al online; alleen de Next.js-app moet nog gehost
worden. Gratis via Vercel. Eenmalig opzetten, daarna deployt elke `git push`
automatisch.

## 1. Code naar GitHub

Je hebt een (gratis) GitHub-account nodig.

1. Maak op https://github.com/new een **lege, private** repo aan, bijv. `pitchup`.
   Vink NIET "Add a README" aan.
2. Koppel en push vanuit deze map:

   ```bash
   git remote add origin https://github.com/<jouw-gebruikersnaam>/pitchup.git
   git push -u origin main
   ```

`.env.local` staat in `.gitignore`, dus je Supabase-keys gaan **niet** mee.

## 2. Importeren in Vercel

Je hebt een (gratis) Vercel-account nodig — log in met je GitHub-account.

1. https://vercel.com/new → kies je `pitchup`-repo → **Import**.
2. Framework wordt automatisch herkend als **Next.js**. Niets aanpassen.
3. Onder **Environment Variables** twee variabelen toevoegen (waarden staan in
   je lokale `.env.local`):

   | Name | Value |
   |------|-------|
   | `NEXT_PUBLIC_SUPABASE_URL` | (kopieer uit `.env.local`) |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (kopieer uit `.env.local`) |

4. **Deploy**. Na ~1 minuut krijg je een URL zoals `https://pitchup-xxx.vercel.app`.

## 3. Supabase laten weten waar de app draait

In je Supabase-dashboard → **Authentication** → **URL Configuration**:

- **Site URL**: je Vercel-URL (`https://pitchup-xxx.vercel.app`)
- **Redirect URLs**: voeg toe `https://pitchup-xxx.vercel.app/reset-password`

Anders werkt de wachtwoord-herstelmail niet op de live-site.

## 4. Op je iPhone

1. Open de Vercel-URL in **Safari**.
2. Deel-knop → **Zet op beginscherm**.
3. Pitchup verschijnt als app-icoon en opent schermvullend, als een echte app.

## Later (optioneel)

- **Volledige account-verwijdering**: voeg in Vercel de env var
  `SUPABASE_SERVICE_ROLE_KEY` toe (Supabase → Project Settings → API →
  `service_role` key). Server-only; nooit in de code.
- **Database sneller**: draai `supabase/performance-indexes.sql` eenmalig in de
  Supabase SQL Editor.
- **E-mail (registratie/wachtwoord-reset)**: koppel een SMTP-provider (Resend of
  Postmark) in Supabase → Authentication → Emails. De ingebouwde mailserver is
  niet voor productie bedoeld.

## Toekomstige wijzigingen

Elke `git push` naar `main` triggert automatisch een nieuwe deploy op Vercel.
