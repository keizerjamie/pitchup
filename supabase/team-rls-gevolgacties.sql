-- ============================================================
-- Pitchup — M2b: gevolgschrijfacties (brief §8, addendum)
--
-- WANNEER DRAAIEN: VÓÓR de deploy van fase 1, direct na M1. Run dit eenmalig
-- in de Supabase SQL Editor.
--
-- WAAROM VÓÓR DE DEPLOY EN NIET LATER: de fase-1-code roept de vier RPC's uit
-- dit script al aan (saveDoelstelling, saveMatchResult, updateGatherTime,
-- updateTrainingstype). Bestaan ze nog niet, dan geeft elke aanroep PGRST202
-- en ziet de gebruiker "Er ging iets mis".
--
-- DIT SCRIPT KAN ZELFSTANDIG DIRECT NA M1 DRAAIEN: het hangt alleen aan
-- can_edit() en is_team_member() uit M1. De attendance-policies die het hier
-- zet zijn in fase 1 gedragsgelijk aan de oude `team_id = auth.uid()`-policy —
-- iedereen is owner van zijn eigen team met teams.id = user.id, dus
-- can_edit(...) is waar op exact dezelfde rijen. M2 mag daarna gewoon volgen:
-- het attendance-blok daar is een WOORDELIJKE KOPIE van dat hieronder, dus de
-- twee scripts kunnen elkaar niet stukmaken, in welke volgorde ze ook draaien.
--
--   M1  supabase/teams-en-leden.sql            vóór deploy
--   M3a supabase/inzichten-team-id.sql         vóór deploy
--   M2b supabase/team-rls-gevolgacties.sql     vóór deploy  (dit bestand)
--       deploy
--   ==> backfill uit M1 sectie 6 nogmaals draaien, direct ná de deploy
--   M2  supabase/team-rls.sql                  ná  deploy
--   M3b supabase/inzichten-team-id-opruimen.sql ná deploy
--
-- IN FASE 1 VERANDERT DIT SCRIPT GEEN GEDRAG: iedereen is owner van precies
-- één team, en can_edit() kort dan altijd kort op rol = 'owner'. De vier RPC's
-- worden wél meteen gebruikt — dat is de reden dat het script vóór de deploy
-- moet. De policy-verruiming zelf is voorbereiding op fase 2, waar assistenten
-- met losse rechten bestaan.
--
-- ── HET PROBLEEM DAT DIT OPLOST ─────────────────────────────
-- Zeven server actions vragen één onderdeel maar schrijven ook een rij in een
-- tabel die onder een ánder onderdeel valt. Zonder dit script komt zo'n action
-- in fase 2 wél langs assertCanEdit en strandt hij daarna op de RLS-policy —
-- soms stil (genegeerde fout), soms halverwege.
--
-- ── DE REGEL (brief §8.2, "principe van afgeleide macht") ───
-- De app-laag vraagt precies één onderdeel: dat van de handeling die de
-- gebruiker uitvoert. Rijen die daar automatisch uit volgen vallen onder
-- datzelfde recht. Een policy mag daarvoor verruimd worden UITSLUITEND richting
-- een onderdeel dat diezelfde rijen langs een andere weg tóch al kan aanmaken
-- of vernietigen. Kan het onderdeel er vandaag helemaal niet bij, dan is
-- verruiming VERBODEN en gaat de gevolgschrijfactie door een kolom-begrensde
-- security-definer-RPC.
--
-- Toegepast:
--   attendance <- agenda   : deleteEvent cascadeert vandaag al élke
--                            attendance-rij van een event weg (schema.sql,
--                            ON DELETE CASCADE) en createEvent maakt ze aan.
--                            Agenda heeft die macht dus al -> VERRUIMEN.
--   attendance <- spelers  : deletePlayer cascadeert vandaag al élke
--                            attendance-rij van een speler weg -> VERRUIMEN.
--   events <- training     : training kan vandaag GEEN events-rij maken of
--   events <- wedstrijd      wissen -> NIET verruimen, wel vier RPC's.
--
-- Idempotent: alles is `drop … if exists` + `create (or replace)`.
-- ============================================================

begin;

-- ── attendance ───────────────────────────────────────────────
-- LET OP — DIT BLOK STAAT WOORDELIJK GELIJK IN supabase/team-rls.sql (M2).
-- Dat is bewust: M2b draait vóór de deploy en M2 erna, dus M2 komt als laatste
-- langs deze tabel. Stond daar de smallere variant, dan zou M2 de verruiming
-- hieronder stilzwijgend terugdraaien. Wijzig je hier iets, wijzig het daar
-- dan mee (en andersom).
-- Gevolgschrijfacties, zie het principe hierboven.
-- INSERT ook via agenda   : createEvent, createBulkMatches en
--                           generateSeasonTrainings zetten de
--                           aanwezigheidsrijen van een nieuw event klaar.
-- INSERT/UPDATE via spelers: markInjured (upsert) en markRecovered (update).
-- DELETE blijft strikt aanwezigheid: geen enkele gevolgactie verwijdert losse
-- attendance-rijen; dat gaat altijd via de FK-cascade op events/players, en
-- een cascade is niet aan RLS onderworpen.
--
-- BEWUST AANVAARD RESTRISICO: een assistent met alléén Spelers-recht kan met
-- een directe aanroep een willekeurige aanwezigheidsstatus wijzigen zonder
-- Aanwezigheid-recht. Dat is strikt kleiner dan wat hij al mag — met
-- deletePlayer wist hij in één klik de volledige aanwezigheidshistorie van die
-- speler. Hetzelfde geldt voor Agenda via deleteEvent. De verruiming voegt geen
-- macht toe die er niet al was. Zie supabase/team-rls-verificatie.sql blok 7:
-- die test legt dit vast als AANVAARD, niet als lek.
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

-- ── events — BEWUST ONGEWIJZIGD ──────────────────────────────
-- NIET verruimen naar 'training' of 'wedstrijd'. Geen van beide onderdelen kan
-- vandaag een events-rij maken of wissen; verruiming zou echte macht TOEVOEGEN
-- in plaats van bestaande macht erkennen. De policies uit M2 blijven dus staan:
--   select  is_team_member(team_id)
--   insert/update/delete  can_edit(team_id, 'agenda')
--
-- De vier kolom-begrensde uitzonderingen lopen via de RPC's hieronder. Elke
-- RPC zet EXACT ÉÉN kolom (of, bij set_match_result, het ene uitslag-paar) en
-- toetst zelf het juiste onderdeel. Dat is de enige reden dat ze bestaan.

-- ── RPC 1: doelstelling van een training ─────────────────────
-- Onderdeel: training. Kolom: events.doelstelling.
create or replace function public.set_event_doelstelling(
  p_event_id uuid, p_doelstelling text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_team uuid;
begin
  -- team_id komt ALTIJD uit de rij zelf, nooit uit de client. Daarmee kan een
  -- aanroeper geen vreemd team opgeven; het ergste wat hij kan doen is een
  -- event-id raden, en daar staat de can_edit-check hieronder voor.
  select team_id into v_team from events
   where id = p_event_id and type = 'training';
  if v_team is null then
    raise exception 'Event niet gevonden' using errcode = 'P0002';
  end if;
  if not can_edit(v_team, 'training') then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  -- LET OP bij uitbreiding: `type = 'training'` is bewust. saveDoelstelling
  -- wordt vandaag uitsluitend vanaf de trainingsplan-pagina aangeroepen. Wordt
  -- de doelstelling ooit ook bij wedstrijden gebruikt, dan moet de check
  --   case type when 'training' then can_edit(v_team,'training')
  --             else can_edit(v_team,'wedstrijd') end
  -- worden, en moet de type-filter uit de select hierboven.
  --
  -- Exact één kolom. Dezelfde 500-tekengrens als de app-laag; hier als tweede
  -- vangnet, niet als enige bron.
  update events set doelstelling = nullif(left(coalesce(p_doelstelling, ''), 500), '')
   where id = p_event_id;
end $$;

revoke execute on function public.set_event_doelstelling(uuid, text) from public, anon;
grant  execute on function public.set_event_doelstelling(uuid, text) to authenticated;

-- ── RPC 2: uitslag van een wedstrijd ─────────────────────────
-- Onderdeel: wedstrijd. Kolommen: events.goals_for + events.goals_against.
create or replace function public.set_match_result(
  p_event_id uuid, p_goals_for smallint, p_goals_against smallint
) returns void
language plpgsql security definer set search_path = public as $$
declare v_team uuid;
begin
  select team_id into v_team from events
   where id = p_event_id and type = 'match';
  if v_team is null then
    raise exception 'Event niet gevonden' using errcode = 'P0002';
  end if;
  if not can_edit(v_team, 'wedstrijd') then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  -- NULL blijft geldig: "geen uitslag ingevuld". matchResult() in
  -- lib/match-analysis.mjs rekent daarop. Bewust GEEN clamp hier: clampGoals in
  -- app/actions/match-analysis.ts is de enige bron van waarheid voor het
  -- bereik, en twee clamps zouden uit elkaar kunnen lopen.
  update events
     set goals_for     = p_goals_for,
         goals_against = p_goals_against
   where id = p_event_id;
end $$;

revoke execute on function public.set_match_result(uuid, smallint, smallint) from public, anon;
grant  execute on function public.set_match_result(uuid, smallint, smallint) to authenticated;

-- ── RPC 3: verzameltijd van een wedstrijd ────────────────────
-- Onderdeel: wedstrijd (besluit van de eigenaar op brief-vraag 8.8).
-- Kolom: events.gather_time, type TIME — bewust plain TIME en geen timestamptz:
-- dit domein gebruikt lokale wandkloktijd, net als events.time en events.date
-- (supabase/gather-time.sql). Er wordt niets naar UTC geconverteerd.
create or replace function public.set_gather_time(
  p_event_id uuid, p_gather_time time
) returns void
language plpgsql security definer set search_path = public as $$
declare v_team uuid;
begin
  select team_id into v_team from events
   where id = p_event_id and type = 'match';
  if v_team is null then
    raise exception 'Event niet gevonden' using errcode = 'P0002';
  end if;
  if not can_edit(v_team, 'wedstrijd') then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  -- NULL = verzameltijd wissen; dat is een geldige waarde, geen fout. De
  -- vormvalidatie (HH:MM, 00:00-23:59) zit in isTimeString in lib/utils.ts en
  -- draait in updateGatherTime vóór deze aanroep; het `time`-type hier is het
  -- tweede vangnet.
  update events set gather_time = p_gather_time
   where id = p_event_id;
end $$;

revoke execute on function public.set_gather_time(uuid, time) from public, anon;
grant  execute on function public.set_gather_time(uuid, time) to authenticated;

-- ── RPC 4: trainingstype van een training ────────────────────
-- Onderdeel: training (besluit van de eigenaar op brief-vraag 8.8).
-- Kolom: events.trainingstype.
create or replace function public.set_trainingstype(
  p_event_id uuid, p_trainingstype text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_team uuid;
begin
  -- Whitelist vóór alles: dezelfde twee waarden als de CHECK-constraint
  -- events_trainingstype_check (supabase/trainingstype-en-koppeling-duur.sql).
  -- Hier expliciet, zodat de aanroeper een nette fout krijgt in plaats van een
  -- ruwe constraint-schending met de kolomnaam erin.
  if p_trainingstype is null or p_trainingstype not in ('vct', 'teamtactisch') then
    raise exception 'Ongeldig trainingstype' using errcode = '22023';
  end if;
  select team_id into v_team from events
   where id = p_event_id and type = 'training';
  if v_team is null then
    raise exception 'Event niet gevonden' using errcode = 'P0002';
  end if;
  if not can_edit(v_team, 'training') then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  update events set trainingstype = p_trainingstype
   where id = p_event_id;
end $$;

revoke execute on function public.set_trainingstype(uuid, text) from public, anon;
grant  execute on function public.set_trainingstype(uuid, text) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ── Controle na afloop ───────────────────────────────────────
-- 1. De vier RPC's staan er, alle vier security definer:
--
-- select p.proname, p.prosecdef, pg_get_function_identity_arguments(p.oid)
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('set_event_doelstelling','set_match_result',
--                     'set_gather_time','set_trainingstype')
-- order by 1;
-- -- vier rijen, prosecdef = true
--
-- 2. attendance heeft vier policies en de INSERT-policy noemt drie onderdelen:
--
-- select policyname, cmd, with_check from pg_policies
-- where schemaname = 'public' and tablename = 'attendance' order by cmd;
--
-- 3. events is NIET verruimd — alleen 'agenda' mag hier staan:
--
-- select policyname, cmd, qual, with_check from pg_policies
-- where schemaname = 'public' and tablename = 'events' order by cmd;
--
-- 4. Draai daarna supabase/team-rls-verificatie.sql blok 7 t/m 12.
