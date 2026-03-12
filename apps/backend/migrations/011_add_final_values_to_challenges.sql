ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS challenger_final_value NUMERIC,
  ADD COLUMN IF NOT EXISTS opponent_final_value   NUMERIC;
