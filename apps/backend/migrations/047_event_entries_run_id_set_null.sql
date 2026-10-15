-- 047: event_entries.run_id -> runs(id) blir ON DELETE SET NULL — "Migration C" i ADR 010 (RUN-172, v0.7.0).
-- Datum: 2026-10-14. APPLICERAD i prod 2026-10-15 (ägar-ja i chatten; Lead via Supabase MCP apply_migration,
-- name: 047_event_entries_run_id_set_null, och uppdaterar den här raden till APPLICERAD med datum).
--
-- Bakgrund: FK:n event_entries_run_id_fkey (000_baseline) är NO ACTION. När en Strava-runda som kvalificerat ett event
-- raderas (raderad på Strava, gjord privat, typbyte, deauthorize eller "Koppla bort") kraschar raderingen på FK:n. Ägarbeslut
-- D2 (ADR 010 beslut 8.2): rundan raderas, men event_entries-raden och dess XP behålls och run_id blir NULL.
-- event_entries.run_id skrivs bara vid insert och läses ingenstans, så ingen kod behöver ändras för att NULL ska fungera.
--
-- Vad migrationen gör: släpper FK:n (om den finns) och skapar den på nytt med samma namn, samma kolumn och samma mål men med
-- ON DELETE SET NULL. Kolumnen run_id är redan nullable (000_baseline), så ingen kolumnändring behövs. xp_awarded,
-- users.event_xp och entry-raderna rörs inte: ingen data skrivs. Att lägga tillbaka en FK validerar befintliga rader
-- (en kort tabellskanning på en liten tabell).
--
-- Lås: drop constraint och add constraint tar ACCESS EXCLUSIVE på event_entries OCH på runs (den heta tabellen, FK:ns mål) i
-- resten av transaktionen, i millisekunder. Första satsen, set local lock_timeout = '5s', gör att migrationen misslyckas i
-- stället för att köa all trafik bakom en lång fråga på runs. set local gäller bara den pågående transaktionen (apply_migration
-- kör filen i en) och lämnar inget kvar i sessionen, så omkörning ger samma slutläge; kör något filen utanför en transaktion
-- ger Postgres en varning och inställningen gör ingenting, men inget går sönder. Misslyckas den med lock_timeout: kör om.
--
-- Konsekvens att känna till: kodkontrollen i DELETE /api/runs/:id (409 för en manuell runda som kvalificerat ett event, och
-- för source='strava') är nu det ENDA skyddet för manuella rundor. Före migrationen skyddade FK:n också. Kontrollen är
-- oförändrad och testad (runs-strava-lock.test.ts).
--
-- KÖRORDNING: applicera FÖRE backend-deployen i v0.7.0 (ADR 010: A, B och C körs alla före deployen); C måste vara på plats
-- innan någon webhook-radering bearbetas. Bakåtkompatibel: gammal kod blockerar redan raderingen med 409-kontrollen, så FK:ns
-- nya uppförande märks aldrig av den.
--
-- Idempotent: drop constraint if exists + add constraint — en omkörning ger samma slutläge. Ingen egen begin/commit:
-- apply_migration kör filen som en transaktion (som övriga migrationer), så FK:n finns aldrig borta mellan satserna.
--
-- Bevis efter apply (läsning, ändrar inget):
--   select conname, confdeltype from pg_constraint where conname = 'event_entries_run_id_fkey';
--   -- förväntat: en rad, confdeltype = 'n' (SET NULL; före migrationen 'a' = NO ACTION)
--
-- Rollback (kommentar, körs manuellt och bara efter ägar-ja; ingen data förloras, men entries med run_id = NULL förblir NULL
-- och FK:n tillåter dem). Migrationerna är framåtriktade (ADR 002 beslut 3); rollbacken finns bara här:
--   alter table public.event_entries drop constraint if exists event_entries_run_id_fkey;
--   alter table public.event_entries add constraint event_entries_run_id_fkey foreign key (run_id) references public.runs(id);
-- Statiskt test: eventEntriesRunIdMigration047.test.ts.

set local lock_timeout = '5s';

alter table public.event_entries
  drop constraint if exists event_entries_run_id_fkey;

alter table public.event_entries
  add constraint event_entries_run_id_fkey
  foreign key (run_id) references public.runs(id) on delete set null;
