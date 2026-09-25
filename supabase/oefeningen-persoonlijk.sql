-- ============================================================
-- Pitchup — M6: oefeningen als persoonlijk bezit, zichtbaar via het trainingsplan
--
-- WANNEER DRAAIEN: NÁ M6b (supabase/oefeningen-koppeling-eigenaar.sql) en VÓÓR
-- de deploy van fase 4. Run dit eenmalig in de Supabase SQL Editor. Het script
-- is idempotent (drop-if-exists + create).
--
-- Volgorde van de hele feature (fase 1 t/m 3 staan al live):
--   M1  teams-en-leden.sql              fase 1
--   M3a inzichten-team-id.sql           fase 1
--   M2b team-rls-gevolgacties.sql       fase 1
--   M2  team-rls.sql                    fase 1
--   M3b inzichten-team-id-opruimen.sql  fase 1
--   M4  team-invites-rpc.sql            fase 2
--   M5  team-aanmaken-rpc.sql           fase 2
--   M5c team-fk-naar-teams.sql          fase 2
--   M5b team-bootstrap-policies-opruimen.sql  fase 2 (ná die deploy)
--       fase 3 heeft GEEN migratie (deleteTeam leunt op bestaande policies)
--   M6b oefeningen-koppeling-eigenaar.sql  EERST, vóór de deploy van fase 4
--   M6  oefeningen-persoonlijk.sql      DAARNA, vóór de deploy van fase 4  (dit bestand)
--       deploy fase 4
--
-- VOLGORDE IS HARD: M6b → M6. Deze policy maakt een oefening leesbaar zodra
-- hij in een plan van jouw team hangt; zonder M6b kan iemand met
-- Training-recht via een directe API-aanroep een willekeurige oefening-UUID in
-- dat plan hangen en hem zo lezen. M6b eist dat je alleen eigen (of al in het
-- team gekoppelde) oefeningen koppelt. Sectie 3f hieronder dwingt dit af: staat
-- M6b er nog niet, dan stopt dit script en rolt het alles terug.
--
-- ── WAT HET DOET ────────────────────────────────────────────
-- 1. `comment on column oefeningen.team_id`: de kolom betekent de EIGENAAR-USER
--    (auth.users.id), geen teams.id. Bewust niet hernoemd (beslissing 6: een
--    rename raakt ~40 call sites zonder functioneel verschil).
-- 2. Eén extra, PERMISSIVE SELECT-policy: een oefening is leesbaar voor elk
--    lid van een team in wiens trainingsplan hij gekoppeld staat (AC 19/20,
--    BR 57). Permissive policies worden ge-OR'd met de bestaande
--    "oefeningen: own team only", dus dit VERBREEDT UITSLUITEND LEZEN.
--    Bewerken, verwijderen en aanmaken blijven bij de eigenaar
--    (team_id = auth.uid()) — AC 35, BR 54/55.
--
-- WAAROM VÓÓR DE DEPLOY EN NIET ERNA: de fase-4-code toont bij een koppeling
-- van een teamgenoot een kopieerknop en leest daarvoor de gejoinde oefening.
-- Zonder deze policy geeft de join `training_oefeningen(*, oefeningen(*))`
-- voor zo'n koppeling `oefeningen: null`. Andersom is de policy onschadelijk
-- voor de huidige (fase-3-)code: de bibliotheek (/oefeningen) en de picker
-- filteren al expliciet op `team_id = ctx.userId`, en de enige plekken die nu
-- méér zien zijn de joins vanuit training_oefeningen — precies de bedoeling.
--
-- LET OP — DIT IS OOK EEN FIX VOOR FASE 2: sinds fase 2 kan een assistent met
-- Training-recht zijn EIGEN oefening aan het plan van het team koppelen. Tot
-- deze policy er is ziet de hoofdtrainer die koppeling met `oefeningen: null`
-- (de rij zelf is zichtbaar, de oefening niet). Hoe eerder M6 draait, hoe
-- beter.
--
-- ── VOORAF IN PRODUCTIE CONTROLEREN (pg_constraint, les uit fase 2) ──
-- De repo-SQL was bij fase 2 niet de volledige waarheid: vijf foreign keys
-- stonden alleen in het dashboard. Draai daarom VÓÓR dit script de twee
-- query's uit het kopblok "Controle vooraf" onderaan dit bestand en vergelijk
-- met de verwachte uitkomst. Wijkt er iets af: NIET draaien, eerst uitzoeken.
-- Sectie 3 hieronder toetst hetzelfde nog eens en stopt de transactie zelf
-- als het niet klopt.
--
-- ── WAT ER NIET VERANDERT ───────────────────────────────────
-- * Geen FK van oefeningen.team_id naar teams (die zou de verkeerde kant op
--   wijzen; blok 21 van team-rls-verificatie.sql bewaakt dat).
-- * training_oefeningen.oefening_id blijft ON DELETE CASCADE: een verwijderde
--   oefening verdwijnt uit elk trainingsplan, ook van andere teams (AC 22,
--   BR 47/48). Een FK-cascade is niet aan RLS onderworpen.
-- * Geen herkomstkolom voor kopieën (beslissing 2).
-- * Geen nieuwe index: idx_training_oefeningen_oefening
--   (supabase/training-plan.sql) dekt de subquery al.
--
-- Terugdraaien (alleen als het echt moet — de fase-4-UI verliest dan de
-- oefeningen van teamgenoten):
--   drop policy if exists "oefeningen: zichtbaar via gekoppeld trainingsplan" on public.oefeningen;
-- ============================================================

begin;

-- ── 1. Documentatie op de kolom ─────────────────────────────
comment on column public.oefeningen.team_id is
  'EIGENAAR-USER (auth.users.id), GEEN teams.id. Oefeningen zijn persoonlijk bezit en verhuizen niet met het actieve team mee. Leesbaar voor teamgenoten via een koppeling in training_oefeningen; bewerken en verwijderen alleen door de eigenaar. Zie supabase/oefeningen-persoonlijk.sql.';

-- ── 2. Leesbaar via een gekoppeld trainingsplan ─────────────
-- De subquery op training_oefeningen draait onder de RLS van de aanroeper
-- ("training_oefeningen: lid mag lezen", is_team_member(team_id)); is_team_member
-- hieronder is dus dubbel, maar expliciet: de voorwaarde moet ook kloppen als
-- iemand die leespolicy ooit verruimt. Geen recursie: de policies op
-- training_oefeningen lezen `oefeningen` niet.
drop policy if exists "oefeningen: zichtbaar via gekoppeld trainingsplan" on public.oefeningen;
create policy "oefeningen: zichtbaar via gekoppeld trainingsplan" on public.oefeningen
  for select
  using (exists (
    select 1 from public.training_oefeningen k
     where k.oefening_id = oefeningen.id
       and is_team_member(k.team_id)
  ));

-- ── 3. Zelfcontrole — stopt de transactie als de database afwijkt ──
-- Bewust pg_constraint/pg_policies en niet de repo of information_schema.
do $$
declare
  v_aantal int;
  v_namen text;
begin
  -- 3a. oefeningen.team_id heeft GEEN foreign key (eigenaar-user).
  select count(*) into v_aantal
    from pg_constraint con
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
   where con.contype = 'f'
     and con.conrelid = 'public.oefeningen'::regclass
     and att.attname = 'team_id';
  if v_aantal <> 0 then
    raise exception 'M6 GESTOPT: oefeningen.team_id heeft % foreign key(s). Dat is de EIGENAAR-USER; een FK (naar teams of auth.users) hoort hier niet. Eerst uitzoeken, zie de controle vooraf.', v_aantal;
  end if;

  -- 3b. De koppeling cascadet bij het verwijderen van een oefening (AC 22).
  select count(*) into v_aantal
    from pg_constraint con
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
   where con.contype = 'f'
     and con.conrelid = 'public.training_oefeningen'::regclass
     and att.attname = 'oefening_id'
     and con.confrelid = 'public.oefeningen'::regclass
     and con.confdeltype = 'c';
  if v_aantal <> 1 then
    raise exception 'M6 GESTOPT: training_oefeningen.oefening_id heeft geen (of meer dan één) FK naar oefeningen met ON DELETE CASCADE (gevonden: %). Accountverwijdering leunt daarop.', v_aantal;
  end if;

  -- 3c. Geen andere tabel verwijst naar oefeningen. Een onverwachte FK zonder
  --     cascade zou deleteOefening en deleteAccount laten stuklopen.
  select string_agg(con.conrelid::regclass || '.' || con.conname, ', ') into v_namen
    from pg_constraint con
   where con.contype = 'f'
     and con.confrelid = 'public.oefeningen'::regclass
     and con.conrelid <> 'public.training_oefeningen'::regclass;
  if v_namen is not null then
    raise exception 'M6 GESTOPT: onverwachte foreign key(s) naar oefeningen: %', v_namen;
  end if;

  -- 3d. Precies twee policies op oefeningen: de eigenaar (ALL) en deze nieuwe
  --     (SELECT). Een derde, onbekende permissive policy zou de hele set
  --     ondermijnen (permissive policies worden ge-OR'd).
  select string_agg(policyname || ' (' || cmd || ')', ', ' order by policyname) into v_namen
    from pg_policies
   where schemaname = 'public' and tablename = 'oefeningen';
  if v_namen is distinct from
     'oefeningen: own team only (ALL), oefeningen: zichtbaar via gekoppeld trainingsplan (SELECT)' then
    raise exception 'M6 GESTOPT: de policies op oefeningen zijn niet wat dit script verwacht: %', v_namen;
  end if;

  -- 3e. Schrijven blijft bij de eigenaar: de ALL-policy toetst in beide
  --     richtingen op team_id = auth.uid(). (Bewust een losse tekstvergelijking
  --     op de twee bestanddelen, niet op de exacte opmaak van pg_get_expr.)
  select count(*) into v_aantal
    from pg_policies
   where schemaname = 'public' and tablename = 'oefeningen'
     and policyname = 'oefeningen: own team only'
     and cmd = 'ALL'
     and position('team_id' in qual) > 0 and position('auth.uid()' in qual) > 0
     and position('team_id' in with_check) > 0 and position('auth.uid()' in with_check) > 0;
  if v_aantal <> 1 then
    raise exception 'M6 GESTOPT: "oefeningen: own team only" toetst niet meer op team_id = auth.uid() — bewerken/verwijderen zou dan niet meer eigenaar-only zijn';
  end if;

  -- 3f. M6b moet er AL staan. Zonder de eigenaarscheck op het koppelen zou
  --     deze SELECT-policy een leesgat openen (zie de kop). Zelfde controle
  --     als blok 25 van supabase/team-rls-verificatie.sql.
  select count(*) into v_aantal from pg_policies
   where schemaname = 'public' and tablename = 'training_oefeningen'
     and policyname in ('training_oefeningen: recht mag maken', 'training_oefeningen: recht mag wijzigen')
     and position('oefening_koppelbaar' in with_check) > 0;
  if v_aantal <> 2 then
    raise exception 'M6 GESTOPT: M6b ontbreekt — de INSERT- en UPDATE-policy op training_oefeningen hebben de eigenaarscheck niet (gevonden: % van 2). Draai eerst supabase/oefeningen-koppeling-eigenaar.sql en daarna dit script opnieuw.', v_aantal;
  end if;

  raise notice 'OK M6: kolom gedocumenteerd, SELECT-policy staat, FK''s en policies zijn zoals verwacht, M6b staat er al';
end $$;

commit;

-- Optioneel; Supabase herlaadt de PostgREST-schemacache normaal zelf na DDL.
notify pgrst, 'reload schema';

-- ============================================================
-- Controle vooraf — DRAAI DEZE TWEE VÓÓR HET SCRIPT (alleen lezen)
-- ============================================================
--
-- 1. Alle foreign keys OP oefeningen en training_oefeningen, en alles wat NAAR
--    oefeningen wijst:
--
-- select con.conrelid::regclass  as tabel,
--        con.conname             as constraint_naam,
--        con.confrelid::regclass as verwijst_naar,
--        con.confdeltype         as bij_delete,   -- c = cascade, n = set null, a = no action
--        pg_get_constraintdef(con.oid) as definitie
--   from pg_constraint con
--  where con.contype = 'f'
--    and (con.conrelid in ('public.oefeningen'::regclass, 'public.training_oefeningen'::regclass)
--         or con.confrelid = 'public.oefeningen'::regclass)
--  order by 1, 2;
--
--    VERWACHT (uit de repo-SQL), precies drie rijen, allemaal op
--    training_oefeningen:
--      event_id    -> events              bij_delete = c
--      oefening_id -> oefeningen          bij_delete = c
--      genest_in   -> training_oefeningen bij_delete = n
--    Dus: GEEN enkele rij met tabel = oefeningen (ook niet naar auth.users —
--    dat was het patroon van het fase-2-incident), GEEN team_id-FK op
--    training_oefeningen, en niets anders dat naar oefeningen wijst.
--
-- 2. De huidige policies op oefeningen:
--
-- select policyname, cmd, permissive, qual, with_check
--   from pg_policies
--  where schemaname = 'public' and tablename = 'oefeningen';
--
--    VERWACHT vóór M6: precies één rij, "oefeningen: own team only", cmd ALL,
--    qual en with_check allebei (team_id = auth.uid()).
--
-- ============================================================
-- Controle na afloop
-- ============================================================
-- 3. De kolom is gedocumenteerd:
--
-- select col_description('public.oefeningen'::regclass, attnum)
--   from pg_attribute
--  where attrelid = 'public.oefeningen'::regclass and attname = 'team_id';
--    -- begint met 'EIGENAAR-USER'
--
-- 4. Query 2 hierboven geeft nu twee rijen: de oude (ALL) en
--    "oefeningen: zichtbaar via gekoppeld trainingsplan" (SELECT).
--
-- 5. Blok 24 van supabase/team-rls-verificatie.sql toetst het gedrag met een
--    echte hoofdtrainer, assistent en buitenstaander; blok 25 de koppelregel
--    van M6b.
