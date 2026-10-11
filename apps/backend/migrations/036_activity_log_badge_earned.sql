-- 036: badge_earned i händelseloggen (ADR 009 beslut 5; migrationen delad i två enligt ADR 009 addendum 2026-10-11).
-- Datum: 2026-10-11. APPLICERAD i prod 2026-10-11 direkt efter v0.6.0-deployen (ägar-ja);
-- (RUN-122). Applicering via Supabase MCP apply_migration (name: 036_activity_log_badge_earned).
-- KÖRORDNING (Lead-beslut 2026-10-11, avviker medvetet från ADR 002 beslut 3): DIREKT EFTER att v0.6.0-backend och
-- -frontend är live. Skäl: v0.5.3-frontendens News saknar default-gren och kraschar på okända typer — så länge 036 inte
-- finns kan inga badge_earned-rader skrivas (CHECK-felet loggas och sväljs i activityLog.ts). Pris: badge-news för
-- nivåhöjningar mellan deploy och 036 skrivs aldrig (user_badges och popupen påverkas inte). Öppna flikar från före
-- releasen måste laddas om. Rollback av frontend till v0.5.3 efter att badge_earned-rader finns kräver att de raderas
-- (delete from activity_log where type = 'badge_earned' — ägar-ja).
-- Bara ett constraint-byte: släpp och lägg om activity_log_type_check med 'badge_earned' tillagd. Inga kolumner,
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
  'event_open','event_closed','badge_earned'));

