-- ============================================================
-- Pitchup — Fase A (A-2): blessure-status opruimen
--
-- WANNEER DRAAIEN: pas NÁ de push van fase A én de rooktest in productie, en
-- pas als vaststaat dat de code niet teruggerold hoeft te worden. Oude code
-- schrijft attendance.injury_set en breekt zonder die kolom. Idempotent.
--
--   A-1 supabase/blessure-status.sql            vóór push
--       push fase A + rooktest in productie
--   A-2 supabase/blessure-status-opruimen.sql   ná push en rooktest (dit bestand)
--
-- ONOMKEERBAAR zonder de kolom opnieuw toe te voegen:
--   alter table attendance add column injury_set boolean not null default false;
-- ============================================================

-- 0. Controle (los uitvoeren, vóór de update hieronder): rijen die de OUDE
--    markRecovered in het venster tussen A-1 en de push kan hebben laten
--    hangen. Verwacht: 0 rijen.
--    Hersteloptie bij treffers: in de app "Blessure melden" + "Hersteld melden"
--    voor die speler (de nieuwe markRecovered zet toekomstige 'injured' terug).
--    current_date is de UTC-datum van de database; alleen voor detectie.
select a.team_id, a.player_id, count(*)
from attendance a
join events  e on e.id = a.event_id
join players p on p.id = a.player_id
where a.status = 'injured' and p.injured = false and e.date >= current_date
group by 1, 2;

-- De guard op het bestaan van de kolom maakt het vangnet idempotent: na een
-- eerdere run bestaat injury_set niet meer en zou een kale update falen.
begin;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'attendance' and column_name = 'injury_set'
  ) then
    -- 1. Vangnet: rijen die de OUDE markInjured in het venster nog als
    --    absent + injury_set schreef.
    update public.attendance set status = 'injured'
     where status = 'absent' and injury_set = true;
  end if;
end $$;
-- 2. Vlag weg: blessure is geen aparte vlag meer naast de status.
alter table public.attendance drop column if exists injury_set;
commit;
notify pgrst, 'reload schema';
