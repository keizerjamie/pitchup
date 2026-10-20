-- ============================================================
-- Pitchup — Fase A (A-1): blessure als eigen aanwezigheidsstatus
--
-- WANNEER DRAAIEN: VÓÓR de push van fase A, en daarna DIRECT pushen. Run dit
-- eenmalig in de Supabase SQL Editor. Idempotent: veilig opnieuw te draaien,
-- zowel vóór als ná A-2 (de dataconversie slaat zichzelf over zodra de kolom
-- injury_set is gedropt; CHECK en RPC's worden dan gewoon opnieuw gezet).
--
--   A-1 supabase/blessure-status.sql            vóór push (dit bestand)
--       push fase A + rooktest in productie
--   A-2 supabase/blessure-status-opruimen.sql   ná push en rooktest
--
-- ZONDER DIT BESTAND BREEKT DE NIEUWE CODE: die schrijft status 'injured'.
-- Zonder de bredere CHECK faalt elke markInjured, elke
-- updateAttendance(...'injured') en elke createEvent met een geblesseerde
-- speler (die laatste rolt het event dan terug).
--
-- WAT ER GEBEURT:
--   1. De CHECK op attendance.status krijgt de waarde 'injured' erbij.
--   2. Bestaande data: absent + injury_set -> 'injured'. present + injury_set
--      blijft present. Historie die de oude markRecovered al wiste, is niet te
--      herstellen.
--   3. De drie aanwezigheids-RPC's tellen 'injured' als afwezig, zodat
--      /inzichten, het spelersprofiel en het seizoensrapport exact dezelfde
--      getallen houden als vóór de conversie. Signatuur en returns table zijn
--      ongewijzigd, dus `create or replace` volstaat: geen drop, de grants
--      blijven staan.
--
-- LET OP: zowel `events` als `players` heeft een kolom `type`; de aliassen
-- e/p houden dat uit elkaar.
--
-- NIET MEER DRAAIEN NA DIT BESTAND: supabase/inzichten-team-id.sql. Dat zou de
-- drie RPC's hieronder terugzetten naar "alleen 'absent' is afwezig" en
-- daarmee elk geblesseerd event stil uit de cijfers halen.
--
-- TENANT: er komt geen tabel of policy bij. De update in stap 2 draait als
-- eigenaar over alle teams, maar wijzigt uitsluitend de kolom `status`.
-- ============================================================

-- ── Controle VÓÓR het draaien (los uitvoeren en de uitkomst bewaren) ───────
-- De RPC's geven in de SQL Editor een lege set (auth.uid() is daar null), dus
-- vergelijk direct op de tabel.
--
--   select team_id,
--          count(*) filter (where status = 'present') as p,
--          count(*) filter (where status = 'absent')  as a
--   from attendance group by team_id order by team_id;

begin;

-- 1. CHECK verbreden. De naam van de bestaande constraint is niet
--    gegarandeerd (inline CHECK uit CREATE TABLE), dus dynamisch opzoeken.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.attendance'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.attendance drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.attendance
  add constraint attendance_status_check
  check (status in ('present', 'absent', 'injured', 'unknown'));

-- 2. Bestaande data: absent + injury_set -> injured.
--    present + injury_set blijft present.
--    Achter een guard op het bestaan van de kolom: na A-2
--    (blessure-status-opruimen.sql) bestaat injury_set niet meer en zou een
--    kale update de hele transactie terugrollen — inclusief de RPC's hieronder.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'attendance' and column_name = 'injury_set'
  ) then
    update public.attendance
       set status = 'injured'
     where status = 'absent' and injury_set = true;
  end if;
end $$;

-- 3. In bestaande cijfers telt 'injured' als afwezig. Bodies letterlijk gelijk
--    aan supabase/inzichten-team-id.sql; het enige verschil is het
--    afwezig-filter.
create or replace function public.inzichten_aanwezigheid(
  p_team_id uuid, p_start date, p_end date
)
returns table (aanwezig int, afwezig int)
language sql stable security invoker set search_path = public
as $$
  select
    count(*) filter (where a.status = 'present')::int,
    count(*) filter (where a.status in ('absent', 'injured'))::int
  from attendance a
  join events  e on e.id = a.event_id
  join players p on p.id = a.player_id
  where is_team_member(p_team_id)
    and a.team_id = p_team_id
    and e.team_id = p_team_id
    and p.team_id = p_team_id
    and p.type = 'regular'
    and e.type <> 'meting'
    and e.date >= p_start
    and e.date <= p_end;
$$;

create or replace function public.inzichten_training_opkomst_per_maand(
  p_team_id uuid, p_start date, p_end date
)
returns table (maand text, aanwezig int, afwezig int)
language sql stable security invoker set search_path = public
as $$
  select
    to_char(e.date, 'YYYY-MM') as maand,
    count(*) filter (where a.status = 'present')::int,
    count(*) filter (where a.status in ('absent', 'injured'))::int
  from attendance a
  join events  e on e.id = a.event_id
  join players p on p.id = a.player_id
  where is_team_member(p_team_id)
    and a.team_id = p_team_id
    and e.team_id = p_team_id
    and p.team_id = p_team_id
    and p.type = 'regular'
    and e.type = 'training'
    and e.date >= p_start
    and e.date <= p_end
  group by 1
  order by 1;
$$;

create or replace function public.inzichten_aanwezigheid_per_speler(
  p_team_id uuid, p_start date, p_end date, p_player uuid default null
)
returns table (player_id uuid, naam text, aanwezig int, afwezig int)
language sql stable security invoker set search_path = public
as $$
  select
    p.id,
    p.name,
    count(*) filter (where a.status = 'present')::int,
    count(*) filter (where a.status in ('absent', 'injured'))::int
  from attendance a
  join events  e on e.id = a.event_id
  join players p on p.id = a.player_id
  where is_team_member(p_team_id)
    and a.team_id = p_team_id
    and e.team_id = p_team_id
    and p.team_id = p_team_id
    and p.active = true
    and p.type = 'regular'
    and e.type <> 'meting'
    and e.date >= p_start
    and e.date <= p_end
    and (p_player is null or p.id = p_player)
  group by p.id, p.name
  order by p.name, p.id;
$$;

commit;
notify pgrst, 'reload schema';

-- ── Controle NÁ het draaien (los uitvoeren) ────────────────────────────────
--
-- a. Per team exact gelijk aan de "vóór"-uitkomst hierboven:
--
--   select team_id,
--          count(*) filter (where status = 'present') as p,
--          count(*) filter (where status in ('absent','injured')) as a
--   from attendance group by team_id order by team_id;
--
-- b. Geen rij met (absent, true) meer:
--
--   select status, injury_set, count(*) from attendance group by 1, 2 order by 1, 2;
--
-- c. Overloads: precies één signatuur per naam. Staan hier nog signaturen
--    zónder p_team_id, dan is M3b (supabase/inzichten-team-id-opruimen.sql)
--    niet gedraaid en tellen die oude overloads 'injured' NIET als afwezig.
--
--   select p.proname, pg_get_function_identity_arguments(p.oid)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname like 'inzichten_aanwezigheid%'
--   order by 1, 2;
