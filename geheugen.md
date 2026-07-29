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

### Migraties (draaien in Supabase SQL Editor; alle vier zijn door de eigenaar uitgevoerd)
- `supabase/oefening-bibliotheek.sql` — bibliotheektabel + koppeltabel + backfill.
- `supabase/oefening-diagram.sql` — `diagram JSONB` kolom.
- `supabase/oefening-categorieen.sql` — categorie-CHECK verruimd met warming_up/positiespel/pass_trap.
- `supabase/oefening-spelerindeling.sql` — `spelerindeling JSONB` kolom op `training_oefeningen` (zie feature hieronder).

### Aandachtspunten / bewust geaccepteerd
- Server actions gooien nog rauwe DB-foutmeldingen door (`throw new Error(error.message)`) — codebase-breed patroon, niet door deze feature geïntroduceerd; ooit opschonen.
- De ruimere onzichtbare sleep-hitbox rond de (kleinere) spelers kan materiaal plaatsen vlak náást een speler lastig maken (speler vangt de tik).
- Demo-oefeningen aangemaakt tijdens testen: "7v7 positiespel opbouw" en "Pass- en trapvorm 4-hoek" (staan in de prod-DB; mogen weg).

## Feature: Teamindeling per trainingsoefening
Spelers koppelen aan de teams van een oefening, op de trainingsplan-pagina. Gebouwd via de feature-factory-keten (2026-07-29, live).

### Datamodel
- **`training_oefeningen.spelerindeling JSONB NOT NULL DEFAULT '[]'`** + CHECK `jsonb_typeof = 'array'`. Vorm: **array-van-arrays**; `spelerindeling[i]` = lijst `player_id`'s in team `i`, waarbij `i` = index in `oefeningen.teams`. Een `player_id` in geen enkele sub-array staat "in de pool".
- Bewust op de **koppeltabel**, niet op de bibliotheek-oefening: dezelfde oefening in twee trainingen heeft dus onafhankelijke indelingen (zelfde regel als `volgorde`/`stap_override`/`genest_in`).
- Gekozen boven een aparte koppeltabel omdat het `lineups.positions`-precedent al zo werkt (hele indeling in één write). Keerzijde: JSONB kan geen FK op `player_id` afdwingen — daarom valideert de server elke id (zie hieronder).

### Server action + pure lib
- **`saveSpelerindeling(koppelingId, eventId, spelerindeling)`** in `app/actions/training-plan.ts`. Keten: `Niet ingelogd` → `assertOwnEvent` → koppeling-select gescoped op `id + event_id + team_id` → eigen spelers als `ownPlayerIds` (**géén** `active`-filter, anders vallen inactief-geworden ingedeelde spelers eruit) → `validateSpelerindeling` → update gescoped op `id + team_id` → `revalidatePath`. Raakt nooit `oefeningen`.
- **`lib/spelerindeling.ts`** (puur, géén `'use server'`): `validateSpelerindeling` (tenant-check per id, teamIndex-grens, geen speler in twee teams) en `autoAssignTeams`.
- **Let op:** het bestaande `saveLineup` (`app/actions/attendance.ts`) valideert `player_id` NIET tegen de eigen spelers — dat lek is hier bewust niet herhaald, maar staat er nog wel.

### Auto-verdelen (`autoAssignTeams`)
- Spreidt **per positiegroep** via `POSITION_GROUPS` (`lib/types.ts`): keepers eerst, dan verdedigers/middenvelders/aanvallers; spelers zonder bekende positie vormen een laatste rest-groep.
- Implementatie: één sortering op `(positiegroep, rating desc, id)` gevolgd door één doorlopende snake-draft. **De snake loopt door over de groepsgrenzen heen** — begint elke groep opnieuw bij team 0, dan krijgt team 0 de beste van élke groep.
- Vult **alleen open plekken**; bestaande toewijzingen blijven. Overschot gaat naar teams **zonder** grootte (losse plaatsing, onbeperkt); zonder zo'n team blijft het overschot in de pool.
- Gevolg om te weten: het overschot bestaat nu uit de laatste positiegroepen, niet uit de laagst gerate spelers.

### UI (`components/TeamIndelingEditor.tsx`)
- Teamkaarten + pool met **alleen aanwezige** spelers (uit `attendance`); afwezigen zijn niet selecteerbaar. Autosave via `startTransition`, met rollback naar `lastConfirmedRef` en een eigen i18n-foutmelding (nooit de rauwe DB-fout).
- **Drag & drop via unified Pointer Events** (zelfde aanpak als `DiagramEditor`, werkt op touch), met tikken/klikken als alternatief — drempel `DRAG_THRESHOLD_PX = 6`.
- **Gotcha die live is opgetreden:** de dragstate moet in een **ref** staan, niet in `useState`. Komen `pointerdown` + `pointermove` in dezelfde React-batch binnen (snelle sleep in een echte browser), dan leest de move de state nog uit de oude closure → de sleep werd als klik afgehandeld. Vitest miste dit omdat elke event daar zijn eigen `act()` krijgt; de regressietest dispatcht ze nu in één `act()`.
- **Nooit stilzwijgend loskoppelen** — waarschuwen bij: afgemelde speler, inactieve/onbekende speler, team boven zijn grootte, en een verwijderd team (die spelers vallen terug in de pool). Een grootte-mismatch blokkeert een drop niet.
- `TrainingPlanEditor` geeft `initialIndeling={k.spelerindeling ?? EMPTY_INDELING}` door met een **module-constante** als fallback — een inline `[]` maakt elke render een nieuwe referentie en triggert het resync-blok onnodig.

### Bewust geaccepteerd
- De telling in `teamsRemovedWarning` telt alle id's uit weggevallen teams; niet elk daarvan wordt zichtbaar in de pool (een afwezige niet). Tekst is daarop aangepast i.p.v. de telling — anders zou het signaal verdwijnen als een verwijderd team alleen afwezigen bevatte.
- Een hard uit `players` verwijderde speler valt bij de eerstvolgende save uit de indeling (zijn id zit niet meer in `ownPlayerIds`). Inactief zetten (`active=false`) blijft wél bewaard.
- Formaties bevatten **altijd** een keeper (`position_label: 'K'`); er is geen keeperloze variant. Voor een positiespel kies je daarom simpelweg géén formatie. Notatie is inconsistent (`1-1` en `4-3-3` noemen de keeper niet, `2-0+K` wel) — bewust zo gelaten; hernoemen zou een backfill vergen omdat `formatie` als string in `oefeningen.teams` staat.
- `DiagramEditor` houdt zijn sleepstate ook in `useState` bij en kan dezelfde latente race hebben als hierboven; werkt in de praktijk, niet onderzocht.
