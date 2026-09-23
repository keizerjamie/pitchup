-- ============================================================
-- Pitchup — M2: RLS omzetten van team_id = auth.uid() naar lidmaatschap
--
-- WANNEER DRAAIEN: NÁ deploy 1a (de deploy die getTeamContext() en ctx.teamId
-- introduceert). Run dit eenmalig in de Supabase SQL Editor.
--
--   M1  supabase/teams-en-leden.sql            vóór deploy
--   M3a supabase/inzichten-team-id.sql         vóór deploy
--   M2b supabase/team-rls-gevolgacties.sql     vóór deploy
--       deploy
--   ==> backfill uit M1 sectie 6 nogmaals draaien, direct ná de deploy
--   M2  supabase/team-rls.sql                  ná  deploy   (dit bestand)
--   M3b supabase/inzichten-team-id-opruimen.sql ná deploy
--
-- NUL GEDRAGSVERANDERING, NUL DOWNTIME: op dit moment is elke gebruiker owner
-- van precies één team met teams.id = zijn user-id (backfill in M1), dus
-- is_team_member(team_id) is waar op exact dezelfde rijen als
-- team_id = auth.uid(), en can_edit(...) is waar voor elke owner.
--
-- LET OP — het scherpste migratierisico van deze feature: drie policy-sets
-- staan TWEE KEER in de repo (absence_periods, match_squad en de
-- storage-policies staan zowel in supabase/rls.sql als in hun eigen bestand).
-- Elke `drop policy if exists` hieronder noemt daarom BEIDE gangbare namen
-- ("<tabel>: team_id = auth.uid()" én "<tabel>: own team only"). Blijft er één
-- oude permissieve policy staan, dan ondermijnt die stilzwijgend de hele set:
-- permissive policies worden ge-OR'd.
--
-- Idempotent: alles is drop-if-exists + create.
-- ============================================================

begin;

-- ── players → onderdeel 'spelers' ────────────────────────────
drop policy if exists "players: team_id = auth.uid()" on players;
drop policy if exists "players: own team only"        on players;
drop policy if exists "players: lid mag lezen"        on players;
drop policy if exists "players: recht mag maken"      on players;
drop policy if exists "players: recht mag wijzigen"   on players;
drop policy if exists "players: recht mag wissen"     on players;

create policy "players: lid mag lezen"      on players for select using (is_team_member(team_id));
create policy "players: recht mag maken"    on players for insert with check (can_edit(team_id,'spelers'));
create policy "players: recht mag wijzigen" on players for update
  using (can_edit(team_id,'spelers')) with check (can_edit(team_id,'spelers'));
create policy "players: recht mag wissen"   on players for delete using (can_edit(team_id,'spelers'));

-- ── events → onderdeel 'agenda' ──────────────────────────────
-- Ja, ook wedstrijduitslagen en trainingsdoelstellingen staan op `events`. Een
-- policy kan niet per kolom beslissen; de hele tabel valt onder Agenda. De
-- applicatielaag is hier fijnmaziger (assertCanEdit met het juiste onderdeel).
drop policy if exists "events: team_id = auth.uid()" on events;
drop policy if exists "events: own team only"        on events;
drop policy if exists "events: lid mag lezen"        on events;
drop policy if exists "events: recht mag maken"      on events;
drop policy if exists "events: recht mag wijzigen"   on events;
drop policy if exists "events: recht mag wissen"     on events;

create policy "events: lid mag lezen"      on events for select using (is_team_member(team_id));
create policy "events: recht mag maken"    on events for insert with check (can_edit(team_id,'agenda'));
create policy "events: recht mag wijzigen" on events for update
  using (can_edit(team_id,'agenda')) with check (can_edit(team_id,'agenda'));
create policy "events: recht mag wissen"   on events for delete using (can_edit(team_id,'agenda'));

-- ── attendance → 'aanwezigheid', met gevolgacties ────────────
--
-- LET OP — DIT BLOK IS EEN WOORDELIJKE KOPIE VAN HET ATTENDANCE-BLOK IN
-- supabase/team-rls-gevolgacties.sql (M2b). DAT IS BEWUST EN MOET ZO BLIJVEN.
-- M2b draait vóór de deploy en M2 erna, dus M2 komt als laatste langs deze
-- tabel; stond hier de smallere variant, dan zou M2 de verruiming uit M2b
-- stilzwijgend terugdraaien. Door beide bestanden dezelfde policies te laten
-- schrijven is het eindresultaat gelijk, ongeacht de volgorde waarin ze
-- draaien — en werkt een verse installatie ook met alleen dit script.
-- Wijzig je hier iets, wijzig het dan in M2b mee (en andersom).
--
-- De motivering staat één keer, volledig, in M2b ("principe van afgeleide
-- macht"): INSERT ook via agenda (createEvent en broers zetten de
-- aanwezigheidsrijen van een nieuw event klaar), INSERT+UPDATE ook via spelers
-- (markInjured/markRecovered), DELETE strikt aanwezigheid.
drop policy if exists "attendance: team_id = auth.uid()" on attendance;
drop policy if exists "attendance: own team only"        on attendance;
drop policy if exists "attendance: lid mag lezen"        on attendance;
drop policy if exists "attendance: recht mag maken"      on attendance;
drop policy if exists "attendance: recht mag wijzigen"   on attendance;
drop policy if exists "attendance: recht mag wissen"     on attendance;

create policy "attendance: lid mag lezen" on attendance for select
  using (is_team_member(team_id));

create policy "attendance: recht mag maken" on attendance for insert
  with check (
    can_edit(team_id, 'aanwezigheid')
    or can_edit(team_id, 'agenda')
    or can_edit(team_id, 'spelers')
  );

create policy "attendance: recht mag wijzigen" on attendance for update
  using (can_edit(team_id, 'aanwezigheid') or can_edit(team_id, 'spelers'))
  with check (can_edit(team_id, 'aanwezigheid') or can_edit(team_id, 'spelers'));

create policy "attendance: recht mag wissen" on attendance for delete
  using (can_edit(team_id, 'aanwezigheid'));

-- ── absence_periods → onderdeel 'aanwezigheid' ───────────────
-- DUBBELE OPNAME: supabase/rls.sql én supabase/absence-periods.sql.
drop policy if exists "absence_periods: own team only"        on absence_periods;
drop policy if exists "absence_periods: team_id = auth.uid()" on absence_periods;
drop policy if exists "absence_periods: lid mag lezen"        on absence_periods;
drop policy if exists "absence_periods: recht mag maken"      on absence_periods;
drop policy if exists "absence_periods: recht mag wijzigen"   on absence_periods;
drop policy if exists "absence_periods: recht mag wissen"     on absence_periods;

create policy "absence_periods: lid mag lezen"      on absence_periods for select using (is_team_member(team_id));
create policy "absence_periods: recht mag maken"    on absence_periods for insert with check (can_edit(team_id,'aanwezigheid'));
create policy "absence_periods: recht mag wijzigen" on absence_periods for update
  using (can_edit(team_id,'aanwezigheid')) with check (can_edit(team_id,'aanwezigheid'));
create policy "absence_periods: recht mag wissen"   on absence_periods for delete using (can_edit(team_id,'aanwezigheid'));

-- ── lineups → onderdeel 'wedstrijd' ──────────────────────────
drop policy if exists "lineups: team_id = auth.uid()" on lineups;
drop policy if exists "lineups: own team only"        on lineups;
drop policy if exists "lineups: lid mag lezen"        on lineups;
drop policy if exists "lineups: recht mag maken"      on lineups;
drop policy if exists "lineups: recht mag wijzigen"   on lineups;
drop policy if exists "lineups: recht mag wissen"     on lineups;

create policy "lineups: lid mag lezen"      on lineups for select using (is_team_member(team_id));
create policy "lineups: recht mag maken"    on lineups for insert with check (can_edit(team_id,'wedstrijd'));
create policy "lineups: recht mag wijzigen" on lineups for update
  using (can_edit(team_id,'wedstrijd')) with check (can_edit(team_id,'wedstrijd'));
create policy "lineups: recht mag wissen"   on lineups for delete using (can_edit(team_id,'wedstrijd'));

-- ── match_ratings → onderdeel 'wedstrijd' ────────────────────
drop policy if exists "match_ratings: own team only"        on match_ratings;
drop policy if exists "match_ratings: team_id = auth.uid()" on match_ratings;
drop policy if exists "match_ratings: lid mag lezen"        on match_ratings;
drop policy if exists "match_ratings: recht mag maken"      on match_ratings;
drop policy if exists "match_ratings: recht mag wijzigen"   on match_ratings;
drop policy if exists "match_ratings: recht mag wissen"     on match_ratings;

create policy "match_ratings: lid mag lezen"      on match_ratings for select using (is_team_member(team_id));
create policy "match_ratings: recht mag maken"    on match_ratings for insert with check (can_edit(team_id,'wedstrijd'));
create policy "match_ratings: recht mag wijzigen" on match_ratings for update
  using (can_edit(team_id,'wedstrijd')) with check (can_edit(team_id,'wedstrijd'));
create policy "match_ratings: recht mag wissen"   on match_ratings for delete using (can_edit(team_id,'wedstrijd'));

-- ── match_events → onderdeel 'wedstrijd' ─────────────────────
drop policy if exists "match_events: own team only"        on match_events;
drop policy if exists "match_events: team_id = auth.uid()" on match_events;
drop policy if exists "match_events: lid mag lezen"        on match_events;
drop policy if exists "match_events: recht mag maken"      on match_events;
drop policy if exists "match_events: recht mag wijzigen"   on match_events;
drop policy if exists "match_events: recht mag wissen"     on match_events;

create policy "match_events: lid mag lezen"      on match_events for select using (is_team_member(team_id));
create policy "match_events: recht mag maken"    on match_events for insert with check (can_edit(team_id,'wedstrijd'));
create policy "match_events: recht mag wijzigen" on match_events for update
  using (can_edit(team_id,'wedstrijd')) with check (can_edit(team_id,'wedstrijd'));
create policy "match_events: recht mag wissen"   on match_events for delete using (can_edit(team_id,'wedstrijd'));

-- ── match_squad → onderdeel 'wedstrijd' ──────────────────────
-- DUBBELE OPNAME: supabase/rls.sql én supabase/match-squad.sql.
drop policy if exists "match_squad: own team only"        on match_squad;
drop policy if exists "match_squad: team_id = auth.uid()" on match_squad;
drop policy if exists "match_squad: lid mag lezen"        on match_squad;
drop policy if exists "match_squad: recht mag maken"      on match_squad;
drop policy if exists "match_squad: recht mag wijzigen"   on match_squad;
drop policy if exists "match_squad: recht mag wissen"     on match_squad;

create policy "match_squad: lid mag lezen"      on match_squad for select using (is_team_member(team_id));
create policy "match_squad: recht mag maken"    on match_squad for insert with check (can_edit(team_id,'wedstrijd'));
create policy "match_squad: recht mag wijzigen" on match_squad for update
  using (can_edit(team_id,'wedstrijd')) with check (can_edit(team_id,'wedstrijd'));
create policy "match_squad: recht mag wissen"   on match_squad for delete using (can_edit(team_id,'wedstrijd'));

-- ── task_overrides → Training of Wedstrijd, per task_type ────
-- Het afvinken van "trainingsplan klaar" hoort bij Training; squad/lineup/
-- analysis horen bij Wedstrijd. Anders dan bij de tabellen hierboven KAN dat
-- hier wel per rij, want de scheidslijn zit in een kolomwaarde.
drop policy if exists "task_overrides: own team only"        on task_overrides;
drop policy if exists "task_overrides: team_id = auth.uid()" on task_overrides;
drop policy if exists "task_overrides: lid mag lezen"        on task_overrides;
drop policy if exists "task_overrides: recht mag maken"      on task_overrides;
drop policy if exists "task_overrides: recht mag wijzigen"   on task_overrides;
drop policy if exists "task_overrides: recht mag wissen"     on task_overrides;

create policy "task_overrides: lid mag lezen" on task_overrides for select using (is_team_member(team_id));
create policy "task_overrides: recht mag maken" on task_overrides for insert
  with check (can_edit(team_id, case task_type when 'training_plan' then 'training' else 'wedstrijd' end));
create policy "task_overrides: recht mag wijzigen" on task_overrides for update
  using (can_edit(team_id, case task_type when 'training_plan' then 'training' else 'wedstrijd' end))
  with check (can_edit(team_id, case task_type when 'training_plan' then 'training' else 'wedstrijd' end));
create policy "task_overrides: recht mag wissen" on task_overrides for delete
  using (can_edit(team_id, case task_type when 'training_plan' then 'training' else 'wedstrijd' end));

-- ── metingen → onderdeel 'periodisering' ─────────────────────
drop policy if exists "metingen: own team only"        on metingen;
drop policy if exists "metingen: team_id = auth.uid()" on metingen;
drop policy if exists "metingen: lid mag lezen"        on metingen;
drop policy if exists "metingen: recht mag maken"      on metingen;
drop policy if exists "metingen: recht mag wijzigen"   on metingen;
drop policy if exists "metingen: recht mag wissen"     on metingen;

create policy "metingen: lid mag lezen"      on metingen for select using (is_team_member(team_id));
create policy "metingen: recht mag maken"    on metingen for insert with check (can_edit(team_id,'periodisering'));
create policy "metingen: recht mag wijzigen" on metingen for update
  using (can_edit(team_id,'periodisering')) with check (can_edit(team_id,'periodisering'));
create policy "metingen: recht mag wissen"   on metingen for delete using (can_edit(team_id,'periodisering'));

-- ── categorie_metingen → onderdeel 'periodisering' ───────────
drop policy if exists "categorie_metingen: own team only"        on categorie_metingen;
drop policy if exists "categorie_metingen: team_id = auth.uid()" on categorie_metingen;
drop policy if exists "categorie_metingen: lid mag lezen"        on categorie_metingen;
drop policy if exists "categorie_metingen: recht mag maken"      on categorie_metingen;
drop policy if exists "categorie_metingen: recht mag wijzigen"   on categorie_metingen;
drop policy if exists "categorie_metingen: recht mag wissen"     on categorie_metingen;

create policy "categorie_metingen: lid mag lezen"      on categorie_metingen for select using (is_team_member(team_id));
create policy "categorie_metingen: recht mag maken"    on categorie_metingen for insert with check (can_edit(team_id,'periodisering'));
create policy "categorie_metingen: recht mag wijzigen" on categorie_metingen for update
  using (can_edit(team_id,'periodisering')) with check (can_edit(team_id,'periodisering'));
create policy "categorie_metingen: recht mag wissen"   on categorie_metingen for delete using (can_edit(team_id,'periodisering'));

-- ── training_oefeningen → onderdeel 'training' ───────────────
-- Ook stap_override staat op deze tabel en is inhoudelijk periodisering. Een
-- policy kan niet per kolom beslissen en het veld wordt op de
-- trainingsplan-pagina bewerkt: de hele tabel valt onder Training (bevestigd
-- besluit van de eigenaar).
drop policy if exists "training_oefeningen: own team only"        on training_oefeningen;
drop policy if exists "training_oefeningen: team_id = auth.uid()" on training_oefeningen;
drop policy if exists "training_oefeningen: lid mag lezen"        on training_oefeningen;
drop policy if exists "training_oefeningen: recht mag maken"      on training_oefeningen;
drop policy if exists "training_oefeningen: recht mag wijzigen"   on training_oefeningen;
drop policy if exists "training_oefeningen: recht mag wissen"     on training_oefeningen;

create policy "training_oefeningen: lid mag lezen"      on training_oefeningen for select using (is_team_member(team_id));
create policy "training_oefeningen: recht mag maken"    on training_oefeningen for insert with check (can_edit(team_id,'training'));
create policy "training_oefeningen: recht mag wijzigen" on training_oefeningen for update
  using (can_edit(team_id,'training')) with check (can_edit(team_id,'training'));
create policy "training_oefeningen: recht mag wissen"   on training_oefeningen for delete using (can_edit(team_id,'training'));

-- ── settings → per SLEUTEL ───────────────────────────────────
-- settings is een key/value-store met sleutels uit verschillende onderdelen.
-- settings_key_editable() splitst dat: agenda-sleutels onder Agenda,
-- cyclus_week_correctie onder Periodisering, al het overige (team_name,
-- team_logo_url, default_attendance, team_color_*) bij de hoofdtrainer.
--
-- LET OP voor toekomstige wijzigingen: saveScheduleSettings
-- (app/actions/settings.ts) upsert vijf agenda-sleutels in één call. De
-- with check wordt per rij geëvalueerd; alle vijf vallen onder 'agenda', dus
-- dat blijft werken. Voeg nooit een sleutel van een ander onderdeel aan die
-- batch toe.
drop policy if exists "settings: team_id = auth.uid()" on settings;
drop policy if exists "settings: own team only"        on settings;
drop policy if exists "settings: lid mag lezen"        on settings;
drop policy if exists "settings: recht mag maken"      on settings;
drop policy if exists "settings: recht mag wijzigen"   on settings;
drop policy if exists "settings: recht mag wissen"     on settings;

create policy "settings: lid mag lezen"      on settings for select using (is_team_member(team_id));
create policy "settings: recht mag maken"    on settings for insert with check (settings_key_editable(team_id, key));
create policy "settings: recht mag wijzigen" on settings for update
  using (settings_key_editable(team_id, key)) with check (settings_key_editable(team_id, key));
create policy "settings: recht mag wissen"   on settings for delete using (settings_key_editable(team_id, key));

-- ── oefeningen: BEWUST ONGEWIJZIGD ───────────────────────────
-- "oefeningen: own team only" (team_id = auth.uid()) blijft precies zoals hij
-- is. oefeningen.team_id betekent EIGENAAR-USER, geen teams.id: oefeningen
-- zijn persoonlijk bezit en verhuizen niet met het actieve team mee. De
-- verbreding van de LEESBAARHEID via een gekoppeld trainingsplan komt pas in
-- fase 4 (supabase/oefeningen-persoonlijk.sql). Niets doen is hier de
-- bedoeling — niet vergeten, maar bewust.

-- ── teams / team_members / team_invites ──────────────────────
-- Staan al in M1 (supabase/teams-en-leden.sql) omdat getTeamContext() ze vanaf
-- deploy 1a nodig heeft. Hier idempotent herhaald zodat dit bestand de
-- volledige policy-set van de app beschrijft.
alter table teams         enable row level security;
alter table team_members  enable row level security;
alter table team_invites  enable row level security;

drop policy if exists "teams: lid mag lezen" on teams;
create policy "teams: lid mag lezen" on teams for select using (is_team_member(id));

drop policy if exists "teams: owner mag wissen" on teams;
create policy "teams: owner mag wissen" on teams for delete using (is_team_owner(id));

-- Fase-1-bootstrap voor signUp. Verdwijnt pas NÁ de deploy van fase 2, via M5b
-- (supabase/team-bootstrap-policies-opruimen.sql) — niet in M5 zelf, want tussen
-- M5 en die deploy draait de live app nog op deze policies. Zie het uitgebreide
-- commentaar in supabase/teams-en-leden.sql voor de twee randen.
--
-- LET OP BIJ EEN HERHAALDE RUN NA M5b: dit blok ZET DE POLICIES TERUG. Is M5b
-- al gedraaid (fase 2 staat live), sla dit blok dan over — of draai M5b erna
-- opnieuw. Ze terugzetten is niet direct gevaarlijk (een gebruiker kan er
-- alleen zijn EIGEN team <zijn user-id> mee maken), maar het opent wel weer de
-- weg waarlangs een half aangemaakt team kan ontstaan.
drop policy if exists "teams: eigen team bij registratie" on teams;
create policy "teams: eigen team bij registratie" on teams for insert
  to authenticated with check (id = auth.uid());

drop policy if exists "team_members: eigen owner-rij bij registratie" on team_members;
create policy "team_members: eigen owner-rij bij registratie" on team_members for insert
  to authenticated with check (user_id = auth.uid() and team_id = auth.uid() and rol = 'owner');

drop policy if exists "team_members: eigen rij of eigen team" on team_members;
create policy "team_members: eigen rij of eigen team" on team_members for select
  using (user_id = auth.uid() or is_team_owner(team_id));

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

drop policy if exists "team_invites: owner mag lezen" on team_invites;
create policy "team_invites: owner mag lezen" on team_invites for select
  using (is_team_owner(team_id));

drop policy if exists "team_invites: owner mag wissen" on team_invites;
create policy "team_invites: owner mag wissen" on team_invites for delete
  using (is_team_owner(team_id));

commit;

-- ── storage.objects (bucket team-logos) ──────────────────────
-- Buiten de transactie hierboven: deze policies staan op een tabel van de
-- interne supabase_storage_admin-rol.
--
-- DUBBELE OPNAME: dezelfde vier policy-namen staan zowel in supabase/rls.sql
-- als in supabase/team-logo.sql. Eén drop per naam ruimt beide op.
--
-- GEEN "alter table storage.objects enable row level security": die tabel is
-- eigendom van supabase_storage_admin, dus de SQL Editor mag dat niet
-- uitvoeren ("must be owner of table objects"). Niet nodig ook: RLS staat daar
-- in elk Supabase-project al aan.
--
-- De padconventie team-logos/<team_id>/logo (lib/logo-upload.ts) blijft
-- ongewijzigd; alleen de BETEKENIS van <team_id> verschuift van auth.uid()
-- naar teams.id — voor bestaande teams dezelfde waarde.
--
-- LET OP de richting van de cast: m.team_id::text = (storage.foldername(name))[1]
-- en NIET (storage.foldername(name))[1]::uuid = m.team_id. Die omgekeerde cast
-- gooit een fout zodra er ooit een object met een niet-uuid eerste padsegment
-- in de bucket staat, en een fout in een policy is geen `false` maar een harde
-- 500.

drop policy if exists "team-logos: insert own folder"     on storage.objects;
drop policy if exists "team-logos: owner schrijft teammap" on storage.objects;
create policy "team-logos: owner schrijft teammap" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'team-logos'
    and exists (
      select 1 from team_members m
      where m.user_id = auth.uid() and m.rol = 'owner'
        and m.team_id::text = (storage.foldername(name))[1]
    )
  );

-- Een upload met upsert:true op een BESTAAND object is een UPDATE, geen
-- INSERT: zonder deze policy zou alleen de eerste upload slagen.
drop policy if exists "team-logos: update own folder"      on storage.objects;
drop policy if exists "team-logos: owner vervangt teammap" on storage.objects;
create policy "team-logos: owner vervangt teammap" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'team-logos'
    and exists (
      select 1 from team_members m
      where m.user_id = auth.uid() and m.rol = 'owner'
        and m.team_id::text = (storage.foldername(name))[1]
    )
  )
  with check (
    bucket_id = 'team-logos'
    and exists (
      select 1 from team_members m
      where m.user_id = auth.uid() and m.rol = 'owner'
        and m.team_id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists "team-logos: delete own folder"    on storage.objects;
drop policy if exists "team-logos: owner wist teammap"   on storage.objects;
create policy "team-logos: owner wist teammap" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'team-logos'
    and exists (
      select 1 from team_members m
      where m.user_id = auth.uid() and m.rol = 'owner'
        and m.team_id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists "team-logos: select own folder" on storage.objects;
drop policy if exists "team-logos: lid leest teammap" on storage.objects;
create policy "team-logos: lid leest teammap" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'team-logos'
    and exists (
      select 1 from team_members m
      where m.user_id = auth.uid()
        and m.team_id::text = (storage.foldername(name))[1]
    )
  );

notify pgrst, 'reload schema';

-- ── Controle na afloop ───────────────────────────────────────
-- 1. Geen enkele oude policy mag zijn blijven staan:
--
-- select tablename, policyname, cmd
-- from pg_policies
-- where schemaname = 'public'
--   and (qual like '%auth.uid()%' or with_check like '%auth.uid()%')
--   and tablename <> 'oefeningen'          -- oefeningen blijft bewust op auth.uid()
--   and tablename not in ('teams','team_members')  -- bootstrap-policies
-- order by tablename, policyname;
-- -- moet 0 rijen geven.
--
-- 2. Elke tabel heeft RLS aan:
--
-- select tablename, rowsecurity from pg_tables
-- where schemaname = 'public' order by tablename;
--
-- 3. Draai daarna supabase/team-rls-verificatie.sql.
