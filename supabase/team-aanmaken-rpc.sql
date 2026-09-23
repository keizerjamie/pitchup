-- ============================================================
-- Pitchup — M5: create_team() (fase 2 "Staf, rechten en meerdere
-- lidmaatschappen")
--
-- WANNEER DRAAIEN: VÓÓR de deploy van fase 2. Run dit eenmalig in de Supabase
-- SQL Editor. Samen met M4 (supabase/team-invites-rpc.sql); de onderlinge
-- volgorde van M4 en M5 maakt niet uit.
--
-- Volgorde van de hele fase 2 — niet cosmetisch:
--   M4  supabase/team-invites-rpc.sql               vóór deploy
--   M5  supabase/team-aanmaken-rpc.sql              vóór deploy  (dit bestand)
--       deploy fase 2: uitnodigen/accepteren, rechten-UI, teamwisselaar,
--                      signUp + zelfherstel via create_team()
--   M5b supabase/team-bootstrap-policies-opruimen.sql  ná deploy
--
-- WAAROM VÓÓR DE DEPLOY: de fase-2-code (app/actions/team.ts createTeam,
-- app/actions/auth.ts signUp en het zelfherstel in lib/team-context.ts) roept
-- create_team() rechtstreeks aan. Bestaat hij nog niet, dan geeft elke
-- registratie PGRST202.
--
-- WAAROM DE BOOTSTRAP-POLICIES HIER BLIJVEN STAAN (addendum §8.6): tussen dit
-- script en de afgeronde deploy draait de OUDE signUp nog, die zijn teams-rij
-- en owner-rij zelf schrijft. Ze hier droppen breekt registratie — exact
-- dezelfde valkuil als M3a/M3b in fase 1. Droppen gebeurt in M5b, ná de
-- deploy.
--
-- ── WAAROM ÉÉN TRANSACTIE EN NIET DRIE STATEMENTS ───────────
-- De oude signUp deed teams -> team_members -> settings.team_name als drie
-- losse calls. Faalde de tweede, dan bestond er een team ZONDER hoofdtrainer
-- en was de gebruiker permanent buitengesloten van zijn eigen team, zonder dat
-- iets dat detecteerde. Een functiebody is één transactie: alles of niets.
-- (De sanity-check "geen team zonder owner" staat in M5b en als blok 13 in
-- supabase/team-rls-verificatie.sql.)
--
-- ── teams.id IS HIER GEEN user-id MEER ──────────────────────
-- De fase-1-invariant `teams.id = user-id van de hoofdtrainer` gold alleen om
-- fase 1 zonder gedragsverandering te kunnen uitrollen: is_team_member(team_id)
-- dekte daardoor exact dezelfde rijen als het oude team_id = auth.uid().
-- Vanaf hier krijgt elk NIEUW team een eigen uuid (§1.1 van de brief). Voor
-- bestaande teams blijft de oude id staan; er verhuist niets.
--
-- Idempotent: `create or replace`.
-- ============================================================

begin;

-- ── create_team ──────────────────────────────────────────────
-- Maakt de teams-rij, de owner-rij met alle zes rechten en de teamnaam in
-- settings — in die volgorde en in één transactie. Geeft het nieuwe team-id
-- terug.
--
-- GEEN LIMIET OP HET AANTAL TEAMS (BR 37).
--
-- p_alleen_zonder_team: alleen voor het ZELFHERSTEL in lib/team-context.ts
-- (maakEigenTeam). Dat pad draait wanneer een account nul lidmaatschappen
-- heeft en er nog een teamnaam als user-metadata klaarstaat. Twee gelijktijdige
-- requests zouden dan allebei een team kunnen maken — vóór fase 2 ving de
-- primaire sleutel `teams.id = user.id` dat af met een 23505, maar een
-- gen_random_uuid() botst nooit. Met deze vlag serialiseert de functie per
-- gebruiker (advisory lock binnen de transactie) en geeft hij het bestaande
-- team terug in plaats van een tweede aan te maken. De gewone weg
-- (createTeam vanuit de UI) zet hem op false: daar is een tweede team juist de
-- bedoeling.
create or replace function public.create_team(
  p_naam text,
  p_alleen_zonder_team boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_naam text := btrim(coalesce(p_naam, ''));
  v_team uuid;
begin
  if v_user is null then
    raise exception 'Niet ingelogd' using errcode = '42501';
  end if;

  -- 1..80 na trim, dezelfde grens die app/actions/auth.ts en
  -- app/actions/team.ts vóór de aanroep al hanteren. Hier als tweede vangnet,
  -- met een eigen errcode zodat de aanroeper "naam fout" kan onderscheiden van
  -- een echte databasefout.
  if length(v_naam) < 1 or length(v_naam) > 80 then
    raise exception 'Ongeldige teamnaam' using errcode = '22023';
  end if;

  if p_alleen_zonder_team then
    -- Advisory lock per gebruiker, binnen deze transactie. Twee gelijktijdige
    -- zelfherstel-pogingen wachten zo op elkaar in plaats van allebei een team
    -- te maken.
    perform pg_advisory_xact_lock(hashtext('pitchup:create_team:' || v_user::text));
    -- ALLEEN EEN OWNER-LIDMAATSCHAP TELT. Zonder `m.rol = 'owner'` zou deze
    -- functie het team van een ZOJUIST geaccepteerde uitnodiging kunnen
    -- teruggeven (een assistent-lidmaatschap dat in een ander tabblad is
    -- ontstaan tussen de lidmaatschapsquery van laadContext en deze aanroep).
    -- De aanroeper zou dat team dan als zijn eigen, net aangemaakte team
    -- behandelen. Een account dat wél assistent is maar nergens hoofdtrainer,
    -- krijgt hier gewoon zijn eigen team — dat is precies wat de vlag vraagt
    -- en wat BR 37 toestaat.
    select m.team_id into v_team
      from team_members m
     where m.user_id = v_user and m.rol = 'owner'
     limit 1;
    if v_team is not null then
      return v_team;
    end if;
  end if;

  insert into teams default values returning id into v_team;

  -- De maker is hoofdtrainer (BR 46) met alle zes rechten. can_edit() kort
  -- weliswaar kort op rol = 'owner', maar de kolommen staan hier expliciet op
  -- true zodat de rij ook los leesbaar de waarheid vertelt.
  insert into team_members (team_id, user_id, rol,
    mag_spelers_bewerken, mag_agenda_bewerken, mag_aanwezigheid_bewerken,
    mag_wedstrijd_bewerken, mag_training_bewerken, mag_periodisering_bewerken)
  values (v_team, v_user, 'owner', true, true, true, true, true, true);

  -- De teamnaam hoort in settings onder 'team_name' — bewust geen kolom op
  -- teams (zie het comment op die tabel in supabase/teams-en-leden.sql).
  insert into settings (team_id, key, value)
  values (v_team, 'team_name', v_naam);

  return v_team;
end $$;

revoke execute on function public.create_team(text, boolean) from public, anon;
grant  execute on function public.create_team(text, boolean) to authenticated;

commit;

-- Optioneel; Supabase herlaadt de PostgREST-schemacache normaal zelf na DDL.
notify pgrst, 'reload schema';

-- ── Controle na afloop ───────────────────────────────────────
-- 1. De functie staat er, security definer:
--
-- select p.proname, p.prosecdef, pg_get_function_identity_arguments(p.oid)
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'create_team';
-- -- één rij, prosecdef = true, argumenten: text, boolean
--
-- 2. anon mag hem NIET uitvoeren:
--
-- select has_function_privilege('anon', 'public.create_team(text, boolean)', 'execute') as anon_mag,
--        has_function_privilege('authenticated', 'public.create_team(text, boolean)', 'execute') as auth_mag;
-- -- anon_mag = false, auth_mag = true
--
-- 3. De bootstrap-policies staan er NOG (ze gaan pas in M5b weg):
--
-- select tablename, policyname, cmd from pg_policies
--  where schemaname = 'public' and tablename in ('teams','team_members') and cmd = 'INSERT'
--  order by tablename, policyname;
-- -- verwacht: "teams: eigen team bij registratie",
-- --           "team_members: eigen owner-rij bij registratie",
-- --           "team_members: owner voegt assistent toe"
