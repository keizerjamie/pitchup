-- ============================================================
-- Pitchup — handmatig verificatiescript voor de team-RLS (fase 1)
--
-- WANNEER DRAAIEN: direct NA supabase/team-rls.sql (M2), en opnieuw na elke
-- latere wijziging aan de policies. Run dit in de Supabase SQL Editor.
--
-- WAAROM DIT BESTAAT: `npm test` bewijst NIETS over RLS. Vitest draait buiten
-- de Next-compiler en praat nooit met een database, en de chainable testmock
-- in app/actions/*.test.ts negeert .eq()-filters volledig. Een groene
-- testsuite en een lekkende policy kunnen prima naast elkaar bestaan. Dit
-- script is het enige automatische vangnet dat er wél naar kijkt.
--
-- HET SCRIPT SCHRIJFT NIETS WEG: alles staat in één transactie die op
-- `rollback` eindigt. Elke geslaagde controle geeft een NOTICE; de eerste
-- gefaalde controle gooit een exception en stopt de rest.
--
-- ── VOORBEREIDING (verplicht) ───────────────────────────────
-- Zoek-en-vervang hieronder vier waarden. Maak daarvoor eerst, via de app,
-- twee accounts met elk een eigen team:
--
--   select m.user_id, m.team_id, m.rol, s.value as teamnaam
--   from team_members m
--   left join settings s on s.team_id = m.team_id and s.key = 'team_name'
--   order by s.value;
--
--   OWNER_A_UUID      = user_id van de hoofdtrainer van team A
--   ASSISTENT_A_UUID  = user_id van een assistent in team A
--                       (in fase 1 bestaat die nog niet; zie "FASE 1" hieronder)
--   TEAM_A_UUID       = team_id van team A
--   TEAM_B_UUID       = team_id van een ANDER team, waar OWNER_A geen lid van is
--
-- FASE 1: er bestaan nog geen assistenten — de uitnodigingsflow komt in fase 2.
-- Blok 1, 2, 6 en 13 zijn nu al zinvol en moeten slagen. Blok 3 t/m 12 hebben
-- een echte assistent nodig; maak die desnoods tijdelijk aan met:
--
--   insert into team_members (team_id, user_id, rol) values
--     ('TEAM_A_UUID', 'ASSISTENT_A_UUID', 'assistent');
--   -- alle zes mag_*-kolommen staan dan op false (de default).
--
-- Die rij zit binnen de transactie van dit script alleen als je hem HIER
-- invoegt; doe je het los, denk dan aan opruimen.
-- ============================================================

begin;

-- ── Blok 1: een lid ziet de data van zijn eigen team ────────
do $$
declare n int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"OWNER_A_UUID","role":"authenticated"}';

  if not is_team_member('TEAM_A_UUID') then
    raise exception 'FOUT: OWNER_A is volgens is_team_member geen lid van TEAM_A';
  end if;
  if not is_team_owner('TEAM_A_UUID') then
    raise exception 'FOUT: OWNER_A is volgens is_team_owner geen hoofdtrainer van TEAM_A';
  end if;

  select count(*) into n from players where team_id = 'TEAM_A_UUID';
  raise notice 'OK blok 1: hoofdtrainer ziet % spelers in het eigen team', n;

  -- Een hoofdtrainer mag alles, op elk onderdeel.
  if not (can_edit('TEAM_A_UUID','spelers') and can_edit('TEAM_A_UUID','agenda')
      and can_edit('TEAM_A_UUID','aanwezigheid') and can_edit('TEAM_A_UUID','wedstrijd')
      and can_edit('TEAM_A_UUID','training') and can_edit('TEAM_A_UUID','periodisering')) then
    raise exception 'FOUT: can_edit weigert een onderdeel voor de hoofdtrainer';
  end if;

  -- Onbekend onderdeel moet DICHT vallen.
  if can_edit('TEAM_A_UUID','bestaat-niet') then
    raise exception 'LEK: can_edit geeft true voor een onbekend onderdeel';
  end if;
  reset role;
end $$;

-- ── Blok 2: een niet-lid ziet NIETS van een vreemd team ─────
do $$
declare n int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"OWNER_A_UUID","role":"authenticated"}';

  if is_team_member('TEAM_B_UUID') then
    raise exception 'FOUT IN DE OPZET: OWNER_A is wél lid van TEAM_B — kies een ander TEAM_B';
  end if;

  select count(*) into n from players            where team_id = 'TEAM_B_UUID';
  if n <> 0 then raise exception 'LEK: niet-lid ziet % spelers van een vreemd team', n; end if;
  select count(*) into n from events             where team_id = 'TEAM_B_UUID';
  if n <> 0 then raise exception 'LEK: niet-lid ziet % events van een vreemd team', n; end if;
  select count(*) into n from attendance         where team_id = 'TEAM_B_UUID';
  if n <> 0 then raise exception 'LEK: niet-lid ziet aanwezigheid van een vreemd team'; end if;
  select count(*) into n from absence_periods    where team_id = 'TEAM_B_UUID';
  if n <> 0 then raise exception 'LEK: niet-lid ziet afmeldperiodes van een vreemd team'; end if;
  select count(*) into n from lineups            where team_id = 'TEAM_B_UUID';
  if n <> 0 then raise exception 'LEK: niet-lid ziet opstellingen van een vreemd team'; end if;
  select count(*) into n from match_ratings      where team_id = 'TEAM_B_UUID';
  if n <> 0 then raise exception 'LEK: niet-lid ziet beoordelingen van een vreemd team'; end if;
  select count(*) into n from match_events       where team_id = 'TEAM_B_UUID';
  if n <> 0 then raise exception 'LEK: niet-lid ziet wedstrijdgebeurtenissen van een vreemd team'; end if;
  select count(*) into n from match_squad        where team_id = 'TEAM_B_UUID';
  if n <> 0 then raise exception 'LEK: niet-lid ziet de wedstrijdselectie van een vreemd team'; end if;
  select count(*) into n from task_overrides     where team_id = 'TEAM_B_UUID';
  if n <> 0 then raise exception 'LEK: niet-lid ziet afgevinkte taken van een vreemd team'; end if;
  select count(*) into n from metingen           where team_id = 'TEAM_B_UUID';
  if n <> 0 then raise exception 'LEK: niet-lid ziet metingen van een vreemd team'; end if;
  select count(*) into n from categorie_metingen where team_id = 'TEAM_B_UUID';
  if n <> 0 then raise exception 'LEK: niet-lid ziet nulmetingen van een vreemd team'; end if;
  select count(*) into n from training_oefeningen where team_id = 'TEAM_B_UUID';
  if n <> 0 then raise exception 'LEK: niet-lid ziet trainingsplannen van een vreemd team'; end if;
  select count(*) into n from settings           where team_id = 'TEAM_B_UUID';
  if n <> 0 then raise exception 'LEK: niet-lid ziet instellingen (incl. teamnaam) van een vreemd team'; end if;
  select count(*) into n from teams              where id = 'TEAM_B_UUID';
  if n <> 0 then raise exception 'LEK: niet-lid ziet de teams-rij van een vreemd team'; end if;
  select count(*) into n from team_members       where team_id = 'TEAM_B_UUID';
  if n <> 0 then raise exception 'LEK: niet-lid ziet de ledenlijst van een vreemd team'; end if;
  select count(*) into n from team_invites       where team_id = 'TEAM_B_UUID';
  if n <> 0 then raise exception 'LEK: niet-lid ziet de uitnodigingen van een vreemd team'; end if;

  raise notice 'OK blok 2: een niet-lid ziet geen enkele rij van een vreemd team';
  reset role;
end $$;

-- ── Blok 3: assistent ZONDER rechten mag lezen, niet schrijven
-- Let op het verschil in faalgedrag: een INSERT die de with check niet haalt
-- gooit SQLSTATE 42501; een UPDATE/DELETE die de using-clausule niet haalt
-- raakt gewoon 0 RIJEN zonder fout. Beide vormen worden hieronder getest.
do $$
declare n int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"ASSISTENT_A_UUID","role":"authenticated"}';

  if not is_team_member('TEAM_A_UUID') then
    raise exception 'FOUT IN DE OPZET: ASSISTENT_A is geen lid van TEAM_A';
  end if;
  if is_team_owner('TEAM_A_UUID') then
    raise exception 'FOUT IN DE OPZET: ASSISTENT_A is hoofdtrainer — kies een echte assistent';
  end if;

  -- Lezen mag altijd (AC: een assistent ziet alles).
  select count(*) into n from players where team_id = 'TEAM_A_UUID';
  raise notice 'OK blok 3: assistent ziet % spelers', n;

  -- Schrijven zonder recht mag niet.
  begin
    insert into players (team_id, name, position, active)
    values ('TEAM_A_UUID', 'RLS-controle', 'Keeper', true);
    raise exception 'LEK: assistent zonder spelersrecht kon een speler toevoegen';
  exception when insufficient_privilege then
    raise notice 'OK blok 3: insert op players geweigerd zonder spelersrecht';
  end;

  begin
    insert into events (team_id, type, date)
    values ('TEAM_A_UUID', 'training', current_date);
    raise exception 'LEK: assistent zonder agendarecht kon een event toevoegen';
  exception when insufficient_privilege then
    raise notice 'OK blok 3: insert op events geweigerd zonder agendarecht';
  end;

  update players set name = name where team_id = 'TEAM_A_UUID';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEK: assistent zonder spelersrecht kon % spelers wijzigen', n; end if;

  delete from players where team_id = 'TEAM_A_UUID';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEK: assistent zonder spelersrecht kon % spelers verwijderen', n; end if;

  raise notice 'OK blok 3: update en delete op players raakten 0 rijen';
  reset role;
end $$;

-- ── Blok 4: settings splitst per SLEUTEL ────────────────────
-- Een assistent met ALLE zes rechten mag nog steeds geen team_name,
-- team_logo_url, default_attendance of team_color_* aanraken; agenda-sleutels
-- en cyclus_week_correctie wél, mits hij het bijbehorende recht heeft.
do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"ASSISTENT_A_UUID","role":"authenticated"}';

  -- Geef de assistent binnen deze transactie tijdelijk ALLE zes rechten.
  -- `reset role` en niet `set local role postgres`: de sessie-rol hoeft niet
  -- per se postgres te heten, en resetten brengt je hoe dan ook terug bij de
  -- rol waarmee de SQL Editor draait.
  reset role;
  update team_members set
    mag_spelers_bewerken = true, mag_agenda_bewerken = true,
    mag_aanwezigheid_bewerken = true, mag_wedstrijd_bewerken = true,
    mag_training_bewerken = true, mag_periodisering_bewerken = true
  where team_id = 'TEAM_A_UUID' and user_id = 'ASSISTENT_A_UUID';
  set local role authenticated;

  if settings_key_editable('TEAM_A_UUID','team_name') then
    raise exception 'LEK: assistent met alle rechten mag de teamnaam wijzigen';
  end if;
  if settings_key_editable('TEAM_A_UUID','team_logo_url') then
    raise exception 'LEK: assistent met alle rechten mag het clublogo wijzigen';
  end if;
  if settings_key_editable('TEAM_A_UUID','default_attendance') then
    raise exception 'LEK: assistent met alle rechten mag de aanwezigheid-default wijzigen';
  end if;
  if settings_key_editable('TEAM_A_UUID','team_color_primary') then
    raise exception 'LEK: assistent met alle rechten mag de clubkleuren wijzigen';
  end if;
  if settings_key_editable('TEAM_A_UUID','een-onbekende-sleutel') then
    raise exception 'LEK: settings_key_editable staat een ONBEKENDE sleutel toe';
  end if;

  if not settings_key_editable('TEAM_A_UUID','season_start') then
    raise exception 'FOUT: assistent met agendarecht mag season_start niet wijzigen';
  end if;
  if not settings_key_editable('TEAM_A_UUID','cyclus_week_correctie') then
    raise exception 'FOUT: assistent met periodiseringsrecht mag cyclus_week_correctie niet wijzigen';
  end if;

  begin
    insert into settings (team_id, key, value)
    values ('TEAM_A_UUID', 'team_name', 'RLS-controle')
    on conflict (team_id, key) do update set value = excluded.value;
    raise exception 'LEK: assistent kon de teamnaam schrijven';
  exception when insufficient_privilege then
    raise notice 'OK blok 4: schrijven van team_name geweigerd voor een assistent';
  end;

  raise notice 'OK blok 4: settings-sleutels zijn correct gesplitst';
  reset role;
end $$;

-- ── Blok 5: assistent MET recht mag wél schrijven ───────────
do $$
declare n int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"ASSISTENT_A_UUID","role":"authenticated"}';
  -- De zes rechten staan sinds blok 4 (binnen deze transactie) op true.

  insert into players (team_id, name, position, active)
  values ('TEAM_A_UUID', 'RLS-controle', 'Keeper', true);
  raise notice 'OK blok 5: assistent met spelersrecht kon een speler toevoegen';

  update players set name = 'RLS-controle-2'
  where team_id = 'TEAM_A_UUID' and name = 'RLS-controle';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FOUT: assistent met spelersrecht kon de speler niet wijzigen'; end if;

  -- Een rij in een VREEMD team blijft onmogelijk, ook mét alle rechten.
  begin
    insert into players (team_id, name, position, active)
    values ('TEAM_B_UUID', 'RLS-controle', 'Keeper', true);
    raise exception 'LEK: assistent kon een speler in een VREEMD team toevoegen';
  exception when insufficient_privilege then
    raise notice 'OK blok 5: insert in een vreemd team geweigerd';
  end;
  reset role;
end $$;

-- ── Blok 6: storage-policy op de clublogo-bucket ────────────
-- De isolatie hangt hier niet aan een kolom maar aan het eerste padsegment
-- (team-logos/<team_id>/logo, zie lib/logo-upload.ts).
do $$
declare n int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"OWNER_A_UUID","role":"authenticated"}';

  select count(*) into n from storage.objects
  where bucket_id = 'team-logos' and (storage.foldername(name))[1] = 'TEAM_B_UUID';
  if n <> 0 then raise exception 'LEK: niet-lid ziet % logo-objecten van een vreemd team', n; end if;

  raise notice 'OK blok 6: de logomap van een vreemd team is niet zichtbaar';
  reset role;
end $$;

-- ============================================================
-- GEVOLGSCHRIJFACTIES (M2b — supabase/team-rls-gevolgacties.sql)
--
-- Vanaf hier wordt de rechtenset van ASSISTENT_A per blok opnieuw gezet, zodat
-- elk blok precies één onderdeel test. Alles blijft binnen dezelfde
-- transactie en verdwijnt bij de `rollback` onderaan.
--
-- Deze blokken hebben extra gegevens nodig. Zoek-en-vervang ook:
--   TRAINING_A_UUID  = id van een event met type 'training' in TEAM_A
--   MATCH_A_UUID     = id van een event met type 'match'    in TEAM_A
--   PLAYER_A_UUID    = id van een speler in TEAM_A
-- ============================================================

-- Hulpje: zet exact één recht aan voor ASSISTENT_A binnen deze transactie.
create or replace function pg_temp.zet_recht(p_onderdeel text) returns void
language plpgsql as $$
begin
  update team_members set
    mag_spelers_bewerken       = (p_onderdeel = 'spelers'),
    mag_agenda_bewerken        = (p_onderdeel = 'agenda'),
    mag_aanwezigheid_bewerken  = (p_onderdeel = 'aanwezigheid'),
    mag_wedstrijd_bewerken     = (p_onderdeel = 'wedstrijd'),
    mag_training_bewerken      = (p_onderdeel = 'training'),
    mag_periodisering_bewerken = (p_onderdeel = 'periodisering')
  where team_id = 'TEAM_A_UUID' and user_id = 'ASSISTENT_A_UUID';
end $$;

-- ── Blok 7: assistent met ALLEEN 'spelers' ──────────────────
-- markInjured/markRecovered schrijven attendance; de policy is daarvoor
-- verruimd met can_edit(team,'spelers') op INSERT en UPDATE.
do $$
declare n int;
begin
  reset role;
  perform pg_temp.zet_recht('spelers');
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"ASSISTENT_A_UUID","role":"authenticated"}';

  -- Het markInjured-pad: een afwezig-rij wegschrijven met de blessurevlag.
  insert into attendance (team_id, event_id, player_id, status, injury_set)
  values ('TEAM_A_UUID', 'TRAINING_A_UUID', 'PLAYER_A_UUID', 'absent', true)
  on conflict (event_id, player_id) do update
    set status = 'absent', injury_set = true;
  raise notice 'OK blok 7: spelersrecht mag een attendance-rij schrijven (markInjured-pad)';

  -- Het markRecovered-pad: dezelfde rij terugzetten.
  update attendance set injury_set = false
   where team_id = 'TEAM_A_UUID' and player_id = 'PLAYER_A_UUID';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'FOUT: spelersrecht kan de attendance-rij niet bijwerken'; end if;

  -- BEWUST AANVAARD RESTRISICO — GEEN LEK, NIET RAPPORTEREN ALS BUG.
  -- Met alleen Spelers-recht kan een assistent ook een willekeurige status
  -- zetten zonder Aanwezigheid-recht. Dat is strikt kleiner dan wat hij al
  -- mag: met deletePlayer wist hij in één klik de volledige
  -- aanwezigheidshistorie van die speler (FK-cascade, niet aan RLS
  -- onderworpen). Zie brief §8.2. Deze regel legt het gedrag vast, zodat een
  -- latere lezer ziet dat het bekend en gewogen is.
  update attendance set status = 'present'
   where team_id = 'TEAM_A_UUID' and player_id = 'PLAYER_A_UUID';
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'ONVERWACHT: het aanvaarde restrisico is dichtgetimmerd — werk brief §8.2 bij';
  end if;
  raise notice 'OK blok 7: aanvaard restrisico bevestigd (spelersrecht kan status zetten)';

  -- Verwijderen mag hij NIET: delete blijft strikt aanwezigheid.
  delete from attendance where team_id = 'TEAM_A_UUID' and player_id = 'PLAYER_A_UUID';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEK: spelersrecht kon % attendance-rijen verwijderen', n; end if;
  raise notice 'OK blok 7: delete op attendance geweigerd zonder aanwezigheidsrecht';
  reset role;
end $$;

-- ── Blok 8: assistent met ALLEEN 'agenda' ───────────────────
-- createEvent zet de aanwezigheidsrijen klaar: INSERT verruimd. UPDATE en
-- DELETE op attendance blijven dicht.
do $$
declare n int;
begin
  reset role;
  perform pg_temp.zet_recht('agenda');
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"ASSISTENT_A_UUID","role":"authenticated"}';

  insert into attendance (team_id, event_id, player_id, status)
  values ('TEAM_A_UUID', 'MATCH_A_UUID', 'PLAYER_A_UUID', 'unknown')
  on conflict (event_id, player_id) do nothing;
  raise notice 'OK blok 8: agendarecht mag een attendance-rij aanmaken';

  update attendance set status = 'present'
   where team_id = 'TEAM_A_UUID' and event_id = 'MATCH_A_UUID';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEK: agendarecht kon % attendance-rijen wijzigen', n; end if;

  delete from attendance where team_id = 'TEAM_A_UUID' and event_id = 'MATCH_A_UUID';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEK: agendarecht kon % attendance-rijen verwijderen', n; end if;
  raise notice 'OK blok 8: update en delete op attendance geweigerd met alleen agendarecht';
  reset role;
end $$;

-- ── Blok 9: assistent met ALLEEN 'training' — doelstelling ──
do $$
declare n int;
begin
  reset role;
  perform pg_temp.zet_recht('training');
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"ASSISTENT_A_UUID","role":"authenticated"}';

  perform set_event_doelstelling('TRAINING_A_UUID', 'RLS-controle doelstelling');
  raise notice 'OK blok 9: set_event_doelstelling slaagt met alleen trainingsrecht';

  -- Rechtstreeks schrijven blijft dicht: de events-policy is NIET verruimd.
  update events set doelstelling = 'direct' where id = 'TRAINING_A_UUID';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEK: trainingsrecht kon events rechtstreeks wijzigen'; end if;
  raise notice 'OK blok 9: directe update op events geweigerd';

  -- De RPC weigert een wedstrijd, ook met trainingsrecht.
  begin
    perform set_event_doelstelling('MATCH_A_UUID', 'mag niet');
    raise exception 'LEK: set_event_doelstelling accepteerde een WEDSTRIJD';
  exception when sqlstate 'P0002' then
    raise notice 'OK blok 9: set_event_doelstelling weigert een wedstrijd (Event niet gevonden)';
  end;
  reset role;
end $$;

-- ── Blok 10: assistent met ALLEEN 'wedstrijd' — uitslag ─────
do $$
declare n int;
begin
  reset role;
  perform pg_temp.zet_recht('wedstrijd');
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"ASSISTENT_A_UUID","role":"authenticated"}';

  perform set_match_result('MATCH_A_UUID', 3::smallint, 1::smallint);
  raise notice 'OK blok 10: set_match_result slaagt met alleen wedstrijdrecht';

  update events set goals_for = 9 where id = 'MATCH_A_UUID';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEK: wedstrijdrecht kon events rechtstreeks wijzigen'; end if;
  raise notice 'OK blok 10: directe update op events geweigerd';

  begin
    perform set_match_result('TRAINING_A_UUID', 1::smallint, 0::smallint);
    raise exception 'LEK: set_match_result accepteerde een TRAINING';
  exception when sqlstate 'P0002' then
    raise notice 'OK blok 10: set_match_result weigert een training (Event niet gevonden)';
  end;

  -- En zonder het juiste onderdeel faalt de RPC met 42501, niet stil.
  reset role;
  perform pg_temp.zet_recht('spelers');
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"ASSISTENT_A_UUID","role":"authenticated"}';
  begin
    perform set_match_result('MATCH_A_UUID', 0::smallint, 0::smallint);
    raise exception 'LEK: set_match_result slaagde zonder wedstrijdrecht';
  exception when sqlstate '42501' then
    raise notice 'OK blok 10: set_match_result weigert zonder wedstrijdrecht (Geen toegang)';
  end;
  reset role;
end $$;

-- ── Blok 11: verzameltijd (set_gather_time) ─────────────────
-- Besluit van de eigenaar op brief-vraag 8.8: onderdeel WEDSTRIJD.
do $$
declare n int;
begin
  reset role;
  perform pg_temp.zet_recht('wedstrijd');
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"ASSISTENT_A_UUID","role":"authenticated"}';

  perform set_gather_time('MATCH_A_UUID', '13:45'::time);
  raise notice 'OK blok 11: set_gather_time slaagt met alleen wedstrijdrecht';

  -- NULL = wissen, en dat is een geldige waarde.
  perform set_gather_time('MATCH_A_UUID', null);
  raise notice 'OK blok 11: set_gather_time wist de tijd met NULL';

  update events set gather_time = '09:00' where id = 'MATCH_A_UUID';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEK: wedstrijdrecht kon gather_time rechtstreeks zetten'; end if;

  begin
    perform set_gather_time('TRAINING_A_UUID', '13:45'::time);
    raise exception 'LEK: set_gather_time accepteerde een TRAINING';
  exception when sqlstate 'P0002' then
    raise notice 'OK blok 11: set_gather_time weigert een training';
  end;

  reset role;
  perform pg_temp.zet_recht('agenda');
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"ASSISTENT_A_UUID","role":"authenticated"}';
  begin
    perform set_gather_time('MATCH_A_UUID', '13:45'::time);
    raise exception 'LEK: set_gather_time slaagde met alleen agendarecht';
  exception when sqlstate '42501' then
    raise notice 'OK blok 11: set_gather_time weigert zonder wedstrijdrecht';
  end;
  reset role;
end $$;

-- ── Blok 12: trainingstype (set_trainingstype) ──────────────
-- Besluit van de eigenaar op brief-vraag 8.8: onderdeel TRAINING.
do $$
declare n int;
begin
  reset role;
  perform pg_temp.zet_recht('training');
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"ASSISTENT_A_UUID","role":"authenticated"}';

  perform set_trainingstype('TRAINING_A_UUID', 'teamtactisch');
  raise notice 'OK blok 12: set_trainingstype slaagt met alleen trainingsrecht';

  -- Whitelist: alleen de twee waarden uit events_trainingstype_check.
  begin
    perform set_trainingstype('TRAINING_A_UUID', 'onzin');
    raise exception 'LEK: set_trainingstype accepteerde een onbekende waarde';
  exception when sqlstate '22023' then
    raise notice 'OK blok 12: set_trainingstype weigert een onbekende waarde';
  end;

  update events set trainingstype = 'vct' where id = 'TRAINING_A_UUID';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEK: trainingsrecht kon trainingstype rechtstreeks zetten'; end if;

  begin
    perform set_trainingstype('MATCH_A_UUID', 'vct');
    raise exception 'LEK: set_trainingstype accepteerde een WEDSTRIJD';
  exception when sqlstate 'P0002' then
    raise notice 'OK blok 12: set_trainingstype weigert een wedstrijd';
  end;

  reset role;
  perform pg_temp.zet_recht('agenda');
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"ASSISTENT_A_UUID","role":"authenticated"}';
  begin
    perform set_trainingstype('TRAINING_A_UUID', 'vct');
    raise exception 'LEK: set_trainingstype slaagde met alleen agendarecht';
  exception when sqlstate '42501' then
    raise notice 'OK blok 12: set_trainingstype weigert zonder trainingsrecht';
  end;
  reset role;
end $$;

-- ── Blok 13: permanente sanity-check ────────────────────────
-- Geen enkel team zonder hoofdtrainer. Dit blok is ook LOS van de rest
-- waardevol: draai hem na elke migratie en na elke deploy. Een team zonder
-- owner betekent dat iemand permanent buitengesloten is van zijn eigen data,
-- zonder dat iets dat meldt.
do $$
declare n int;
begin
  reset role;
  select count(*) into n
    from teams t
    left join team_members m on m.team_id = t.id and m.rol = 'owner'
   where m.team_id is null;
  if n <> 0 then raise exception 'KAPOT: % team(s) zonder hoofdtrainer', n; end if;
  raise notice 'OK blok 13: elk team heeft een hoofdtrainer';
end $$;

rollback;

-- ============================================================
-- Blok 7 t/m 12 vereisen supabase/team-rls-gevolgacties.sql (M2b). Draaien ze
-- met een "function set_event_doelstelling does not exist"-fout, dan staat M2b
-- nog niet in deze database.
--
-- NOG NIET VAN TOEPASSING IN FASE 1 — toevoegen zodra die fase er is:
--
-- FASE 2 (uitnodigingen):
--   * token met verloopt_op = now()        -> accept_team_invite geeft 'invalid'
--   * token met verloopt_op = now() + '1 second' -> 'ok'
--   * een reeds lid dat accepteert         -> 'already_member', invite blijft
--                                             ONGEBRUIKT
--   * twee gelijktijdige sessies: één createInvite en één acceptInvite,
--     precies één heeft effect (open twee SQL-tabbladen, beide in een
--     transactie, en controleer de rij-lock via `for update`)
--   * een assistent die updateMemberRights/removeMember/createInvite probeert
--     -> geweigerd
--
-- FASE 4 (persoonlijke oefeningen):
--   * een oefening van een teamgenoot is WEL leesbaar via een gekoppeld
--     trainingsplan en NIET wijzigbaar of verwijderbaar
-- ============================================================
