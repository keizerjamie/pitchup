-- ============================================================
-- Pitchup — M1: teams, teamleden en uitnodigingen (fase 1 "Fundament")
--
-- WANNEER DRAAIEN: VÓÓR deploy 1a (de deploy die getTeamContext() en
-- ctx.teamId introduceert). Run dit eenmalig in de Supabase SQL Editor.
--
-- Volgorde van de hele fase 1 — niet cosmetisch, omdraaien breekt de live app:
--   M1  supabase/teams-en-leden.sql            vóór deploy   (dit bestand)
--   M3a supabase/inzichten-team-id.sql         vóór deploy
--   M2b supabase/team-rls-gevolgacties.sql     vóór deploy
--       deploy: getTeamContext() + ctx.teamId + p_team_id + de vier RPC's
--   ==> BACKFILL (sectie 6 hieronder) NOGMAALS DRAAIEN, direct ná de deploy
--   M2  supabase/team-rls.sql                  ná  deploy
--   M3b supabase/inzichten-team-id-opruimen.sql ná deploy
--
-- DIE TWEEDE BACKFILL IS GEEN NETHEID. Tussen het draaien van dit script en de
-- afgeronde Vercel-deploy registreren er mogelijk accounts; die lopen nog door
-- de OUDE signUp en krijgen dus geen teams/team_members-rij. Na de deploy
-- zouden ze op 'Geen team' stuklopen. Sectie 6 is los uitvoerbaar (selecteer
-- alleen dat blok) en volledig idempotent (`on conflict do nothing`), dus hem
-- nog een keer draaien is altijd veilig.
--
-- Dit script wijzigt GEEN ENKELE bestaande policy. De live app draait tijdens
-- en na dit script ongewijzigd door op team_id = auth.uid(). De policies op de
-- drie NIEUWE tabellen staan hier wel al: zonder die policies zouden de
-- tabellen óf onbeschermd zijn (RLS uit = iedere geauthenticeerde gebruiker
-- kan zichzelf lid maken van een vreemd team), óf onleesbaar voor
-- getTeamContext() na deploy 1a. M2 herhaalt ze idempotent.
--
-- Kern van het ontwerp: teams.id van een BESTAAND team is gelijk aan de
-- user-id van de hoofdtrainer (zie de backfill onderaan). Daardoor is
-- is_team_member(team_id) na dit script exact even waar als
-- team_id = auth.uid() vandaag, en verandert er niets aan het gedrag.
--
-- Idempotent: alles is `if not exists` / `or replace` / `drop ... if exists`.
-- ============================================================

begin;

-- ── 1. teams ─────────────────────────────────────────────────
-- Bewust GEEN naam-kolom: de teamnaam staat al in settings onder de key
-- 'team_name' (supabase/settings.sql), geschreven door app/actions/auth.ts.
-- Een tweede bron zou meteen uit elkaar lopen.
-- Bewust GEEN owner_id-kolom: het eigenaarschap staat in team_members.rol en
-- "precies één hoofdtrainer per team" wordt afgedwongen met de partiële unique
-- index hieronder.
create table if not exists teams (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now()
);

comment on table teams is
  'Tenant-anker. teams.id van een team dat vóór deze migratie bestond is gelijk
   aan de user-id van de hoofdtrainer (backfill in supabase/teams-en-leden.sql).
   Nieuwe teams krijgen een eigen uuid. De teamnaam staat in settings.team_name.';

-- ── 2. team_members ──────────────────────────────────────────
-- Zes losse boolean-kolommen en geen JSONB: de businessregel legt precies zes
-- vlaggen vast, booleans geven een DB-gegarandeerde vorm en can_edit() heeft er
-- maar een korte `case` voor nodig. Een JSONB-kolom laat een typefout in een
-- sleutel stil doorglippen.
--
-- GEEN FK naar auth.users: het auth-schema is eigendom van Supabase; een FK
-- daarheen vanuit public is in de SQL Editor niet altijd toegestaan en koppelt
-- het datamodel aan intern Supabase-gedrag. Wezen worden opgeruimd door
-- deleteAccount (app/actions/auth.ts).
create table if not exists team_members (
  team_id                     uuid not null references teams(id) on delete cascade,
  user_id                     uuid not null,
  rol                         text not null check (rol in ('owner','assistent')),
  mag_spelers_bewerken        boolean not null default false,
  mag_agenda_bewerken         boolean not null default false,
  mag_aanwezigheid_bewerken   boolean not null default false,
  mag_wedstrijd_bewerken      boolean not null default false,
  mag_training_bewerken       boolean not null default false,
  mag_periodisering_bewerken  boolean not null default false,
  created_at                  timestamptz not null default now(),
  primary key (team_id, user_id)
);

-- Precies één hoofdtrainer per team, op databaseniveau.
create unique index if not exists team_members_een_owner_per_team
  on team_members (team_id) where rol = 'owner';

-- Dekt de lookup van getTeamContext(): alle lidmaatschappen van één gebruiker.
create index if not exists idx_team_members_user on team_members (user_id);

-- ── 3. team_invites ──────────────────────────────────────────
-- Alleen de HASH van het token wordt opgeslagen (sha256, hex). Het ruwe token
-- verlaat de server precies één keer: in het antwoord van createInvite. Een
-- DB-dump of logregel is daarmee onbruikbaar als toegangsmiddel.
--
-- TIJDZONE: verloopt_op is timestamptz (UTC) en wordt UITSLUITEND server-side
-- vergeleken met now() binnen accept_team_invite (M4, fase 2). Er komt nergens
-- een JS-Date aan te pas bij de geldigheidsbeslissing; de client krijgt de
-- ISO-string alleen om hem te TONEN.
create table if not exists team_invites (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references teams(id) on delete cascade,
  token_hash      text not null unique,
  aangemaakt_door uuid not null,
  created_at      timestamptz not null default now(),
  verloopt_op     timestamptz not null default (now() + interval '7 days'),
  gebruikt_op     timestamptz,
  gebruikt_door   uuid,
  ingetrokken_op  timestamptz
);

-- Er kan nooit meer dan één actieve uitnodiging per team bestaan.
create unique index if not exists team_invites_een_actief_per_team
  on team_invites (team_id)
  where gebruikt_op is null and ingetrokken_op is null;

-- ── 4. Helperfuncties ────────────────────────────────────────
-- SECURITY DEFINER is hier VERPLICHT, niet optioneel: een policy op
-- team_members die een security-invoker-functie aanroept die zelf team_members
-- leest, levert "infinite recursion detected in policy for relation
-- team_members" op. Dit zijn de eerste security-definer-functies in dit
-- project (supabase/inzichten.sql benadrukt juist invoker) — daarom staat
-- `set search_path = public` er verplicht bij en zijn de rechten expliciet
-- ingetrokken voor public/anon.
create or replace function public.is_team_member(p_team_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members m
                 where m.team_id = p_team_id and m.user_id = auth.uid());
$$;

create or replace function public.is_team_owner(p_team_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_members m
                 where m.team_id = p_team_id and m.user_id = auth.uid() and m.rol = 'owner');
$$;

-- VOOR EEN ASSISTENT valt een onbekend onderdeel DICHT (else false). Dat is wat
-- een toekomstig zevende onderdeel afdwingt zonder dat iemand deze functie
-- bijwerkt.
--
-- VOOR EEN HOOFDTRAINER NIET, en dat is ontworpen gedrag: `m.rol = 'owner' or
-- case ...` kortsluit vóór de case, dus een owner krijgt op ELK onderdeel true
-- — ook op een onbekend. Een hoofdtrainer mag per definitie alles in zijn eigen
-- team. Die kortsluiting is bovendien waar de bootstrap-INSERT-policy op
-- team_members op leunt (rand 1 daar): een owner-rij met alle zes vlaggen op
-- false is daardoor onschadelijk. Haal de kortsluiting nooit weg zonder die
-- policy mee te veranderen.
--
-- supabase/team-rls-verificatie.sql legt beide kanten vast: blok 1 dat een
-- owner true krijgt op een onbekend onderdeel, blok 3 dat een assistent false
-- krijgt.
create or replace function public.can_edit(p_team_id uuid, p_onderdeel text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members m
    where m.team_id = p_team_id and m.user_id = auth.uid()
      and (m.rol = 'owner' or case p_onderdeel
            when 'spelers'       then m.mag_spelers_bewerken
            when 'agenda'        then m.mag_agenda_bewerken
            when 'aanwezigheid'  then m.mag_aanwezigheid_bewerken
            when 'wedstrijd'     then m.mag_wedstrijd_bewerken
            when 'training'      then m.mag_training_bewerken
            when 'periodisering' then m.mag_periodisering_bewerken
            else false end));
$$;

-- settings is een generieke key/value-store met sleutels uit verschillende
-- onderdelen. Onbekende sleutel valt dicht op is_team_owner: alles wat hier
-- niet expliciet staat (team_name, team_logo_url, default_attendance,
-- team_color_*) is hoofdtrainer-werk.
create or replace function public.settings_key_editable(p_team_id uuid, p_key text) returns boolean
  language sql stable security definer set search_path = public as $$
  select case p_key
    when 'season_start'          then can_edit(p_team_id, 'agenda')
    when 'season_end'            then can_edit(p_team_id, 'agenda')
    when 'training_days'         then can_edit(p_team_id, 'agenda')
    when 'training_time'         then can_edit(p_team_id, 'agenda')
    when 'training_location'     then can_edit(p_team_id, 'agenda')
    when 'cyclus_week_correctie' then can_edit(p_team_id, 'periodisering')
    else is_team_owner(p_team_id)
  end;
$$;

revoke execute on function public.is_team_member(uuid), public.is_team_owner(uuid),
                          public.can_edit(uuid, text), public.settings_key_editable(uuid, text)
  from public, anon;
grant execute on function public.is_team_member(uuid), public.is_team_owner(uuid),
                         public.can_edit(uuid, text), public.settings_key_editable(uuid, text)
  to authenticated;

-- ── 5. RLS op de drie nieuwe tabellen ────────────────────────
-- Deze policies raken GEEN bestaande tabel en veranderen dus niets aan het
-- huidige gedrag. Ze zijn wél nodig vanaf deploy 1a, want getTeamContext()
-- leest team_members met de gewone gebruikerssessie.
alter table teams         enable row level security;
alter table team_members  enable row level security;
alter table team_invites  enable row level security;

drop policy if exists "teams: lid mag lezen" on teams;
create policy "teams: lid mag lezen" on teams for select
  using (is_team_member(id));

drop policy if exists "teams: owner mag wissen" on teams;
create policy "teams: owner mag wissen" on teams for delete
  using (is_team_owner(id));

-- BOOTSTRAP (fase 1) — hoort bij de fase-2-RPC create_team, die er nog niet is.
-- signUp (app/actions/auth.ts) moet na registratie zijn eigen teams-rij en
-- owner-rij kunnen aanmaken; anders belandt elk NIEUW account na deze migratie
-- in de lege staat. De check is zo smal mogelijk: het team-id MOET de eigen
-- user-id zijn, dus niemand kan hiermee een vreemd team aanmaken of zich aan
-- een bestaand team toevoegen.
--
-- WANNEER GAAN ZE WEG: pas NÁ de deploy van fase 2, via M5b
-- (supabase/team-bootstrap-policies-opruimen.sql). NIET in M5 zelf: tussen M5
-- (die create_team aanmaakt) en de deploy die signUp erop overzet, draait de
-- live app nog op deze policies. Ze te vroeg droppen breekt registratie —
-- exact dezelfde valkuil als bij M3a/M3b.
--
-- Twee randen, expliciet genoteerd:
--   1. De rechten-kolommen zitten NIET in de check, dus een gebruiker kan zijn
--      owner-rij met alle zes vlaggen op false aanmaken. Dat is onschadelijk
--      OMDAT can_edit() kortsluit op rol = 'owner' (zie die functie hierboven).
--      Wie die kortsluiting ooit weghaalt, breekt dit stilzwijgend.
--   2. De policy staat toe dat iemand die al assistent is bij een ander team
--      óók een eigen team <zijn user-id> aanmaakt. BR 51 (registratie via
--      uitnodiging levert geen eigen team) wordt afgedwongen door de CODE —
--      signUpViaInvite roept de teams-insert simpelweg niet aan. De policy is
--      hier de ondergrens, niet de businessregel.
--
-- LET OP BIJ EEN HERHAALDE RUN NA M5b: dit blok ZET DE POLICIES TERUG. Is M5b
-- al gedraaid (fase 2 staat live), sla dit blok dan over — of draai M5b erna
-- opnieuw. Ze terugzetten is niet direct gevaarlijk (een gebruiker kan er
-- alleen zijn EIGEN team <zijn user-id> mee maken), maar het opent wel weer de
-- weg waarlangs een half aangemaakt team kan ontstaan.
drop policy if exists "teams: eigen team bij registratie" on teams;
create policy "teams: eigen team bij registratie" on teams for insert
  to authenticated
  with check (id = auth.uid());

drop policy if exists "team_members: eigen owner-rij bij registratie" on team_members;
create policy "team_members: eigen owner-rij bij registratie" on team_members for insert
  to authenticated
  with check (user_id = auth.uid() and team_id = auth.uid() and rol = 'owner');

drop policy if exists "team_members: eigen rij of eigen team" on team_members;
create policy "team_members: eigen rij of eigen team" on team_members for select
  using (user_id = auth.uid() or is_team_owner(team_id));

-- rol = 'assistent' in insert/update sluit uit dat een hoofdtrainer zichzelf
-- degradeert of iemand anders promoveert. Owner-rijen ontstaan uitsluitend in
-- de backfill hieronder, de bootstrap-policy hierboven en (fase 2) create_team.
drop policy if exists "team_members: owner voegt assistent toe" on team_members;
create policy "team_members: owner voegt assistent toe" on team_members for insert
  with check (is_team_owner(team_id) and rol = 'assistent');

drop policy if exists "team_members: owner wijzigt rechten" on team_members;
create policy "team_members: owner wijzigt rechten" on team_members for update
  using (is_team_owner(team_id) and rol = 'assistent')
  with check (is_team_owner(team_id) and rol = 'assistent');

drop policy if exists "team_members: owner of vertrek" on team_members;
create policy "team_members: owner of vertrek" on team_members for delete
  using (rol = 'assistent' and (is_team_owner(team_id) or user_id = auth.uid()));

-- team_invites: insert/update lopen uitsluitend via de RPC's uit M4 (fase 2),
-- dus daar staat bewust geen policy voor.
drop policy if exists "team_invites: owner mag lezen" on team_invites;
create policy "team_invites: owner mag lezen" on team_invites for select
  using (is_team_owner(team_id));

drop policy if exists "team_invites: owner mag wissen" on team_invites;
create policy "team_invites: owner mag wissen" on team_invites for delete
  using (is_team_owner(team_id));

-- ── 6. Backfill — LOS UITVOERBAAR, DRAAI HEM TWEE KEER ───────
-- Eén keer als onderdeel van dit script (vóór deploy 1a) en nog één keer
-- direct ná de afgeronde deploy, om de accounts op te pikken die tussen die
-- twee momenten via de oude signUp zijn aangemaakt. Zie het kopcommentaar.
-- Selecteer voor die tweede ronde alleen de twee insert-statements hieronder;
-- de rest van dit script hoeft dan niet opnieuw.
--
-- Dit is de reden dat er geen enkele bestaande rij hoeft te verhuizen:
-- teams.id = de user-id van de hoofdtrainer, dus elke bestaande
-- .eq('team_id', user.id) blijft exact dezelfde rijen aanwijzen.
--
-- auth.users is de bron en NIET settings: een account dat destijds de
-- settings-insert miste (app/actions/auth.ts logt die fout en gaat door) zou
-- anders geen team krijgen en na deploy in de lege staat belanden.
insert into teams (id, created_at)
select u.id, coalesce(u.created_at, now())
from auth.users u
on conflict (id) do nothing;

insert into team_members (team_id, user_id, rol,
  mag_spelers_bewerken, mag_agenda_bewerken, mag_aanwezigheid_bewerken,
  mag_wedstrijd_bewerken, mag_training_bewerken, mag_periodisering_bewerken)
select u.id, u.id, 'owner', true, true, true, true, true, true
from auth.users u
on conflict (team_id, user_id) do nothing;

commit;

-- Optioneel; Supabase herlaadt de PostgREST-schemacache normaal zelf na DDL.
notify pgrst, 'reload schema';

-- ── 7. Controlequery — DRAAI DEZE NA AFLOOP ──────────────────
-- Draai hem twee keer: na dit script én na de tweede backfill-ronde.
-- Alle drie de getallen moeten gelijk zijn. Is dat niet zo, deploy 1a dan NIET:
-- een account zonder team belandt na de deploy in de lege staat.
--
-- select (select count(*) from auth.users) as accounts,
--        (select count(*) from teams)      as teams,
--        (select count(*) from team_members where rol = 'owner') as owners;
--
-- Tweede controle: elk bestaand team is van de hoofdtrainer zelf.
--
-- select count(*) as afwijkend
-- from team_members m
-- where m.rol = 'owner' and m.team_id <> m.user_id;
-- -- moet 0 zijn direct na deze migratie.
