-- 036: badge_earned i händelseloggen (ADR 009 beslut 5; migrationen delad i två enligt ADR 009 addendum 2026-10-11).
-- Datum: 2026-10-11. Ägargodkännande för APPLICERING krävs (permissions.md: migration mot prod = ask);
-- filen är skriven men inte körd (RUN-122). Applicering via Supabase MCP apply_migration
-- (name: 036_activity_log_badge_earned) FÖRE deploy av kod som skriver badge_earned-rader (ADR 002 beslut 3).
-- Bara ett constraint-byte: släpp och lägg om activity_log_type_check med 'badge_earned' tillagd. Inga kolumner,
-- index, policyer eller data rörs; befintliga rader har typer som alla finns kvar i den nya listan, så valideringen
-- av den nya constrainten går igenom.
-- Idempotent: drop ... if exists före add, så en omkörning ger samma slutläge.
-- Listan måste vara identisk med ACTIVITY_TYPES i packages/shared/src/activity.ts (statiskt test:
-- activityLogMigration.test.ts, "senaste migrationen som definierar activity_log_type_check").

begin;

alter table public.activity_log drop constraint if exists activity_log_type_check;

alter table public.activity_log add constraint activity_log_type_check check (type in (
  'title_unlocked','title_taken','title_revoked',
  'challenge_received','challenge_won','challenge_draw',
  'level_up','run_milestone','streak_broken',
  'event_open','event_closed','badge_earned'));

commit;
