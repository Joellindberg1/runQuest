import type { User, UserTitle } from '@runquest/types';
import { MAX_LEVEL } from '@/constants/appConstants';
import { getInitials, leaderboardUtils } from '@/shared/utils/leaderboardUtils';
import { deltaView, formatDecimal, formatInt, formatRunAge, latestRunOf, type DeltaView } from './boardFormat';

// Season-/All-time-vyns vymodell: allt som korten visar, härlett ur users-with-runs + titlar + rank-delta.
// Ren logik — rendering och datahämtning ligger i komponenterna/hooks.

export interface TierTokens {
  minor: number;
  major: number;
  legendary: number;
}

export interface SeasonRow {
  id: string;
  name: string;
  rank: number;
  level: number;
  initials: string;
  pictureUrl: string | null;
  delta: DeltaView;
  /** Visade titlar i användarens egen ordning (max 3). */
  titleNames: string[];
  /** Antal innehavda titlar totalt (styr "too many names"-raden). */
  heldTitleCount: number;
  progress: { pct: number; into: string; atMax: boolean };
  kmTotal: string;
  longest: string;
  runs: number;
  avgPerRun: string;
  pace: { perDay: number; text: string; tone: 'up' | 'down' };
  /** Dagar till nästa nivå vid nuvarande tempo; null = ingen prognos (inget tempo eller maxnivå). */
  nextLevelDays: number | null;
  lastRun: { age: string; km: string } | null;
  tokens: TierTokens;
  tokensLeft: number;
}

export interface SeasonInput {
  now: Date;
  titlesByUser: Record<string, UserTitle[]>;
  /** user_id → rank_delta ur /api/leaderboard/rank-delta (positivt = klättrat). */
  rankDeltaByUser: Record<string, number | null>;
}

const MAX_DISPLAYED_TITLES = 3;

/** Titlarna som visas på kortet: användarens valda i vald ordning, annars de innehavda (max 3). */
export function displayedTitleNames(user: User, titles: UserTitle[]): { names: string[]; heldCount: number } {
  const held = titles.filter((title) => title.is_current_holder);
  const chosenIds = user.displayed_title_ids ?? [];
  const ordered = chosenIds.length > 0
    ? chosenIds.map((id) => held.find((title) => title.title_id === id)).filter((title): title is UserTitle => !!title)
    : held;
  return { names: ordered.slice(0, MAX_DISPLAYED_TITLES).map((title) => title.title_name), heldCount: held.length };
}

/** Titelraden på desktopkortet: "A, B & C", med skämtet kvar när fler än tre innehas (som gamla kortet). */
export function titleLine(names: string[], heldCount: number): string {
  if (names.length === 0) return 'No titles held yet';
  if (heldCount > MAX_DISPLAYED_TITLES) return `${names.join(', ')} & The one with too many names to mention!`;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

export function buildSeasonRows(users: User[], input: SeasonInput): SeasonRow[] {
  const sorted = leaderboardUtils.filterAndSortUsers(users);

  const partial = sorted.map((user) => {
    const stats = leaderboardUtils.calculateUserStats(user);
    const { names, heldCount } = displayedTitleNames(user, input.titlesByUser[user.id] ?? []);
    const latest = latestRunOf(user.runs);
    const counts = user.challenge_counts ?? {};
    const tokens: TierTokens = { minor: counts.minor ?? 0, major: counts.major ?? 0, legendary: counts.legendary ?? 0 };
    const atMax = stats.level >= MAX_LEVEL;

    return {
      id: user.id,
      name: user.name,
      rank: leaderboardUtils.getUserPosition(user, sorted),
      level: stats.level,
      initials: getInitials(user.name).slice(0, 2),
      pictureUrl: user.profile_picture || null,
      delta: deltaView(input.rankDeltaByUser[user.id]),
      titleNames: names,
      heldTitleCount: heldCount,
      progress: {
        pct: atMax ? 100 : Math.round(stats.xpProgress),
        into: atMax ? 'Max level' : `${formatInt(stats.xpInLevel)} / ${formatInt(stats.xpLevelRange)} XP`,
        atMax,
      },
      kmTotal: formatInt(user.total_km),
      longest: formatDecimal(stats.longestRun),
      runs: stats.numberOfRuns,
      avgPerRun: formatDecimal(stats.averageKmPerRun),
      perDay: stats.avgXpPer14Days,
      nextLevelDays: !atMax && stats.daysToNextLevel > 0 ? stats.daysToNextLevel : null,
      lastRun: latest ? { age: formatRunAge(latest, input.now), km: formatDecimal(latest.distance) } : null,
      tokens,
      tokensLeft: tokens.minor + tokens.major + tokens.legendary,
    };
  });

  // Tempots färg är relativ: över/under flockens snitt (designens 39/d grönt, 24/d rött …).
  const averagePace = partial.length > 0 ? partial.reduce((sum, row) => sum + row.perDay, 0) / partial.length : 0;

  return partial.map(({ perDay, ...row }) => ({
    ...row,
    pace: { perDay, text: `${perDay} / d`, tone: perDay > 0 && perDay >= averagePace ? 'up' : 'down' } as const,
  }));
}

export function rankDeltaMap(users: Array<{ user_id: string; rank_delta: number | null }> | undefined): Record<string, number | null> {
  return Object.fromEntries((users ?? []).map((user) => [user.user_id, user.rank_delta]));
}
