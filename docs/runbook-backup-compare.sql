-- Återställningsövningen (docs/runbook-backup.md, avsnitt 5): jämför radantal mellan prod och den återställda kopian.
--
-- ENDAST LÄSNING. Den verkliga garantin är att filen BARA innehåller SELECT/WITH-satser med funktioner från en vitlista (count, max,
-- min, coalesce, now, cast, current_database, pg_database_size, pg_size_pretty, to_char): scripts/runbook-backup-sql.test.mjs
-- fäller bygget i CI om något annat dyker upp. `begin read only` och `rollback` runt varje block är ett extra lager; det gäller
-- bara om klienten inte redan har öppnat en egen transaktion, så lita inte på det ensamt. Kör filen i Supabase SQL Editor
-- (inte i psql med autocommit av eller i ett verktyg som lägger en egen transaktion runt). Filen läser aldrig innehåll ur
-- strava_tokens (inga tokens, inga id:n), bara antalet.
--
-- Så här körs den (SQL-editorn i Supabase visar bara resultatet av det SISTA blocket, så ett block i taget):
--   1. Markera BLOCK A, kör det i den ÅTERSTÄLLDA kopian (det tillfälliga projektet). Skriv av resultatet i runbookens logg.
--   2. Markera BLOCK A igen, kör det i PROD (SQL-editorn eller MCP-läsning är båda läsning). Skriv av resultatet.
--   3. Fyll i återställningspunkten i BLOCK B (tidpunkten för backupen du återställde), kör det i PROD. Kolumnen
--      forvantat_i_kopian är hur många rader prod hade vid den tidpunkten; den ska stämma med kopians antal i steg 1.
--   4. BLOCK C mäter databasens storlek (kör i prod, och i kopian om du vill jämföra); det underlag RTO-antagandet saknar.
-- Skillnaden mellan prod och kopian i steg 1 och 2 är normalt det som skapats efter backupen. Rader som RADERATS i prod efter
-- backupen finns kvar i kopian och gör att kopian kan ha FLER rader än forvantat_i_kopian; det är inget fel i backupen.

-- ===================================== BLOCK A: radantal och senaste rad per tabell =====================================
begin read only;

select tabell, antal, senaste
from (
  select 'users' as tabell, count(*) as antal, max(created_at)::text as senaste from public.users
  union all select 'runs', count(*), max(created_at)::text from public.runs
  union all select 'user_titles', count(*), max(earned_at)::text from public.user_titles
  union all select 'activity_log', count(*), max(created_at)::text from public.activity_log
  union all select 'strava_tokens (bara antal)', count(*), max(created_at)::text from public.strava_tokens
  union all select 'events', count(*), max(created_at)::text from public.events
  union all select 'event_entries', count(*), max(created_at)::text from public.event_entries
  union all select 'groups', count(*), max(created_at)::text from public.groups
  union all select 'user_badges', count(*), max(updated_at)::text from public.user_badges
  -- Metadata i storage.objects. Databasbackupen bär bara raderna, aldrig filerna: antalet här kan vara högre än antalet filer
  -- som verkligen går att hämta ur den återställda kopian (se runbook, "Vad som inte täcks").
  union all select 'storage.objects (profile-pictures, bara metadata)', count(*), max(created_at)::text
    from storage.objects where bucket_id = 'profile-pictures'
  -- Schemaversionen: antal körda migrationer och den senaste. Ska vara lika i prod och kopian.
  union all select 'migrationer (antal, senaste version)', count(*), max(version)::text from supabase_migrations.schema_migrations
) as radantal
order by tabell;

rollback;

-- ===================================== BLOCK B: vad prod hade vid återställningspunkten =================================
-- KÖRS I PROD. Ändra tidpunkten på raden med "ÄNDRA" till backupens tidpunkt (så som dashboarden visar den, med tidszon).
begin read only;

with punkt as (
  select '2000-01-01 00:00:00+00'::timestamptz as t   -- ÄNDRA: backupens tidpunkt, t.ex. '2026-10-18 03:00:00+00'
)
select tabell, forvantat_i_kopian, antal_i_prod_nu, antal_i_prod_nu - forvantat_i_kopian as tillkommit_sedan_dess
from (
  select 'users' as tabell,
         count(*) filter (where created_at <= (select t from punkt)) as forvantat_i_kopian, count(*) as antal_i_prod_nu
    from public.users
  union all select 'runs', count(*) filter (where created_at <= (select t from punkt)), count(*) from public.runs
  union all select 'user_titles', count(*) filter (where earned_at <= (select t from punkt)), count(*) from public.user_titles
  union all select 'activity_log', count(*) filter (where created_at <= (select t from punkt)), count(*) from public.activity_log
  union all select 'strava_tokens (bara antal)', count(*) filter (where created_at <= (select t from punkt)), count(*) from public.strava_tokens
  union all select 'events', count(*) filter (where created_at <= (select t from punkt)), count(*) from public.events
  union all select 'event_entries', count(*) filter (where created_at <= (select t from punkt)), count(*) from public.event_entries
) as prod_vid_punkten
order by tabell;

rollback;

-- ===================================== BLOCK C: databasens storlek ======================================================
-- Underlag för RTO: en återställnings tid beror på storleken. Kör i prod (och gärna i kopian).
begin read only;

select pg_database_size(current_database()) as bytes, pg_size_pretty(pg_database_size(current_database())) as storlek;

rollback;
