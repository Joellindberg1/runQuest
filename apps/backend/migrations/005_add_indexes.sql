-- Composite index for the most common run query pattern:
-- filter by user_id (equality) + range/order on date
-- Used by reprocessRunsFromDate, streak calculations, and run history
CREATE INDEX IF NOT EXISTS idx_runs_user_id_date
  ON public.runs (user_id, date);
