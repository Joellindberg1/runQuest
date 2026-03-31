-- Migration 026: Enable RLS on event_pools + event_pool_members
-- Same pattern as migration 020 — authenticated users can read,
-- service role (used by backend) bypasses RLS for all writes.

ALTER TABLE public.event_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_pool_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_event_pools"
  ON public.event_pools FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "authenticated_read_event_pool_members"
  ON public.event_pool_members FOR SELECT
  TO authenticated USING (true);
