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
--   * blok 26                 — vereist supabase/inzichten-metrics.sql
--                               (tabel tegendoelpunten + 4 RPC's) en een
--                               assistent in TEAM_A
--                               LET OP: sinds die migratie noemen ook blok 2
--                               en blok 22 de tabel tegendoelpunten; zonder
--                               inzichten-metrics.sql falen die met
--                               "relation does not exist".
--   * blok 27                 — vereist supabase/inzichten-metrics-fase2.sql
--                               (4 lees-RPC's, geen tabellen); geen assistent
--                               nodig, maakt zijn eigen testdata in jan. 1990
--   * blok 28                 — vereist supabase/inzichten-metrics-fase2b.sql
--                               (tabel speelminuten + 1 RPC); maakt zijn eigen
--                               testdata in jan. 1990 en zo nodig binnen de
--                               transactie een assistent zonder wedstrijdrecht
--                               LET OP: sinds die migratie noemen ook blok 2
--                               en blok 22 de tabel speelminuten; zonder
--                               inzichten-metrics-fase2b.sql falen die met
--                               "relation does not exist".
--   * blok 29                 — vereist supabase/inzichten-metrics-fase3a.sql
--                               (2 lees-RPC's, geen tabellen); geen assistent
--                               nodig, maakt zijn eigen testdata in maart 1990
--                               (jan. en feb. 1990 zijn al bezet door blok 27/28)
--   * blok 30                 — vereist supabase/inzichten-metrics-fase3b.sql
--                               (tabel training_evaluaties + 1 RPC); maakt zijn
--                               eigen testdata in april 1990 (jan.–maart 1990
--                               zijn al bezet door blok 27/28/29) en zo nodig
--                               binnen de transactie een assistent zonder
--                               trainingsrecht (wel Spelers en Aanwezigheid)
--                               LET OP: sinds die migratie noemen ook blok 2
--                               en blok 22 de tabel training_evaluaties; zonder
--                               inzichten-metrics-fase3b.sql falen die met
--                               "relation does not exist".
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
  select count(*) into n from tegendoelpunten    where team_id = 'TEAM_B_UUID';
  if n <> 0 then raise exception 'LEK: niet-lid ziet tegendoelpunten van een vreemd team'; end if;
  select count(*) into n from speelminuten       where team_id = 'TEAM_B_UUID';
  if n <> 0 then raise exception 'LEK: niet-lid ziet speelminuten van een vreemd team'; end if;
  select count(*) into n from training_evaluaties where team_id = 'TEAM_B_UUID';
  if n <> 0 then raise exception 'LEK: niet-lid ziet trainingsevaluaties van een vreemd team'; end if;
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

  -- Het markInjured-pad: een rij met status 'injured' wegschrijven
  -- (supabase/blessure-status.sql; de vlag injury_set bestaat niet meer).
  insert into attendance (team_id, event_id, player_id, status)
  values ('TEAM_A_UUID', 'TRAINING_A_UUID', 'PLAYER_A_UUID', 'injured')
  on conflict (event_id, player_id) do update
    set status = 'injured';
  raise notice 'OK blok 7: spelersrecht mag een attendance-rij schrijven (markInjured-pad)';

  -- Het markRecovered-pad: dezelfde rij terugzetten.
  update attendance set status = 'unknown'
   where team_id = 'TEAM_A_UUID' and player_id = 'PLAYER_A_UUID'
     and status = 'injured';
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
--      zestien tabellen uit TEAM_TABELLEN (lib/team-opruimen.ts) en daarna
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
  foreach v_tabel in array array['training_oefeningen','task_overrides','match_squad','match_events','tegendoelpunten','speelminuten','training_evaluaties','match_ratings','lineups','attendance','absence_periods','categorie_metingen','metingen','events','players','settings'] loop
    execute format('delete from public.%I where team_id = $1', v_tabel) using v_team;
  end loop;

  -- De expliciete deletes moeten zelf het werk doen, niet de cascade:
  -- categorie_metingen heeft GEEN foreign key naar teams en zou anders als
  -- wees achterblijven. Daarom hier al tellen, vóór `delete from teams`.
  reset role;
  foreach v_tabel in array array['training_oefeningen','task_overrides','match_squad','match_events','tegendoelpunten','speelminuten','training_evaluaties','match_ratings','lineups','attendance','absence_periods','categorie_metingen','metingen','events','players','settings'] loop
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

-- ── Blok 26: tegendoelpunten en de inzichten-metrics-RPC's ──
-- Vereist supabase/inzichten-metrics.sql en een assistent in TEAM_A. Maakt
-- binnen deze transactie een wedstrijd en een training in TEAM_A en een
-- wedstrijd met tegendoelpunt in TEAM_B aan (de rollback ruimt ze op).
--   a. OWNER_A ziet geen tegendoelpunten van TEAM_B;
--   b. de vier RPC's met p_team_id = TEAM_B geven 0 rijen, en anon mag ze niet;
--   c. ASSISTENT_A zonder wedstrijdrecht: insert 42501, delete 0 rijen;
--   d. OWNER_A met team_id = TEAM_A en een event_id van TEAM_B: 42501;
--   e. OWNER_A op een eigen wedstrijd: insert lukt, soort 'anders' en minuut
--      131 geven 23514, een update raakt 0 rijen (geen update-policy);
--   f. een training van het eigen team: 42501.
do $$
declare
  v_match uuid; v_training uuid; v_match_b uuid; v_bestaand uuid; n int;
begin
  reset role;
  if to_regclass('public.tegendoelpunten') is null then
    raise exception 'INZICHTEN-METRICS ONTBREEKT: draai eerst supabase/inzichten-metrics.sql';
  end if;
  update team_members set mag_wedstrijd_bewerken = false
   where team_id = 'TEAM_A_UUID' and user_id = 'ASSISTENT_A_UUID';

  -- Opzet als postgres (buiten RLS): eigen wedstrijd + training, één bestaand
  -- tegendoelpunt in TEAM_A, en een wedstrijd mét uitslag en tegendoelpunt in
  -- TEAM_B — zodat a en b iets te verbergen hebben.
  insert into events (team_id, type, date)
  values ('TEAM_A_UUID', 'match', current_date) returning id into v_match;
  insert into events (team_id, type, date)
  values ('TEAM_A_UUID', 'training', current_date) returning id into v_training;
  insert into tegendoelpunten (team_id, event_id, soort, minute)
  values ('TEAM_A_UUID', v_match, 'open_play', 30) returning id into v_bestaand;
  insert into events (team_id, type, date, goals_for, goals_against)
  values ('TEAM_B_UUID', 'match', current_date, 1, 1) returning id into v_match_b;
  insert into tegendoelpunten (team_id, event_id, soort, minute)
  values ('TEAM_B_UUID', v_match_b, 'set_piece', 12);

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"OWNER_A_UUID","role":"authenticated"}';
  if is_team_member('TEAM_B_UUID') then
    raise exception 'FOUT IN DE OPZET: OWNER_A is wél lid van TEAM_B — kies een ander TEAM_B';
  end if;

  -- a. Lezen van een vreemd team.
  select count(*) into n from tegendoelpunten where team_id = 'TEAM_B_UUID';
  if n <> 0 then raise exception 'LEK: OWNER_A ziet % tegendoelpunten van TEAM_B', n; end if;
  select count(*) into n from tegendoelpunten where event_id = v_match_b;
  if n <> 0 then raise exception 'LEK: OWNER_A ziet tegendoelpunten op een wedstrijd van TEAM_B'; end if;
  raise notice 'OK blok 26: OWNER_A ziet geen tegendoelpunten van TEAM_B';

  -- b. De vier RPC's met een vreemd team-id.
  select count(*) into n from inzichten_wedstrijd_uitslagen('TEAM_B_UUID', current_date - 400, current_date + 400);
  if n <> 0 then raise exception 'LEK: inzichten_wedstrijd_uitslagen geeft % rijen van TEAM_B', n; end if;
  select count(*) into n from inzichten_speler_momenten('TEAM_B_UUID', current_date - 400, current_date + 400);
  if n <> 0 then raise exception 'LEK: inzichten_speler_momenten geeft % rijen van TEAM_B', n; end if;
  select count(*) into n from inzichten_doelpunten_per_minuut('TEAM_B_UUID', current_date - 400, current_date + 400);
  if n <> 0 then raise exception 'LEK: inzichten_doelpunten_per_minuut geeft % rijen van TEAM_B', n; end if;
  select count(*) into n from inzichten_tegendoelpunten('TEAM_B_UUID', current_date - 400, current_date + 400);
  if n <> 0 then raise exception 'LEK: inzichten_tegendoelpunten geeft % rijen van TEAM_B', n; end if;
  -- Ter controle dat de RPC's zelf werken: het eigen team ziet zijn eigen tegendoelpunt.
  select coalesce(sum(aantal), 0) into n from inzichten_tegendoelpunten('TEAM_A_UUID', current_date - 1, current_date + 1);
  if n < 1 then raise exception 'KAPOT: inzichten_tegendoelpunten ziet het eigen tegendoelpunt van TEAM_A niet'; end if;
  raise notice 'OK blok 26: de vier inzichten-metrics-RPC''s geven 0 rijen voor een vreemd team';

  -- c. Assistent zonder wedstrijdrecht.
  set local request.jwt.claims = '{"sub":"ASSISTENT_A_UUID","role":"authenticated"}';
  if not is_team_member('TEAM_A_UUID') or is_team_owner('TEAM_A_UUID') then
    raise exception 'FOUT IN DE OPZET: ASSISTENT_A is geen assistent in TEAM_A';
  end if;
  begin
    insert into tegendoelpunten (team_id, event_id, soort, minute)
    values ('TEAM_A_UUID', v_match, 'open_play', 10);
    raise exception 'LEK: een assistent zonder wedstrijdrecht kon een tegendoelpunt toevoegen';
  exception when insufficient_privilege then
    raise notice 'OK blok 26: insert op tegendoelpunten geweigerd zonder wedstrijdrecht';
  end;
  delete from tegendoelpunten where id = v_bestaand;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEK: een assistent zonder wedstrijdrecht kon een tegendoelpunt verwijderen'; end if;
  raise notice 'OK blok 26: delete op tegendoelpunten raakt 0 rijen zonder wedstrijdrecht';

  -- d. Eigen team_id, maar het event van een ander team.
  set local request.jwt.claims = '{"sub":"OWNER_A_UUID","role":"authenticated"}';
  begin
    insert into tegendoelpunten (team_id, event_id, soort, minute)
    values ('TEAM_A_UUID', v_match_b, 'open_play', 10);
    raise exception 'LEK: OWNER_A kon een tegendoelpunt aan een wedstrijd van TEAM_B hangen';
  exception when insufficient_privilege then
    raise notice 'OK blok 26: een event_id van een ander team wordt geweigerd';
  end;

  -- e. Eigen wedstrijd: insert lukt, CHECKs houden stand, update raakt niets.
  insert into tegendoelpunten (team_id, event_id, soort, minute)
  values ('TEAM_A_UUID', v_match, 'set_piece', null);
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'KAPOT: OWNER_A kon geen tegendoelpunt op een eigen wedstrijd vastleggen'; end if;
  raise notice 'OK blok 26: OWNER_A legt een tegendoelpunt vast op een eigen wedstrijd';
  begin
    insert into tegendoelpunten (team_id, event_id, soort, minute)
    values ('TEAM_A_UUID', v_match, 'anders', 10);
    raise exception 'KAPOT: soort ''anders'' werd geaccepteerd';
  exception when check_violation then
    raise notice 'OK blok 26: soort ''anders'' geeft 23514';
  end;
  begin
    insert into tegendoelpunten (team_id, event_id, soort, minute)
    values ('TEAM_A_UUID', v_match, 'open_play', 131);
    raise exception 'KAPOT: minuut 131 werd geaccepteerd';
  exception when check_violation then
    raise notice 'OK blok 26: minuut 131 geeft 23514';
  end;
  update tegendoelpunten set minute = 5 where id = v_bestaand;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEK: een tegendoelpunt kon gewijzigd worden (er hoort geen update-policy te zijn)'; end if;
  raise notice 'OK blok 26: een update op tegendoelpunten raakt 0 rijen';

  -- f. Een training van het eigen team.
  begin
    insert into tegendoelpunten (team_id, event_id, soort, minute)
    values ('TEAM_A_UUID', v_training, 'open_play', 10);
    raise exception 'LEK: een tegendoelpunt kon aan een training gehangen worden';
  exception when insufficient_privilege then
    raise notice 'OK blok 26: een training wordt geweigerd';
  end;

  reset role;
  if has_function_privilege('anon', 'public.inzichten_wedstrijd_uitslagen(uuid, date, date)', 'execute')
     or has_function_privilege('anon', 'public.inzichten_speler_momenten(uuid, date, date)', 'execute')
     or has_function_privilege('anon', 'public.inzichten_doelpunten_per_minuut(uuid, date, date)', 'execute')
     or has_function_privilege('anon', 'public.inzichten_tegendoelpunten(uuid, date, date)', 'execute') then
    raise exception 'LEK: anon mag een inzichten-metrics-RPC uitvoeren';
  end if;
  raise notice 'OK blok 26: anon mag de inzichten-metrics-RPC''s niet uitvoeren';
end $$;

-- ── Blok 27: inzichten-metrics fase 2a (spelers) ─────────────
-- Vereist supabase/inzichten-metrics-fase2.sql (4 lees-RPC's). Geen assistent
-- nodig. Maakt binnen deze transactie (de rollback ruimt alles op) in TEAM_A
-- twee wedstrijden in januari 1990 aan — een maand zonder echte data, zodat
-- bestaande wedstrijden de noemer niet beïnvloeden — plus drie eigen spelers,
-- een selectie, een opstelling met het id van een TEAM_B-speler en twee
-- blessureregistraties.
--   a. de vier RPC's met p_team_id = TEAM_B geven 0 rijen, en anon mag ze niet;
--   b. een TEAM_B-speler in lineups.positions van een eigen wedstrijd komt niet
--      terug uit inzichten_speelkansen(TEAM_A), en een ongeldige string of null
--      in de JSONB laat de RPC niet falen (geen uuid-cast);
--   c. een injured-rij van een TEAM_B-speler op een eigen event telt niet mee in
--      inzichten_blessures_per_maand(TEAM_A);
--   d. noemerregel: een actieve speler houdt de latere selectiewedstrijd in zijn
--      noemer (W2), een INACTIEVE stopt bij zijn laatste voorkomen (O2).
do $$
declare
  v_start date := date '1990-01-01';
  v_end   date := date '1990-01-31';
  v_m1 uuid; v_m2 uuid; v_actief uuid; v_inactief uuid; v_later uuid; v_vreemd uuid;
  v_c_gelukt boolean := false;
  n int; r record;
begin
  reset role;
  if to_regprocedure('public.inzichten_speelkansen(uuid, date, date)') is null
     or to_regprocedure('public.inzichten_rating_vorm_per_speler(uuid, date, date, int)') is null
     or to_regprocedure('public.inzichten_training_opkomst_per_speler(uuid, date, date)') is null
     or to_regprocedure('public.inzichten_blessures_per_maand(uuid, date, date)') is null then
    raise exception 'INZICHTEN-METRICS FASE 2 ONTBREEKT: draai eerst supabase/inzichten-metrics-fase2.sql';
  end if;
  select count(*) into n from events where team_id = 'TEAM_A_UUID' and date between v_start and v_end;
  if n <> 0 then
    raise exception 'FOUT IN DE OPZET: TEAM_A heeft al events in januari 1990 — kies in blok 27 een andere testmaand';
  end if;

  -- Opzet als postgres (buiten RLS).
  insert into events (team_id, type, date) values ('TEAM_A_UUID', 'match', v_start)     returning id into v_m1;
  insert into events (team_id, type, date) values ('TEAM_A_UUID', 'match', v_start + 1) returning id into v_m2;
  insert into players (team_id, name, position, active)
  values ('TEAM_A_UUID', 'RLS-27 actief', 'Keeper', true) returning id into v_actief;
  insert into players (team_id, name, position, active)
  values ('TEAM_A_UUID', 'RLS-27 inactief', 'Spits', false) returning id into v_inactief;
  insert into players (team_id, name, position, active)
  values ('TEAM_A_UUID', 'RLS-27 later', 'Spits', true) returning id into v_later;
  -- Een speler van TEAM_B: bestaande opzoeken, anders tijdelijk aanmaken.
  select id into v_vreemd from players where team_id = 'TEAM_B_UUID' order by id limit 1;
  if v_vreemd is null then
    insert into players (team_id, name, position, active)
    values ('TEAM_B_UUID', 'RLS-27 vreemd', 'Keeper', true) returning id into v_vreemd;
  end if;

  -- Wedstrijd 1: selectie actief + inactief; wedstrijd 2: selectie alleen later.
  insert into match_squad (team_id, event_id, player_id) values
    ('TEAM_A_UUID', v_m1, v_actief),
    ('TEAM_A_UUID', v_m1, v_inactief),
    ('TEAM_A_UUID', v_m2, v_later);
  -- Opstelling wedstrijd 1: actief, de TEAM_B-speler, een ongeldige string en null.
  insert into lineups (team_id, event_id, formation, positions) values (
    'TEAM_A_UUID', v_m1, '4-3-3',
    jsonb_build_array(
      jsonb_build_object('player_id', v_actief::text, 'position_label', 'KP'),
      jsonb_build_object('player_id', v_vreemd::text, 'position_label', 'SP'),
      jsonb_build_object('player_id', 'geen-uuid',    'position_label', 'LB'),
      jsonb_build_object('player_id', null,           'position_label', 'RB')));
  -- Eigen blessure op wedstrijd 2 (telt wél), en c: een TEAM_B-speler als
  -- injured op een eigen event met team_id = TEAM_A (mag niet tellen).
  insert into attendance (team_id, event_id, player_id, status)
  values ('TEAM_A_UUID', v_m2, v_later, 'injured');
  begin
    insert into attendance (team_id, event_id, player_id, status)
    values ('TEAM_A_UUID', v_m1, v_vreemd, 'injured');
    v_c_gelukt := true;
  exception when others then
    raise notice 'OVERGESLAGEN blok 27c: de vreemde blessurerij liet zich niet invoegen (%)', sqlstate;
  end;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"OWNER_A_UUID","role":"authenticated"}';
  if is_team_member('TEAM_B_UUID') then
    raise exception 'FOUT IN DE OPZET: OWNER_A is wél lid van TEAM_B — kies een ander TEAM_B';
  end if;

  -- a. De vier RPC's met een vreemd team-id.
  select count(*) into n from inzichten_speelkansen('TEAM_B_UUID', current_date - 400, current_date + 400);
  if n <> 0 then raise exception 'LEK: inzichten_speelkansen geeft % rijen van TEAM_B', n; end if;
  select count(*) into n from inzichten_rating_vorm_per_speler('TEAM_B_UUID', current_date - 400, current_date + 400, 5);
  if n <> 0 then raise exception 'LEK: inzichten_rating_vorm_per_speler geeft % rijen van TEAM_B', n; end if;
  select count(*) into n from inzichten_training_opkomst_per_speler('TEAM_B_UUID', current_date - 400, current_date + 400);
  if n <> 0 then raise exception 'LEK: inzichten_training_opkomst_per_speler geeft % rijen van TEAM_B', n; end if;
  select count(*) into n from inzichten_blessures_per_maand('TEAM_B_UUID', current_date - 400, current_date + 400);
  if n <> 0 then raise exception 'LEK: inzichten_blessures_per_maand geeft % rijen van TEAM_B', n; end if;
  raise notice 'OK blok 27: de vier fase-2-RPC''s geven 0 rijen voor een vreemd team';

  -- b. De vreemde speler uit de opstelling telt niet mee; de RPC faalt niet op
  --    'geen-uuid' of null.
  select count(*) into n from inzichten_speelkansen('TEAM_A_UUID', v_start, v_end) where player_id = v_vreemd;
  if n <> 0 then raise exception 'LEK: inzichten_speelkansen geeft een TEAM_B-speler uit lineups.positions terug'; end if;
  select * into r from inzichten_speelkansen('TEAM_A_UUID', v_start, v_end) where player_id = v_actief;
  if not found or r.noemer <> 2 or r.selectie <> 1 or r.basis <> 1 or r.gast then
    raise exception 'KAPOT: speelkansen van de actieve testspeler zijn % (verwacht noemer 2, selectie 1, basis 1, geen gast)', r;
  end if;
  raise notice 'OK blok 27: een TEAM_B-speler in de opstelling telt niet mee in speelkansen';

  -- d. Noemerregel W2 + O2.
  select * into r from inzichten_speelkansen('TEAM_A_UUID', v_start, v_end) where player_id = v_inactief;
  if not found or r.noemer <> 1 or r.selectie <> 1 or r.basis <> 0 then
    raise exception 'KAPOT (O2): speelkansen van de inactieve testspeler zijn % (verwacht noemer 1 — stopt bij laatste voorkomen)', r;
  end if;
  select * into r from inzichten_speelkansen('TEAM_A_UUID', v_start, v_end) where player_id = v_later;
  if not found or r.noemer <> 1 or r.selectie <> 1 then
    raise exception 'KAPOT (W2): speelkansen van de latere testspeler zijn % (verwacht noemer 1 — vanaf eerste voorkomen)', r;
  end if;
  raise notice 'OK blok 27: noemer vanaf eerste voorkomen, voor een inactieve speler t/m het laatste (O2)';

  -- c. Blessures: alleen de eigen speler telt.
  select geblesseerd into n from inzichten_blessures_per_maand('TEAM_A_UUID', v_start, v_end) where maand = '1990-01';
  if n is null then raise exception 'KAPOT: inzichten_blessures_per_maand geeft geen rij voor een maand met wedstrijden'; end if;
  if n > 1 then raise exception 'LEK: inzichten_blessures_per_maand telt een blessure van een TEAM_B-speler mee (% i.p.v. 1)', n; end if;
  if n <> 1 then raise exception 'KAPOT: inzichten_blessures_per_maand telt % i.p.v. 1 geblesseerde speler', n; end if;
  if v_c_gelukt then
    raise notice 'OK blok 27: een blessure van een TEAM_B-speler op een eigen event telt niet mee';
  end if;

  reset role;
  if has_function_privilege('anon', 'public.inzichten_speelkansen(uuid, date, date)', 'execute')
     or has_function_privilege('anon', 'public.inzichten_rating_vorm_per_speler(uuid, date, date, int)', 'execute')
     or has_function_privilege('anon', 'public.inzichten_training_opkomst_per_speler(uuid, date, date)', 'execute')
     or has_function_privilege('anon', 'public.inzichten_blessures_per_maand(uuid, date, date)', 'execute') then
    raise exception 'LEK: anon mag een fase-2-RPC uitvoeren';
  end if;
  raise notice 'OK blok 27: anon mag de fase-2-RPC''s niet uitvoeren';
end $$;

-- ── Blok 28: inzichten-metrics fase 2b (speelminuten) ────────
-- Vereist supabase/inzichten-metrics-fase2b.sql (tabel speelminuten + 1 RPC).
-- Maakt binnen deze transactie (de rollback ruimt alles op) in TEAM_A drie
-- wedstrijden en een training aan, plus vijf eigen testspelers en
-- speelminuten-rijen in januari 1990 — een maand zonder echte speelminuten,
-- zodat bestaande data de noemer niet beïnvloedt (de events van blok 27 in
-- dezelfde maand hebben geen speelminuten en tellen dus niet). Een assistent
-- in TEAM_A zonder wedstrijdrecht wordt zo nodig binnen de transactie
-- aangemaakt.
--   a. OWNER_A ziet geen speelminuten van TEAM_B;
--   b. de RPC met p_team_id = TEAM_B geeft 0 rijen; met TEAM_A over januari
--      1990 de verwachte waarden (som, wedstrijden, noemer, gast, inactief met
--      rij doet mee, inactief zonder rij ontbreekt, actief zonder rij = 0/null);
--   c. ASSISTENT_A zonder wedstrijdrecht: insert 42501, update en delete 0 rijen;
--   d. OWNER_A met een event_id van TEAM_B: 42501;
--   e. OWNER_A op een eigen wedstrijd met een player_id van TEAM_B: 42501;
--   f. een training van het eigen team: 42501;
--   g. minuten 131 of -1, wissels -1 of 100: 23514;
--   h. een tweede gewone insert op dezelfde (event, speler): 23505; een upsert
--      laat precies één rij over met de nieuwe waarde;
--   i. een update van event_id, player_id of team_id naar TEAM_B: 42501;
--   j. een testspeler en daarna een testwedstrijd verwijderen neemt hun rijen
--      mee (cascade);
--   k. anon mag de RPC niet uitvoeren.
do $$
declare
  v_start date := date '1990-01-01';
  v_end   date := date '1990-01-31';
  v_m1 uuid; v_m2 uuid; v_buiten uuid; v_training uuid; v_match_b uuid;
  v_vast uuid; v_zonder uuid; v_gast uuid; v_inactief_met uuid; v_inactief_zonder uuid;
  v_vreemd uuid;
  n int; r record;
begin
  reset role;
  if to_regclass('public.speelminuten') is null
     or to_regprocedure('public.inzichten_speelminuten_per_speler(uuid, date, date)') is null then
    raise exception 'INZICHTEN-METRICS FASE 2B ONTBREEKT: draai eerst supabase/inzichten-metrics-fase2b.sql';
  end if;
  select count(*) into n
  from speelminuten sm join events e on e.id = sm.event_id
  where sm.team_id = 'TEAM_A_UUID' and e.date between v_start and v_end;
  if n <> 0 then
    raise exception 'FOUT IN DE OPZET: TEAM_A heeft al speelminuten in januari 1990 — kies in blok 28 een andere testmaand';
  end if;

  -- Assistent zonder wedstrijdrecht (c): bestaande rij dichtzetten, of
  -- tijdelijk invoegen (alle mag_* default false).
  insert into team_members (team_id, user_id, rol)
  values ('TEAM_A_UUID', 'ASSISTENT_A_UUID', 'assistent')
  on conflict (team_id, user_id) do update set mag_wedstrijd_bewerken = false
   where team_members.rol = 'assistent';

  -- Opzet als postgres (buiten RLS).
  insert into events (team_id, type, date) values ('TEAM_A_UUID', 'match', v_start + 9)     returning id into v_m1;
  insert into events (team_id, type, date) values ('TEAM_A_UUID', 'match', v_start + 10)    returning id into v_m2;
  insert into events (team_id, type, date) values ('TEAM_A_UUID', 'match', date '1990-02-15') returning id into v_buiten;
  insert into events (team_id, type, date) values ('TEAM_A_UUID', 'training', v_start + 11) returning id into v_training;
  insert into events (team_id, type, date) values ('TEAM_B_UUID', 'match', v_start + 9)     returning id into v_match_b;
  insert into players (team_id, name, position, active)
  values ('TEAM_A_UUID', 'RLS-28 vast', 'Keeper', true) returning id into v_vast;
  insert into players (team_id, name, position, active)
  values ('TEAM_A_UUID', 'RLS-28 zonder rij', 'Spits', true) returning id into v_zonder;
  insert into players (team_id, name, position, active, type)
  values ('TEAM_A_UUID', 'RLS-28 gast', 'Spits', true, 'guest') returning id into v_gast;
  insert into players (team_id, name, position, active)
  values ('TEAM_A_UUID', 'RLS-28 inactief met rij', 'Spits', false) returning id into v_inactief_met;
  insert into players (team_id, name, position, active)
  values ('TEAM_A_UUID', 'RLS-28 inactief zonder rij', 'Spits', false) returning id into v_inactief_zonder;
  -- Een bestaande speler van TEAM_B (e en i); bestaat er geen, dan worden die
  -- delen overgeslagen.
  select id into v_vreemd from players where team_id = 'TEAM_B_UUID' order by id limit 1;

  -- vast: 2 wedstrijden in januari (60+75 min, 1+2 wissels) + 1 in februari
  -- (buiten het venster); gast en inactief-met-rij: elk 1 wedstrijd.
  insert into speelminuten (team_id, event_id, player_id, minuten, wissels) values
    ('TEAM_A_UUID', v_m1,     v_vast,         60, 1),
    ('TEAM_A_UUID', v_m2,     v_vast,         75, 2),
    ('TEAM_A_UUID', v_buiten, v_vast,         90, 0),
    ('TEAM_A_UUID', v_m1,     v_gast,         30, 0),
    ('TEAM_A_UUID', v_m2,     v_inactief_met, 90, 0);
  if v_vreemd is not null then
    insert into speelminuten (team_id, event_id, player_id, minuten, wissels)
    values ('TEAM_B_UUID', v_match_b, v_vreemd, 45, 1);
  end if;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"OWNER_A_UUID","role":"authenticated"}';
  if is_team_member('TEAM_B_UUID') then
    raise exception 'FOUT IN DE OPZET: OWNER_A is wél lid van TEAM_B — kies een ander TEAM_B';
  end if;

  -- a. Lezen van een vreemd team.
  select count(*) into n from speelminuten where team_id = 'TEAM_B_UUID';
  if n <> 0 then raise exception 'LEK: OWNER_A ziet % speelminuten van TEAM_B', n; end if;
  select count(*) into n from speelminuten where event_id = v_match_b;
  if n <> 0 then raise exception 'LEK: OWNER_A ziet speelminuten op een wedstrijd van TEAM_B'; end if;
  raise notice 'OK blok 28: OWNER_A ziet geen speelminuten van TEAM_B';

  -- b. De RPC: vreemd team leeg, eigen team met de verwachte waarden.
  select count(*) into n from inzichten_speelminuten_per_speler('TEAM_B_UUID', current_date - 400, current_date + 400);
  if n <> 0 then raise exception 'LEK: inzichten_speelminuten_per_speler geeft % rijen van TEAM_B', n; end if;
  select count(*) into n from inzichten_speelminuten_per_speler('TEAM_B_UUID', v_start, v_end);
  if n <> 0 then raise exception 'LEK: inzichten_speelminuten_per_speler geeft % rijen van TEAM_B (jan. 1990)', n; end if;
  if v_vreemd is not null then
    select count(*) into n from inzichten_speelminuten_per_speler('TEAM_A_UUID', v_start, v_end) where player_id = v_vreemd;
    if n <> 0 then raise exception 'LEK: inzichten_speelminuten_per_speler(TEAM_A) geeft een TEAM_B-speler terug'; end if;
  end if;
  select * into r from inzichten_speelminuten_per_speler('TEAM_A_UUID', v_start, v_end) where player_id = v_vast;
  if not found or r.wedstrijden <> 2 or r.minuten <> 135 or r.wissels <> 3 or r.noemer <> 2 or r.gast then
    raise exception 'KAPOT: speelminuten van de vaste testspeler zijn % (verwacht wedstrijden 2, minuten 135, wissels 3, noemer 2, geen gast)', r;
  end if;
  select * into r from inzichten_speelminuten_per_speler('TEAM_A_UUID', v_start, v_end) where player_id = v_zonder;
  if not found or r.wedstrijden <> 0 or r.minuten is not null or r.wissels is not null or r.noemer <> 2 then
    raise exception 'KAPOT: de actieve speler zonder rij geeft % (verwacht wedstrijden 0, minuten/wissels null, noemer 2)', r;
  end if;
  select * into r from inzichten_speelminuten_per_speler('TEAM_A_UUID', v_start, v_end) where player_id = v_gast;
  if not found or not r.gast or r.wedstrijden <> 1 or r.minuten <> 30 then
    raise exception 'KAPOT: de gast met een rij geeft % (verwacht gast true, wedstrijden 1, minuten 30)', r;
  end if;
  select * into r from inzichten_speelminuten_per_speler('TEAM_A_UUID', v_start, v_end) where player_id = v_inactief_met;
  if not found or r.wedstrijden <> 1 or r.minuten <> 90 then
    raise exception 'KAPOT (M4): de inactieve speler met een rij geeft % (verwacht wedstrijden 1, minuten 90)', r;
  end if;
  select count(*) into n from inzichten_speelminuten_per_speler('TEAM_A_UUID', v_start, v_end) where player_id = v_inactief_zonder;
  if n <> 0 then raise exception 'KAPOT: een inactieve speler zonder rij staat in de RPC'; end if;
  select count(*) into n from inzichten_speelminuten_per_speler('TEAM_A_UUID', date '1989-12-01', date '1989-12-31');
  if n <> 0 then raise exception 'KAPOT: de RPC geeft % rijen voor een venster zonder speelminuten (verwacht 0, lege staat)', n; end if;
  raise notice 'OK blok 28: inzichten_speelminuten_per_speler telt per speler, noemer = wedstrijden met minuten, vreemd team leeg';

  -- c. Assistent zonder wedstrijdrecht.
  set local request.jwt.claims = '{"sub":"ASSISTENT_A_UUID","role":"authenticated"}';
  if not is_team_member('TEAM_A_UUID') or is_team_owner('TEAM_A_UUID') then
    raise exception 'FOUT IN DE OPZET: ASSISTENT_A is geen assistent in TEAM_A';
  end if;
  begin
    insert into speelminuten (team_id, event_id, player_id, minuten, wissels)
    values ('TEAM_A_UUID', v_m1, v_zonder, 10, 0);
    raise exception 'LEK: een assistent zonder wedstrijdrecht kon speelminuten vastleggen';
  exception when insufficient_privilege then
    raise notice 'OK blok 28: insert op speelminuten geweigerd zonder wedstrijdrecht';
  end;
  update speelminuten set minuten = 1 where event_id = v_m1 and player_id = v_vast;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEK: een assistent zonder wedstrijdrecht kon speelminuten wijzigen'; end if;
  delete from speelminuten where event_id = v_m1 and player_id = v_vast;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEK: een assistent zonder wedstrijdrecht kon speelminuten verwijderen'; end if;
  raise notice 'OK blok 28: update en delete op speelminuten raken 0 rijen zonder wedstrijdrecht';

  -- d. Eigen team_id, maar het event van een ander team.
  set local request.jwt.claims = '{"sub":"OWNER_A_UUID","role":"authenticated"}';
  begin
    insert into speelminuten (team_id, event_id, player_id, minuten, wissels)
    values ('TEAM_A_UUID', v_match_b, v_zonder, 10, 0);
    raise exception 'LEK: OWNER_A kon speelminuten aan een wedstrijd van TEAM_B hangen';
  exception when insufficient_privilege then
    raise notice 'OK blok 28: een event_id van een ander team wordt geweigerd';
  end;

  -- e. Eigen wedstrijd, maar een speler van een ander team.
  if v_vreemd is null then
    raise notice 'OVERGESLAGEN blok 28e: TEAM_B heeft geen spelers';
  else
    begin
      insert into speelminuten (team_id, event_id, player_id, minuten, wissels)
      values ('TEAM_A_UUID', v_m1, v_vreemd, 10, 0);
      raise exception 'LEK: OWNER_A kon speelminuten voor een speler van TEAM_B vastleggen';
    exception when insufficient_privilege then
      raise notice 'OK blok 28: een player_id van een ander team wordt geweigerd';
    end;
  end if;

  -- f. Een training van het eigen team.
  begin
    insert into speelminuten (team_id, event_id, player_id, minuten, wissels)
    values ('TEAM_A_UUID', v_training, v_zonder, 10, 0);
    raise exception 'LEK: speelminuten konden aan een training gehangen worden';
  exception when insufficient_privilege then
    raise notice 'OK blok 28: een training wordt geweigerd';
  end;

  -- g. De CHECKs op minuten en wissels.
  begin
    insert into speelminuten (team_id, event_id, player_id, minuten, wissels)
    values ('TEAM_A_UUID', v_m1, v_zonder, 131, 0);
    raise exception 'KAPOT: minuten 131 werd geaccepteerd';
  exception when check_violation then
    raise notice 'OK blok 28: minuten 131 geeft 23514';
  end;
  begin
    insert into speelminuten (team_id, event_id, player_id, minuten, wissels)
    values ('TEAM_A_UUID', v_m1, v_zonder, -1, 0);
    raise exception 'KAPOT: minuten -1 werd geaccepteerd';
  exception when check_violation then
    raise notice 'OK blok 28: minuten -1 geeft 23514';
  end;
  begin
    insert into speelminuten (team_id, event_id, player_id, minuten, wissels)
    values ('TEAM_A_UUID', v_m1, v_zonder, 10, -1);
    raise exception 'KAPOT: wissels -1 werd geaccepteerd';
  exception when check_violation then
    raise notice 'OK blok 28: wissels -1 geeft 23514';
  end;
  begin
    insert into speelminuten (team_id, event_id, player_id, minuten, wissels)
    values ('TEAM_A_UUID', v_m1, v_zonder, 10, 100);
    raise exception 'KAPOT: wissels 100 werd geaccepteerd';
  exception when check_violation then
    raise notice 'OK blok 28: wissels 100 geeft 23514';
  end;

  -- h. Eén rij per (event, speler); de upsert van de app laat er één over.
  insert into speelminuten (team_id, event_id, player_id, minuten, wissels)
  values ('TEAM_A_UUID', v_m1, v_zonder, 10, 0);
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'KAPOT: OWNER_A kon geen speelminuten op een eigen wedstrijd vastleggen'; end if;
  begin
    insert into speelminuten (team_id, event_id, player_id, minuten, wissels)
    values ('TEAM_A_UUID', v_m1, v_zonder, 11, 0);
    raise exception 'KAPOT: een tweede rij voor dezelfde wedstrijd en speler werd geaccepteerd';
  exception when unique_violation then
    raise notice 'OK blok 28: een tweede rij voor dezelfde (event, speler) geeft 23505';
  end;
  insert into speelminuten (team_id, event_id, player_id, minuten, wissels)
  values ('TEAM_A_UUID', v_m1, v_zonder, 20, 1)
  on conflict (event_id, player_id) do update set minuten = excluded.minuten, wissels = excluded.wissels;
  select count(*) into n from speelminuten where event_id = v_m1 and player_id = v_zonder;
  if n <> 1 then raise exception 'KAPOT: na de upsert staan er % rijen voor (event, speler)', n; end if;
  select minuten into n from speelminuten where event_id = v_m1 and player_id = v_zonder;
  if n <> 20 then raise exception 'KAPOT: de upsert zette minuten op % i.p.v. 20 (laatste wint)', n; end if;
  raise notice 'OK blok 28: upsert op (event_id, player_id) laat precies één rij over met de nieuwe waarde';

  -- i. Een bestaande rij kan niet naar een ander team verhuizen.
  begin
    update speelminuten set event_id = v_match_b where event_id = v_m1 and player_id = v_zonder;
    raise exception 'LEK: een update kon speelminuten naar een wedstrijd van TEAM_B verplaatsen';
  exception when insufficient_privilege then
    raise notice 'OK blok 28: een update naar een event_id van TEAM_B wordt geweigerd';
  end;
  if v_vreemd is null then
    raise notice 'OVERGESLAGEN blok 28i (speler): TEAM_B heeft geen spelers';
  else
    begin
      update speelminuten set player_id = v_vreemd where event_id = v_m1 and player_id = v_zonder;
      raise exception 'LEK: een update kon speelminuten aan een speler van TEAM_B hangen';
    exception when insufficient_privilege then
      raise notice 'OK blok 28: een update naar een player_id van TEAM_B wordt geweigerd';
    end;
  end if;
  begin
    update speelminuten set team_id = 'TEAM_B_UUID' where event_id = v_m1 and player_id = v_zonder;
    raise exception 'LEK: een update kon speelminuten naar TEAM_B verplaatsen';
  exception when insufficient_privilege then
    raise notice 'OK blok 28: een update naar team_id TEAM_B wordt geweigerd';
  end;

  -- j. Cascade (als postgres: de FK werkt los van RLS).
  reset role;
  delete from players where id = v_inactief_met;
  select count(*) into n from speelminuten where player_id = v_inactief_met;
  if n <> 0 then raise exception 'KAPOT: na het verwijderen van de speler staan er nog % speelminuten-rijen', n; end if;
  delete from events where id = v_m1;
  select count(*) into n from speelminuten where event_id = v_m1;
  if n <> 0 then raise exception 'KAPOT: na het verwijderen van de wedstrijd staan er nog % speelminuten-rijen', n; end if;
  raise notice 'OK blok 28: speler en wedstrijd verwijderen neemt hun speelminuten mee (cascade)';

  -- k. Geen execute-recht voor anon.
  if has_function_privilege('anon', 'public.inzichten_speelminuten_per_speler(uuid, date, date)', 'execute') then
    raise exception 'LEK: anon mag inzichten_speelminuten_per_speler uitvoeren';
  end if;
  raise notice 'OK blok 28: anon mag inzichten_speelminuten_per_speler niet uitvoeren';
end $$;

-- ── Blok 29: inzichten-metrics fase 3a (training en kwaliteit, alleen lezen) ──
-- Vereist supabase/inzichten-metrics-fase3a.sql (2 lees-RPC's, geen tabellen).
-- Geen assistent nodig. Maakt binnen deze transactie (de rollback ruimt alles
-- op) in TEAM_A testdata in MAART 1990 aan — een maand zonder echte data.
-- Bewust niet januari of februari: blok 27 en 28 zetten in dezelfde
-- transactie al events in januari 1990, en blok 28 laat ook een wedstrijd op
-- 15 februari 1990 staan (v_buiten); die zou elke telling hier vervuilen.
-- Daarom eerst de opzetcheck op events van TEAM_A in maart 1990.
-- Testdata: T1 vct (ma 5-3) met K1 (eigen oefening O1, duur 20) en K2 (O2 van
-- een ANDERE eigenaar, koppeling zonder duur, bibliotheek 15); T2 teamtactisch
-- (zo 11-3) zonder koppelingen; M1 met uitslag en 1 rating; M2 zonder uitslag
-- met een eigen task_override 'analysis'. Plus "vreemde" rijen met team_id =
-- TEAM_B op eigen events: K3 op T1, een override en een moment op M1.
--   a. beide RPC's met p_team_id = TEAM_B geven 0 rijen;
--   b. inzichten_training_koppelingen(TEAM_A, maart) = precies K1, K2 en T2
--      (koppeling_id null), K3 ontbreekt, totaal = 3;
--   c. K2: de oefening van een andere eigenaar is leesbaar via M6
--      (oefening_leesbaar, categorie, bibliotheekduur 15) — de RPC filtert
--      oefeningen bewust NIET op team_id (EIGENAAR-USER);
--   d. inzichten_invul_discipline(TEAM_A, maart) = 4 rijen met de juiste
--      tellingen; de TEAM_B-override, -moment en K3 tellen niet;
--   e. een niet-lid (BUITENSTAANDER, sinds blok 23) krijgt 0 rijen voor TEAM_A;
--   f. anon mag beide RPC's niet uitvoeren;
--   g. alleen lezen: beide functies zijn stable en invoker, en na alle calls
--      zijn de aantallen in events, training_oefeningen en task_overrides
--      voor TEAM_A ongewijzigd.
do $$
declare
  v_start date := date '1990-03-01';
  v_end   date := date '1990-03-31';
  v_t1 uuid; v_t2 uuid; v_m1 uuid; v_m2 uuid; v_speler uuid;
  v_o1 uuid; v_o2 uuid; v_k1 uuid; v_k2 uuid; v_k3 uuid;
  v_vreemd_override boolean := false; v_vreemd_moment boolean := false;
  v_events_voor int; v_koppelingen_voor int; v_overrides_voor int;
  v_events_na int; v_koppelingen_na int; v_overrides_na int;
  n int; r record;
begin
  reset role;
  if to_regprocedure('public.inzichten_training_koppelingen(uuid, date, date)') is null
     or to_regprocedure('public.inzichten_invul_discipline(uuid, date, date)') is null then
    raise exception 'INZICHTEN-METRICS FASE 3A ONTBREEKT: draai eerst supabase/inzichten-metrics-fase3a.sql';
  end if;
  select count(*) into n from events where team_id = 'TEAM_A_UUID' and date between v_start and v_end;
  if n <> 0 then
    raise exception 'FOUT IN DE OPZET: TEAM_A heeft al events in maart 1990 — kies in blok 29 een andere testmaand';
  end if;

  -- Opzet als postgres (buiten RLS).
  insert into events (team_id, type, date, trainingstype, doelstelling)
  values ('TEAM_A_UUID', 'training', date '1990-03-05', 'vct', 'RLS-29 doel') returning id into v_t1;
  insert into events (team_id, type, date, trainingstype)
  values ('TEAM_A_UUID', 'training', date '1990-03-11', 'teamtactisch') returning id into v_t2;
  insert into events (team_id, type, date, goals_for, goals_against, doelstelling)
  values ('TEAM_A_UUID', 'match', date '1990-03-03', 2, 1, 'RLS-29 geen trainingsdoel') returning id into v_m1;
  insert into events (team_id, type, date)
  values ('TEAM_A_UUID', 'match', date '1990-03-04') returning id into v_m2;
  insert into players (team_id, name, position, active)
  values ('TEAM_A_UUID', 'RLS-29 speler', 'Keeper', true) returning id into v_speler;
  insert into match_ratings (team_id, event_id, player_id, rating) values ('TEAM_A_UUID', v_m1, v_speler, 7);
  insert into task_overrides (team_id, event_id, task_type) values ('TEAM_A_UUID', v_m2, 'analysis');
  -- O1 = eigen oefening van OWNER_A; O2 = van een andere eigenaar (oefeningen.team_id
  -- is de eigenaar-user en heeft geen FK, supabase/oefeningen-persoonlijk.sql).
  insert into oefeningen (team_id, naam, categorie, duur_min)
  values ('OWNER_A_UUID', 'RLS-29 eigen', 'positiespel', 10) returning id into v_o1;
  insert into oefeningen (team_id, naam, categorie, duur_min)
  values (gen_random_uuid(), 'RLS-29 teamgenoot', 'partijen_klein', 15) returning id into v_o2;
  insert into training_oefeningen (team_id, event_id, oefening_id, volgorde, duur_min)
  values ('TEAM_A_UUID', v_t1, v_o1, 1, 20) returning id into v_k1;
  insert into training_oefeningen (team_id, event_id, oefening_id, volgorde, duur_min)
  values ('TEAM_A_UUID', v_t1, v_o2, 2, null) returning id into v_k2;
  -- Vreemde rijen: team_id = TEAM_B op een event van TEAM_A.
  begin
    insert into training_oefeningen (team_id, event_id, oefening_id, volgorde, duur_min)
    values ('TEAM_B_UUID', v_t1, v_o1, 3, 45) returning id into v_k3;
  exception when others then
    v_k3 := null;
    raise notice 'OVERGESLAGEN blok 29 (K3): de vreemde koppeling liet zich niet invoegen (%)', sqlstate;
  end;
  begin
    insert into task_overrides (team_id, event_id, task_type) values ('TEAM_B_UUID', v_m1, 'analysis');
    v_vreemd_override := true;
  exception when others then
    raise notice 'OVERGESLAGEN blok 29 (override): de vreemde override liet zich niet invoegen (%)', sqlstate;
  end;
  begin
    insert into match_events (team_id, event_id, player_id, kind) values ('TEAM_B_UUID', v_m1, v_speler, 'goal');
    v_vreemd_moment := true;
  exception when others then
    raise notice 'OVERGESLAGEN blok 29 (moment): het vreemde moment liet zich niet invoegen (%)', sqlstate;
  end;

  -- g (voor): aantallen als postgres, vóór de RPC-calls.
  select count(*) into v_events_voor from events where team_id = 'TEAM_A_UUID';
  select count(*) into v_koppelingen_voor from training_oefeningen where team_id = 'TEAM_A_UUID';
  select count(*) into v_overrides_voor from task_overrides where team_id = 'TEAM_A_UUID';

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"OWNER_A_UUID","role":"authenticated"}';
  if is_team_member('TEAM_B_UUID') then
    raise exception 'FOUT IN DE OPZET: OWNER_A is wél lid van TEAM_B — kies een ander TEAM_B';
  end if;

  -- a. Beide RPC's met een vreemd team-id.
  select count(*) into n from inzichten_training_koppelingen('TEAM_B_UUID', current_date - 400, current_date + 400);
  if n <> 0 then raise exception 'LEK: inzichten_training_koppelingen geeft % rijen van TEAM_B', n; end if;
  select count(*) into n from inzichten_training_koppelingen('TEAM_B_UUID', v_start, v_end);
  if n <> 0 then raise exception 'LEK: inzichten_training_koppelingen geeft % rijen van TEAM_B (maart 1990)', n; end if;
  select count(*) into n from inzichten_invul_discipline('TEAM_B_UUID', current_date - 400, current_date + 400);
  if n <> 0 then raise exception 'LEK: inzichten_invul_discipline geeft % rijen van TEAM_B', n; end if;
  select count(*) into n from inzichten_invul_discipline('TEAM_B_UUID', v_start, v_end);
  if n <> 0 then raise exception 'LEK: inzichten_invul_discipline geeft % rijen van TEAM_B (maart 1990)', n; end if;
  raise notice 'OK blok 29: beide fase-3a-RPC''s geven 0 rijen voor een vreemd team';

  -- b. Trainingen + koppelingen van TEAM_A.
  if v_k3 is not null then
    select count(*) into n from inzichten_training_koppelingen('TEAM_A_UUID', v_start, v_end) where koppeling_id = v_k3;
    if n <> 0 then raise exception 'LEK: een koppeling van TEAM_B telt mee in inzichten_training_koppelingen(TEAM_A)'; end if;
  end if;
  select count(*) into n from inzichten_training_koppelingen('TEAM_A_UUID', v_start, v_end);
  if n <> 3 then raise exception 'KAPOT: inzichten_training_koppelingen(TEAM_A, maart 1990) geeft % rijen (verwacht 3: K1, K2 en T2 zonder koppeling)', n; end if;
  select count(*) into n from inzichten_training_koppelingen('TEAM_A_UUID', v_start, v_end) where totaal <> 3;
  if n <> 0 then raise exception 'KAPOT: totaal is niet 3 op % rijen (count(*) over () vóór de limit)', n; end if;
  select * into r from inzichten_training_koppelingen('TEAM_A_UUID', v_start, v_end) where event_id = v_t2;
  if not found or r.koppeling_id is not null or r.trainingstype <> 'teamtactisch' or r.oefening_leesbaar then
    raise exception 'KAPOT: de training zonder koppeling geeft % (verwacht één rij, koppeling_id null, teamtactisch)', r;
  end if;
  select * into r from inzichten_training_koppelingen('TEAM_A_UUID', v_start, v_end) where koppeling_id = v_k1;
  if not found or r.koppeling_duur_min <> 20 or r.oefening_duur_min <> 10 or r.categorie <> 'positiespel'
     or not r.oefening_leesbaar or r.datum <> date '1990-03-05' or r.trainingstype <> 'vct' then
    raise exception 'KAPOT: K1 geeft % (verwacht duur 20, bibliotheek 10, positiespel, leesbaar, vct op 5-3)', r;
  end if;
  raise notice 'OK blok 29: inzichten_training_koppelingen geeft eigen koppelingen + training zonder koppeling, geen vreemde';

  -- c. De oefening van een andere eigenaar (M6), via de koppeling van TEAM_A.
  select * into r from inzichten_training_koppelingen('TEAM_A_UUID', v_start, v_end) where koppeling_id = v_k2;
  if not found or not r.oefening_leesbaar or r.categorie is null
     or r.koppeling_duur_min is not null or r.oefening_duur_min is distinct from 15 then
    raise exception 'KAPOT: oefening van teamgenoot niet leesbaar — staat M6 er nog? (%)', r;
  end if;
  raise notice 'OK blok 29: de oefening van een andere eigenaar is leesbaar (geen oefeningen.team_id-filter)';

  -- d. Invul-discipline van TEAM_A.
  select count(*) into n from inzichten_invul_discipline('TEAM_A_UUID', v_start, v_end);
  if n <> 4 then raise exception 'KAPOT: inzichten_invul_discipline(TEAM_A, maart 1990) geeft % rijen (verwacht 4)', n; end if;
  select * into r from inzichten_invul_discipline('TEAM_A_UUID', v_start, v_end) where event_id = v_m1;
  if not found then raise exception 'KAPOT: M1 ontbreekt in inzichten_invul_discipline(TEAM_A)'; end if;
  if v_vreemd_override and r.handmatig then
    raise exception 'LEK: een task_override van TEAM_B telt mee als handmatig afgevinkt';
  end if;
  if v_vreemd_moment and r.aantal_momenten <> 0 then
    raise exception 'LEK: een wedstrijdmoment van TEAM_B telt mee (% momenten)', r.aantal_momenten;
  end if;
  if r.soort <> 'match' or r.aantal_ratings <> 1 or r.handmatig or r.goals_for <> 2 or r.goals_against <> 1
     or r.doelstelling is not null or r.totaal <> 4 then
    raise exception 'KAPOT: M1 geeft % (verwacht match, 1 rating, niet handmatig, 2-1, geen doelstelling, totaal 4)', r;
  end if;
  select * into r from inzichten_invul_discipline('TEAM_A_UUID', v_start, v_end) where event_id = v_m2;
  if not found or not r.handmatig or r.goals_for is not null or r.aantal_ratings <> 0 then
    raise exception 'KAPOT: M2 geeft % (verwacht handmatig afgevinkt, geen uitslag, 0 ratings)', r;
  end if;
  select * into r from inzichten_invul_discipline('TEAM_A_UUID', v_start, v_end) where event_id = v_t1;
  if not found then raise exception 'KAPOT: T1 ontbreekt in inzichten_invul_discipline(TEAM_A)'; end if;
  if v_k3 is not null and r.aantal_oefeningen > 2 then
    raise exception 'LEK: een koppeling van TEAM_B telt mee in aantal_oefeningen (%)', r.aantal_oefeningen;
  end if;
  if r.soort <> 'training' or r.aantal_oefeningen <> 2 or r.doelstelling is distinct from 'RLS-29 doel' or r.handmatig then
    raise exception 'KAPOT: T1 geeft % (verwacht training, 2 oefeningen, doelstelling, niet handmatig)', r;
  end if;
  select * into r from inzichten_invul_discipline('TEAM_A_UUID', v_start, v_end) where event_id = v_t2;
  if not found or r.aantal_oefeningen <> 0 or r.doelstelling is not null then
    raise exception 'KAPOT: T2 geeft % (verwacht 0 oefeningen, geen doelstelling)', r;
  end if;
  raise notice 'OK blok 29: inzichten_invul_discipline telt alleen rijen van TEAM_A, handmatig = override van het eigen type';

  -- e. Een niet-lid van TEAM_A.
  set local request.jwt.claims = '{"sub":"BUITENSTAANDER_UUID","role":"authenticated"}';
  if is_team_member('TEAM_A_UUID') then
    raise notice 'OVERGESLAGEN blok 29e: BUITENSTAANDER is (weer) lid van TEAM_A';
  else
    select count(*) into n from inzichten_training_koppelingen('TEAM_A_UUID', v_start, v_end);
    if n <> 0 then raise exception 'LEK: een niet-lid krijgt % rijen uit inzichten_training_koppelingen(TEAM_A)', n; end if;
    select count(*) into n from inzichten_invul_discipline('TEAM_A_UUID', v_start, v_end);
    if n <> 0 then raise exception 'LEK: een niet-lid krijgt % rijen uit inzichten_invul_discipline(TEAM_A)', n; end if;
    raise notice 'OK blok 29: een niet-lid krijgt 0 rijen voor TEAM_A';
  end if;

  -- f. Geen execute-recht voor anon.
  reset role;
  if has_function_privilege('anon', 'public.inzichten_training_koppelingen(uuid, date, date)', 'execute')
     or has_function_privilege('anon', 'public.inzichten_invul_discipline(uuid, date, date)', 'execute') then
    raise exception 'LEK: anon mag een fase-3a-RPC uitvoeren';
  end if;
  raise notice 'OK blok 29: anon mag de fase-3a-RPC''s niet uitvoeren';

  -- g. Alleen lezen.
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('inzichten_training_koppelingen', 'inzichten_invul_discipline')
     and p.provolatile = 's' and not p.prosecdef;
  if n <> 2 then raise exception 'KAPOT: de fase-3a-RPC''s zijn niet allebei stable en security invoker (% van 2)', n; end if;
  select count(*) into v_events_na from events where team_id = 'TEAM_A_UUID';
  select count(*) into v_koppelingen_na from training_oefeningen where team_id = 'TEAM_A_UUID';
  select count(*) into v_overrides_na from task_overrides where team_id = 'TEAM_A_UUID';
  if v_events_na <> v_events_voor or v_koppelingen_na <> v_koppelingen_voor or v_overrides_na <> v_overrides_voor then
    raise exception 'KAPOT: de fase-3a-RPC''s hebben geschreven (events %→%, koppelingen %→%, overrides %→%)',
      v_events_voor, v_events_na, v_koppelingen_voor, v_koppelingen_na, v_overrides_voor, v_overrides_na;
  end if;
  raise notice 'OK blok 29: de fase-3a-RPC''s schrijven niets (alleen lezen)';
end $$;

-- ── Blok 30: inzichten-metrics fase 3b (RPE en doelstelling-oordeel) ──
-- Vereist supabase/inzichten-metrics-fase3b.sql (tabel training_evaluaties + 1
-- RPC). Maakt binnen deze transactie (de rollback ruimt alles op) in TEAM_A
-- testdata in APRIL 1990 aan — een maand zonder echte data. Bewust niet
-- januari t/m maart: blok 27, 28 en 29 zetten in dezelfde transactie al events
-- in januari en maart 1990, en blok 28 laat een wedstrijd op 15 februari 1990
-- staan. Daarom eerst de opzetcheck op events van TEAM_A in april 1990.
-- ASSISTENT_A krijgt (of houdt) Spelers- en Aanwezigheidsrecht ZONDER
-- Trainingsrecht: zo is bewezen dat die rechten niet genoeg zijn (R4).
-- Testdata: T1 training (ma 2-4, doelstelling 'RLS-30 doel'), T2 training
-- (zo 8-4, geen doelstelling), T3 training (ma 9-4), M1 wedstrijd (3-4) en TB
-- een training van TEAM_B (2-4). Evaluaties: T1 (rpe 6, 'ja'), T3 (rpe 4,
-- oordeel null) en TB (rpe 9) met team_id TEAM_B.
--   a. OWNER_A ziet geen evaluaties van TEAM_B (op team_id en op event_id TB);
--   b. de RPC met p_team_id = TEAM_B geeft 0 rijen; met TEAM_A over april
--      precies T1, T2 en T3 (totaal 3, T2 zonder evaluatie = null), M1 en TB
--      ontbreken;
--   c. ASSISTENT_A (spelers en aanwezigheid aan, training uit): insert 42501,
--      update en delete 0 rijen;
--   d. OWNER_A met een event_id van TEAM_B: 42501;
--   e. OWNER_A op de eigen wedstrijd M1: 42501;
--   f. rpe 0 of 11, oordeel 'misschien': 23514 (bewust gevangen op sqlstate
--      '23514', niet op de conditienaam: de structuurtests van blok 28 en 29
--      tellen die naam in hun stuk tot de rollback, en dat omvat dit blok);
--   g. een tweede gewone insert op T1: 23505;
--   h. een RPE-upsert laat het oordeel staan en een oordeel-upsert de RPE
--      (R.9); wissen = kolom op null laat de andere waarde staan; herstel
--      met `is null` overschrijft nooit;
--   i. een update van event_id naar TB of M1, of van team_id naar TEAM_B: 42501;
--   j. T3 verwijderen neemt zijn rij mee (cascade);
--   k. een niet-lid (BUITENSTAANDER, sinds blok 23) krijgt 0 rijen;
--   l. anon mag de RPC niet uitvoeren; de functie is stable en invoker; RLS
--      staat aan met precies 4 policies.
do $$
declare
  v_start date := date '1990-04-01';
  v_end   date := date '1990-04-30';
  v_t1 uuid; v_t2 uuid; v_t3 uuid; v_m1 uuid; v_tb uuid;
  n int; r record;
begin
  reset role;
  if to_regclass('public.training_evaluaties') is null
     or to_regprocedure('public.inzichten_training_evaluaties(uuid, date, date)') is null then
    raise exception 'INZICHTEN-METRICS FASE 3B ONTBREEKT: draai eerst supabase/inzichten-metrics-fase3b.sql';
  end if;
  select count(*) into n from events where team_id = 'TEAM_A_UUID' and date between v_start and v_end;
  if n <> 0 then
    raise exception 'FOUT IN DE OPZET: TEAM_A heeft al events in april 1990 — kies in blok 30 een andere testmaand';
  end if;

  -- Assistent met Spelers- en Aanwezigheidsrecht, zonder Trainingsrecht (c):
  -- bestaande rij bijwerken, of tijdelijk invoegen.
  insert into team_members (team_id, user_id, rol, mag_spelers_bewerken, mag_aanwezigheid_bewerken, mag_training_bewerken)
  values ('TEAM_A_UUID', 'ASSISTENT_A_UUID', 'assistent', true, true, false)
  on conflict (team_id, user_id) do update
    set mag_training_bewerken = false, mag_spelers_bewerken = true, mag_aanwezigheid_bewerken = true
   where team_members.rol = 'assistent';

  -- Opzet als postgres (buiten RLS).
  insert into events (team_id, type, date, doelstelling)
  values ('TEAM_A_UUID', 'training', date '1990-04-02', 'RLS-30 doel') returning id into v_t1;
  insert into events (team_id, type, date)
  values ('TEAM_A_UUID', 'training', date '1990-04-08') returning id into v_t2;
  insert into events (team_id, type, date)
  values ('TEAM_A_UUID', 'training', date '1990-04-09') returning id into v_t3;
  insert into events (team_id, type, date)
  values ('TEAM_A_UUID', 'match', date '1990-04-03') returning id into v_m1;
  insert into events (team_id, type, date)
  values ('TEAM_B_UUID', 'training', date '1990-04-02') returning id into v_tb;
  insert into training_evaluaties (team_id, event_id, rpe, oordeel) values
    ('TEAM_A_UUID', v_t1, 6, 'ja'),
    ('TEAM_A_UUID', v_t3, 4, null),
    ('TEAM_B_UUID', v_tb, 9, null);

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"OWNER_A_UUID","role":"authenticated"}';
  if is_team_member('TEAM_B_UUID') then
    raise exception 'FOUT IN DE OPZET: OWNER_A is wél lid van TEAM_B — kies een ander TEAM_B';
  end if;

  -- a. Lezen van een vreemd team.
  select count(*) into n from training_evaluaties where team_id = 'TEAM_B_UUID';
  if n <> 0 then raise exception 'LEK: OWNER_A ziet % trainingsevaluaties van TEAM_B', n; end if;
  select count(*) into n from training_evaluaties where event_id = v_tb;
  if n <> 0 then raise exception 'LEK: OWNER_A ziet een trainingsevaluatie op een training van TEAM_B'; end if;
  raise notice 'OK blok 30: OWNER_A ziet geen trainingsevaluaties van TEAM_B';

  -- b. De RPC: vreemd team leeg, eigen team precies T1, T2 en T3.
  select count(*) into n from inzichten_training_evaluaties('TEAM_B_UUID', current_date - 400, current_date + 400);
  if n <> 0 then raise exception 'LEK: inzichten_training_evaluaties geeft % rijen van TEAM_B', n; end if;
  select count(*) into n from inzichten_training_evaluaties('TEAM_B_UUID', v_start, v_end);
  if n <> 0 then raise exception 'LEK: inzichten_training_evaluaties geeft % rijen van TEAM_B (april 1990)', n; end if;
  select count(*) into n from inzichten_training_evaluaties('TEAM_A_UUID', v_start, v_end) where event_id = v_tb;
  if n <> 0 then raise exception 'LEK: een training van TEAM_B staat in inzichten_training_evaluaties(TEAM_A)'; end if;
  select count(*) into n from inzichten_training_evaluaties('TEAM_A_UUID', v_start, v_end) where event_id = v_m1;
  if n <> 0 then raise exception 'KAPOT: een wedstrijd staat in inzichten_training_evaluaties (alleen trainingen)'; end if;
  select count(*) into n from inzichten_training_evaluaties('TEAM_A_UUID', v_start, v_end);
  if n <> 3 then raise exception 'KAPOT: inzichten_training_evaluaties(TEAM_A, april 1990) geeft % rijen (verwacht 3: T1, T2 en T3)', n; end if;
  select count(*) into n from inzichten_training_evaluaties('TEAM_A_UUID', v_start, v_end) where totaal <> 3;
  if n <> 0 then raise exception 'KAPOT: totaal is niet 3 op % rijen (count(*) over () vóór de limit)', n; end if;
  select * into r from inzichten_training_evaluaties('TEAM_A_UUID', v_start, v_end) where event_id = v_t1;
  if not found or r.rpe is distinct from 6 or r.oordeel is distinct from 'ja' or r.doelstelling is null
     or r.datum <> date '1990-04-02' then
    raise exception 'KAPOT: T1 geeft % (verwacht rpe 6, oordeel ja, een doelstelling, 2-4)', r;
  end if;
  select * into r from inzichten_training_evaluaties('TEAM_A_UUID', v_start, v_end) where event_id = v_t2;
  if not found or r.rpe is not null or r.oordeel is not null then
    raise exception 'KAPOT: T2 zonder evaluatie geeft % (verwacht één rij met rpe en oordeel null)', r;
  end if;
  select * into r from inzichten_training_evaluaties('TEAM_A_UUID', v_start, v_end) where event_id = v_t3;
  if not found or r.rpe is distinct from 4 or r.oordeel is not null then
    raise exception 'KAPOT: T3 geeft % (verwacht rpe 4, oordeel null)', r;
  end if;
  raise notice 'OK blok 30: inzichten_training_evaluaties geeft één rij per eigen training, geen wedstrijd en niets van TEAM_B';

  -- c. Assistent met Spelers en Aanwezigheid, zonder Training.
  set local request.jwt.claims = '{"sub":"ASSISTENT_A_UUID","role":"authenticated"}';
  if not is_team_member('TEAM_A_UUID') or is_team_owner('TEAM_A_UUID') then
    raise exception 'FOUT IN DE OPZET: ASSISTENT_A is geen assistent in TEAM_A';
  end if;
  if not (can_edit('TEAM_A_UUID', 'spelers') and can_edit('TEAM_A_UUID', 'aanwezigheid'))
     or can_edit('TEAM_A_UUID', 'training') then
    raise exception 'FOUT IN DE OPZET: ASSISTENT_A heeft niet precies Spelers en Aanwezigheid zonder Training';
  end if;
  begin
    insert into training_evaluaties (team_id, event_id, rpe) values ('TEAM_A_UUID', v_t2, 5);
    raise exception 'LEK: een assistent zonder trainingsrecht kon een RPE vastleggen';
  exception when insufficient_privilege then
    raise notice 'OK blok 30: insert op training_evaluaties geweigerd zonder trainingsrecht (ook met Spelers en Aanwezigheid)';
  end;
  update training_evaluaties set rpe = 1 where event_id = v_t1;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEK: een assistent zonder trainingsrecht kon een trainingsevaluatie wijzigen'; end if;
  delete from training_evaluaties where event_id = v_t1;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'LEK: een assistent zonder trainingsrecht kon een trainingsevaluatie verwijderen'; end if;
  raise notice 'OK blok 30: update en delete op training_evaluaties raken 0 rijen zonder trainingsrecht';

  -- d. Eigen team_id, maar een training van een ander team.
  set local request.jwt.claims = '{"sub":"OWNER_A_UUID","role":"authenticated"}';
  begin
    insert into training_evaluaties (team_id, event_id, rpe) values ('TEAM_A_UUID', v_tb, 5);
    raise exception 'LEK: OWNER_A kon een evaluatie aan een training van TEAM_B hangen';
  exception when insufficient_privilege then
    raise notice 'OK blok 30: een event_id van een ander team wordt geweigerd';
  end;

  -- e. Een wedstrijd van het eigen team.
  begin
    insert into training_evaluaties (team_id, event_id, rpe) values ('TEAM_A_UUID', v_m1, 5);
    raise exception 'LEK: een RPE kon aan een wedstrijd gehangen worden';
  exception when insufficient_privilege then
    raise notice 'OK blok 30: een wedstrijd wordt geweigerd';
  end;

  -- f. De CHECKs op rpe en oordeel (op de eigen training T2, zonder rij).
  begin
    insert into training_evaluaties (team_id, event_id, rpe) values ('TEAM_A_UUID', v_t2, 0);
    raise exception 'KAPOT: rpe 0 werd geaccepteerd';
  exception when sqlstate '23514' then
    raise notice 'OK blok 30: rpe 0 geeft 23514';
  end;
  begin
    insert into training_evaluaties (team_id, event_id, rpe) values ('TEAM_A_UUID', v_t2, 11);
    raise exception 'KAPOT: rpe 11 werd geaccepteerd';
  exception when sqlstate '23514' then
    raise notice 'OK blok 30: rpe 11 geeft 23514';
  end;
  begin
    insert into training_evaluaties (team_id, event_id, oordeel) values ('TEAM_A_UUID', v_t2, 'misschien');
    raise exception 'KAPOT: oordeel misschien werd geaccepteerd';
  exception when sqlstate '23514' then
    raise notice 'OK blok 30: oordeel misschien geeft 23514';
  end;

  -- g. Eén rij per training.
  begin
    insert into training_evaluaties (team_id, event_id, rpe) values ('TEAM_A_UUID', v_t1, 7);
    raise exception 'KAPOT: een tweede rij voor dezelfde training werd geaccepteerd';
  exception when unique_violation then
    raise notice 'OK blok 30: een tweede rij voor dezelfde training geeft 23505';
  end;

  -- h. Elke kolom los (R.9): de upserts van de app sturen alleen hun eigen kolom.
  insert into training_evaluaties (team_id, event_id, rpe) values ('TEAM_A_UUID', v_t1, 8)
  on conflict (event_id) do update set rpe = excluded.rpe;
  select count(*) into n from training_evaluaties where event_id = v_t1;
  if n <> 1 then raise exception 'KAPOT: na de RPE-upsert staan er % rijen voor T1', n; end if;
  select * into r from training_evaluaties where event_id = v_t1;
  if r.rpe is distinct from 8 or r.oordeel is distinct from 'ja' then
    raise exception 'KAPOT (R.9): de RPE-upsert op T1 gaf rpe % en oordeel % (verwacht 8 en ja)', r.rpe, r.oordeel;
  end if;
  insert into training_evaluaties (team_id, event_id, oordeel) values ('TEAM_A_UUID', v_t3, 'nee')
  on conflict (event_id) do update set oordeel = excluded.oordeel;
  select * into r from training_evaluaties where event_id = v_t3;
  if r.rpe is distinct from 4 or r.oordeel is distinct from 'nee' then
    raise exception 'KAPOT (R.9): de oordeel-upsert op T3 gaf rpe % en oordeel % (verwacht 4 en nee)', r.rpe, r.oordeel;
  end if;
  -- Wissen zoals wisTrainingRpe: alleen de kolom op null, de rij en het oordeel blijven.
  update training_evaluaties set rpe = null where event_id = v_t1 and team_id = 'TEAM_A_UUID' and rpe = 8;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'KAPOT: OWNER_A kon de RPE van T1 niet wissen (% rijen)', n; end if;
  select * into r from training_evaluaties where event_id = v_t1;
  if not found or r.rpe is not null or r.oordeel is distinct from 'ja' then
    raise exception 'KAPOT: wissen van de RPE raakte ook het oordeel of de rij (%)', r;
  end if;
  -- Herstel zoals herstelTrainingRpe: alleen als de kolom nog leeg is.
  update training_evaluaties set rpe = 6 where event_id = v_t1 and team_id = 'TEAM_A_UUID' and rpe is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'KAPOT: het herstel van de RPE van T1 raakte % rijen (verwacht 1)', n; end if;
  update training_evaluaties set rpe = 2 where event_id = v_t1 and team_id = 'TEAM_A_UUID' and rpe is null;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'KAPOT: een herstel overschreef een bestaande RPE'; end if;
  raise notice 'OK blok 30: rpe en oordeel worden los geschreven, gewist en hersteld (R.9)';

  -- i. Een bestaande rij kan niet naar een ander team, of naar een wedstrijd.
  begin
    update training_evaluaties set event_id = v_tb where event_id = v_t1;
    raise exception 'LEK: een update kon een evaluatie naar een training van TEAM_B verplaatsen';
  exception when insufficient_privilege then
    raise notice 'OK blok 30: een update naar een event_id van TEAM_B wordt geweigerd';
  end;
  begin
    update training_evaluaties set event_id = v_m1 where event_id = v_t1;
    raise exception 'LEK: een update kon een evaluatie naar een wedstrijd verplaatsen';
  exception when insufficient_privilege then
    raise notice 'OK blok 30: een update naar een wedstrijd wordt geweigerd';
  end;
  begin
    update training_evaluaties set team_id = 'TEAM_B_UUID' where event_id = v_t1;
    raise exception 'LEK: een update kon een evaluatie naar TEAM_B verplaatsen';
  exception when insufficient_privilege then
    raise notice 'OK blok 30: een update naar team_id TEAM_B wordt geweigerd';
  end;

  -- j. Cascade (als postgres: de FK werkt los van RLS).
  reset role;
  delete from events where id = v_t3;
  select count(*) into n from training_evaluaties where event_id = v_t3;
  if n <> 0 then raise exception 'KAPOT: na het verwijderen van de training staan er nog % evaluatie-rijen', n; end if;
  raise notice 'OK blok 30: een training verwijderen neemt zijn evaluatie mee (cascade)';

  -- k. Een niet-lid van TEAM_A.
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"BUITENSTAANDER_UUID","role":"authenticated"}';
  if is_team_member('TEAM_A_UUID') then
    raise notice 'OVERGESLAGEN blok 30k: BUITENSTAANDER is (weer) lid van TEAM_A';
  else
    select count(*) into n from inzichten_training_evaluaties('TEAM_A_UUID', v_start, v_end);
    if n <> 0 then raise exception 'LEK: een niet-lid krijgt % rijen uit inzichten_training_evaluaties(TEAM_A)', n; end if;
    select count(*) into n from training_evaluaties where team_id = 'TEAM_A_UUID';
    if n <> 0 then raise exception 'LEK: een niet-lid ziet % trainingsevaluaties van TEAM_A', n; end if;
    raise notice 'OK blok 30: een niet-lid krijgt 0 rijen voor TEAM_A';
  end if;

  -- l. Rechten en vorm.
  reset role;
  if has_function_privilege('anon', 'public.inzichten_training_evaluaties(uuid, date, date)', 'execute') then
    raise exception 'LEK: anon mag inzichten_training_evaluaties uitvoeren';
  end if;
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'inzichten_training_evaluaties'
     and p.provolatile = 's' and not p.prosecdef;
  if n <> 1 then raise exception 'KAPOT: inzichten_training_evaluaties is niet stable en security invoker'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.training_evaluaties'::regclass) then
    raise exception 'LEK: RLS staat uit op training_evaluaties';
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'training_evaluaties';
  if n <> 4 then raise exception 'KAPOT: training_evaluaties heeft % policies (verwacht 4)', n; end if;
  raise notice 'OK blok 30: anon mag de RPC niet uitvoeren; stable, invoker, RLS aan met 4 policies';
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
-- fase 4 (persoonlijke oefeningen) in blok 24 (M6) en 25 (M6b), en de
-- inzichten-metrics (tabel tegendoelpunten + 4 RPC's) in blok 26, fase 2a
-- (4 speler-RPC's) in blok 27, fase 2b (tabel speelminuten + 1 RPC) in blok
-- 28, fase 3a (2 lees-RPC's: trainingskoppelingen en invul-discipline) in blok
-- 29, fase 3b (tabel training_evaluaties + 1 RPC) in blok 30. Accountverwijdering zelf
-- (auth.admin.deleteUser) is hier niet na te bootsen; de onderdelen ervan
-- wel: de team-opruiming is blok 22, het opzeggen van een lidmaatschap blok
-- 23, en de cascade van een verwijderde oefening naar elk trainingsplan blok
-- 24 (g).
-- ============================================================
