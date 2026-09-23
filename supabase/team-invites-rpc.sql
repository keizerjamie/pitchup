-- ============================================================
-- Pitchup — M4: uitnodigings-RPC's (fase 2 "Staf, rechten en meerdere
-- lidmaatschappen")
--
-- WANNEER DRAAIEN: VÓÓR de deploy van fase 2. Run dit eenmalig in de Supabase
-- SQL Editor. Samen met M5 (supabase/team-aanmaken-rpc.sql); de onderlinge
-- volgorde van M4 en M5 maakt niet uit, ze raken elkaar niet.
--
-- Volgorde van de hele fase 2 — niet cosmetisch:
--   M4  supabase/team-invites-rpc.sql               vóór deploy  (dit bestand)
--   M5  supabase/team-aanmaken-rpc.sql              vóór deploy
--   M5c supabase/team-fk-naar-teams.sql             vóór deploy
--       deploy fase 2: uitnodigen/accepteren, rechten-UI, teamwisselaar,
--                      signUp + zelfherstel via create_team()
--       ==> rooktest: registreer één nieuw account -> moet een team opleveren
--   M5b supabase/team-bootstrap-policies-opruimen.sql  ná deploy
--
-- WAAROM VÓÓR DE DEPLOY: de fase-2-code roept deze functies rechtstreeks aan
-- (app/actions/team-invites.ts). Bestaan ze nog niet, dan geeft elke aanroep
-- PGRST202 en ziet de gebruiker "Er ging iets mis".
--
-- WAAROM DIT SCRIPT ONSCHULDIG IS VÓÓR DE DEPLOY: het voegt alleen functies
-- toe. Zolang niemand ze aanroept verandert er niets; team_invites blijft een
-- lege tabel die alleen een hoofdtrainer kan lezen en wissen (policies uit M1).
--
-- ── WAAROM ALLE VIER DE FUNCTIES SECURITY DEFINER ZIJN ──────
--   * peek/accept worden aangeroepen door iemand die (nog) GEEN lid is van het
--     team. Voor hem bestaat de rij niet — de SELECT-policy op team_invites is
--     "is_team_owner(team_id)". Zonder security definer kan hij niet eens zien
--     dat zijn link geldig is.
--   * create/revoke schrijven team_invites, en daar staat bewust GEEN
--     INSERT- of UPDATE-policy op (brief §1.5): schrijven kan uitsluitend
--     hierlangs, zodat de invariant "hooguit één actieve link per team" en de
--     eigenaarscheck niet op twee plekken geformuleerd hoeven te worden.
-- Verplicht bij elke security-definer-functie in dit project:
-- `set search_path = public` + revoke van public/anon + expliciete grant.
--
-- ── HET TOKEN ───────────────────────────────────────────────
-- Alleen de sha256-HASH (64 hex-tekens) komt hier langs; het ruwe token wordt
-- nergens opgeslagen en verlaat de server precies één keer, in het antwoord
-- van createInvite (lib/invite-token.ts). Een DB-dump of logregel is daarmee
-- onbruikbaar als toegangsmiddel.
--
-- ── TIJDZONE — HET SCHERPSTE PUNT VAN DEZE FEATURE ──────────
-- `verloopt_op` is timestamptz (UTC). De geldigheidsbeslissing valt
-- UITSLUITEND hier, met `verloopt_op <= now()` respectievelijk
-- `verloopt_op > now()` — servertijd van Postgres. Er komt nergens een
-- JS-Date aan te pas; de app krijgt de ISO-string alleen om hem te TONEN.
-- Dat dekt de edge case "exact na 7×24 uur".
--
-- Idempotent: alles is `create or replace`.
-- ============================================================

begin;

-- ── 1. peek_team_invite ──────────────────────────────────────
-- Toont de teamnaam die bij een geldige link hoort, zonder sessie (AC 3).
--
-- ÉÉN ONONDERSCHEIDBARE STATUS voor verlopen, gebruikt, ingetrokken én
-- onbekend (AC 23/24/25): 'invalid' met team_naam = null. Wie een token raadt
-- mag niet kunnen aflezen of hij bestaat.
--
-- GRANT OOK AAN anon (beslissing 12 van de eigenaar): een bezoeker zonder
-- account moet de teamnaam zien vóór hij registreert. Het token is de enige
-- sleutel; 32 random bytes maken raden onhaalbaar en de app-laag
-- (app/actions/team-invites.ts) zet er nog een IP-rate-limit voor.
--
-- Deze functie WIJZIGT NIETS. Een hoofdtrainer die zijn eigen link controleert
-- verbrandt hem dus niet.
create or replace function public.peek_team_invite(p_token_hash text)
returns table(status text, team_naam text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_team uuid;
begin
  select i.team_id into v_team
    from team_invites i
   where i.token_hash = p_token_hash
     and i.gebruikt_op is null
     and i.ingetrokken_op is null
     and i.verloopt_op > now();

  if v_team is null then
    return query select 'invalid'::text, null::text;
    return;
  end if;

  -- De teamnaam staat in settings onder 'team_name' — bewust geen kolom op
  -- teams (zie het comment op die tabel). Ontbreekt de rij, dan een lege
  -- string en niet null: de pagina toont dan een lege naam in plaats van
  -- "niet geldig" te suggereren.
  return query
    select 'ok'::text,
           coalesce((select s.value from settings s
                      where s.team_id = v_team and s.key = 'team_name'), '')::text;
end $$;

revoke execute on function public.peek_team_invite(text) from public;
grant  execute on function public.peek_team_invite(text) to anon, authenticated;

-- ── 2. accept_team_invite ────────────────────────────────────
-- Verzilvert een link: maakt de aanroeper assistent van het team, met ALLE ZES
-- RECHTEN OP FALSE (BR 39 — een nieuwe assistent begint als meekijker).
--
-- `for update` op de rij is de kern: hij beslecht de race uit de story. Trekt
-- de hoofdtrainer op hetzelfde moment een nieuwe link aan (create_team_invite
-- hieronder locked dezelfde rij), dan wacht de één op de ander en ziet de
-- verliezer een rij die inmiddels ingetrokken of gebruikt is -> 'invalid'.
--
-- ALREADY_MEMBER LAAT DE INVITE ONGEBRUIKT (beslissing 9 van de eigenaar):
-- anders verbrandt een hoofdtrainer zijn eigen link door hem te controleren,
-- en zou een assistent die de link per ongeluk twee keer opent hem voor de
-- volgende persoon opmaken. De rechten van dat bestaande lidmaatschap blijven
-- ongemoeid (AC 26) — accepteren mag nooit rechten weggooien.
--
-- GEEN anon-grant: accepteren vereist een sessie.
create or replace function public.accept_team_invite(p_token_hash text)
returns table(status text, team_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_invite record;
begin
  if v_user is null then
    raise exception 'Niet ingelogd' using errcode = '42501';
  end if;

  select i.id, i.team_id, i.gebruikt_op, i.ingetrokken_op, i.verloopt_op
    into v_invite
    from team_invites i
   where i.token_hash = p_token_hash
     for update;

  -- `not found` eerst: bij nul rijen mag er geen veld van v_invite gelezen
  -- worden. `verloopt_op <= now()` is daarna de ENIGE vervaltoets in de hele
  -- feature.
  if not found
     or v_invite.gebruikt_op is not null
     or v_invite.ingetrokken_op is not null
     or v_invite.verloopt_op <= now() then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  if exists (select 1 from team_members m
              where m.team_id = v_invite.team_id and m.user_id = v_user) then
    return query select 'already_member'::text, v_invite.team_id;
    return;
  end if;

  -- Rol en rechten staan hier hard: een uitnodiging levert ALTIJD een
  -- assistent zonder rechten op. Er is bewust geen parameter voor — dan zou
  -- de client zijn eigen rol kunnen kiezen.
  insert into team_members (team_id, user_id, rol,
    mag_spelers_bewerken, mag_agenda_bewerken, mag_aanwezigheid_bewerken,
    mag_wedstrijd_bewerken, mag_training_bewerken, mag_periodisering_bewerken)
  values (v_invite.team_id, v_user, 'assistent',
    false, false, false, false, false, false);

  update team_invites
     set gebruikt_op = now(), gebruikt_door = v_user
   where id = v_invite.id;

  return query select 'ok'::text, v_invite.team_id;
end $$;

revoke execute on function public.accept_team_invite(text) from public, anon;
grant  execute on function public.accept_team_invite(text) to authenticated;

-- ── 3. create_team_invite ────────────────────────────────────
-- Trekt de bestaande actieve link in en maakt de nieuwe aan, IN ÉÉN
-- TRANSACTIE (brief §1.3). Twee losse statements vanuit de app kunnen dat niet
-- veilig: er staat geen INSERT/UPDATE-policy op team_invites, en tussen de
-- twee statements zou een acceptatie van de oude link erdoorheen kunnen
-- glippen.
--
-- De `for update` op de actieve rij is dezelfde lock als in
-- accept_team_invite — precies één van de twee wint.
--
-- p_team_id komt van de aanroeper, maar is_team_owner() is de poort: een
-- vreemd team-id levert 'Geen toegang' op, geen rij.
create or replace function public.create_team_invite(p_team_id uuid, p_token_hash text)
returns table(invite_id uuid, verloopt_op timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_verloopt timestamptz;
begin
  if v_user is null then
    raise exception 'Niet ingelogd' using errcode = '42501';
  end if;
  -- Uitnodigen is hoofdtrainer-werk, ook voor een assistent met alle zes
  -- bewerkrechten (AC 46).
  if not is_team_owner(p_team_id) then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;
  -- Vormcheck op de hash: 64 hex-tekens, zoals sha256 ze oplevert
  -- (lib/invite-token.ts). Zo kan er geen vrije tekst in de kolom belanden.
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Ongeldige uitnodiging' using errcode = '22023';
  end if;

  -- Advisory lock per TEAM, binnen deze transactie. De `for update` hieronder
  -- lockt niets zolang er nog géén actieve rij is: twee gelijktijdige
  -- aanroepen (een dubbelklik op "Link genereren") zouden dan allebei
  -- invoegen en zou er één stuklopen op de partiële unique index
  -- team_invites_een_actief_per_team — 23505, wat de gebruiker als een
  -- generieke "er ging iets mis" te zien krijgt. Met de lock serialiseren de
  -- twee aanroepen: de tweede trekt de link van de eerste in en levert een
  -- nieuwe. Dat is precies wat de knop belooft, en het is hetzelfde
  -- gereedschap als in create_team (M5).
  --
  -- Bewust de lock EN de `for update`: de lock beschermt het "nog geen rij"-
  -- geval, de `for update` beslecht de race met accept_team_invite, dat
  -- dezelfde rij vasthoudt.
  perform pg_advisory_xact_lock(hashtext('pitchup:team_invite:' || p_team_id::text));

  perform 1 from team_invites i
    where i.team_id = p_team_id
      and i.gebruikt_op is null
      and i.ingetrokken_op is null
    for update;

  update team_invites
     set ingetrokken_op = now()
   where team_id = p_team_id
     and gebruikt_op is null
     and ingetrokken_op is null;

  -- verloopt_op komt uit de kolomdefault (now() + 7 dagen, M1). Bewust geen
  -- parameter: een client mag de looptijd niet kunnen kiezen.
  insert into team_invites (team_id, token_hash, aangemaakt_door)
  values (p_team_id, p_token_hash, v_user)
  returning id, team_invites.verloopt_op into v_id, v_verloopt;

  return query select v_id, v_verloopt;
end $$;

revoke execute on function public.create_team_invite(uuid, text) from public, anon;
grant  execute on function public.create_team_invite(uuid, text) to authenticated;

-- ── 4. revoke_team_invite ────────────────────────────────────
-- Trekt de actieve link in zonder een nieuwe te maken. Geeft true als er
-- daadwerkelijk iets is ingetrokken.
--
-- Bewust een UPDATE (ingetrokken_op) en geen DELETE, ook al staat er een
-- DELETE-policy op team_invites: de rij blijft zo als spoor bestaan ("er is op
-- <datum> een link uitgezet en ingetrokken"), en de partiële unique index
-- `team_invites_een_actief_per_team` telt hem daarna niet meer mee.
create or replace function public.revoke_team_invite(p_team_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_aantal int;
begin
  if auth.uid() is null then
    raise exception 'Niet ingelogd' using errcode = '42501';
  end if;
  if not is_team_owner(p_team_id) then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;

  update team_invites
     set ingetrokken_op = now()
   where team_id = p_team_id
     and gebruikt_op is null
     and ingetrokken_op is null;

  get diagnostics v_aantal = row_count;
  return v_aantal > 0;
end $$;

revoke execute on function public.revoke_team_invite(uuid) from public, anon;
grant  execute on function public.revoke_team_invite(uuid) to authenticated;

-- ── 5. active_team_invite ────────────────────────────────────
-- "Staat er een link open, en tot wanneer?" voor de Instellingenpagina.
--
-- WAAROM EEN FUNCTIE EN GEEN GEWONE SELECT: het filter op de vervaltijd hoort
-- met `now()` in de database te gebeuren. Een PostgREST-query zou daar een
-- JS-Date voor moeten meesturen, en dan beslist de klok van de app-server
-- over geldigheid terwijl accept_team_invite de klok van de database gebruikt.
-- Die twee mogen niet uit elkaar kunnen lopen.
--
-- GEEFT NOOIT HET TOKEN of de hash terug: die is gehasht opgeslagen en de link
-- is na één keer tonen niet meer te reproduceren (bewust, beslissing 5).
create or replace function public.active_team_invite(p_team_id uuid)
returns table(verloopt_op timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_team_owner(p_team_id) then
    raise exception 'Geen toegang' using errcode = '42501';
  end if;

  return query
    select i.verloopt_op
      from team_invites i
     where i.team_id = p_team_id
       and i.gebruikt_op is null
       and i.ingetrokken_op is null
       and i.verloopt_op > now()
     order by i.verloopt_op desc
     limit 1;
end $$;

revoke execute on function public.active_team_invite(uuid) from public, anon;
grant  execute on function public.active_team_invite(uuid) to authenticated;

commit;

-- Optioneel; Supabase herlaadt de PostgREST-schemacache normaal zelf na DDL.
notify pgrst, 'reload schema';

-- ── Controle na afloop ───────────────────────────────────────
-- 1. De vijf functies staan er, alle vijf security definer:
--
-- select p.proname, p.prosecdef, pg_get_function_identity_arguments(p.oid)
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('peek_team_invite','accept_team_invite',
--                     'create_team_invite','revoke_team_invite',
--                     'active_team_invite')
-- order by 1;
-- -- vijf rijen, prosecdef = true
--
-- 2. Alleen peek_team_invite is voor anon uitvoerbaar:
--
-- select p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'execute') as mag
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- cross join (values ('anon'),('authenticated')) as r(rolname)
-- where n.nspname = 'public'
--   and p.proname in ('peek_team_invite','accept_team_invite',
--                     'create_team_invite','revoke_team_invite',
--                     'active_team_invite')
-- order by 1, 2;
-- -- anon mag UITSLUITEND peek_team_invite; authenticated mag alle vijf.
--
-- 3. Er staat nog steeds geen INSERT- of UPDATE-policy op team_invites
--    (schrijven kan alleen via de functies hierboven):
--
-- select policyname, cmd from pg_policies
--  where schemaname = 'public' and tablename = 'team_invites' order by cmd;
-- -- alleen SELECT en DELETE, beide "owner"-policies uit M1.
--
-- ── Functionele verificatie ──────────────────────────────────
-- De vervaltermijn, de race en het already_member-pad staan als blok 14 t/m 16
-- in supabase/team-rls-verificatie.sql. Draai die na dit script.
