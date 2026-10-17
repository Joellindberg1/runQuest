-- 051: Stäng skrivpolicyerna på storage-bucketen profile-pictures och sätt gränser på bucketen (RUN-276, säkerhetsgenomgång RUN-96).
-- Datum: 2026-10-17. Kräver ägar-ja per miljö: först staging (supabase-staging), sedan prod. Körs av Lead, aldrig av en builder.
-- Bakgrund: uppladdningen går via backend (POST /api/users/profile-picture) med service role, som förbigår RLS, till den
-- publika bucketen profile-pictures. Baslinjen (000_baseline.sql rad 20-22) lät ändå INSERT/UPDATE/DELETE på storage.objects
-- kräva rollen authenticated, och 038 rörde dem inte. Den som får en Supabase Auth-session med den publika nyckeln kunde alltså
-- skriva, skriva över och radera andras bilder. Backend använder ingen av policyerna.
-- SELECT-policyn tas också bort. En publik bucket serverar objekten via /storage/v1/object/public/<fil> utan RLS, och
-- publicUrl i users.profile_picture är just den adressen. Ingenting i appen listar bucketen (backend gör bara upload,
-- getPublicUrl och remove, alla med service role; frontend har ingen Supabase-klient sedan RUN-105). Policyn gav bara
-- list/select via API:t med den publika nyckeln, dvs. en lista över alla filnamn, och filnamnet är `<user-id>-<tid>.<ext>`.
-- Prods fyra policyer (läst 2026-10-17, alla med roles {public}, dvs. inte "to authenticated"; skrivpolicyerna släppte in via
-- auth.role() = 'authenticated') finns exakt återgivna i rollbacken nedan. Migrationen går ändå igenom pg_policies och tar bort
-- ALLA policyer på storage.objects i stället för att räkna upp namn, så att den också rensar en miljö med andra namn. Det är
-- säkert eftersom profile-pictures är appens enda bucket; finns det ändå en annan bucket avbryts migrationen (inget ändras) i
-- stället för att tyst ta bort dess policyer. Hela ändringen, även bucketens gränser, ligger i ett enda do-block: ett guard-fel
-- lämnar aldrig en halv ändring, inte ens vid psql -f utan ON_ERROR_STOP.
-- Gränserna på bucketen (5 MB, jpeg/png/webp/gif) speglar backendens MAX_FILE_SIZE och ALLOWED_IMAGE_TYPES i routes/users.ts
-- och gäller även om någon skulle skriva med en annan väg. Om bucketen saknas (en ny miljö) skapas den publik, med samma
-- gränser; finns den lämnas public som den är.
-- Efter applicering: RLS på storage.objects är på och objects saknar policyer => anon och authenticated nekas all åtkomst
-- via API:t, service role påverkas inte. Befintliga bild-URL:er (publik väg) svarar som förut. Ingen data ändras.
-- Körordning: när som helst, inga beroenden. Idempotent (omkörning ändrar inget).
--
-- Prod före 051 (Lead, read-only 2026-10-17): RLS på storage.objects true, enda bucket profile-pictures med public = true,
-- file_size_limit = null och allowed_mime_types = null. Staging (samma datum): RLS true, inga policyer och ingen bucket, eftersom
-- baslinjen inte innehåller storage. Kontrollfrågor före applicering (bevisar utgångsläget i respektive miljö):
--   select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'storage' and tablename = 'objects';
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets;
-- Migrationen skriver också ut varje borttagen policy som NOTICE (namn, kommando, roller, using, with check).
--
-- Rollback i prod (ägar-ja krävs, det öppnar skrivning för varje Supabase Auth-session igen). Återskapar prods exakta policyer:
--   create policy "Users can upload their own profile pictures" on storage.objects for insert to public with check ((bucket_id = 'profile-pictures'::text) and (auth.role() = 'authenticated'::text));
--   create policy "Users can update their own profile pictures" on storage.objects for update to public using ((bucket_id = 'profile-pictures'::text) and (auth.role() = 'authenticated'::text));
--   create policy "Users can delete their own profile pictures" on storage.objects for delete to public using ((bucket_id = 'profile-pictures'::text) and (auth.role() = 'authenticated'::text));
--   create policy "Anyone can view profile pictures" on storage.objects for select to public using (bucket_id = 'profile-pictures'::text);
--   update storage.buckets set file_size_limit = null, allowed_mime_types = null where id = 'profile-pictures';
-- Rollback i staging: staging saknade både policyer och bucket före 051. Rollbacken där är att ta bort gränserna (samma update som
-- ovan) och, bara om bucketen skapades av 051, att ta bort bucketen (tom, via Storage-API:t; delete from storage.buckets nekas av
-- Storage). Återskapa inga policyer i staging.

do $$
declare
  p record;
  other_buckets text;
  rls_on boolean;
begin
  select string_agg(id, ', ' order by id) into other_buckets
    from storage.buckets
   where id <> 'profile-pictures';
  if other_buckets is not null then
    raise exception '051 avbryts: det finns andra buckets (%). Policyerna på storage.objects är gemensamma och skulle försvinna för dem också.', other_buckets;
  end if;

  select c.relrowsecurity into rls_on
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'storage' and c.relname = 'objects';
  if rls_on is distinct from true then
    raise exception '051 avbryts: RLS är inte påslagen på storage.objects. Slå på den först; utan RLS hjälper det inte att ta bort policyer.';
  end if;

  for p in
    select policyname, cmd, roles, qual, with_check
      from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
  loop
    raise notice '051 tar bort policy "%" (%, roller %, using %, with check %)', p.policyname, p.cmd, p.roles, p.qual, p.with_check;
    execute format('drop policy if exists %I on storage.objects', p.policyname);
  end loop;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('profile-pictures', 'profile-pictures', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
  on conflict (id) do update
    set file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;
end
$$;
