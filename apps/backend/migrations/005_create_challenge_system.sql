-- ============================================================
-- Migration 005: Challenge System — Schema
-- ============================================================

-- 1. Challenge definition tables (config — new types = new rows, no code changes)

CREATE TABLE challenge_metrics (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric           TEXT NOT NULL,        -- 'km', 'runs', 'total_xp', 'elevation', 'moving_time'
  description      TEXT NOT NULL,        -- "Vem springer längst totalt?"
  tier_eligibility TEXT[] NOT NULL,      -- ARRAY['minor'], ARRAY['minor','major'], etc.
  active           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE challenge_durations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  duration_days    INT NOT NULL,
  tier_eligibility TEXT[] NOT NULL,
  active           BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE challenge_rewards (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_eligibility TEXT[] NOT NULL,
  winner_type      TEXT NOT NULL,    -- 'multiplier_days', 'multiplier_runs', 'xp_flat'
  winner_delta     NUMERIC NOT NULL, -- additive delta e.g. +0.15
  winner_duration  INT,              -- days or runs (NULL for xp_flat)
  loser_type       TEXT NOT NULL,
  loser_delta      NUMERIC NOT NULL, -- negative e.g. -0.07
  loser_duration   INT,
  description      TEXT,
  active           BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE level_challenge_rewards (
  level INT PRIMARY KEY,
  tier  TEXT NOT NULL  -- 'minor', 'major', 'legendary'
);

-- 2. User challenge tokens (challenges held by a player, not yet sent)

CREATE TABLE user_challenge_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric_id     UUID NOT NULL REFERENCES challenge_metrics(id),
  duration_id   UUID NOT NULL REFERENCES challenge_durations(id),
  reward_id     UUID NOT NULL REFERENCES challenge_rewards(id),
  tier          TEXT NOT NULL,
  metric        TEXT NOT NULL,
  duration_days INT NOT NULL,
  earned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at       TIMESTAMPTZ,
  challenge_id  UUID
);

-- 3. Challenges (sent / active / completed / declined)

CREATE TABLE challenges (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          UUID NOT NULL REFERENCES groups(id),
  token_id          UUID REFERENCES user_challenge_tokens(id),
  tier              TEXT NOT NULL,
  challenger_id     UUID NOT NULL REFERENCES users(id),
  opponent_id       UUID NOT NULL REFERENCES users(id),
  metric            TEXT NOT NULL,
  duration_days     INT NOT NULL,
  winner_delta      NUMERIC NOT NULL,
  winner_duration   INT,
  winner_type       TEXT NOT NULL,
  loser_delta       NUMERIC NOT NULL,
  loser_duration    INT,
  loser_type        TEXT NOT NULL,
  challenger_level  INT NOT NULL,
  opponent_level    INT NOT NULL,
  start_date        DATE,
  end_date          DATE,
  determine_at      TIMESTAMPTZ,
  legendary_sent_at TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'pending',
  winner_id         UUID REFERENCES users(id),
  outcome           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_challenge_tokens
  ADD CONSTRAINT fk_token_challenge
  FOREIGN KEY (challenge_id) REFERENCES challenges(id);

-- 4. User boosts (active XP effects from challenge outcomes)

CREATE TABLE user_boosts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_id  UUID NOT NULL REFERENCES challenges(id),
  outcome       TEXT NOT NULL,
  type          TEXT NOT NULL,
  delta         NUMERIC NOT NULL,
  remaining     INT,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Alter existing tables

ALTER TABLE users
  ADD COLUMN wins             INT NOT NULL DEFAULT 0,
  ADD COLUMN draws            INT NOT NULL DEFAULT 0,
  ADD COLUMN losses           INT NOT NULL DEFAULT 0,
  ADD COLUMN challenge_active BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE runs
  ADD COLUMN moving_time           INT,
  ADD COLUMN total_elevation_gain  NUMERIC,
  ADD COLUMN start_time            TIMESTAMPTZ,
  ADD COLUMN sport_type            TEXT;

-- 6. Indexes

CREATE INDEX idx_challenges_challenger ON challenges(challenger_id, status);
CREATE INDEX idx_challenges_opponent   ON challenges(opponent_id, status);
CREATE INDEX idx_challenges_group      ON challenges(group_id, status);
CREATE INDEX idx_challenges_end_date   ON challenges(end_date, status);
CREATE INDEX idx_challenges_determine  ON challenges(determine_at) WHERE status = 'active';
CREATE INDEX idx_tokens_user_unsent    ON user_challenge_tokens(user_id) WHERE sent_at IS NULL;
CREATE INDEX idx_boosts_user_active    ON user_boosts(user_id, expires_at);
