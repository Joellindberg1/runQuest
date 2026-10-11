-- 035: Badgesystemet (ADR 009 beslut 1) — tabellen user_badges + users.displayed_badge_series.
-- Datum: 2026-10-11. Ägargodkännande för APPLICERING krävs (permissions.md: migration mot prod = ask);
-- APPLICERAD i prod 2026-10-11 (RUN-113, ägar-ja). Applicering via Supabase MCP apply_migration
-- (name: 035_create_user_badges) FÖRE deploy av kod som skriver till tabellen (ADR 002 beslut 3).
-- Additiv (expand): ny tabell + ny kolumn med default; inget befintligt ändras, inget tas bort.
-- Idempotent: kan köras flera gånger (create ... if not exists, add column if not exists, villkorlig CHECK).
-- En rad per (användare, serie) = BÄSTA tier just nu. Seriernycklarna bor i packages/shared (ingen CHECK på
-- series: nya serier = ingen migration). Datan är härledd ur rundor och kan regenereras av backfill-skriptet.
-- Åtkomst: RLS på, inga policyer, ingen anon-/authenticated-åtkomst. Skrivning och läsning sker
-- uteslutande via backend (service role).
-- Utanför denna fil (annat manifest): CHECK-utökningen av activity_log med 'badge_earned' (ADR 009 beslut 1,
-- sista blocket) — den kräver drop+add av constraint och ACTIVITY_TYPES-ändring i shared.

create table if not exists public.user_badges (
  user_id       uuid        not null references public.users(id) on delete cascade,
  series        text        not null,                                    -- 'early_bird' … (nyckel ur shared)
  tier          smallint    not null check (tier >= 1),
  seen_tier     smallint    not null default 0 check (seen_tier >= 0 and seen_tier <= tier),  -- popup-vattenmärke
  earned_at     timestamptz not null default now(),                      -- när NUVARANDE tier uppnåddes
  source_run_id uuid        references public.runs(id) on delete set null,  -- rundan som gav tiern (enrundsserier)
  updated_at    timestamptz not null default now(),
  primary key (user_id, series)
);

alter table public.user_badges enable row level security;   -- inga policyer = ingen åtkomst utom service role
revoke all on public.user_badges from anon, authenticated;

-- Visade badges (max 3): samma mönster som displayed_title_ids (migration 009); atomisk enradsuppdatering.
alter table public.users add column if not exists displayed_badge_series text[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'users_displayed_badge_series_max3'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_displayed_badge_series_max3 check (cardinality(displayed_badge_series) <= 3);
  end if;
end
$$;
