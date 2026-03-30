-- Enable RLS on event tables (were unrestricted in public schema)

ALTER TABLE public.event_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_entries ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all event data (service role bypasses RLS for writes)
CREATE POLICY "authenticated_read_event_templates"
  ON public.event_templates FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "authenticated_read_events"
  ON public.events FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "authenticated_read_event_entries"
  ON public.event_entries FOR SELECT
  TO authenticated USING (true);

-- Fix increment_event_xp search_path to prevent mutable search_path warning
CREATE OR REPLACE FUNCTION increment_event_xp(p_user_id UUID, p_xp INT)
RETURNS VOID LANGUAGE sql SET search_path = public AS $$
  UPDATE users SET event_xp = event_xp + p_xp WHERE id = p_user_id;
$$;
