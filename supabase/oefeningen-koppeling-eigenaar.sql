-- ============================================================
-- Pitchup — M6b: alleen EIGEN oefeningen (of al in het team gekoppelde) koppelen
--
-- WANNEER DRAAIEN: als EERSTE van fase 4, vóór M6 en vóór de deploy. Run dit
-- eenmalig in de Supabase SQL Editor. Idempotent (create or replace +
-- drop-if-exists).
--
-- Volgorde fase 4 — hard, niet omwisselen:
--   M6b supabase/oefeningen-koppeling-eigenaar.sql  EERST       (dit bestand)
--   M6  supabase/oefeningen-persoonlijk.sql         DAARNA
--       deploy fase 4
--       ==> supabase/team-rls-verificatie.sql, blok 22 t/m 25
-- M6 zonder M6b zet het leesgat hieronder open, en dat hoort geen moment in
-- productie te staan. M6 controleert daarom zelf (sectie 3f) dat dit script er
-- al staat, en stopt anders.
--
-- ── WAAROM ──────────────────────────────────────────────────
-- M6 maakt een oefening leesbaar voor elk lid van een team in wiens
-- trainingsplan hij gekoppeld staat. De INSERT- en UPDATE-policy op
-- training_oefeningen toetsten tot nu toe alleen can_edit(team_id,'training'),
-- niet VAN WIE de oefening is. Een foreign-key-check negeert RLS, dus via een
-- directe PostgREST-aanroep kon iemand met Training-recht een willekeurige
-- oefening-UUID in het plan van zijn eigen team hangen en die daarna lezen en
-- kopiëren. De app weigert dat al (addOefeningToTraining zoekt de oefening op
-- ctx.userId); dit is de tweede laag (BR 45, brief §6.1).
--
-- ── WAT HET DOET ────────────────────────────────────────────
-- * Nieuwe security definer-functie oefening_koppelbaar(oefening, team) — de
--   ENIGE nieuwe infrastructuur; waarom een functie en geen inline exists: zie
--   het blokcommentaar hieronder (recursie).
-- * INSERT- en UPDATE-policy op training_oefeningen krijgen er een with check
--   bij. SELECT, DELETE en de using-kant van UPDATE blijven ongewijzigd.
--
-- Het blok tussen de markeringen >>> en <<< staat WOORDELIJK GELIJK in
-- supabase/team-rls.sql (M2), zodat een herhaalde run van M2 dit niet
-- terugdraait. Wijzig ze samen.
--
-- ── WAT BLIJFT WERKEN (nagelopen in de code) ────────────────
-- * addOefeningToTraining / createAndAddOefening — koppelen een EIGEN oefening
--   (tak 1).
-- * kopieerTrainingsplan — kopieert koppelingen binnen hetzelfde team; die
--   oefeningen hangen al in dat team (tak 2), ook die van teamgenoten.
-- * updateKoppeling, saveSpelerindeling, saveAantallenOverride,
--   reorderKoppelingen, parallelgroepen — geen van alle wijzigt oefening_id of
--   team_id; de rij zelf is een bestaande koppeling in het team (tak 2).
-- * removeOefeningFromTraining — DELETE, ongewijzigd.
-- * FK-acties (genest_in on delete set null, cascades) — niet aan RLS
--   onderworpen.
-- Bewust gevolg: een oefening van een teamgenoot die NERGENS meer in het team
-- hangt, kun je niet opnieuw koppelen — je kunt hem dan ook niet meer zien.
-- Kopiëren naar de eigen bibliotheek blijft de weg (AC 20).
--
-- Terugdraaien: draai het training_oefeningen-blok uit een oudere versie van
-- supabase/team-rls.sql, of zet de twee with check's terug op alleen
-- can_edit(team_id,'training'). Doe dat nooit zolang M6 staat.
-- ============================================================

begin;

-- >>> training_oefeningen-blok — WOORDELIJK GELIJK in team-rls.sql (M2) en oefeningen-koppeling-eigenaar.sql (M6b)
-- ── training_oefeningen → onderdeel 'training', koppelen alleen van eigen oefeningen ──
--
-- LET OP — DIT BLOK STAAT WOORDELIJK GELIJK IN supabase/team-rls.sql (M2) EN IN
-- supabase/oefeningen-koppeling-eigenaar.sql (M6b). DAT IS BEWUST EN MOET ZO
-- BLIJVEN. M6b is de latere, strengere variant; stond hier in M2 nog de oude
-- policy, dan zou een herhaalde run van M2 de eigenaarscheck stilzwijgend
-- terugdraaien — en daarmee het leesgat van M6 weer openzetten. Door beide
-- bestanden hetzelfde te laten schrijven is het eindresultaat gelijk, ongeacht
-- de volgorde, en werkt een verse installatie ook met alleen M2. Wijzig je hier
-- iets, wijzig het dan in het andere bestand mee; een structuurtest in
-- assistent-fase1-fundament.acceptance.test.ts vergelijkt de twee letterlijk.
--
-- Onderdeel: ook stap_override staat op deze tabel en is inhoudelijk
-- periodisering. Een policy kan niet per kolom beslissen en het veld wordt op de
-- trainingsplan-pagina bewerkt: de hele tabel valt onder Training (bevestigd
-- besluit van de eigenaar, beslissing 7).
--
-- WAAROM DE EXTRA with check (M6b): sinds M6 is een oefening leesbaar voor elk
-- lid van een team in wiens trainingsplan hij gekoppeld staat. Zonder deze
-- check kon iemand met Training-recht via een directe PostgREST-aanroep een
-- willekeurige oefening-UUID in het plan van zijn eigen team hangen (de
-- FK-check negeert RLS) en die oefening daarna lezen en kopiëren — bijvoorbeeld
-- een oud-assistent met ids die hij nog kent. De app weigerde dat al
-- (addOefeningToTraining zoekt de oefening op ctx.userId, AC 19/36); dit is de
-- tweede laag (BR 45).
--
-- Koppelbaar is een oefening als:
--   1. hij van de aanroeper is (oefeningen.team_id = auth.uid()) —
--      addOefeningToTraining en createAndAddOefening; of
--   2. hij al aan een trainingsplan van HETZELFDE team hangt —
--      kopieerTrainingsplan (een vorige training kopiëren, ook met oefeningen
--      van teamgenoten) én elke UPDATE van een bestaande koppeling: de rij
--      zelf is dan die bestaande koppeling, dus spelerindeling, volgorde,
--      parallelgroepen en stap_override blijven werken op andermans gekoppelde
--      oefening. Alleen oefening_id omzetten naar een oefening die nog niet in
--      het team hangt, faalt.
--
-- WAAROM EEN security definer-FUNCTIE EN GEEN INLINE exists(...): een policy op
-- training_oefeningen die zelf training_oefeningen leest — rechtstreeks, of
-- via de M6-policy op oefeningen die dat doet — geeft "infinite recursion
-- detected in policy". Zelfde reden als is_team_member & co. in M1. Daarom ook
-- set search_path = public en geen execute voor public/anon. De functie begint
-- met is_team_member(p_team_id), zodat ze voor een niet-lid nooit iets
-- verraadt over koppelingen in een vreemd team.
--
-- SELECT en DELETE blijven zoals ze waren. De using-kant van UPDATE ook:
-- ontkoppelen en herordenen van andermans gekoppelde oefening valt onder het
-- Training-recht (beslissing 3).
create or replace function public.oefening_koppelbaar(p_oefening_id uuid, p_team_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select is_team_member(p_team_id) and (
    exists (select 1 from oefeningen o
             where o.id = p_oefening_id and o.team_id = auth.uid())
    or exists (select 1 from training_oefeningen k
                where k.oefening_id = p_oefening_id and k.team_id = p_team_id)
  );
$$;

revoke execute on function public.oefening_koppelbaar(uuid, uuid) from public, anon;
grant execute on function public.oefening_koppelbaar(uuid, uuid) to authenticated;

drop policy if exists "training_oefeningen: own team only"        on training_oefeningen;
drop policy if exists "training_oefeningen: team_id = auth.uid()" on training_oefeningen;
drop policy if exists "training_oefeningen: lid mag lezen"        on training_oefeningen;
drop policy if exists "training_oefeningen: recht mag maken"      on training_oefeningen;
drop policy if exists "training_oefeningen: recht mag wijzigen"   on training_oefeningen;
drop policy if exists "training_oefeningen: recht mag wissen"     on training_oefeningen;

create policy "training_oefeningen: lid mag lezen"      on training_oefeningen for select using (is_team_member(team_id));
create policy "training_oefeningen: recht mag maken"    on training_oefeningen for insert
  with check (can_edit(team_id,'training') and oefening_koppelbaar(oefening_id, team_id));
create policy "training_oefeningen: recht mag wijzigen" on training_oefeningen for update
  using (can_edit(team_id,'training'))
  with check (can_edit(team_id,'training') and oefening_koppelbaar(oefening_id, team_id));
create policy "training_oefeningen: recht mag wissen"   on training_oefeningen for delete using (can_edit(team_id,'training'));
-- <<< einde training_oefeningen-blok

-- ── Zelfcontrole — stopt de transactie als het niet klopt ───
do $$
declare v_aantal int;
begin
  select count(*) into v_aantal from pg_policies
   where schemaname = 'public' and tablename = 'training_oefeningen'
     and policyname in ('training_oefeningen: recht mag maken', 'training_oefeningen: recht mag wijzigen')
     and position('oefening_koppelbaar' in with_check) > 0;
  if v_aantal <> 2 then
    raise exception 'M6b GESTOPT: niet beide policies (INSERT en UPDATE) hebben de eigenaarscheck (gevonden: %)', v_aantal;
  end if;

  select count(*) into v_aantal from pg_policies
   where schemaname = 'public' and tablename = 'training_oefeningen';
  if v_aantal <> 4 then
    raise exception 'M6b GESTOPT: training_oefeningen heeft % policies in plaats van 4 — een onbekende permissive policy zou de check omzeilen', v_aantal;
  end if;

  if has_function_privilege('anon', 'public.oefening_koppelbaar(uuid, uuid)', 'execute') then
    raise exception 'M6b GESTOPT: anon mag oefening_koppelbaar uitvoeren';
  end if;

  raise notice 'OK M6b: INSERT en UPDATE op training_oefeningen eisen een eigen of al gekoppelde oefening';
end $$;

commit;

-- Optioneel; Supabase herlaadt de PostgREST-schemacache normaal zelf na DDL.
notify pgrst, 'reload schema';

-- ============================================================
-- Controle na afloop
-- ============================================================
-- 1. De vier policies op training_oefeningen:
--
-- select policyname, cmd, qual, with_check
--   from pg_policies
--  where schemaname = 'public' and tablename = 'training_oefeningen'
--  order by policyname;
--
--    VERWACHT: vier rijen. "lid mag lezen" (SELECT, is_team_member), "recht mag
--    maken" (INSERT, with_check met can_edit én oefening_koppelbaar), "recht mag
--    wijzigen" (UPDATE, qual alleen can_edit, with_check met beide), "recht mag
--    wissen" (DELETE, can_edit).
--
-- 2. De functie is security definer met een vast search_path, en alleen voor
--    authenticated:
--
-- select p.prosecdef, p.proconfig,
--        has_function_privilege('anon', p.oid, 'execute')          as anon,
--        has_function_privilege('authenticated', p.oid, 'execute') as authenticated
--   from pg_proc p
--  where p.oid = 'public.oefening_koppelbaar(uuid, uuid)'::regprocedure;
--
--    VERWACHT: prosecdef = true, proconfig = {search_path=public},
--    anon = false, authenticated = true.
--
-- 3. Gedrag: blok 25 van supabase/team-rls-verificatie.sql.
