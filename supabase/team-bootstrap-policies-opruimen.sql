-- ============================================================
-- Pitchup — M5b: bootstrap-INSERT-policies opruimen (fase 2, NÁ de deploy)
--
-- WANNEER DRAAIEN: pas NÁDAT de Vercel-deploy van fase 2 klaar is. Niet eerder.
-- Run dit eenmalig in de Supabase SQL Editor.
--
--   M4  supabase/team-invites-rpc.sql               vóór deploy
--   M5  supabase/team-aanmaken-rpc.sql              vóór deploy
--   M5c supabase/team-fk-naar-teams.sql             vóór deploy
--       deploy fase 2
--       ==> rooktest: registreer één nieuw account -> moet een team opleveren
--   M5b supabase/team-bootstrap-policies-opruimen.sql  ná deploy  (dit bestand)
--
-- WAAROM PAS NA DE DEPLOY — dit is dezelfde valkuil als M3a/M3b in fase 1.
-- Tot de deploy klaar is, schrijft de OUDE signUp zijn teams-rij en owner-rij
-- nog rechtstreeks. Die twee inserts kunnen alleen door de policies die dit
-- script dropt. Te vroeg draaien = registratie kapot voor iedereen die zich in
-- dat tijdvak aanmeldt, en die accounts zijn daarna een account zonder team.
--
-- WAT ER NA DIT SCRIPT VERANDERT: er is in de hele database geen enkele weg
-- meer waarlangs een gewone client zelf een teams-rij of een owner-rij in
-- team_members kan maken. Die twee ontstaan uitsluitend nog in de
-- security-definer-functie create_team() (M5) — in één transactie, dus nooit
-- meer een team zonder hoofdtrainer.
--
-- WAT ER BLIJFT STAAN: "team_members: owner voegt assistent toe" (insert met
-- `is_team_owner(team_id) and rol = 'assistent'`). Die is geen bootstrap maar
-- de gewone weg voor het toevoegen van staf, en hoort te blijven.
--
-- TERUGDRAAIEN (alleen als de deploy teruggerold moet worden naar fase 1):
--   create policy "teams: eigen team bij registratie" on teams for insert
--     to authenticated with check (id = auth.uid());
--   create policy "team_members: eigen owner-rij bij registratie" on team_members
--     for insert to authenticated
--     with check (user_id = auth.uid() and team_id = auth.uid() and rol = 'owner');
-- De volledige toelichting op die twee checks staat in
-- supabase/teams-en-leden.sql, sectie 5.
--
-- Idempotent: `drop policy if exists`.
-- ============================================================

begin;

drop policy if exists "teams: eigen team bij registratie" on teams;
drop policy if exists "team_members: eigen owner-rij bij registratie" on team_members;

commit;

-- Optioneel; Supabase herlaadt de PostgREST-schemacache normaal zelf na DDL.
notify pgrst, 'reload schema';

-- ── Controle na afloop — beide query's zijn verplicht ────────
--
-- 1. Er mag geen INSERT-policy meer op teams staan; op team_members alleen
--    "team_members: owner voegt assistent toe".
--
-- select tablename, policyname, cmd from pg_policies
--  where schemaname = 'public' and tablename in ('teams','team_members') and cmd = 'INSERT'
--  order by tablename, policyname;
-- -- verwacht: precies één rij (team_members / "owner voegt assistent toe").
--
-- 2. PERMANENTE SANITY-CHECK: geen enkel team zonder hoofdtrainer.
--    Dit is de controle die de hele reden van create_team() bewaakt. Draai hem
--    ook los na elke latere migratie en na elke deploy; hij staat daarom ook
--    als blok 13 in supabase/team-rls-verificatie.sql.
--
-- select t.id from teams t
--   left join team_members m on m.team_id = t.id and m.rol = 'owner'
--  where m.team_id is null;
-- -- moet LEEG zijn. Is dat niet zo, dan is er ergens een team aangemaakt
-- -- buiten create_team() om; die eigenaar is buitengesloten van zijn eigen
-- -- data en dat meldt zichzelf nergens.
--
-- 3. Rooktest, handmatig: registreer een nieuw account via de app. Dat moet
--    nog steeds een team opleveren (nu via create_team). Lukt dat niet, draai
--    dan de twee policies uit het kopcommentaar terug en onderzoek eerst.
