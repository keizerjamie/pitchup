-- ============================================================
-- Pitchup — inzichten-metrics fase 3a (training en kwaliteit, ALLEEN LEZEN)
--
-- WANNEER: VÓÓR de deploy, handmatig in de Supabase SQL Editor (of via de
-- Supabase-MCP). Idempotent; mag opnieuw.
-- NIEUW: alleen twee LEES-RPC's; geen tabel, kolom, index of policy. Raakt GEEN
-- bestaande functie (inzichten-team-id.sql, inzichten-metrics.sql,
-- inzichten-metrics-fase2.sql en inzichten-metrics-fase2b.sql NIET opnieuw
-- draaien). Daarna: supabase/team-rls-verificatie.sql blok 29.
--
-- Volgorde: eerst dit bestand, dan de deploy. Ontbreekt het, dan geven de RPC's
-- PGRST202 en tonen alleen de drie fase-3a-kaarten op /inzichten een
-- foutmelding; de rest blijft werken.
--
-- Rekenwerk (duurregel, parallel = langste, stap, analyseBestaat,
-- hasTrainingPlanDone) gebeurt BEWUST in TS (lib/sessie-tijdlijn.ts,
-- lib/parallel-groep.ts, lib/periodization.ts, lib/*.mjs; aangeroepen vanuit
-- lib/inzichten.ts): hier staat geen enkele duplicaat van die regels. De
-- enige afbeelding in SQL is task_type per eventtype, dezelfde als in de
-- task_overrides-policy (supabase/team-rls.sql) en app/page.tsx.
--
-- limit 901 = MAX_FASE3_RIJEN + 1 (lib/inzichten.ts); `totaal` = count(*) over ()
-- vóór de limit, zodat ook een lagere PostgREST max-rows nooit stil afkapt
-- (isAfgekapt in lib/inzichten.ts).
--
-- LET OP: events en players hebben allebei een kolom `type`; daarom `soort`.
-- Tijd: events.date is een kale DATE; de ISO-week wordt in TS bepaald (geen
-- date_trunc). `aangemaakt` (created_at, timestamptz) is alleen tie-break.
-- ============================================================
begin;

-- ── RPC 1: trainingen + koppelingen (belasting én periodisering) ──
-- Eén rij per koppeling; een training zonder koppeling geeft één rij met
-- koppeling_id null. Teamfilter van de koppeling in de ON (left join blijft
-- left join). BEWUSTE UITZONDERING: oefeningen wordt NIET op team_id gefilterd
-- — oefeningen.team_id is de EIGENAAR-USER, geen teams.id
-- (supabase/oefeningen-persoonlijk.sql). De tenantgrens is k.team_id =
-- p_team_id; de RLS op oefeningen (eigenaar of "zichtbaar via gekoppeld
-- trainingsplan") bepaalt de leesbaarheid. Niet leesbaar → oef.* null en
-- oefening_leesbaar = false (de app telt die zichtbaar, nooit stil weg).
-- Geen filter op trainingstype: de belasting telt teamtactisch mee (Q2), de
-- periodisering filtert in TS op 'vct' (P.7).
create or replace function public.inzichten_training_koppelingen(p_team_id uuid, p_start date, p_end date)
returns table (event_id uuid, datum date, trainingstype text, koppeling_id uuid, volgorde int,
               aangemaakt timestamptz, parallel_groep_id uuid, koppeling_duur_min int,
               oefening_duur_min int, categorie text, stap_override int, oefening_leesbaar boolean,
               totaal int)
language sql stable security invoker set search_path = public
as $$
  select e.id, e.date, e.trainingstype,
         k.id, k.volgorde::int, k.created_at, k.parallel_groep_id,
         k.duur_min::int, oef.duur_min::int, oef.categorie, k.stap_override::int,
         (oef.id is not null),
         (count(*) over ())::int
  from events e
  left join training_oefeningen k on k.event_id = e.id and k.team_id = p_team_id
  left join oefeningen oef on oef.id = k.oefening_id
  where is_team_member(p_team_id)
    and e.team_id = p_team_id
    and e.type = 'training'
    and e.date >= p_start and e.date <= p_end
  order by e.date, e.id, k.volgorde, k.created_at, k.id
  limit 901;
$$;

-- ── RPC 2: ruwe invul-tellingen per gespeelde wedstrijd / training ──
-- Geen oordeel in SQL: analyseBestaat, matchResult en hasTrainingPlanDone
-- draaien in TS. Tellingen zoals het dashboard (app/page.tsx): rijen van dit
-- team per event. handmatig = task_override van het BIJBEHORENDE type.
create or replace function public.inzichten_invul_discipline(p_team_id uuid, p_start date, p_end date)
returns table (event_id uuid, soort text, datum date, goals_for int, goals_against int,
               doelstelling text, aantal_ratings int, aantal_momenten int,
               aantal_oefeningen int, handmatig boolean, totaal int)
language sql stable security invoker set search_path = public
as $$
  select e.id, e.type, e.date, e.goals_for::int, e.goals_against::int,
         case when e.type = 'training' then e.doelstelling end,
         (select count(*) from match_ratings r
           where r.event_id = e.id and r.team_id = p_team_id)::int,
         (select count(*) from match_events me
           where me.event_id = e.id and me.team_id = p_team_id)::int,
         (select count(*) from training_oefeningen k
           where k.event_id = e.id and k.team_id = p_team_id)::int,
         exists (select 1 from task_overrides tov
                  where tov.event_id = e.id and tov.team_id = p_team_id
                    and tov.task_type = case e.type when 'match' then 'analysis' else 'training_plan' end),
         (count(*) over ())::int
  from events e
  where is_team_member(p_team_id)
    and e.team_id = p_team_id
    and e.type in ('match', 'training')
    and e.date >= p_start and e.date <= p_end
  order by e.date, e.id
  limit 901;
$$;

revoke all on function public.inzichten_training_koppelingen(uuid, date, date) from public, anon;
grant execute on function public.inzichten_training_koppelingen(uuid, date, date) to authenticated;
revoke all on function public.inzichten_invul_discipline(uuid, date, date) from public, anon;
grant execute on function public.inzichten_invul_discipline(uuid, date, date) to authenticated;

commit;
notify pgrst, 'reload schema';

-- ── Controle na afloop ───────────────────────────────────────
-- select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('inzichten_training_koppelingen', 'inzichten_invul_discipline');
