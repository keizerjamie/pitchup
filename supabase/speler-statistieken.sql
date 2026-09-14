-- ============================================================
-- Pitchup — spelersprofiel: aanwezigheid van ÉÉN speler
-- Run dit eenmalig in de Supabase SQL Editor.
--
-- Waarom een DROP en geen kale CREATE OR REPLACE: de functie-identiteit in
-- Postgres is (naam + argumenttypen). Een derde parameter maakt dus een
-- OVERLOAD naast de bestaande (date, date)-versie. Een aanroep met twee
-- argumenten — precies wat app/inzichten/page.tsx doet — matcht daarna
-- op allebei en faalt met "function ... is not unique". De oude versie moet
-- dus weg voordat de nieuwe er staat.
--
-- Verder is deze functie bit voor bit gelijk aan de versie in
-- supabase/inzichten.sql (inzichten_aanwezigheid_per_speler): zelfde joins,
-- zelfde filters (p.active, p.type = 'regular', e.type <> 'meting'), zelfde
-- security invoker + team_id = auth.uid(). De ENIGE toevoeging is de
-- optionele p_player-regel.
-- ============================================================

drop function if exists public.inzichten_aanwezigheid_per_speler(date, date);

create or replace function public.inzichten_aanwezigheid_per_speler(
  p_start  date,
  p_end    date,
  p_player uuid default null
)
returns table (player_id uuid, naam text, aanwezig int, afwezig int)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id,
    p.name,
    count(*) filter (where a.status = 'present')::int,
    count(*) filter (where a.status = 'absent')::int
  from attendance a
  join events e  on e.id = a.event_id
  join players p on p.id = a.player_id
  where a.team_id = auth.uid()
    and e.team_id = auth.uid()
    and p.team_id = auth.uid()
    and p.active = true
    and p.type = 'regular'
    and e.type <> 'meting'
    and e.date >= p_start
    and e.date <= p_end
    -- NULL = alle spelers (bestaand gedrag, /inzichten). Een waarde = één speler.
    and (p_player is null or p.id = p_player)
  group by p.id, p.name
  order by p.name, p.id;
$$;

-- Rechten gelden per signatuur en gaan NIET mee met de nieuwe functie.
revoke all on function public.inzichten_aanwezigheid_per_speler(date, date, uuid) from public, anon;
grant execute on function public.inzichten_aanwezigheid_per_speler(date, date, uuid) to authenticated;

-- Optioneel; Supabase herlaadt de PostgREST-schemacache normaal zelf na DDL.
notify pgrst, 'reload schema';
