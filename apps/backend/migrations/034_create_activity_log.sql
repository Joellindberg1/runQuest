-- 034: Händelselogg för Pack News (ADR 008) — tabellen activity_log + users.news_last_seen_id.
-- Datum: 2026-10-05. Ägargodkänd 2026-10-04 (redesign-beslut 5; migration 034 uttryckligen godkänd).
-- Additiv (expand): ny tabell + ny nullbar kolumn; inget befintligt ändras, inget tas bort.
-- Körs via Supabase MCP apply_migration (name: 034_create_activity_log) FÖRE deploy av kod som skriver
-- till tabellen (ADR 002 beslut 3 / ADR 008 beslut 12). Typlistan i CHECK måste vara identisk med
-- ACTIVITY_TYPES i packages/shared/src/activity.ts (statiskt test: activityLogMigration.test.ts).
-- Åtkomst: RLS på, inga policyer, ingen anon-/authenticated-åtkomst. Läsning sker uteslutande via
-- backend (service role) genom GET /api/news.

create table if not exists public.activity_log (
  id              bigint generated always as identity primary key,
  group_id        uuid        not null references public.groups(id) on delete cascade,
  type            text        not null,
  actor_user_id   uuid        references public.users(id) on delete set null,
  target_user_id  uuid        references public.users(id) on delete set null,
  payload         jsonb       not null default '{}'::jsonb,
  payload_version smallint    not null default 1,
  dedupe_key      text        not null,
  is_backfill     boolean     not null default false,
  occurred_at     timestamptz not null default now(),   -- när det hände (visning/dag-gruppering)
  created_at      timestamptz not null default now(),   -- när det loggades
  constraint activity_log_dedupe_key_key unique (dedupe_key),
  constraint activity_log_type_check check (type in (
    'title_unlocked','title_taken','title_revoked',
    'challenge_received','challenge_won','challenge_draw',
    'level_up','run_milestone','streak_broken',
    'event_open','event_closed'))
);

create index if not exists activity_log_group_id_idx  on public.activity_log (group_id, id desc);
create index if not exists activity_log_actor_idx     on public.activity_log (actor_user_id)  where actor_user_id  is not null;
create index if not exists activity_log_target_idx    on public.activity_log (target_user_id) where target_user_id is not null;

alter table public.activity_log enable row level security;   -- inga policyer = ingen åtkomst utom service role
revoke all on public.activity_log from anon, authenticated;

-- Oläst-vattenmärke per användare (ADR 008 beslut 8): högsta activity_log.id som användaren markerat som läst.
alter table public.users add column if not exists news_last_seen_id bigint;
