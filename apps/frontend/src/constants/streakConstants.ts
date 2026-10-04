/**
 * Streak multiplier thresholds — SSOT i @runquest/shared (ADR 004).
 * Databasens tabell `streak_multipliers` är runtime-källan för XP-beräkningen
 * (backend); dessa default-värden speglar den och används här för display
 * (PlaybookPage, UserProfile stats).
 */
import { DEFAULT_STREAK_MULTIPLIERS } from '@runquest/shared';

export const STREAK_MULTIPLIERS = DEFAULT_STREAK_MULTIPLIERS;

/** Returns the highest applicable multiplier for a given streak length. */
export function getStreakMultiplier(streak: number): number {
  let result = 1.0;
  for (const { days, multiplier } of STREAK_MULTIPLIERS) {
    if (streak >= days) result = multiplier;
    else break;
  }
  return result;
}
