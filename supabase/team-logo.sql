-- ============================================================
-- Pitchup — Clublogo (Supabase Storage) (migratie)
-- Run this in the Supabase SQL Editor
-- ============================================================
--
-- NIEUWE INFRASTRUCTUUR: dit is de eerste Storage-bucket van de app.
-- De URL zelf komt in de bestaande settings-tabel (key 'team_logo_url'),
-- er is dus GEEN nieuwe tabel nodig.
--
-- Padconventie (dragend voor de isolatie hieronder):
--     team-logos/<team_id>/logo
-- Vaste, extensieloze bestandsnaam per team. Daardoor kan er per constructie
-- geen wees-bestand ontstaan bij vervangen: een nieuwe upload met upsert
-- OVERSCHRIJFT hetzelfde object. Het content-type wordt bij de upload expliciet
-- meegegeven (gesnift, niet overgenomen van de client) zodat de browser het
-- bestand correct serveert ondanks de ontbrekende extensie.

-- Publieke leesbaarheid (expliciet goedgekeurd): nodig omdat de PDF-kop en de
-- zijbalk het logo via een gewone <img src> laden. Een private bucket zou per
-- render een signed URL met vervaltijd vereisen; die verloopt tijdens/na het
-- afdrukken en levert een lege kop op. SCHRIJVEN/VERWIJDEREN blijft strikt
-- afgeschermd (policies hieronder). file_size_limit en allowed_mime_types zijn
-- een tweede, door de database zelf afgedwongen vangnet naast de validatie in
-- de server action.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'team-logos',
  'team-logos',
  true,
  2097152,                                              -- 2 MB
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── RLS op storage.objects ───────────────────────────────────
-- Ander mechanisme dan de tabel-RLS in rls.sql: er is geen team_id-KOLOM, dus
-- de isolatie hangt volledig aan de EERSTE PADSEGMENT-conventie hierboven.
-- (storage.foldername(name))[1] is die eerste map; die moet gelijk zijn aan
-- auth.uid(). Wie een pad buiten zijn eigen map probeert te schrijven, wordt
-- door with check geweigerd.
--
-- GEEN "alter table storage.objects enable row level security" hier: die tabel
-- is eigendom van de interne supabase_storage_admin-rol, dus de SQL Editor
-- (die als een gewone rol draait) mag dat niet uitvoeren ("must be owner of
-- table objects"). Niet nodig ook: RLS staat op storage.objects in elk
-- Supabase-project al standaard aan, alleen policies toevoegen is voldoende.

drop policy if exists "team-logos: insert own folder" on storage.objects;
create policy "team-logos: insert own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'team-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Aparte UPDATE-policy: een upload met upsert:true op een BESTAAND object is
-- een UPDATE, geen INSERT. Zonder deze policy slaagt de eerste upload wel en
-- elke vervanging niet. using én with check, zodat een rij ook niet naar een
-- andere map verplaatst kan worden.
drop policy if exists "team-logos: update own folder" on storage.objects;
create policy "team-logos: update own folder" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'team-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'team-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "team-logos: delete own folder" on storage.objects;
create policy "team-logos: delete own folder" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'team-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "team-logos: select own folder" on storage.objects;
create policy "team-logos: select own folder" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'team-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
