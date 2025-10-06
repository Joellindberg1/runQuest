-- STEG 7: Skapa view och permissions
CREATE OR REPLACE VIEW title_leaderboard_view AS
SELECT 
  t.id as title_id,
  t.name as title_name,
  t.description as title_description,
  t.unlock_requirement,
  tl.position,
  tl.user_id,
  u.name as user_name,
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

GRANT SELECT ON title_leaderboard TO authenticated;
GRANT SELECT ON title_leaderboard_view TO authenticated;
GRANT EXECUTE ON FUNCTION update_title_leaderboard(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION update_all_title_leaderboards() TO service_role;