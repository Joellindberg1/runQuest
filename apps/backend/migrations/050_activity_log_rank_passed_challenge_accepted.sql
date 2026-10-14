-- 050: rank_passed och challenge_accepted i händelseloggen (RUN-191, v0.7.0). ADR 011 beslut 6 och 7 (migration 3 i beslut 10).
-- Datum: 2026-10-14. EJ APPLICERAD i prod (kräver ägarens uttryckliga ja; Lead applicerar via Supabase MCP apply_migration,
-- name: 050_activity_log_rank_passed_challenge_accepted, och uppdaterar den här raden till APPLICERAD med datum).
--
-- KÖRORDNING: applicera EFTER deployen av backend + frontend (S28, ägarens ja). Annars bryter CHECK:en inget: den här
-- migrationen bara tillåter fler värden. Körs den före deploy ändras inget synligt förrän nya backend går live, men nya
-- backend kan då skriva de nya typerna några sekunder innan nya frontend är live (Railway deployar tjänsterna oberoende);
-- äldre flikar tål okända typer sedan RUN-138 (v0.5.3-flikar kraschade, samma resonemang som ADR 009 addendum, migration
-- 036). Mellan deploy och den här migrationen misslyckas bara rank_passed- och challenge_accepted-skrivningarna, tyst
-- (best-effort, loggas); inget annat påverkas och raderna saknas bara i några minuter.
--
-- Bara ett constraint-byte: släpp och lägg om activity_log_type_check med 'rank_passed' och 'challenge_accepted' tillagda
-- (15 värden). Inga kolumner, index, policyer eller data rörs; befintliga rader har typer som alla finns kvar i den nya
-- listan, så valideringen av den nya constrainten går igenom. Listan måste vara identisk med ACTIVITY_TYPES i
-- packages/shared/src/activity.ts (statiskt test: activityLogMigration.test.ts, "senaste CHECK-migrationens lista").
--
-- Lås: add constraint tar ACCESS EXCLUSIVE på activity_log och validerar befintliga rader (en skanning). Tabellen skrivs vid
-- varje rundlogg (titlar, levels, utmaningar, badges), så en lång transaktion kan annars få migrationens lås att köa och all
-- skrivtrafik bakom sig. Första satsen, set local lock_timeout = '5s', gör att migrationen misslyckas i stället. set local
-- gäller bara den pågående transaktionen (apply_migration kör filen i en) och lämnar inget kvar i sessionen; körs filen
-- utanför en transaktion ger Postgres en varning och inställningen gör ingenting, men inget går sönder. Misslyckas den med
-- lock_timeout: kör om, helst när ingen runda loggas.
--
-- Ingen egen begin/commit (036/041-mönstret): apply_migration äger transaktionen.
-- Idempotent: drop ... if exists före add, så en omkörning ger samma slutläge.
--
-- Bevis efter apply (läsning, ändrar inget):
--   select pg_get_constraintdef(oid) from pg_constraint
--     where conname = 'activity_log_type_check';   -- förväntat: 15 värden, inklusive rank_passed och challenge_accepted
--
-- Rollback (kommentar, körs manuellt och bara efter ägar-ja; migrationerna är framåtriktade, ADR 002 beslut 3). Raderna med
-- de nya typerna måste bort först, annars avvisar den gamla constrainten dem (destruktivt, ask):
--   delete from public.activity_log where type in ('rank_passed', 'challenge_accepted');
--   alter table public.activity_log drop constraint if exists activity_log_type_check;
--   alter table public.activity_log add constraint activity_log_type_check check (type in (<041:s 13 värden>));

set local lock_timeout = '5s';

alter table public.activity_log drop constraint if exists activity_log_type_check;

alter table public.activity_log add constraint activity_log_type_check check (type in (
  'title_unlocked','title_taken','title_revoked',
  'challenge_received','challenge_won','challenge_draw',
  'level_up','run_milestone','streak_broken',
  'event_open','event_closed','badge_earned','release_published',
  'rank_passed','challenge_accepted'));
