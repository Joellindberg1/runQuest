-- Migration 027: user_seen_items — onboarding state per user
-- Tracks which onboarding slugs each user has seen.
-- Slug format examples: onboarding_v1, patch_2026_03_31, tour_events_v1
-- Versioning via slug name — no migration needed when content changes.

CREATE TABLE public.user_seen_items (
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_slug TEXT NOT NULL,
  seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_slug)
);

CREATE INDEX idx_user_seen_items_user ON public.user_seen_items(user_id);

ALTER TABLE public.user_seen_items ENABLE ROW LEVEL SECURITY;

-- Users can only read their own rows (backend writes via service role)
CREATE POLICY "users_read_own_seen_items"
  ON public.user_seen_items FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
