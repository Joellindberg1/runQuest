-- ============================================================================
-- 000_baseline.sql — RunQuest schema-baslinje (ADR 002)
-- Genererad 2026-10-04 ur produktionens faktiska kataloger (projekt
-- yrrqaxdngayakcivfrck), EFTER migration 031. Endast schema — ingen data,
-- inga hemligheter.
--
-- ANVÄNDNING: en ny databas (t.ex. staging) byggs med denna fil + alla
-- migrationer ≥ 032. Filerna 001–031 är FRYST HISTORIK och ska aldrig köras
-- mot en ny databas.
--
-- KÄNDA AVVIKELSER/NOTERINGAR (dokumenterade, inte fixade här):
-- · idx_runs_external_id är INTE unikt — Strava-dedupe skyddas bara i appkod
--   (STATE.md zon 5). En unik constraint kräver först dubblettkontroll.
-- · Triggrarna trigger_update_user_totals_* räknar om users.total_xp som
--   SUM(runs.xp_gained) UTAN event_xp, medan appens calculateUserTotals
--   inkluderar event_xp — två skribenter med olika formel (STATE.md zon 1).
-- · handle_new_user() är en kvarleva från Supabase Auth-eran; dess trigger
--   satt på auth.users och ingår inte i public-schemat. Funktionen behålls
--   i baslinjen för trohet mot prod men är sannolikt död.
-- · Storage: bucketen `profile-pictures` + dess policyer ligger i storage-
--   schemat och ingår inte här; de återskapas via Supabase-dashboarden
--   (SELECT public; INSERT/UPDATE/DELETE kräver authenticated — se STATE.md).
-- ============================================================================

-- ───────────────────────────── Tabeller ─────────────────────────────────────

create table public.admin_settings (
  id uuid default gen_random_uuid() not null,
  admin_password_hash text not null,
  min_run_distance numeric(4,2) default 1.6,
  base_xp integer default 15,
  xp_per_km integer default 2,
  bonus_5km integer default 5,
  bonus_10km integer default 15,
  bonus_15km integer default 25,
  bonus_20km integer default 50,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  min_run_date date default '2025-06-01'::date
);

create table public.challenge_durations (
  id uuid default gen_random_uuid() not null,
  duration_days integer not null,
  tier_eligibility text[] not null,
  active boolean default true not null
);

create table public.challenge_metrics (
  id uuid default gen_random_uuid() not null,
  metric text not null,
  description text not null,
  tier_eligibility text[] not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null
);

create table public.challenge_rewards (
  id uuid default gen_random_uuid() not null,
  tier_eligibility text[] not null,
  winner_type text not null,
  winner_delta numeric not null,
  winner_duration integer,
  loser_type text not null,
  loser_delta numeric not null,
  loser_duration integer,
  description text,
  active boolean default true not null
);

create table public.challenges (
  id uuid default gen_random_uuid() not null,
  group_id uuid not null,
  token_id uuid,
  tier text not null,
  challenger_id uuid not null,
  opponent_id uuid not null,
  metric text not null,
  duration_days integer not null,
  winner_delta numeric not null,
  winner_duration integer,
  winner_type text not null,
  loser_delta numeric not null,
  loser_duration integer,
  loser_type text not null,
  challenger_level integer not null,
  opponent_level integer not null,
  start_date date,
  end_date date,
  determine_at timestamp with time zone,
  legendary_sent_at timestamp with time zone,
  status text default 'pending'::text not null,
  winner_id uuid,
  outcome text,
  created_at timestamp with time zone default now() not null,
  challenger_final_value numeric,
  opponent_final_value numeric,
  outdoor_only boolean default false not null
);

create table public.event_entries (
  id uuid default gen_random_uuid() not null,
  event_id uuid not null,
  user_id uuid not null,
  run_id uuid,
  qualified_at timestamp with time zone,
  total_value numeric,
  rank integer,
  xp_awarded integer,
  created_at timestamp with time zone default now() not null
);

create table public.event_pool_members (
  pool_id uuid not null,
  template_id uuid not null,
  weight numeric(4,2) default 1.0 not null,
  condition text
);

create table public.event_pools (
  id uuid default gen_random_uuid() not null,
  name text not null,
  trigger_chance numeric(4,2) not null,
  description text
);

create table public.event_templates (
  id uuid default gen_random_uuid() not null,
  name text not null,
  type text not null,
  icon text default 'calendar'::text not null,
  description text,
  min_km numeric,
  reward_xp integer,
  requires_weather text[],
  metric text,
  duration_days integer,
  reward_xp_1st integer,
  reward_xp_2nd integer,
  reward_xp_3rd integer,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  spawn_chance numeric(3,2) default 1.0 not null,
  start_hour smallint,
  end_hour smallint,
  end_minute smallint default 0 not null,
  end_day_offset smallint default 0 not null
);

create table public.events (
  id uuid default gen_random_uuid() not null,
  template_id uuid not null,
  group_id uuid not null,
  type text not null,
  metric text,
  status text default 'scheduled'::text not null,
  starts_at timestamp with time zone not null,
  ends_at timestamp with time zone not null,
  settled_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table public.groups (
  id uuid default gen_random_uuid() not null,
  name text not null,
  invite_code text not null,
  owner_id uuid,
  created_at timestamp with time zone default now() not null
);

create table public.level_challenge_rewards (
  level integer not null,
  tier text not null
);

create table public.level_requirements (
  id uuid default gen_random_uuid() not null,
  level integer not null,
  xp_required integer not null
);

create table public.run_weather (
  run_id uuid not null,
  temperature_c numeric(4,1),
  apparent_temp_c numeric(4,1),
  humidity_pct smallint,
  precipitation_mm numeric(4,1),
  snowfall_cm numeric(4,1),
  snow_depth_cm numeric(4,1),
  wind_speed_ms numeric(4,1),
  wind_gusts_ms numeric(4,1),
  wind_direction_deg smallint,
  weather_code smallint,
  uv_index numeric(3,1),
  visibility_m integer,
  fetched_at timestamp with time zone default now() not null
);

create table public.runs (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  date date not null,
  distance numeric(6,2) not null,
  xp_gained integer not null,
  multiplier numeric(3,2) not null,
  streak_day integer not null,
  base_xp integer not null,
  km_xp integer not null,
  distance_bonus integer not null,
  streak_bonus integer not null,
  created_at timestamp with time zone default now(),
  source text default 'manual'::text,
  external_id text,
  moving_time integer,
  total_elevation_gain numeric,
  start_time timestamp with time zone,
  sport_type text,
  pace_std_dev double precision,
  avg_heartrate double precision,
  max_heartrate double precision,
  start_lat double precision,
  start_lng double precision,
  suffer_score integer,
  is_treadmill boolean
);

create table public.strava_tokens (
  user_id uuid not null,
  access_token text,
  refresh_token text,
  expires_at bigint,
  created_at timestamp with time zone default now(),
  connection_date timestamp with time zone
);

create table public.streak_multipliers (
  id uuid default gen_random_uuid() not null,
  days integer not null,
  multiplier numeric(3,2) not null
);

create table public.title_leaderboard (
  id uuid default gen_random_uuid() not null,
  title_id uuid not null,
  user_id uuid not null,
  "position" integer not null,
  value numeric(15,4) not null,
  earned_at timestamp with time zone not null,
  updated_at timestamp with time zone default now()
);

create table public.titles (
  id uuid default gen_random_uuid() not null,
  name text not null,
  description text not null,
  unlock_requirement numeric(15,4) not null,
  current_holder_id uuid,
  current_value numeric(15,4) default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  metric_key text not null,
  outdoor_only boolean default false not null
);

create table public.user_boosts (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  challenge_id uuid not null,
  outcome text not null,
  type text not null,
  delta numeric not null,
  remaining integer,
  expires_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table public.user_challenge_tokens (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  metric_id uuid not null,
  duration_id uuid not null,
  reward_id uuid not null,
  tier text not null,
  metric text not null,
  duration_days integer not null,
  earned_at timestamp with time zone default now() not null,
  sent_at timestamp with time zone,
  challenge_id uuid,
  earned_at_level integer
);

create table public.user_seen_items (
  user_id uuid not null,
  item_slug text not null,
  seen_at timestamp with time zone default now() not null
);

create table public.user_titles (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  title_id uuid not null,
  earned_at timestamp with time zone default now(),
  value numeric(15,4)
);

create table public.users (
  id uuid default gen_random_uuid() not null,
  name text not null,
  password_hash text not null,
  profile_picture text,
  total_xp integer default 0,
  current_level integer default 1,
  total_km numeric(8,2) default 0,
  current_streak integer default 0,
  longest_streak integer default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  email text not null,
  auth_user_id uuid,
  is_admin boolean default false,
  group_id uuid,
  wins integer default 0 not null,
  draws integer default 0 not null,
  losses integer default 0 not null,
  challenge_active boolean default false not null,
  highest_rewarded_level integer default 0 not null,
  displayed_title_ids text[] default '{}'::text[] not null,
  gender text,
  event_xp integer default 0 not null
);

-- ─────────────────── Constraints (PK → UNIQUE → CHECK → FK) ─────────────────

alter table admin_settings add constraint admin_settings_pkey PRIMARY KEY (id);
alter table challenge_durations add constraint challenge_durations_pkey PRIMARY KEY (id);
alter table challenge_metrics add constraint challenge_metrics_pkey PRIMARY KEY (id);
alter table challenge_rewards add constraint challenge_rewards_pkey PRIMARY KEY (id);
alter table challenges add constraint challenges_pkey PRIMARY KEY (id);
alter table event_entries add constraint event_entries_pkey PRIMARY KEY (id);
alter table event_pool_members add constraint event_pool_members_pkey PRIMARY KEY (pool_id, template_id);
alter table event_pools add constraint event_pools_pkey PRIMARY KEY (id);
alter table event_templates add constraint event_templates_pkey PRIMARY KEY (id);
alter table events add constraint events_pkey PRIMARY KEY (id);
alter table groups add constraint groups_pkey PRIMARY KEY (id);
alter table level_challenge_rewards add constraint level_challenge_rewards_pkey PRIMARY KEY (level);
alter table level_requirements add constraint level_requirements_pkey PRIMARY KEY (id);
alter table run_weather add constraint run_weather_pkey PRIMARY KEY (run_id);
alter table runs add constraint runs_pkey PRIMARY KEY (id);
alter table strava_tokens add constraint strava_tokens_pkey PRIMARY KEY (user_id);
alter table streak_multipliers add constraint streak_multipliers_pkey PRIMARY KEY (id);
alter table title_leaderboard add constraint title_leaderboard_pkey PRIMARY KEY (id);
alter table titles add constraint titles_pkey PRIMARY KEY (id);
alter table user_boosts add constraint user_boosts_pkey PRIMARY KEY (id);
alter table user_challenge_tokens add constraint user_challenge_tokens_pkey PRIMARY KEY (id);
alter table user_seen_items add constraint user_seen_items_pkey PRIMARY KEY (user_id, item_slug);
alter table user_titles add constraint user_titles_pkey PRIMARY KEY (id);
alter table users add constraint users_pkey PRIMARY KEY (id);
alter table event_entries add constraint event_entries_event_id_user_id_key UNIQUE (event_id, user_id);
alter table event_pools add constraint event_pools_name_key UNIQUE (name);
alter table groups add constraint groups_invite_code_key UNIQUE (invite_code);
alter table level_requirements add constraint level_requirements_level_key UNIQUE (level);
alter table streak_multipliers add constraint streak_multipliers_days_key UNIQUE (days);
alter table title_leaderboard add constraint title_leaderboard_title_id_position_key UNIQUE (title_id, "position");
alter table title_leaderboard add constraint title_leaderboard_title_id_user_id_key UNIQUE (title_id, user_id);
alter table titles add constraint titles_metric_key_unique UNIQUE (metric_key);
alter table titles add constraint titles_name_key UNIQUE (name);
alter table user_titles add constraint user_titles_user_id_title_id_key UNIQUE (user_id, title_id);
alter table users add constraint users_auth_user_id_key UNIQUE (auth_user_id);
alter table users add constraint users_email_key UNIQUE (email);
alter table users add constraint users_name_key UNIQUE (name);
alter table event_templates add constraint event_templates_type_check CHECK ((type = ANY (ARRAY['participation'::text, 'competition'::text])));
alter table events add constraint events_dates_check CHECK ((ends_at > starts_at));
alter table events add constraint events_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'active'::text, 'settled'::text, 'cancelled'::text])));
alter table runs add constraint runs_sport_type_check CHECK (((sport_type IS NULL) OR (sport_type = ANY (ARRAY['Run'::text, 'TrailRun'::text, 'VirtualRun'::text]))));
alter table title_leaderboard add constraint title_leaderboard_position_check CHECK ((("position" >= 1) AND ("position" <= 10)));
alter table challenges add constraint challenges_challenger_id_fkey FOREIGN KEY (challenger_id) REFERENCES users(id);
alter table challenges add constraint challenges_group_id_fkey FOREIGN KEY (group_id) REFERENCES groups(id);
alter table challenges add constraint challenges_opponent_id_fkey FOREIGN KEY (opponent_id) REFERENCES users(id);
alter table challenges add constraint challenges_token_id_fkey FOREIGN KEY (token_id) REFERENCES user_challenge_tokens(id);
alter table challenges add constraint challenges_winner_id_fkey FOREIGN KEY (winner_id) REFERENCES users(id);
alter table event_entries add constraint event_entries_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table event_entries add constraint event_entries_run_id_fkey FOREIGN KEY (run_id) REFERENCES runs(id);
alter table event_entries add constraint event_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table event_pool_members add constraint event_pool_members_pool_id_fkey FOREIGN KEY (pool_id) REFERENCES event_pools(id) ON DELETE CASCADE;
alter table event_pool_members add constraint event_pool_members_template_id_fkey FOREIGN KEY (template_id) REFERENCES event_templates(id) ON DELETE CASCADE;
alter table events add constraint events_group_id_fkey FOREIGN KEY (group_id) REFERENCES groups(id);
alter table events add constraint events_template_id_fkey FOREIGN KEY (template_id) REFERENCES event_templates(id);
alter table groups add constraint groups_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL;
alter table run_weather add constraint run_weather_run_id_fkey FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE;
alter table runs add constraint runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table strava_tokens add constraint strava_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
alter table title_leaderboard add constraint title_leaderboard_title_id_fkey FOREIGN KEY (title_id) REFERENCES titles(id) ON DELETE CASCADE;
alter table title_leaderboard add constraint title_leaderboard_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table titles add constraint titles_current_holder_id_fkey FOREIGN KEY (current_holder_id) REFERENCES users(id);
alter table user_boosts add constraint user_boosts_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES challenges(id);
alter table user_boosts add constraint user_boosts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table user_challenge_tokens add constraint fk_token_challenge FOREIGN KEY (challenge_id) REFERENCES challenges(id);
alter table user_challenge_tokens add constraint user_challenge_tokens_duration_id_fkey FOREIGN KEY (duration_id) REFERENCES challenge_durations(id);
alter table user_challenge_tokens add constraint user_challenge_tokens_metric_id_fkey FOREIGN KEY (metric_id) REFERENCES challenge_metrics(id);
alter table user_challenge_tokens add constraint user_challenge_tokens_reward_id_fkey FOREIGN KEY (reward_id) REFERENCES challenge_rewards(id);
alter table user_challenge_tokens add constraint user_challenge_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table user_seen_items add constraint user_seen_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table user_titles add constraint user_titles_title_id_fkey FOREIGN KEY (title_id) REFERENCES titles(id) ON DELETE CASCADE;
alter table user_titles add constraint user_titles_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table users add constraint users_group_id_fkey FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL;

-- ──────────────────────────────── Index ─────────────────────────────────────

CREATE INDEX idx_boosts_user_active ON public.user_boosts USING btree (user_id, expires_at);
CREATE INDEX idx_challenges_challenger ON public.challenges USING btree (challenger_id, status);
CREATE INDEX idx_challenges_determine ON public.challenges USING btree (determine_at) WHERE (status = 'active'::text);
CREATE INDEX idx_challenges_end_date ON public.challenges USING btree (end_date, status);
CREATE INDEX idx_challenges_group ON public.challenges USING btree (group_id, status);
CREATE INDEX idx_challenges_opponent ON public.challenges USING btree (opponent_id, status);
CREATE INDEX idx_event_entries_event ON public.event_entries USING btree (event_id);
CREATE INDEX idx_event_entries_qualified ON public.event_entries USING btree (user_id, qualified_at) WHERE (qualified_at IS NOT NULL);
CREATE INDEX idx_event_entries_user_event ON public.event_entries USING btree (user_id, event_id);
CREATE INDEX idx_events_active ON public.events USING btree (status, ends_at) WHERE (status = 'active'::text);
CREATE INDEX idx_events_group_status ON public.events USING btree (group_id, status);
CREATE INDEX idx_events_scheduled ON public.events USING btree (starts_at) WHERE (status = 'scheduled'::text);
CREATE INDEX idx_groups_invite_code ON public.groups USING btree (invite_code);
CREATE INDEX idx_groups_owner_id ON public.groups USING btree (owner_id);
CREATE INDEX idx_runs_date ON public.runs USING btree (date);
CREATE INDEX idx_runs_external_id ON public.runs USING btree (external_id, user_id) WHERE (external_id IS NOT NULL);
CREATE INDEX idx_runs_user_id ON public.runs USING btree (user_id);
CREATE INDEX idx_runs_user_id_date ON public.runs USING btree (user_id, date);
CREATE INDEX idx_title_leaderboard_title_position ON public.title_leaderboard USING btree (title_id, "position");
CREATE INDEX idx_title_leaderboard_user_id ON public.title_leaderboard USING btree (user_id);
CREATE INDEX idx_titles_current_holder_id ON public.titles USING btree (current_holder_id);
CREATE INDEX idx_tokens_user_level ON public.user_challenge_tokens USING btree (user_id, earned_at_level) WHERE (earned_at_level IS NOT NULL);
CREATE INDEX idx_tokens_user_unsent ON public.user_challenge_tokens USING btree (user_id) WHERE (sent_at IS NULL);
CREATE INDEX idx_user_seen_items_user ON public.user_seen_items USING btree (user_id);
CREATE INDEX idx_user_titles_title_value ON public.user_titles USING btree (title_id, value DESC);
CREATE INDEX idx_users_group_id ON public.users USING btree (group_id);

-- ────────────────────────────── Funktioner ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Insert into our users table when someone signs up
  INSERT INTO public.users (id, name, email, password_hash, total_xp, current_level, total_km, current_streak, longest_streak)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    NEW.email,
    'migrated', -- placeholder for migrated users
    0,
    1,
    0,
    0,
    0
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.increment_event_xp(p_user_id uuid, p_xp integer)
 RETURNS void
 LANGUAGE sql
AS $function$
  UPDATE users
  SET event_xp = event_xp + p_xp,
      total_xp  = total_xp  + p_xp
  WHERE id = p_user_id;
$function$;

CREATE OR REPLACE FUNCTION public.trigger_update_title_leaderboard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        PERFORM public.update_title_leaderboard(NEW.title_id);
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        PERFORM public.update_title_leaderboard(OLD.title_id);
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_all_title_leaderboards()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
    title_record RECORD;
BEGIN
    FOR title_record IN SELECT id FROM public.titles LOOP
        PERFORM public.update_title_leaderboard(title_record.id);
    END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_title_leaderboard(p_title_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
    DELETE FROM public.title_leaderboard WHERE title_id = p_title_id;

    INSERT INTO public.title_leaderboard (title_id, user_id, position, value, earned_at)
    SELECT
        p_title_id,
        ut.user_id,
        ROW_NUMBER() OVER (ORDER BY ut.value DESC, ut.earned_at ASC) AS position,
        ut.value,
        ut.earned_at
    FROM public.user_titles ut
    WHERE ut.title_id = p_title_id
      AND ut.value IS NOT NULL
    ORDER BY ut.value DESC, ut.earned_at ASC
    LIMIT 10;

    UPDATE public.titles
    SET
        current_holder_id = (
            SELECT user_id FROM public.title_leaderboard
            WHERE title_id = p_title_id AND position = 1
        ),
        current_value = (
            SELECT value FROM public.title_leaderboard
            WHERE title_id = p_title_id AND position = 1
        ),
        updated_at = NOW()
    WHERE id = p_title_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_user_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
    affected_user_id UUID;
    total_xp_val     INTEGER;
    total_km_val     NUMERIC;
    current_level_val INTEGER;
BEGIN
    IF TG_OP = 'DELETE' THEN
        affected_user_id := OLD.user_id;
    ELSE
        affected_user_id := NEW.user_id;
    END IF;

    SELECT
        COALESCE(SUM(xp_gained), 0),
        COALESCE(SUM(distance), 0)
    INTO total_xp_val, total_km_val
    FROM public.runs
    WHERE user_id = affected_user_id;

    -- Korrekt level-lookup mot level_requirements (inte sqrt-formeln)
    SELECT COALESCE(MAX(level), 1)
    INTO current_level_val
    FROM public.level_requirements
    WHERE xp_required <= total_xp_val;

    UPDATE public.users
    SET
        total_xp      = total_xp_val,
        total_km      = total_km_val,
        current_level = current_level_val,
        updated_at    = NOW()
    WHERE id = affected_user_id;

    RETURN COALESCE(NEW, OLD);
END;
$function$;

-- ──────────────────────────────── Vyer ──────────────────────────────────────

create or replace view public.title_leaderboard_view as  SELECT t.id AS title_id,
    t.name AS title_name,
    t.description AS title_description,
    t.unlock_requirement,
    t.metric_key,
    tl."position",
    tl.user_id,
    u.name AS user_name,
    u.gender AS user_gender,
    u.profile_picture,
    tl.value,
    tl.earned_at,
        CASE
            WHEN tl."position" = 1 THEN 'holder'::text
            WHEN tl."position" <= 3 THEN 'runner_up'::text
            ELSE 'top_10'::text
        END AS status
   FROM titles t
     LEFT JOIN title_leaderboard tl ON t.id = tl.title_id
     LEFT JOIN users u ON tl.user_id = u.id
  ORDER BY t.name, tl."position";

-- ─────────────────────────────── Triggers ───────────────────────────────────

CREATE TRIGGER title_leaderboard_update_trigger AFTER INSERT OR DELETE OR UPDATE ON user_titles FOR EACH ROW EXECUTE FUNCTION trigger_update_title_leaderboard();

CREATE TRIGGER trigger_update_user_totals_delete AFTER DELETE ON runs FOR EACH ROW EXECUTE FUNCTION update_user_totals();

CREATE TRIGGER trigger_update_user_totals_insert AFTER INSERT ON runs FOR EACH ROW EXECUTE FUNCTION update_user_totals();

CREATE TRIGGER trigger_update_user_totals_update AFTER UPDATE ON runs FOR EACH ROW WHEN (old.user_id IS DISTINCT FROM new.user_id OR old.xp_gained IS DISTINCT FROM new.xp_gained OR old.distance IS DISTINCT FROM new.distance) EXECUTE FUNCTION update_user_totals();

-- ──────────────────────────────── RLS ───────────────────────────────────────
-- Baslinje-princip (migration 030+031): anon läser INGET utom
-- level_requirements och skriver ingenting. All annan åtkomst går via
-- backend (service role). auth.uid()-policyerna är kvarlevor från Supabase
-- Auth-eran och är i praktiken stängda (ingen Supabase-session finns).

alter table public.admin_settings enable row level security;
alter table public.challenge_durations enable row level security;
alter table public.challenge_metrics enable row level security;
alter table public.challenge_rewards enable row level security;
alter table public.challenges enable row level security;
alter table public.event_entries enable row level security;
alter table public.event_pool_members enable row level security;
alter table public.event_pools enable row level security;
alter table public.event_templates enable row level security;
alter table public.events enable row level security;
alter table public.groups enable row level security;
alter table public.level_challenge_rewards enable row level security;
alter table public.level_requirements enable row level security;
alter table public.run_weather enable row level security;
alter table public.runs enable row level security;
alter table public.strava_tokens enable row level security;
alter table public.streak_multipliers enable row level security;
alter table public.title_leaderboard enable row level security;
alter table public.titles enable row level security;
alter table public.user_boosts enable row level security;
alter table public.user_challenge_tokens enable row level security;
alter table public.user_seen_items enable row level security;
alter table public.user_titles enable row level security;
alter table public.users enable row level security;

create policy "Authenticated users can read event entries" on public.event_entries for select to authenticated using (true);
create policy authenticated_read_event_pool_members on public.event_pool_members for select to authenticated using (true);
create policy authenticated_read_event_pools on public.event_pools for select to authenticated using (true);
create policy "Authenticated users can read event templates" on public.event_templates for select to authenticated using (true);
create policy "Authenticated users can read events" on public.events for select to authenticated using (true);
create policy "Anyone can view level requirements" on public.level_requirements for select to anon, authenticated using (true);
create policy "Users can read own run weather" on public.run_weather for select to public using ((run_id IN ( SELECT runs.id FROM runs WHERE (runs.user_id = auth.uid()))));
create policy "Users can insert their own Strava tokens" on public.strava_tokens for insert to public with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy "Users can update their own Strava tokens" on public.strava_tokens for update to public using ((user_id = ( SELECT auth.uid() AS uid)));
create policy "Users can view their own Strava tokens" on public.strava_tokens for select to public using ((user_id = ( SELECT auth.uid() AS uid)));
create policy users_read_own_seen_items on public.user_seen_items for select to authenticated using ((auth.uid() = user_id));
create policy "Users can view all users" on public.users for select to authenticated using (true);
