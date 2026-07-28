# Projectgeheugen — Pitchup (team-tracker)

Kernpunten over dit project, opgebouwd per sessie. Vul aan; verwijder niets zonder reden.

## Project & stack
- **Next.js App Router + Supabase.** Repo: github.com/keizerjamie/pitchup.
- **Deploy:** elke `git push` naar `main` triggert automatisch een Vercel-deploy (prod). Zie `DEPLOY.md`. `.env.local` is gitignored (Supabase-keys gaan niet mee).
- **Tenant-isolatie altijd:** RLS `team_id = auth.uid()` op elke tabel, én expliciete `.eq('team_id', user.id)` in elke query/insert/update/delete. Guards tegen forged id's in `lib/authz.ts` (`assertOwnEvent`, `assertOwnPlayer`, `assertOwnOefening`).
- **i18n:** `messages/{nl,en,de,fr,es}.ts`; `nl.ts` is leidend, `Dict = typeof nl`. Elke nieuwe UI-string in alle 5 bestanden. Client: `useDict()`, server: `getDict()`.
- **Theming:** licht/donker via CSS-variabelen in `app/globals.css`, omgeschakeld met `:root[data-theme="dark"]`. Gebruik thema-utilities: `text-ink`/`text-muted`/`text-faint`, `bg-surface`/`bg-surface-sunken`, `border-[var(--border-soft)]`. **Nooit hardcoded `text-gray-*`/`bg-white`** — dat breekt dark mode (is een keer misgegaan).
- **Responsive-conventie:** container `max-w-2xl lg:max-w-6xl mx-auto px-4 lg:px-8`, `lg:grid`; sheet/modal `rounded-t-3xl sm:rounded-2xl` (bottom-sheet mobiel / gecentreerd desktop); oranje accent voor acties.

## Tests & checks
- **Vitest + @testing-library (jsdom)**: `npm test`. `vitest.config.ts` beperkt tot `*.test.ts(x)` zodat de losse `scripts/*.test.mjs` (node:test) niet meelopen.
- `npm run typecheck` (= `tsc --noEmit`), `npm run lint` (eslint), `npm run smoke` (dependency-vrij smoke-script tegen een draaiende server).
- **Let op:** vitest draait BUITEN de Next/Turbopack-compiler. Runtime-fouten die alleen bij het compileren van `'use server'`-bestanden ontstaan, worden dus NIET door de tests gevangen — check zulke dingen in de echte app.

## Belangrijke gotchas
- **`'use server'`-bestanden mogen alleen async functies exporteren.** Een `export type { X }` (type re-export) uit een server-action-bestand lekt in Turbopack als runtime-verwijzing → `X is not defined` bij het aanroepen van de action. Typecheck ziet dit niet. Importeer types rechtstreeks uit hun bron (`@/lib/...`), niet via de action-bestanden.
- Bij een type-contractwijziging die een verplicht veld toevoegt, moeten bestaande testfixtures dat veld krijgen (anders faalt typecheck).

## Feature: Trainingsplanner — oefeningen-bibliotheek + tactiekbord
Gebouwd via de feature-factory-keten (researcher → story → PM → backend → frontend → test-verifier → validator), met goedkeuringspauzes.

### Datamodel
- **`oefeningen`** = herbruikbare **bibliotheektabel** (los van een training), analoog aan `players`. Kolommen o.a.: `naam`, `beschrijving`, `categorie`, `duur_min`, `breedte_m`/`lengte_m`, `orientatie`, `veldzone`, `teams JSONB` (lijst `{grootte, formatie|null}`, max 6), `aantal_neutralen SMALLINT` (0..30), `diagram JSONB` (nullable; NULL = geen opgeslagen tekening → auto-genereren).
- **`training_oefeningen`** = koppeltabel training↔oefening (analoog aan `attendance`): `event_id`, `oefening_id`, `UNIQUE(event_id, oefening_id)`, plus de **training-specifieke** velden `volgorde`, `stap_override`, `genest_in` (self-FK). Deze horen bij de koppeling, niet bij de bibliotheek-oefening (anders lekt een wijziging door naar andere trainingen).
- **Live gekoppeld:** een wijziging aan een bibliotheek-oefening werkt overal door (geen snapshot). `updateOefening` revalideert `/oefeningen` én elke gekoppelde training-plan-pagina.
- **Periodisering** (`lib/periodization.ts`) telt via een join over `training_oefeningen → oefeningen(categorie)`; `hasMeting`/`cycleWeeks` bepalen of een categorie meetelt in de stap-berekening. Dit was het grootste migratierisico — semantiek is bewust identiek gehouden.

### Categorieën (`PERIODIZATION_CATEGORIES` in `lib/types.ts`)
- Meting-categorieën (`hasMeting:true`): partijen_groot/midden/klein, sprints_weinig_rust, sprints_veel_rust.
- Non-meting (`hasMeting:false`, geen stap/nulmeting): steigerungs, overig, **warming_up, positiespel, pass_trap**.
- Categorie zit met een CHECK-constraint in de DB (`oefeningen_categorie_check`) — nieuwe categorie = migratie nodig.

### Tekening / tactiekbord (`diagram`)
- Pure functies in **`lib/diagram.ts`**: `generateDiagram(teams, aantalNeutralen, veldzone, ...)` (auto-opzet: 2 teams gespiegeld tegenover elkaar `y'=140−y`/`x'=100−x`, 1 team eigen helft, 3+ in banden; team **zonder** formatie → losse plaatsing zonder labels; neutralen apart) en `validateDiagram` (tolerante server-side normalisatie: clamp coords `0-100 × 0-140`, whitelist typen/stijlen/varianten, strip onbekende velden, maxima). Constanten `DIAGRAM_MAX_*`.
- Model: `Diagram { markers, materiaal, lijnen }`. Marker `{x,y,teamIndex,rol,label?}` (kleur uit rol+teamIndex; team0=licht, team1=oranje, neutraal=geel, keeper=rood accent). Materiaal `{type:'pion'|'bal'|'doeltje', x, y, variant?}` (doeltje-varianten groot/klein/mini). Lijn `{stijl:'pass'|'loop'|'dribbel', punten:{x,y}[]}` (min 2 punten; pass=doorgetrokken, loop=gestippeld, dribbel=golvend).
- UI: `DiagramEditor` (unified Pointer Events + `touch-action:none`, tools select/speler/pion/bal/doeltje/lijn/verwijder, kleur-/variant-keuze via segmented controls, "Opnieuw genereren" met bevestiging), read-only `DiagramView` (kaart + trainingsschema, fallback op per-team `FormationField` als `diagram==null`), gedeeld `PitchBackground` + `DiagramElements`. Coördinatenstelsel = SVG viewBox `0 0 100 140`.
- **Markers zijn vrij bewerkbaar**: toevoegen (speler-tool met kleurkeuze), verslepen, verwijderen. Teams+formaties zijn alleen het startpunt voor (opnieuw) genereren. Opslaan zonder team is mogelijk.

### Migraties (draaien in Supabase SQL Editor; alle drie zijn door de eigenaar uitgevoerd)
- `supabase/oefening-bibliotheek.sql` — bibliotheektabel + koppeltabel + backfill.
- `supabase/oefening-diagram.sql` — `diagram JSONB` kolom.
- `supabase/oefening-categorieen.sql` — categorie-CHECK verruimd met warming_up/positiespel/pass_trap.

### Aandachtspunten / bewust geaccepteerd
- Server actions gooien nog rauwe DB-foutmeldingen door (`throw new Error(error.message)`) — codebase-breed patroon, niet door deze feature geïntroduceerd; ooit opschonen.
- De ruimere onzichtbare sleep-hitbox rond de (kleinere) spelers kan materiaal plaatsen vlak náást een speler lastig maken (speler vangt de tik).
- Demo-oefeningen aangemaakt tijdens testen: "7v7 positiespel opbouw" en "Pass- en trapvorm 4-hoek" (staan in de prod-DB; mogen weg).
