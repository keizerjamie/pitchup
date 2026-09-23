-- ============================================================
-- Pitchup — M3b: de oude inzichten-signaturen zonder p_team_id opruimen
--
-- WANNEER DRAAIEN: NÁ deploy 1a. Run dit eenmalig in de Supabase SQL Editor.
--
--   M1  supabase/teams-en-leden.sql            vóór deploy
--   M3a supabase/inzichten-team-id.sql         vóór deploy
--   M2b supabase/team-rls-gevolgacties.sql     vóór deploy
--       deploy
--   ==> backfill uit M1 sectie 6 nogmaals draaien, direct ná de deploy
--   M2  supabase/team-rls.sql                  ná  deploy
--   M3b supabase/inzichten-team-id-opruimen.sql ná deploy  (dit bestand)
--
-- TE VROEG DRAAIEN BREEKT DE LIVE APP: tussen de SQL-run en de deploy roept
-- de draaiende app nog de oude signatuur aan en krijgt dan PGRST202
-- ("function not found") op /inzichten en op de Statistieken-tab van het
-- spelersprofiel.
--
-- Waarom ze weg MOETEN en niet gewoon mogen blijven staan: de oude functies
-- filteren op `team_id = auth.uid()`. Voor een assistent-trainer (fase 2) is
-- auth.uid() NIET het team-id, dus een achtergebleven aanroep zou stil nul
-- rijen opleveren in plaats van hard te falen. Een lege grafiek is een veel
-- lastiger bug dan een foutmelding.
--
-- Idempotent: `drop function if exists`.
-- ============================================================

begin;

drop function if exists public.inzichten_aanwezigheid(date, date);
drop function if exists public.inzichten_training_opkomst_per_maand(date, date);
drop function if exists public.inzichten_rating_team_per_wedstrijd(date, date);
drop function if exists public.inzichten_rating_speler(uuid, date, date);
drop function if exists public.inzichten_rating_per_speler(date, date);

-- Twee varianten: (date, date) is de oorspronkelijke uit supabase/inzichten.sql
-- (supabase/speler-statistieken.sql dropte die destijds al) en
-- (date, date, uuid) is de spelersprofiel-overload. Beide regels staan er
-- bewust: welke van de twee er in een installatie nog staat, hangt af van
-- welke migraties er eerder gedraaid zijn.
drop function if exists public.inzichten_aanwezigheid_per_speler(date, date);
drop function if exists public.inzichten_aanwezigheid_per_speler(date, date, uuid);

commit;

notify pgrst, 'reload schema';

-- ── Controle na afloop ───────────────────────────────────────
-- Elke naam hoort nu nog PRECIES ÉÉN variant te hebben, en die begint met
-- p_team_id:
--
-- select p.proname, pg_get_function_identity_arguments(p.oid) as args
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname like 'inzichten%'
-- order by 1, 2;
--
-- Verwacht:
--   inzichten_aanwezigheid                (p_team_id uuid, p_start date, p_end date)
--   inzichten_aanwezigheid_per_speler     (p_team_id uuid, p_start date, p_end date, p_player uuid)
--   inzichten_rating_per_speler           (p_team_id uuid, p_start date, p_end date)
--   inzichten_rating_speler               (p_team_id uuid, p_player uuid, p_start date, p_end date)
--   inzichten_rating_team_per_wedstrijd   (p_team_id uuid, p_start date, p_end date)
--   inzichten_training_opkomst_per_maand  (p_team_id uuid, p_start date, p_end date)
