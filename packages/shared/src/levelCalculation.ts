// Level-matematik — ENDA hemmet (ADR 004). Rena funktioner med data som
// argument; DB-läsning/cachning bor hos konsumenterna (backend/frontend
// levelService). Fallback-tabellen här är den enda hårdkodade kopian i
// kodbasen och är verifierad identisk med level_requirements i produktion
// (2026-10-04).

export interface LevelRequirement {
  level: number;
  xp_required: number;
}

export const MAX_LEVEL = 30;

const FALLBACK_XP = [
  0, 50, 102, 158, 217, 280, 349, 423, 504, 594,
  693, 806, 934, 1079, 1244, 1436, 1659, 1920, 2228, 2591,
  3026, 3549, 4181, 4953, 5902, 7089, 8584, 10482, 12912, 16071
];

export const FALLBACK_LEVEL_REQUIREMENTS: LevelRequirement[] = FALLBACK_XP.map(
  (xp, index) => ({ level: index + 1, xp_required: xp })
);

/** Standard-multiplikatorer — speglar streak_multipliers-tabellen i prod. */
export const DEFAULT_STREAK_MULTIPLIERS = [
  { days: 5, multiplier: 1.1 },  { days: 15, multiplier: 1.2 },  { days: 30, multiplier: 1.3 },
  { days: 60, multiplier: 1.4 }, { days: 90, multiplier: 1.5 },  { days: 120, multiplier: 1.6 },
  { days: 180, multiplier: 1.7 }, { days: 220, multiplier: 1.8 }, { days: 240, multiplier: 1.9 },
  { days: 270, multiplier: 2.0 }
];

/** Nivå för given total-XP. Tom/ogiltig tabell → fallback. */
export function levelFromXP(totalXP: number, requirements: LevelRequirement[] = FALLBACK_LEVEL_REQUIREMENTS): number {
  const reqs = requirements.length > 0 ? requirements : FALLBACK_LEVEL_REQUIREMENTS;
  for (let i = reqs.length - 1; i >= 0; i--) {
    if (totalXP >= reqs[i].xp_required) {
      return Math.min(reqs[i].level, MAX_LEVEL);
    }
  }
  return 1;
}

/** XP-kravet för en given nivå (0 om nivån saknas). */
export function xpForLevel(level: number, requirements: LevelRequirement[] = FALLBACK_LEVEL_REQUIREMENTS): number {
  const reqs = requirements.length > 0 ? requirements : FALLBACK_LEVEL_REQUIREMENTS;
  return reqs.find(req => req.level === level)?.xp_required || 0;
}

/** XP-kravet för nästa nivå (klampat vid MAX_LEVEL). */
export function xpForNextLevel(level: number, requirements: LevelRequirement[] = FALLBACK_LEVEL_REQUIREMENTS): number {
  return xpForLevel(Math.min(level + 1, MAX_LEVEL), requirements);
}

export interface LevelProgress {
  currentLevel: number;
  currentLevelXP: number;
  nextLevelXP: number;
  progress: number;
  xpToNext: number;
}

/** Progress mot nästa nivå, 0–100. Vid MAX_LEVEL: 100 % och 0 kvar. */
export function levelProgress(totalXP: number, requirements: LevelRequirement[] = FALLBACK_LEVEL_REQUIREMENTS): LevelProgress {
  const currentLevel = levelFromXP(totalXP, requirements);
  const currentLevelXP = xpForLevel(currentLevel, requirements);
  const nextLevelXP = xpForNextLevel(currentLevel, requirements);

  const progress = currentLevel >= MAX_LEVEL ? 100 :
    ((totalXP - currentLevelXP) / (nextLevelXP - currentLevelXP)) * 100;

  const xpToNext = currentLevel >= MAX_LEVEL ? 0 : nextLevelXP - totalXP;

  return {
    currentLevel,
    currentLevelXP,
    nextLevelXP,
    progress: Math.max(0, Math.min(100, progress)),
    xpToNext: Math.max(0, xpToNext)
  };
}
