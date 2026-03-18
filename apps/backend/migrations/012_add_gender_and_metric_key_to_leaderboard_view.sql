-- Migration 012: Add gender and metric_key to title_leaderboard_view
-- Run this in Supabase SQL editor.

CREATE OR REPLACE VIEW title_leaderboard_view AS
SELECT
  t.id as title_id,
  t.name as title_name,
  t.description as title_description,
  t.unlock_requirement,
  t.metric_key,
  tl.position,
  tl.user_id,
  u.name as user_name,
  u.gender as user_gender,
  u.profile_picture,
  tl.value,
  tl.earned_at,
  CASE
    WHEN tl.position = 1 THEN 'holder'
    WHEN tl.position <= 3 THEN 'runner_up'
    ELSE 'top_10'
  END as status
FROM titles t
LEFT JOIN title_leaderboard tl ON t.id = tl.title_id
LEFT JOIN users u ON tl.user_id = u.id
ORDER BY t.name, tl.position;
