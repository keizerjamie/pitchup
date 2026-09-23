-- ============================================================
-- Pitchup — M5c: foreign keys van auth.users naar teams verleggen
--
-- WANNEER DRAAIEN: VÓÓR de deploy van fase 2, ná M4 en M5. Run dit eenmalig
-- in de Supabase SQL Editor.
--
-- Volgorde van de hele fase 2 — niet cosmetisch:
--   M4  supabase/team-invites-rpc.sql               vóór deploy
--   M5  supabase/team-aanmaken-rpc.sql              vóór deploy
--   M5c supabase/team-fk-naar-teams.sql             vóór deploy  (dit bestand)
--       deploy fase 2
--       ==> rooktest: registreer één nieuw account, dat MOET een team opleveren
--   M5b supabase/team-bootstrap-policies-opruimen.sql  ná deploy
--
-- ── WAAROM DIT BESTAAT: EEN PRODUCTIE-INCIDENT ──────────────
-- Bij de rooktest van fase 2 faalde create_team() met:
--
--   23503  insert or update on table "settings" violates foreign key
--          constraint "settings_team_id_fkey"
--          Key (team_id)=(...) is not present in table "users".
--
-- In de productiedatabase bleken VIJF tabellen een foreign key
-- `team_id -> auth.users(id) on delete cascade` te hebben die NERGENS in deze
-- repo staat: players, events, attendance, lineups en settings. Die
-- constraints zijn ooit handmatig in het Supabase-dashboard aangemaakt, in de
-- tijd dat "account = team" gold en team_id dus letterlijk een user-id wás.
-- Geen van de andere tabellen met een team_id heeft zo'n FK.
--
-- Sinds create_team() (M5) krijgt elk NIEUW team een eigen uuid
-- (gen_random_uuid()) die per definitie niet in auth.users voorkomt. Elke
-- eerste rij van zo'n team — te beginnen bij de settings-rij `team_name`
-- binnen create_team zelf — loopt daardoor stuk. Dit script legt de vijf FK's
-- om naar de tabel waar ze sinds fase 1 thuishoren: teams.
--
-- LES, EN DE ENIGE REDEN DAT DIT ONS VERRASTE: de repo-SQL was niet de
-- volledige waarheid over het schema. Handmatige dashboard-wijzigingen staan
-- nergens in git. Bij een volgende schemawijziging is `pg_constraint` (niet
-- de repo) de bron van waarheid — zie de controlequery onderaan.
--
-- ── WAAROM DIT VEILIG IS VOOR BESTAANDE DATA ────────────────
-- Voor elk team dat vóór fase 1 bestond geldt `teams.id = de user-id van de
-- hoofdtrainer` (de backfill in supabase/teams-en-leden.sql sectie 6 vulde
-- teams rechtstreeks uit auth.users). Elke bestaande team_id-waarde die
-- vandaag een geldige auth.users(id) is, staat dus óók in teams. De nieuwe
-- constraint valideert bij het aanmaken alle bestaande rijen en accepteert ze
-- daarom allemaal.
--
-- WAT ER FAALT ALS ER TOCH EEN WEES IS: een rij met een team_id waarvoor geen
-- teams-rij bestaat (bijvoorbeeld een account dat tussen M1 en de deploy van
-- fase 1 registreerde en waarvoor de tweede backfill-ronde is overgeslagen).
-- Postgres weigert dan de ALTER met 23503 en de hele transactie rolt terug —
-- er blijft geen half omgelegde staat achter. Sectie 1 hieronder vangt dat
-- geval op vóórdat het zover komt en noemt de oplossing bij naam: draai
-- sectie 6 van supabase/teams-en-leden.sql (de backfill) opnieuw en probeer
-- het daarna nog eens.
--
-- ── oefeningen KRIJGT BEWUST GEEN FK NAAR teams ─────────────
-- `oefeningen.team_id` betekent EIGENAAR-USER (auth.users.id), geen teams.id:
-- een oefening is persoonlijk bezit van de maker en verhuist niet met het
-- actieve team mee (brief §1.8, `assertOwnOefening` in lib/authz.ts). Een FK
-- naar teams zou daar dus precies de verkeerde kant op wijzen en elke
-- oefening van een assistent onmogelijk maken. De tabel staat daarom NIET in
-- de lijst hieronder en moet daar ook nooit bij komen.
--
-- ── GEVOLG VOOR ACCOUNTVERWIJDERING ─────────────────────────
-- Na dit script ruimt `delete from auth.users` de teamdata NIET meer op.
-- Dat is geen verlies: deleteAccount (app/actions/auth.ts) wist alle dertien
-- teamtabellen al expliciet, per team, vóórdat het auth-account verdwijnt —
-- het leunde nergens op deze cascade. Wat er wél bij komt: `delete from teams`
-- neemt vanaf nu players/events/attendance/lineups/settings mee via de nieuwe
-- cascade. Dat overlapt met de expliciete deletes en is onschadelijk (die
-- lopen eerst en laten niets over).
--
-- Idempotent: sectie 2 dropt ELKE bestaande foreign key op `team_id` van de
-- vijf tabellen — ongeacht de naam — en zet daarna de canonieke terug. Dit
-- script mag dus opnieuw gedraaid worden, ook als het al een keer (of in een
-- andere vorm) is uitgevoerd.
-- ============================================================

begin;

-- ── 1. Wezen opsporen vóór de ALTER ──────────────────────────
-- Zonder dit blok komt dezelfde fout eruit als een kale 23503 zonder enige
-- aanwijzing wat je eraan moet doen.
do $$
declare
  v_tabel text;
  v_aantal bigint;
  v_totaal bigint := 0;
begin
  foreach v_tabel in array array['players','events','attendance','lineups','settings'] loop
    execute format(
      'select count(*) from public.%I x
        where x.team_id is not null
          and not exists (select 1 from public.teams t where t.id = x.team_id)',
      v_tabel) into v_aantal;
    if v_aantal > 0 then
      raise warning 'WEES: % rij(en) in % met een team_id dat niet in teams staat', v_aantal, v_tabel;
      v_totaal := v_totaal + v_aantal;
    end if;
  end loop;

  if v_totaal > 0 then
    raise exception
      'M5c GESTOPT: % wees-rij(en). Draai eerst de backfill (sectie 6 van supabase/teams-en-leden.sql) opnieuw; die maakt voor elk auth.users-account alsnog een teams-rij. Kom je er dan nog niet uit, zoek de betreffende team_id-waarden op met de query in het kopcommentaar.',
      v_totaal;
  end if;

  raise notice 'OK: geen wees-rijen, de vijf FK''s kunnen veilig omgelegd worden';
end $$;

-- ── 2. De vijf FK's omleggen ─────────────────────────────────
-- Drop-en-hermaak in ÉÉN transactie: er is geen moment waarop de kolom
-- onbeschermd is voor een andere sessie.
--
-- Bewust NIET `drop constraint if exists <vaste naam>`: het script is in
-- productie al een keer los gedraaid en een eerdere versie kan een andere
-- constraintnaam hebben gebruikt. Dan zou een vaste naam een no-op zijn en
-- zou de `add` er een TWEEDE foreign key naast zetten. Daarom wordt elke
-- bestaande FK op de kolom team_id opgeruimd, ongeacht naam.
--
-- LET OP: dit dropt élke foreign key waarin team_id voorkomt. Voor deze vijf
-- tabellen is dat er hooguit één, enkelkoloms. Komt er ooit een samengestelde
-- FK bij waarin team_id meedoet, dan moet dit blok specifieker worden.
do $$
declare
  v_tabel text;
  v_con record;
begin
  foreach v_tabel in array array['players','events','attendance','lineups','settings'] loop
    for v_con in
      select con.conname
        from pg_constraint con
        join pg_attribute att
          on att.attrelid = con.conrelid
         and att.attnum = any (con.conkey)
       where con.contype = 'f'
         and con.conrelid = format('public.%I', v_tabel)::regclass
         and att.attname = 'team_id'
    loop
      raise notice 'Drop % op %', v_con.conname, v_tabel;
      execute format('alter table public.%I drop constraint %I', v_tabel, v_con.conname);
    end loop;

    execute format(
      'alter table public.%I
         add constraint %I foreign key (team_id)
         references public.teams(id) on delete cascade',
      v_tabel, v_tabel || '_team_id_fkey');
    raise notice 'OK: %.team_id wijst nu naar teams(id)', v_tabel;
  end loop;
end $$;

commit;

-- Optioneel; Supabase herlaadt de PostgREST-schemacache normaal zelf na DDL.
notify pgrst, 'reload schema';

-- ── Controle na afloop — VERPLICHT ───────────────────────────
-- 1. Alle vijf de FK's wijzen nu naar `teams`.
--
--    Bewust `pg_constraint` en NIET information_schema: die views tonen voor
--    de `postgres`-rol geen constraints die naar het `auth`-schema wijzen, en
--    precies daardoor bleven deze vijf FK's jarenlang onzichtbaar. Dat is de
--    directe oorzaak van het incident dat dit script oplost.
--
-- select con.conrelid::regclass  as tabel,
--        con.conname             as constraint_naam,
--        con.confrelid::regclass as verwijst_naar,
--        con.confdeltype         as bij_delete   -- 'c' = cascade
--   from pg_constraint con
--  where con.contype = 'f'
--    and con.conrelid in ('public.players'::regclass, 'public.events'::regclass,
--                         'public.attendance'::regclass, 'public.lineups'::regclass,
--                         'public.settings'::regclass)
--  order by 1;
-- -- vijf rijen; `verwijst_naar` moet overal `teams` zijn en nergens
-- -- `users`/`auth.users`, en bij_delete = 'c'.
--
-- 2. Breder: staat er NERGENS meer een FK op een team_id-kolom die naar
--    auth.users wijst? (Vangt ook een tabel op die hier nog niet in de lijst
--    stond.)
--
-- select con.conrelid::regclass as tabel, con.conname, con.confrelid::regclass as verwijst_naar
--   from pg_constraint con
--   join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
--  where con.contype = 'f'
--    and att.attname = 'team_id'
--    and con.confrelid = 'auth.users'::regclass;
-- -- moet LEEG zijn.
--
-- 3. `oefeningen` heeft nog steeds GEEN FK op team_id — dat is de
--    eigenaar-user en hoort dat te blijven.
--
-- select count(*) as oefeningen_fks
--   from pg_constraint con
--   join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
--  where con.contype = 'f' and con.conrelid = 'public.oefeningen'::regclass
--    and att.attname = 'team_id';
-- -- moet 0 zijn.
--
-- 4. Rooktest ná de deploy: registreer één nieuw account. Dat moet een team
--    opleveren (create_team schrijft de settings-rij `team_name`, en dát was
--    de rij die stukliep). Blok 21 van supabase/team-rls-verificatie.sql
--    controleert punt 1 t/m 3 automatisch.
