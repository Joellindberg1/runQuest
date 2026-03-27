/**
 * Streak multiplier thresholds.
 *
 * NOTE: These values must be kept in sync with the `streak_multipliers` table
 * in the database (admin-configurable via AdminSettings). The canonical
 * calculation lives in @runquest/shared → calculateStreakMultiplier().
 * These frontend constants are used for display-only purposes (PlaybookPage,
 * UserProfile stats). If the DB values change, update this file too.
 */
export const STREAK_MULTIPLIERS = [
  { days: 5,   multiplier: 1.10 },
  { days: 15,  multiplier: 1.20 },
  { days: 30,  multiplier: 1.30 },
  { days: 60,  multiplier: 1.40 },
  { days: 90,  multiplier: 1.50 },
  { days: 120, multiplier: 1.60 },
  { days: 180, multiplier: 1.70 },
  { days: 220, multiplier: 1.80 },
  { days: 240, multiplier: 1.90 },
  { days: 270, multiplier: 2.00 },
] as const;

/** Returns the highest applicable multiplier for a given streak length. */
export function getStreakMultiplier(streak: number): number {
  let result = 1.0;
  for (const { days, multiplier } of STREAK_MULTIPLIERS) {
    if (streak >= days) result = multiplier;
    else break;
  }
  return result;
}
