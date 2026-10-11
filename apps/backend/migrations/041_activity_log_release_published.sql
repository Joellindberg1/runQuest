-- 041: release_published i händelseloggen (RUN-161, v0.6.1). En release syns som en rad i Pack News, inte bara som
-- What's new-popupen. (040 är reserverat för RUN-112.)
-- Datum: 2026-10-11. EJ APPLICERAD — appliceras av Lead med ägar-ja, via Supabase MCP apply_migration
-- (name: 041_activity_log_release_published).
-- KÖRORDNING: EFTER att v0.6.1 (backend + frontend) är deployad, INNAN `npm run announce:release -- --apply` körs. Skriptet
-- kontrollerar själv att CHECK:en tillåter typen och avbryter utan skrivning annars. Ordningen spelar ingen roll för
-- klienterna: News tål okända typer sedan RUN-138 (buildNewsRow filtrerar bort en rad med okänd typ, och "Mark all read"
-- kvitterar ändå upp till högsta id), så en v0.6.0-flik som laddar den nya raden kraschar inte — raden syns bara inte
-- där förrän fliken laddats om. Appen och servern skriver ALDRIG den här raden vid start; bara skriptet gör det.
-- Bara ett constraint-byte: släpp och lägg om activity_log_type_check med 'release_published' tillagd. Inga kolumner,
-- index, policyer eller data rörs; befintliga rader har typer som alla finns kvar i den nya listan, så valideringen
-- av den nya constrainten går igenom.
-- Ingen egen begin/commit: apply_migration kör filen som en transaktion (som övriga migrationer).
-- Idempotent: drop ... if exists före add, så en omkörning ger samma slutläge.
-- Listan måste vara identisk med ACTIVITY_TYPES i packages/shared/src/activity.ts (statiskt test:
-- activityLogMigration.test.ts, "senaste migrationen som definierar activity_log_type_check").

alter table public.activity_log drop constraint if exists activity_log_type_check;

alter table public.activity_log add constraint activity_log_type_check check (type in (
  'title_unlocked','title_taken','title_revoked',
  'challenge_received','challenge_won','challenge_draw',
  'level_up','run_milestone','streak_broken',
  'event_open','event_closed','badge_earned','release_published'));
