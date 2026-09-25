-- ============================================================
-- Pitchup — handmatig verificatiescript voor de team-RLS (fase 1 t/m 4)
--
-- WANNEER DRAAIEN: direct NA supabase/team-rls.sql (M2), opnieuw na M4/M5
-- (fase 2), na de deploy van fase 3, na M6 (fase 4) en verder na elke
-- wijziging aan de policies of de RPC's. Run dit in
-- de Supabase SQL Editor.
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
-- Voor blok 14 t/m 20 (fase 2, uitnodigingen en team aanmaken) is er één
-- waarde extra nodig:
--
--   BUITENSTAANDER_UUID = user_id van iemand die GEEN lid is van TEAM_A
--                         (bijvoorbeeld de hoofdtrainer van TEAM_B)
--
-- WELKE BLOKKEN WANNEER:
--   * blok 1, 2, 6, 13        — altijd zinvol, ook zonder assistent
--   * blok 3 t/m 12           — vereisen een echte assistent in TEAM_A (M2b)
--   * blok 14 t/m 19          — vereisen M4 (supabase/team-invites-rpc.sql)
--   * blok 20                 — vereist M5 (supabase/team-aanmaken-rpc.sql)
--   * blok 21                 — vereist M5c (supabase/team-fk-naar-teams.sql);
--                               leest alleen de catalogus, geen testaccount nodig
--   * blok 22 en 23           — fase 3 (team verwijderen/verlaten); geen eigen
--                               migratie, wel een assistent én blok 14 (blok 23
--                               laat BUITENSTAANDER vertrekken uit TEAM_A)
--   * blok 24                 — vereist M6 (supabase/oefeningen-persoonlijk.sql)
--                               en blok 23 (BUITENSTAANDER als niet-lid)
--   * blok 25                 — vereist M6b (supabase/oefeningen-koppeling-
--                               eigenaar.sql) en blok 23
--
-- Bestaat er nog geen assistent (dat kan tot de eerste uitnodiging is
-- geaccepteerd), maak er dan tijdelijk een aan met:
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

  -- LET OP — VOOR EEN OWNER GEEFT OOK EEN ONBEKEND ONDERDEEL `true`, EN DAT IS
  -- GEEN LEK. can_edit() is `m.rol = 'owner' or case p_onderdeel ...`: bij een
  -- hoofdtrainer kortsluit de OR vóór de case, dus de naam van het onderdeel
  -- doet er niet toe. Dat is ontworpen gedrag — een hoofdtrainer mag per
  -- definitie alles in zijn eigen team, ook een onderdeel dat later wordt
  -- toegevoegd. De "onbekend valt dicht"-regel uit de brief gaat over
  -- ASSISTENTEN en wordt daarom in blok 3 getest, niet hier.
  --
  -- Deze assertie legt de kortsluiting expliciet vast, want de
  -- bootstrap-INSERT-policy op team_members leunt erop: die staat toe dat
  -- iemand zijn eigen owner-rij met alle zes vlaggen op `false` aanmaakt, en
  -- dat is alleen onschadelijk zolang can_edit() op `rol = 'owner'` kortsluit
  -- (zie rand 1 bij die policy in supabase/teams-en-leden.sql). Haalt iemand
  -- die kortsluiting ooit weg, dan faalt deze regel — precies de bedoeling.
  if not can_edit('TEAM_A_UUID','bestaat-niet') then
    raise exception 'FOUT: can_edit kort niet meer kort op rol = owner — de bootstrap-policy leunt daarop';
  end if;
  raise notice 'OK blok 1: can_edit kort kort op rol = owner (ook voor een onbekend onderdeel)';
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

  -- HIER hoort de "onbekend onderdeel valt dicht"-regel thuis: bij een
  -- assistent loopt can_edit() wél door de case-takken, en die eindigt op
  -- `else false`. Dat is wat een toekomstig zevende onderdeel afdwingt zonder
  -- dat iemand de functie bijwerkt. (Bij een owner kortsluit de OR ervóór —
  -- zie blok 1.)
  if can_edit('TEAM_A_UUID','bestaat-niet') then
    raise exception 'LEK: can_edit geeft true voor een onbekend onderdeel bij een assistent';
  end if;
  raise notice 'OK blok 3: onbekend onderdeel valt dicht voor een assistent';

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

-- ============================================================
-- UITNODIGINGEN (M4 — supabase/team-invites-rpc.sql, fase 2)
--
-- Deze blokken vereisen M4. Draaien ze met een "function peek_team_invite does
-- not exist"-fout, dan staat M4 nog niet in deze database.
--
-- Zoek-en-vervang hiervoor één extra waarde:
--   BUITENSTAANDER_UUID = user_id van iemand die GEEN lid is van TEAM_A
--                         (bijvoorbeeld de hoofdtrainer van TEAM_B)
--
-- Alles blijft binnen dezelfde transactie en verdwijnt bij de `rollback`
-- onderaan — ook de lidmaatschappen die accept_team_invite hier aanmaakt.
-- ============================================================

-- ── Blok 14: de vervaltermijn valt in de DATABASE ───────────
-- Dit is de enige plek in de hele feature waar over geldigheid wordt beslist:
-- `verloopt_op <= now()` in accept_team_invite. now() is binnen één transactie
-- constant, dus de twee randen hieronder zijn exact te testen.
do $$
declare v_status text; v_team uuid; n int;
begin
  reset role;
  delete from team_invites where team_id = 'TEAM_A_UUID';

  -- Rand 1: exact op het verloopmoment -> ONGELDIG.
  insert into team_invites (team_id, token_hash, aangemaakt_door, verloopt_op)
  values ('TEAM_A_UUID', repeat('a', 64), 'OWNER_A_UUID', now());

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"BUITENSTAANDER_UUID","role":"authenticated"}';
  select status, team_id into v_status, v_team from accept_team_invite(repeat('a', 64));
  if v_status <> 'invalid' then
    raise exception 'LEK: een token dat exact NU verloopt werd geaccepteerd (%)', v_status;
  end if;
  raise notice 'OK blok 14: verloopt_op = now() geeft invalid';

  reset role;
  select count(*) into n from team_members
   where team_id = 'TEAM_A_UUID' and user_id = 'BUITENSTAANDER_UUID';
  if n <> 0 then raise exception 'LEK: verlopen token leverde toch een lidmaatschap op'; end if;

  -- Rand 2: één seconde later -> GELDIG.
  delete from team_invites where team_id = 'TEAM_A_UUID';
  insert into team_invites (team_id, token_hash, aangemaakt_door, verloopt_op)
  values ('TEAM_A_UUID', repeat('b', 64), 'OWNER_A_UUID', now() + interval '1 second');

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"BUITENSTAANDER_UUID","role":"authenticated"}';
  select status, team_id into v_status, v_team from accept_team_invite(repeat('b', 64));
  if v_status <> 'ok' or v_team <> 'TEAM_A_UUID' then
    raise exception 'KAPOT: een geldig token werd geweigerd (%)', v_status;
  end if;
  raise notice 'OK blok 14: verloopt_op = now() + 1 second geeft ok';

  -- De nieuwe assistent begint met NUL rechten (BR 39).
  reset role;
  select count(*) into n from team_members
   where team_id = 'TEAM_A_UUID' and user_id = 'BUITENSTAANDER_UUID'
     and rol = 'assistent'
     and not mag_spelers_bewerken and not mag_agenda_bewerken
     and not mag_aanwezigheid_bewerken and not mag_wedstrijd_bewerken
     and not mag_training_bewerken and not mag_periodisering_bewerken;
  if n <> 1 then raise exception 'KAPOT: nieuwe assistent kreeg niet precies nul rechten'; end if;
  raise notice 'OK blok 14: nieuwe assistent is assistent met alle zes rechten op false';

  -- De invite is nu verbruikt en een tweede poging faalt.
  select count(*) into n from team_invites
   where token_hash = repeat('b', 64) and gebruikt_op is not null
     and gebruikt_door = 'BUITENSTAANDER_UUID';
  if n <> 1 then raise exception 'KAPOT: de invite is niet als gebruikt gemarkeerd'; end if;
  raise notice 'OK blok 14: de invite is eenmalig';
end $$;

-- ── Blok 15: een bestaand lid verbruikt de link NIET ────────
-- Beslissing 9 van de eigenaar: anders verbrandt de hoofdtrainer zijn eigen
-- link door hem te controleren. De rechten van dat lidmaatschap blijven ook
-- ongemoeid (AC 26) — accepteren mag nooit rechten weggooien.
do $$
declare v_status text; v_team uuid; n int;
begin
  reset role;
  delete from team_invites where team_id = 'TEAM_A_UUID';
  insert into team_invites (team_id, token_hash, aangemaakt_door)
  values ('TEAM_A_UUID', repeat('c', 64), 'OWNER_A_UUID');
  update team_members set mag_spelers_bewerken = true
   where team_id = 'TEAM_A_UUID' and user_id = 'ASSISTENT_A_UUID';

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"ASSISTENT_A_UUID","role":"authenticated"}';
  select status, team_id into v_status, v_team from accept_team_invite(repeat('c', 64));
  if v_status <> 'already_member' then
    raise exception 'KAPOT: een bestaand lid kreeg status % in plaats van already_member', v_status;
  end if;
  if v_team <> 'TEAM_A_UUID' then
    raise exception 'KAPOT: already_member gaf niet het team-id terug';
  end if;

  reset role;
  select count(*) into n from team_invites
   where token_hash = repeat('c', 64)
     and gebruikt_op is null and ingetrokken_op is null;
  if n <> 1 then raise exception 'LEK: een bestaand lid heeft de uitnodiging verbruikt'; end if;

  select count(*) into n from team_members
   where team_id = 'TEAM_A_UUID' and user_id = 'ASSISTENT_A_UUID' and mag_spelers_bewerken;
  if n <> 1 then raise exception 'KAPOT: accepteren heeft bestaande rechten gewist'; end if;
  raise notice 'OK blok 15: already_member laat de invite ongebruikt en de rechten ongemoeid';
end $$;

-- ── Blok 16: peek toont de teamnaam, maar verraadt niets ────
-- Verlopen, gebruikt, ingetrokken en onbekend geven ALLEMAAL exact dezelfde
-- uitkomst: ('invalid', null). Wie een token raadt mag niet kunnen aflezen of
-- hij bestaat (AC 23/24/25).
do $$
declare v_status text; v_naam text; v_verwacht text;
begin
  reset role;
  delete from team_invites where team_id = 'TEAM_A_UUID';
  insert into team_invites (team_id, token_hash, aangemaakt_door) values
    ('TEAM_A_UUID', repeat('d', 64), 'OWNER_A_UUID');
  select coalesce(value, '') into v_verwacht from settings
   where team_id = 'TEAM_A_UUID' and key = 'team_name';

  -- Zonder sessie (de anon-rol), want de invite-pagina is publiek
  -- (beslissing 12 + proxy.ts).
  set local role anon;
  set local request.jwt.claims = '{"role":"anon"}';
  select status, team_naam into v_status, v_naam from peek_team_invite(repeat('d', 64));
  if v_status <> 'ok' then
    raise exception 'KAPOT: anon kan een geldige uitnodiging niet bekijken (%)', v_status;
  end if;
  if v_naam is distinct from coalesce(v_verwacht, '') then
    raise exception 'KAPOT: peek gaf teamnaam % in plaats van %', v_naam, v_verwacht;
  end if;
  raise notice 'OK blok 16: anon ziet de teamnaam bij een geldige link';

  -- Onbekend token.
  select status, team_naam into v_status, v_naam from peek_team_invite(repeat('e', 64));
  if v_status <> 'invalid' or v_naam is not null then
    raise exception 'LEK: onbekend token gaf % / %', v_status, v_naam;
  end if;

  reset role;
  update team_invites set ingetrokken_op = now() where token_hash = repeat('d', 64);
  set local role anon;
  set local request.jwt.claims = '{"role":"anon"}';
  select status, team_naam into v_status, v_naam from peek_team_invite(repeat('d', 64));
  if v_status <> 'invalid' or v_naam is not null then
    raise exception 'LEK: ingetrokken token gaf % / %', v_status, v_naam;
  end if;

  reset role;
  update team_invites set ingetrokken_op = null, verloopt_op = now() - interval '1 day'
   where token_hash = repeat('d', 64);
  set local role anon;
  set local request.jwt.claims = '{"role":"anon"}';
  select status, team_naam into v_status, v_naam from peek_team_invite(repeat('d', 64));
  if v_status <> 'invalid' or v_naam is not null then
    raise exception 'LEK: verlopen token gaf % / %', v_status, v_naam;
  end if;

  reset role;
  update team_invites set verloopt_op = now() + interval '7 days', gebruikt_op = now()
   where token_hash = repeat('d', 64);
  set local role anon;
  set local request.jwt.claims = '{"role":"anon"}';
  select status, team_naam into v_status, v_naam from peek_team_invite(repeat('d', 64));
  if v_status <> 'invalid' or v_naam is not null then
    raise exception 'LEK: gebruikt token gaf % / %', v_status, v_naam;
  end if;

  raise notice 'OK blok 16: verlopen, ingetrokken, gebruikt en onbekend geven alle vier exact ''invalid'' zonder teamnaam';
  reset role;
end $$;

-- ── Blok 17: staf beheren is hoofdtrainer-werk ──────────────
-- AC 32/46: een assistent — ook met alle zes bewerkrechten — kan geen rechten
-- wijzigen, geen lid verwijderen, geen link genereren en geen link intrekken.
do $$
declare n int; v_ok boolean;
begin
  reset role;
  delete from team_invites where team_id = 'TEAM_A_UUID';
  update team_members set
    mag_spelers_bewerken = true, mag_agenda_bewerken = true,
    mag_aanwezigheid_bewerken = true, mag_wedstrijd_bewerken = true,
    mag_training_bewerken = true, mag_periodisering_bewerken = true
   where team_id = 'TEAM_A_UUID' and user_id = 'ASSISTENT_A_UUID';

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"ASSISTENT_A_UUID","role":"authenticated"}';

  -- updateMemberRights: de UPDATE-policy eist is_team_owner -> 0 rijen, geen
  -- fout. Hij probeert hier zijn EIGEN rij te wijzigen; ook dat mag niet.
  update team_members set mag_spelers_bewerken = false
   where team_id = 'TEAM_A_UUID' and user_id = 'ASSISTENT_A_UUID';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEK: assistent kon % rechtenrij(en) wijzigen', n; end if;

  -- removeMember: de DELETE-policy laat alleen de owner of het lid zelf toe.
  -- De owner-rij is sowieso onaanraakbaar (rol = 'assistent' in de policy).
  delete from team_members where team_id = 'TEAM_A_UUID' and user_id = 'OWNER_A_UUID';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEK: assistent kon de hoofdtrainer verwijderen'; end if;
  raise notice 'OK blok 17: assistent kan geen rechten wijzigen en de hoofdtrainer niet verwijderen';

  -- createInvite / revokeInvite lopen via de RPC's; die gooien 42501.
  begin
    perform create_team_invite('TEAM_A_UUID', repeat('f', 64));
    raise exception 'LEK: assistent kon een uitnodigingslink genereren';
  exception when insufficient_privilege then
    raise notice 'OK blok 17: create_team_invite geweigerd voor een assistent';
  end;

  begin
    perform revoke_team_invite('TEAM_A_UUID');
    raise exception 'LEK: assistent kon een uitnodigingslink intrekken';
  exception when insufficient_privilege then
    raise notice 'OK blok 17: revoke_team_invite geweigerd voor een assistent';
  end;

  begin
    perform active_team_invite('TEAM_A_UUID');
    raise exception 'LEK: assistent kon de actieve uitnodiging opvragen';
  exception when insufficient_privilege then
    raise notice 'OK blok 17: active_team_invite geweigerd voor een assistent';
  end;

  -- Rechtstreeks in team_invites schrijven kan ook niet: er staat geen
  -- INSERT-policy op de tabel.
  begin
    insert into team_invites (team_id, token_hash, aangemaakt_door)
    values ('TEAM_A_UUID', repeat('9', 64), 'ASSISTENT_A_UUID');
    raise exception 'LEK: assistent kon rechtstreeks een invite-rij schrijven';
  exception when insufficient_privilege then
    raise notice 'OK blok 17: directe insert in team_invites geweigerd';
  end;

  -- En hij ziet de uitnodigingen van zijn team niet (SELECT is owner-only).
  reset role;
  insert into team_invites (team_id, token_hash, aangemaakt_door)
  values ('TEAM_A_UUID', repeat('7', 64), 'OWNER_A_UUID');
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"ASSISTENT_A_UUID","role":"authenticated"}';
  select count(*) into n from team_invites where team_id = 'TEAM_A_UUID';
  if n <> 0 then raise exception 'LEK: assistent ziet % uitnodiging(en) van zijn team', n; end if;
  raise notice 'OK blok 17: assistent ziet geen enkele uitnodigingsrij';
  reset role;
end $$;

-- ── Blok 18: één actieve link per team ──────────────────────
-- AC 2/44: een nieuwe link maken trekt de oude direct in. De partiële unique
-- index team_invites_een_actief_per_team is het tweede vangnet.
do $$
declare v_verloopt timestamptz; n int; v_status text;
begin
  reset role;
  delete from team_invites where team_id = 'TEAM_A_UUID';

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"OWNER_A_UUID","role":"authenticated"}';

  select verloopt_op into v_verloopt from create_team_invite('TEAM_A_UUID', repeat('1', 64));
  if v_verloopt is null then raise exception 'KAPOT: create_team_invite gaf geen vervaldatum'; end if;
  -- Kolomdefault: zeven dagen, in de database bepaald.
  if v_verloopt <= now() + interval '6 days' or v_verloopt > now() + interval '8 days' then
    raise exception 'KAPOT: vervaldatum ligt niet rond 7 dagen (%)', v_verloopt;
  end if;

  perform create_team_invite('TEAM_A_UUID', repeat('2', 64));

  reset role;
  select count(*) into n from team_invites
   where team_id = 'TEAM_A_UUID' and gebruikt_op is null and ingetrokken_op is null;
  if n <> 1 then raise exception 'KAPOT: % actieve uitnodigingen na het vervangen', n; end if;
  select count(*) into n from team_invites
   where token_hash = repeat('1', 64) and ingetrokken_op is not null;
  if n <> 1 then raise exception 'KAPOT: de oude link is niet ingetrokken'; end if;
  raise notice 'OK blok 18: de nieuwe link vervangt de oude en die oude is direct ingetrokken';

  -- De ingetrokken link is meteen onbruikbaar.
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"BUITENSTAANDER_UUID","role":"authenticated"}';
  select status into v_status from accept_team_invite(repeat('1', 64));
  if v_status <> 'invalid' then
    raise exception 'LEK: de ingetrokken link werkt nog (%)', v_status;
  end if;
  raise notice 'OK blok 18: de ingetrokken link geeft invalid';

  -- revoke_team_invite maakt het team linkloos.
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"OWNER_A_UUID","role":"authenticated"}';
  if not revoke_team_invite('TEAM_A_UUID') then
    raise exception 'KAPOT: revoke_team_invite meldde dat er niets in te trekken viel';
  end if;
  if revoke_team_invite('TEAM_A_UUID') then
    raise exception 'KAPOT: revoke_team_invite trok twee keer iets in';
  end if;
  select count(*) into n from active_team_invite('TEAM_A_UUID');
  if n <> 0 then raise exception 'KAPOT: er staat nog een actieve link na het intrekken'; end if;
  raise notice 'OK blok 18: intrekken werkt en is idempotent';
  reset role;
end $$;

-- ── Blok 19: een vreemd team is onbereikbaar ────────────────
-- Tenant-isolatie op de RPC's: p_team_id komt van de client, dus dit is de
-- controle dat is_team_owner() de enige poort is.
do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"OWNER_A_UUID","role":"authenticated"}';

  begin
    perform create_team_invite('TEAM_B_UUID', repeat('3', 64));
    raise exception 'LEK: hoofdtrainer van A kon een link voor team B maken';
  exception when insufficient_privilege then
    raise notice 'OK blok 19: create_team_invite weigert een vreemd team';
  end;

  begin
    perform revoke_team_invite('TEAM_B_UUID');
    raise exception 'LEK: hoofdtrainer van A kon een link van team B intrekken';
  exception when insufficient_privilege then
    raise notice 'OK blok 19: revoke_team_invite weigert een vreemd team';
  end;

  begin
    perform active_team_invite('TEAM_B_UUID');
    raise exception 'LEK: hoofdtrainer van A kon de link van team B opvragen';
  exception when insufficient_privilege then
    raise notice 'OK blok 19: active_team_invite weigert een vreemd team';
  end;
  reset role;
end $$;

-- ── Blok 20: create_team maakt nooit een team zonder owner ──
-- M5. De functie doet de drie inserts in één transactie; deze controle bewijst
-- dat de owner-rij en de teamnaam er meteen bij staan.
do $$
declare v_team uuid; n int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"BUITENSTAANDER_UUID","role":"authenticated"}';

  -- BUITENSTAANDER is na blok 14 assistent van TEAM_A en nergens hoofdtrainer.
  -- Met p_alleen_zonder_team = true MOET hij hier alsnog een eigen team
  -- krijgen: de functie kijkt uitsluitend naar een OWNER-lidmaatschap. Zonder
  -- die rolfilter zou ze TEAM_A teruggeven, en zou het zelfherstel in
  -- lib/team-context.ts dat assistent-team als eigen owner-team behandelen —
  -- canEdit/assertIsOwner zouden dan één request lang openstaan.
  v_team := create_team('RLS-controle team', true);
  if v_team = 'TEAM_A_UUID'::uuid then
    raise exception 'LEK: create_team gaf een ASSISTENT-team terug als eigen team';
  end if;
  raise notice 'OK blok 20: p_alleen_zonder_team kijkt alleen naar owner-lidmaatschappen';
  reset role;

  select count(*) into n from team_members
   where team_id = v_team and user_id = 'BUITENSTAANDER_UUID' and rol = 'owner'
     and mag_spelers_bewerken and mag_agenda_bewerken and mag_aanwezigheid_bewerken
     and mag_wedstrijd_bewerken and mag_training_bewerken and mag_periodisering_bewerken;
  if n <> 1 then raise exception 'KAPOT: create_team leverde geen owner-rij met alle rechten'; end if;

  select count(*) into n from settings
   where team_id = v_team and key = 'team_name' and value = 'RLS-controle team';
  if n <> 1 then raise exception 'KAPOT: create_team schreef de teamnaam niet'; end if;

  if v_team = 'BUITENSTAANDER_UUID'::uuid then
    raise exception 'KAPOT: een NIEUW team hoort een eigen uuid te krijgen, niet de user-id';
  end if;
  raise notice 'OK blok 20: create_team levert team, hoofdtrainer en naam in één keer';

  -- Lege naam wordt geweigerd.
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"BUITENSTAANDER_UUID","role":"authenticated"}';
  begin
    perform create_team('   ');
    raise exception 'KAPOT: create_team accepteerde een lege naam';
  exception when others then
    if sqlstate <> '22023' then raise; end if;
    raise notice 'OK blok 20: lege teamnaam geweigerd';
  end;

  -- p_alleen_zonder_team (het zelfherstel-pad) maakt geen TWEEDE team. Welk
  -- bestaand team hij teruggeeft doet er niet toe — deze gebruiker kan er
  -- inmiddels meerdere hebben; de eis is dat het AANTAL teams niet groeit.
  reset role;
  select count(*) into n from teams;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"BUITENSTAANDER_UUID","role":"authenticated"}';
  perform create_team('Mag niet', true);
  reset role;
  if (select count(*) from teams) <> n then
    raise exception 'KAPOT: p_alleen_zonder_team maakte alsnog een team aan';
  end if;
  raise notice 'OK blok 20: p_alleen_zonder_team maakt geen tweede team';
end $$;

-- ── Blok 21: de vijf FK's wijzen naar teams, niet naar auth.users ──
-- M5c (supabase/team-fk-naar-teams.sql). Dit blok bestaat door een echt
-- productie-incident: players, events, attendance, lineups en settings hadden
-- een handmatig, nooit in de repo vastgelegd `team_id -> auth.users(id)`.
-- Sinds create_team() krijgt een nieuw team een eigen uuid, en die staat per
-- definitie niet in auth.users — elke eerste rij van zo'n team liep stuk met
-- 23503.
--
-- Bewust pg_constraint en NIET information_schema: die views verbergen voor de
-- postgres-rol de constraints die naar het auth-schema wijzen, en precies
-- daardoor bleven deze vijf jarenlang onzichtbaar.
do $$
declare v_con record; n int;
begin
  reset role;

  -- 1. Alle vijf moeten bestaan en naar teams wijzen, met cascade.
  for v_con in
    select unnest(array['players','events','attendance','lineups','settings']) as tabel
  loop
    select count(*) into n
      from pg_constraint con
      join pg_attribute att
        on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
     where con.contype = 'f'
       and con.conrelid = format('public.%I', v_con.tabel)::regclass
       and att.attname = 'team_id'
       and con.confrelid = 'public.teams'::regclass
       and con.confdeltype = 'c';
    if n <> 1 then
      raise exception 'KAPOT: %.team_id heeft geen enkele (of meer dan één) foreign key naar teams(id) on delete cascade — draai supabase/team-fk-naar-teams.sql (M5c)', v_con.tabel;
    end if;
  end loop;
  raise notice 'OK blok 21: alle vijf de team_id-FK''s wijzen naar teams(id) met cascade';

  -- 2. Nergens meer een team_id-FK naar auth.users. Dit vangt ook een tabel op
  --    die nog niet in de lijst van M5c stond.
  select count(*) into n
    from pg_constraint con
    join pg_attribute att
      on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
   where con.contype = 'f'
     and att.attname = 'team_id'
     and con.confrelid = 'auth.users'::regclass;
  if n <> 0 then
    raise exception 'KAPOT: % foreign key(s) op een team_id-kolom wijzen nog naar auth.users', n;
  end if;
  raise notice 'OK blok 21: geen enkele team_id-FK wijst nog naar auth.users';

  -- 3. oefeningen.team_id is de EIGENAAR-USER en hoort JUIST geen FK naar
  --    teams te hebben. Zou die er ooit bij komen, dan kan een assistent geen
  --    eigen oefening meer maken.
  select count(*) into n
    from pg_constraint con
    join pg_attribute att
      on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
   where con.contype = 'f'
     and con.conrelid = 'public.oefeningen'::regclass
     and att.attname = 'team_id';
  if n <> 0 then
    raise exception 'KAPOT: oefeningen.team_id heeft een foreign key gekregen — dat is de EIGENAAR-USER, geen teams.id';
  end if;
  raise notice 'OK blok 21: oefeningen.team_id heeft terecht geen foreign key';
end $$;

-- ============================================================
-- VERWIJDEREN (fase 3 — geen migratie; de policies bestaan sinds M1/M2)
-- ============================================================

-- ── Blok 22: team verwijderen (deleteTeam) ──────────────────
-- AC 14/31/49. Dit blok bewijst drie dingen:
--   a. een assistent (hier met alle zes rechten) en een hoofdtrainer van een
--      ÁNDER team kunnen een team niet verwijderen — 0 rijen, geen fout;
--   b. de hoofdtrainer kan exact de deletes van deleteTeam uitvoeren — de
--      dertien tabellen uit TEAM_TABELLEN (lib/team-opruimen.ts) en daarna
--      `delete from teams` — zonder fout, ook nu de cascade van M5c overlapt
--      met de expliciete deletes;
--   c. daarna staat er niets meer van dat team, maar blijven de oefening van
--      de assistent (persoonlijk bezit, BR 54) en zijn lidmaatschap van een
--      ANDER team bestaan.
-- Het echte TEAM_A wordt NIET verwijderd: het blok maakt een wegwerpteam via
-- create_team, en ook dat verdwijnt bij de rollback onderaan.
--
-- De lijst achter "TEAM_TABELLEN" hieronder moet gelijk blijven aan de
-- constante in lib/team-opruimen.ts; een structuurtest in
-- assistent-fase1-fundament.acceptance.test.ts bewaakt dat.
do $$
declare
  v_team uuid; v_event uuid; v_speler uuid; v_oef uuid;
  v_tabel text; n int;
begin
  -- a. Weigeren.
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"ASSISTENT_A_UUID","role":"authenticated"}';
  if is_team_owner('TEAM_A_UUID') then
    raise exception 'FOUT IN DE OPZET: ASSISTENT_A is hoofdtrainer van TEAM_A';
  end if;
  delete from teams where id = 'TEAM_A_UUID';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEK: een assistent kon het team verwijderen'; end if;

  set local request.jwt.claims = '{"sub":"OWNER_A_UUID","role":"authenticated"}';
  delete from teams where id = 'TEAM_B_UUID';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEK: de hoofdtrainer van A kon team B verwijderen'; end if;
  raise notice 'OK blok 22: een assistent en een hoofdtrainer van een ander team kunnen een team niet verwijderen';

  -- b. Een wegwerpteam van OWNER_A, met data in meerdere tabellen, een
  --    assistent met Training-recht, een open uitnodiging en een koppeling
  --    van de EIGEN oefening van die assistent.
  v_team := create_team('RLS-controle weggooiteam');
  insert into team_members (team_id, user_id, rol, mag_training_bewerken)
  values (v_team, 'ASSISTENT_A_UUID', 'assistent', true);
  insert into players (team_id, name, position, active)
  values (v_team, 'RLS-controle', 'Keeper', true) returning id into v_speler;
  insert into events (team_id, type, date)
  values (v_team, 'training', current_date) returning id into v_event;
  insert into attendance (team_id, event_id, player_id, status)
  values (v_team, v_event, v_speler, 'present');
  insert into categorie_metingen (team_id, categorie, datum, stap)
  values (v_team, 'partijen_groot', current_date, 1);
  perform create_team_invite(v_team, repeat('6', 64));

  set local request.jwt.claims = '{"sub":"ASSISTENT_A_UUID","role":"authenticated"}';
  insert into oefeningen (team_id, naam, categorie)
  values ('ASSISTENT_A_UUID', 'RLS-controle assistent-oefening', 'overig') returning id into v_oef;
  insert into training_oefeningen (team_id, event_id, oefening_id)
  values (v_team, v_event, v_oef);

  -- deleteTeam, uitgevoerd onder de rol van de hoofdtrainer.
  set local request.jwt.claims = '{"sub":"OWNER_A_UUID","role":"authenticated"}';
  -- TEAM_TABELLEN
  foreach v_tabel in array array['training_oefeningen','task_overrides','match_squad','match_events','match_ratings','lineups','attendance','absence_periods','categorie_metingen','metingen','events','players','settings'] loop
    execute format('delete from public.%I where team_id = $1', v_tabel) using v_team;
  end loop;

  -- De expliciete deletes moeten zelf het werk doen, niet de cascade:
  -- categorie_metingen heeft GEEN foreign key naar teams en zou anders als
  -- wees achterblijven. Daarom hier al tellen, vóór `delete from teams`.
  reset role;
  foreach v_tabel in array array['training_oefeningen','task_overrides','match_squad','match_events','match_ratings','lineups','attendance','absence_periods','categorie_metingen','metingen','events','players','settings'] loop
    execute format('select count(*) from public.%I where team_id = $1', v_tabel) into n using v_team;
    if n <> 0 then
      raise exception 'KAPOT: de hoofdtrainer kon % rij(en) in % van zijn eigen team niet verwijderen (RLS)', n, v_tabel;
    end if;
  end loop;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"OWNER_A_UUID","role":"authenticated"}';
  delete from teams where id = v_team;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'KAPOT: de hoofdtrainer kon zijn eigen team niet verwijderen (% rijen)', n; end if;
  raise notice 'OK blok 22: de hoofdtrainer voert alle deletes van deleteTeam foutloos uit';

  -- c. Wat er over is.
  reset role;
  foreach v_tabel in array array['team_members','team_invites'] loop
    execute format('select count(*) from public.%I where team_id = $1', v_tabel) into n using v_team;
    if n <> 0 then
      raise exception 'KAPOT: na deleteTeam staan er nog % rij(en) in % — de cascade op teams werkt niet', n, v_tabel;
    end if;
  end loop;
  select count(*) into n from teams where id = v_team;
  if n <> 0 then raise exception 'KAPOT: de teams-rij staat er nog'; end if;

  select count(*) into n from oefeningen where id = v_oef;
  if n <> 1 then
    raise exception 'KAPOT: de oefening van de assistent is meeverwijderd — oefeningen zijn persoonlijk bezit (BR 54)';
  end if;
  select count(*) into n from team_members
   where team_id = 'TEAM_A_UUID' and user_id = 'ASSISTENT_A_UUID';
  if n <> 1 then
    raise exception 'KAPOT: de assistent verloor ook zijn lidmaatschap van een ANDER team';
  end if;
  raise notice 'OK blok 22: team, lidmaatschappen en uitnodiging weg; oefening en ander lidmaatschap van de assistent intact';
end $$;

-- ── Blok 23: team verlaten (leaveTeam) ──────────────────────
-- Beslissing 8: de policy staat het toe, er is (nog) geen UI. De DELETE-policy
-- "team_members: owner of vertrek" laat alleen de EIGEN assistent-rij toe.
-- BUITENSTAANDER is sinds blok 14 assistent van TEAM_A; na dit blok is hij dat
-- niet meer, en blok 24 gebruikt hem daarom als niet-lid.
do $$
declare n int;
begin
  set local role authenticated;

  -- Een hoofdtrainer kan zijn eigen owner-rij niet weghalen: dan blijft er een
  -- team zonder hoofdtrainer over (zie blok 13).
  set local request.jwt.claims = '{"sub":"OWNER_A_UUID","role":"authenticated"}';
  delete from team_members where team_id = 'TEAM_A_UUID' and user_id = 'OWNER_A_UUID';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEK: de hoofdtrainer kon zijn eigen team verlaten'; end if;

  set local request.jwt.claims = '{"sub":"BUITENSTAANDER_UUID","role":"authenticated"}';
  if not is_team_member('TEAM_A_UUID') then
    raise exception 'FOUT IN DE OPZET: BUITENSTAANDER is geen lid van TEAM_A (is blok 14 gedraaid?)';
  end if;

  -- Een assistent kan een ANDERE assistent niet laten vertrekken.
  delete from team_members where team_id = 'TEAM_A_UUID' and user_id = 'ASSISTENT_A_UUID';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEK: een assistent kon een andere assistent uit het team zetten'; end if;

  -- Wel zichzelf.
  delete from team_members where team_id = 'TEAM_A_UUID' and user_id = 'BUITENSTAANDER_UUID';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'KAPOT: een assistent kon zijn eigen lidmaatschap niet opzeggen'; end if;
  if is_team_member('TEAM_A_UUID') then
    raise exception 'KAPOT: na het vertrek is BUITENSTAANDER nog steeds lid van TEAM_A';
  end if;
  raise notice 'OK blok 23: alleen de eigen assistent-rij kan worden opgezegd';
  reset role;
end $$;

-- ============================================================
-- PERSOONLIJKE OEFENINGEN (M6 — supabase/oefeningen-persoonlijk.sql, fase 4)
-- ============================================================

-- ── Blok 24: oefening van een teamgenoot — lezen en kopiëren, niet bewerken ──
-- AC 19/20/22/33/35, BR 54–57. Vereist M6. Staten na blok 23:
-- ASSISTENT_A is assistent van TEAM_A met Training-recht (hieronder expliciet
-- gezet), BUITENSTAANDER is geen lid meer van TEAM_A.
do $$
declare
  v_event uuid; v_oef uuid; v_koppeling uuid; v_kopie uuid;
  v_tekst text; n int;
begin
  reset role;
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'oefeningen'
     and policyname = 'oefeningen: zichtbaar via gekoppeld trainingsplan' and cmd = 'SELECT';
  if n <> 1 then
    raise exception 'M6 ONTBREEKT: draai eerst supabase/oefeningen-persoonlijk.sql';
  end if;
  update team_members set mag_training_bewerken = true
   where team_id = 'TEAM_A_UUID' and user_id = 'ASSISTENT_A_UUID';

  -- Opzet als OWNER_A: een EIGEN oefening, gekoppeld aan een training van TEAM_A.
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"OWNER_A_UUID","role":"authenticated"}';
  insert into oefeningen (team_id, naam, beschrijving, categorie)
  values ('OWNER_A_UUID', 'RLS-controle hoofdtrainer-oefening', 'origineel', 'overig')
  returning id into v_oef;
  insert into events (team_id, type, date)
  values ('TEAM_A_UUID', 'training', current_date) returning id into v_event;
  insert into training_oefeningen (team_id, event_id, oefening_id)
  values ('TEAM_A_UUID', v_event, v_oef) returning id into v_koppeling;

  -- a. Een teamlid ziet de oefening via het plan — los én via de join die de
  --    trainingsplan-pagina doet (AC 19).
  set local request.jwt.claims = '{"sub":"ASSISTENT_A_UUID","role":"authenticated"}';
  select count(*) into n from oefeningen where id = v_oef;
  if n <> 1 then raise exception 'KAPOT: een teamlid ziet een gekoppelde oefening van de hoofdtrainer niet'; end if;
  select count(*) into n
    from training_oefeningen k join oefeningen o on o.id = k.oefening_id
   where k.id = v_koppeling;
  if n <> 1 then raise exception 'KAPOT: de join koppeling -> oefening levert voor een teamlid niets op'; end if;
  raise notice 'OK blok 24: een teamlid ziet de gekoppelde oefening van een teamgenoot';

  -- b. ...maar kan hem niet wijzigen, verwijderen of op diens naam aanmaken (AC 35).
  update oefeningen set naam = 'RLS-controle gekaapt' where id = v_oef;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEK: een teamlid kon de oefening van een ander wijzigen'; end if;
  delete from oefeningen where id = v_oef;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEK: een teamlid kon de oefening van een ander verwijderen'; end if;
  begin
    insert into oefeningen (team_id, naam, categorie)
    values ('OWNER_A_UUID', 'RLS-controle vervalst', 'overig');
    raise exception 'LEK: een teamlid kon een oefening op naam van een ander aanmaken';
  exception when insufficient_privilege then
    raise notice 'OK blok 24: een teamlid kan de oefening van een ander niet wijzigen, verwijderen of namaken';
  end;

  -- c. Kopiëren = een nieuwe rij op eigen naam, met dezelfde kolommen als
  --    kopieerOefeningNaarBibliotheek (OEFENING_INHOUD_KOLOMMEN in lib/oefening.ts).
  insert into oefeningen (team_id, naam, beschrijving, categorie, duur_min, breedte_m, lengte_m,
                          orientatie, veldzone, teams, aantal_neutralen, aantal_neutralen_max, diagram)
  select 'ASSISTENT_A_UUID', naam, beschrijving, categorie, duur_min, breedte_m, lengte_m,
         orientatie, veldzone, teams, aantal_neutralen, aantal_neutralen_max, diagram
    from oefeningen where id = v_oef
  returning id into v_kopie;
  if v_kopie is null or v_kopie = v_oef then raise exception 'KAPOT: kopiëren leverde geen nieuwe rij op'; end if;
  update oefeningen set beschrijving = 'kopie aangepast' where id = v_kopie;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'KAPOT: de eigen kopie is niet bewerkbaar'; end if;
  reset role;
  select beschrijving into v_tekst from oefeningen where id = v_oef;
  if v_tekst is distinct from 'origineel' then
    raise exception 'KAPOT: het wijzigen van de kopie raakte het origineel (BR 56)';
  end if;
  raise notice 'OK blok 24: de kopie is een eigen, onafhankelijke rij';

  -- d. Een niet-lid ziet de oefening niet (AC 33).
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"BUITENSTAANDER_UUID","role":"authenticated"}';
  if is_team_member('TEAM_A_UUID') then
    raise exception 'FOUT IN DE OPZET: BUITENSTAANDER is nog lid van TEAM_A (is blok 23 gedraaid?)';
  end if;
  select count(*) into n from oefeningen where id = v_oef;
  if n <> 0 then raise exception 'LEK: een niet-lid ziet een oefening uit het trainingsplan van een vreemd team'; end if;
  raise notice 'OK blok 24: een niet-lid ziet de oefening niet';

  -- e. Ook de hoofdtrainer kan een oefening van zijn assistent niet bewerken,
  --    al staat die in zíjn trainingsplan gekoppeld (AC 35).
  set local request.jwt.claims = '{"sub":"ASSISTENT_A_UUID","role":"authenticated"}';
  insert into training_oefeningen (team_id, event_id, oefening_id)
  values ('TEAM_A_UUID', v_event, v_kopie);
  set local request.jwt.claims = '{"sub":"OWNER_A_UUID","role":"authenticated"}';
  select count(*) into n from oefeningen where id = v_kopie;
  if n <> 1 then raise exception 'KAPOT: de hoofdtrainer ziet de gekoppelde oefening van zijn assistent niet'; end if;
  update oefeningen set naam = 'RLS-controle gekaapt' where id = v_kopie;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEK: de hoofdtrainer kon de oefening van zijn assistent wijzigen'; end if;
  delete from oefeningen where id = v_kopie;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEK: de hoofdtrainer kon de oefening van zijn assistent verwijderen'; end if;
  raise notice 'OK blok 24: ook de hoofdtrainer kan andermans oefening niet bewerken of verwijderen';

  -- f. Ontkoppelen valt onder het Training-recht, niet onder eigenaarschap
  --    (beslissing 3). Zichtbaarheid loopt UITSLUITEND via het plan: na het
  --    ontkoppelen ziet de assistent de oefening van de hoofdtrainer niet meer.
  set local request.jwt.claims = '{"sub":"ASSISTENT_A_UUID","role":"authenticated"}';
  delete from training_oefeningen where id = v_koppeling;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'KAPOT: een assistent met Training-recht kon een oefening van een ander niet ontkoppelen'; end if;
  select count(*) into n from oefeningen where id = v_oef;
  if n <> 0 then raise exception 'LEK: na het ontkoppelen blijft de oefening van een ander zichtbaar'; end if;
  raise notice 'OK blok 24: ontkoppelen mag met Training-recht; daarna is de oefening weer onzichtbaar';

  -- g. BR 47/48 / AC 22: de eigenaar verwijdert zijn oefening, en de koppeling
  --    in het plan van TEAM_A verdwijnt mee — ook al mag hij in dat team de
  --    koppelingen niet zelf wissen. Een FK-cascade is niet aan RLS
  --    onderworpen; dit is de motor achter "koppelingen verdwijnen overal" bij
  --    accountverwijdering.
  delete from oefeningen where id = v_kopie;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'KAPOT: de eigenaar kon zijn eigen oefening niet verwijderen'; end if;
  reset role;
  select count(*) into n from training_oefeningen where oefening_id = v_kopie;
  if n <> 0 then raise exception 'KAPOT: de koppeling bleef staan na het verwijderen van de oefening (cascade)'; end if;
  raise notice 'OK blok 24: een verwijderde oefening verdwijnt uit elk trainingsplan (cascade)';
end $$;

-- ── Blok 25: koppelen alleen van eigen of al gekoppelde oefeningen (M6b) ──
-- Vereist M6b (supabase/oefeningen-koppeling-eigenaar.sql) en blok 23
-- (BUITENSTAANDER is geen lid meer van TEAM_A). Zonder M6b zou stap a slagen,
-- en maakt M6 de vreemde oefening daarna leesbaar — dat is het gat dat M6b
-- dichtzet.
do $$
declare
  v_event uuid; v_event2 uuid; v_vreemd uuid; v_hoofd uuid; v_eigen uuid;
  v_koppeling uuid; v_event_b uuid; n int;
begin
  reset role;
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'training_oefeningen'
     and policyname in ('training_oefeningen: recht mag maken', 'training_oefeningen: recht mag wijzigen')
     and position('oefening_koppelbaar' in with_check) > 0;
  if n <> 2 then
    raise exception 'M6b ONTBREEKT: draai eerst supabase/oefeningen-koppeling-eigenaar.sql';
  end if;
  update team_members set mag_training_bewerken = true
   where team_id = 'TEAM_A_UUID' and user_id = 'ASSISTENT_A_UUID';

  -- Opzet. Een oefening van BUITENSTAANDER die nergens in TEAM_A hangt, en een
  -- oefening van de hoofdtrainer, gekoppeld aan training 1 van TEAM_A.
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"BUITENSTAANDER_UUID","role":"authenticated"}';
  if is_team_member('TEAM_A_UUID') then
    raise exception 'FOUT IN DE OPZET: BUITENSTAANDER is nog lid van TEAM_A (is blok 23 gedraaid?)';
  end if;
  insert into oefeningen (team_id, naam, categorie)
  values ('BUITENSTAANDER_UUID', 'RLS-controle vreemde oefening', 'overig') returning id into v_vreemd;

  set local request.jwt.claims = '{"sub":"OWNER_A_UUID","role":"authenticated"}';
  insert into oefeningen (team_id, naam, categorie)
  values ('OWNER_A_UUID', 'RLS-controle oefening hoofdtrainer', 'overig') returning id into v_hoofd;
  insert into events (team_id, type, date)
  values ('TEAM_A_UUID', 'training', current_date) returning id into v_event;
  insert into events (team_id, type, date)
  values ('TEAM_A_UUID', 'training', current_date + 7) returning id into v_event2;
  insert into training_oefeningen (team_id, event_id, oefening_id, volgorde)
  values ('TEAM_A_UUID', v_event, v_hoofd, 0) returning id into v_koppeling;

  set local request.jwt.claims = '{"sub":"ASSISTENT_A_UUID","role":"authenticated"}';

  -- a. Een vreemde oefening-UUID koppelen: geweigerd, en hij blijft onzichtbaar.
  begin
    insert into training_oefeningen (team_id, event_id, oefening_id)
    values ('TEAM_A_UUID', v_event, v_vreemd);
    raise exception 'LEK: een assistent met Training-recht kon een vreemde oefening koppelen';
  exception when insufficient_privilege then
    raise notice 'OK blok 25: een vreemde oefening-UUID koppelen wordt geweigerd';
  end;
  select count(*) into n from oefeningen where id = v_vreemd;
  if n <> 0 then raise exception 'LEK: de vreemde oefening is zichtbaar voor de assistent'; end if;

  -- b. Een eigen oefening koppelen: slaagt (addOefeningToTraining).
  insert into oefeningen (team_id, naam, categorie)
  values ('ASSISTENT_A_UUID', 'RLS-controle eigen oefening', 'overig') returning id into v_eigen;
  insert into training_oefeningen (team_id, event_id, oefening_id, volgorde)
  values ('TEAM_A_UUID', v_event, v_eigen, 1);
  raise notice 'OK blok 25: een eigen oefening koppelen slaagt';

  -- c. Een vorige training kopiëren, inclusief de oefening van een teamgenoot
  --    die al in het team hangt: slaagt (kopieerTrainingsplan).
  insert into training_oefeningen (team_id, event_id, oefening_id, volgorde)
  select team_id, v_event2, oefening_id, volgorde
    from training_oefeningen
   where event_id = v_event and team_id = 'TEAM_A_UUID';
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'KAPOT: een training kopiëren binnen het team leverde % in plaats van 2 koppelingen op', n; end if;
  raise notice 'OK blok 25: een training kopiëren met een oefening van een teamgenoot slaagt';

  -- d. Een bestaande koppeling van andermans oefening wijzigen (volgorde,
  --    spelerindeling, parallelgroep, stap_override): slaagt.
  update training_oefeningen set volgorde = 5, stap_override = 2 where id = v_koppeling;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'KAPOT: een koppeling van een teamgenoot-oefening kon niet gewijzigd worden (% rijen)', n; end if;
  raise notice 'OK blok 25: een koppeling van een teamgenoot-oefening wijzigen slaagt';

  -- e. ...maar oefening_id omzetten naar een vreemde oefening: geweigerd.
  begin
    update training_oefeningen set oefening_id = v_vreemd where id = v_koppeling;
    raise exception 'LEK: een assistent kon een koppeling omzetten naar een vreemde oefening';
  exception when insufficient_privilege then
    raise notice 'OK blok 25: oefening_id omzetten naar een vreemde oefening wordt geweigerd';
  end;

  -- f. De helper verraadt niets over een team waar de aanroeper geen lid van
  --    is. Daarvoor moet de oefening wél in TEAM_B gekoppeld staan: dan is de
  --    tweede tak ("al gekoppeld in dit team") waar, en is ALLEEN de
  --    is_team_member-guard vooraan de reden dat de helper false geeft. Zonder
  --    die koppeling zou deze controle ook zonder guard slagen.
  reset role;
  insert into events (team_id, type, date)
  values ('TEAM_B_UUID', 'training', current_date) returning id into v_event_b;
  insert into training_oefeningen (team_id, event_id, oefening_id)
  values ('TEAM_B_UUID', v_event_b, v_vreemd);
  select count(*) into n from training_oefeningen
   where oefening_id = v_vreemd and team_id = 'TEAM_B_UUID';
  if n <> 1 then raise exception 'FOUT IN DE OPZET: de koppeling in TEAM_B is niet aangemaakt'; end if;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"ASSISTENT_A_UUID","role":"authenticated"}';
  if is_team_member('TEAM_B_UUID') then
    raise exception 'FOUT IN DE OPZET: ASSISTENT_A is lid van TEAM_B — kies een ander TEAM_B';
  end if;
  if oefening_koppelbaar(v_vreemd, 'TEAM_B_UUID') then
    raise exception 'LEK: oefening_koppelbaar verraadt een koppeling in een team waar de aanroeper geen lid van is (de is_team_member-guard ontbreekt)';
  end if;
  reset role;
  if has_function_privilege('anon', 'public.oefening_koppelbaar(uuid, uuid)', 'execute') then
    raise exception 'LEK: anon mag oefening_koppelbaar uitvoeren';
  end if;
  raise notice 'OK blok 25: oefening_koppelbaar is alleen voor leden en niet voor anon';
end $$;

rollback;

-- ============================================================
-- Blok 7 t/m 12 vereisen supabase/team-rls-gevolgacties.sql (M2b). Draaien ze
-- met een "function set_event_doelstelling does not exist"-fout, dan staat M2b
-- nog niet in deze database. Blok 14 t/m 19 vereisen M4
-- (supabase/team-invites-rpc.sql), blok 20 vereist M5
-- (supabase/team-aanmaken-rpc.sql) en blok 21 vereist M5c
-- (supabase/team-fk-naar-teams.sql).
--
-- NIET IN DIT SCRIPT TE VANGEN — HANDMATIG, MET TWEE SQL-TABBLADEN:
--
--   De race op linkvervanging (fase 2). Open twee tabbladen, allebei met een
--   eigen `begin;`:
--     tabblad 1: select * from team_invites
--                 where team_id = 'TEAM_A_UUID'
--                   and gebruikt_op is null and ingetrokken_op is null
--                 for update;              -- houdt de rij vast
--     tabblad 2: select * from accept_team_invite('<hash van de oude link>');
--                                          -- blijft hangen op dezelfde lock
--     tabblad 1: select * from create_team_invite('TEAM_A_UUID', repeat('5',64));
--                commit;
--     tabblad 2: deblokkeert en moet nu 'invalid' teruggeven, want de rij is
--                inmiddels ingetrokken. Sluit af met rollback in beide.
--   Precies één van de twee heeft effect; dat is wat de `for update` in
--   accept_team_invite en create_team_invite afdwingt.
--
-- DEKKING PER FASE: fase 3 (verwijderen, verlaten) staat in blok 22 en 23,
-- fase 4 (persoonlijke oefeningen) in blok 24 (M6) en 25 (M6b). Accountverwijdering zelf
-- (auth.admin.deleteUser) is hier niet na te bootsen; de onderdelen ervan
-- wel: de team-opruiming is blok 22, het opzeggen van een lidmaatschap blok
-- 23, en de cascade van een verwijderde oefening naar elk trainingsplan blok
-- 24 (g).
-- ============================================================
