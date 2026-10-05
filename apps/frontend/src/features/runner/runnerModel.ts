import type { Run, User, UserTitle } from '@runquest/types';
import type { ChallengeHistoryItem, HeadToHeadResponse, XpConfigResponse } from '@runquest/shared';
import { calculateStreakMultiplier } from '@runquest/shared';
import { stockholmClock } from '@/app-shell/rightNowItems';
import { formatDecimal, formatInt } from '@/features/leaderboard/boardFormat';
import { buildStreakRow, formatMultiplier } from '@/features/leaderboard/streakModel';
import { hasLinearGap, resolveGenderedTitle, titleValueText } from '@/features/titles/titleFormat';
import type { TitleLeaderboard } from '@/shared/services/backendApi';
import { leaderboardUtils } from '@/shared/utils/leaderboardUtils';

// Runner cardens vymodeller: allt kortet visar, härlett ur users-with-runs + titlar + head-to-head + XP-config.
// Ren logik — ingen DOM, ingen datahämtning. `now` skickas alltid in så att tiderna går att testa.

export const MARATHON_KM = 42.195;
/** Två rundor räknas som ett dubbelpass först när de startat minst så här långt ifrån varandra. */
export const DOUBLE_RUN_MIN_GAP_MS = 4 * 60 * 60 * 1000;

export type Tone = 'default' | 'gold' | 'up' | 'down' | 'muted';

// ─── Hjältekort ───────────────────────────────────────────────────────────────

export interface RunnerHero {
  id: string;
  name: string;
  level: number;
  /** Andel av nuvarande nivå, 0–1 (nivåringen). */
  ringTurn: number;
  rank: number | null;
  runs: number;
  /** XP kvar till nästa nivå; null på maxnivå. */
  xpToNext: number | null;
  nextLevel: number | null;
}

export function buildHero(user: User, allUsers: User[]): RunnerHero {
  const stats = leaderboardUtils.calculateUserStats(user);
  const sorted = leaderboardUtils.filterAndSortUsers(allUsers);
  const ranked = sorted.some((candidate) => candidate.id === user.id);
  const atMax = stats.xpLevelRange === 0;

  return {
    id: user.id,
    name: user.name,
    level: stats.level,
    ringTurn: atMax ? 1 : Math.round(stats.xpProgress) / 100,
    rank: ranked ? leaderboardUtils.getUserPosition(user, sorted) : null,
    runs: stats.numberOfRuns,
    xpToNext: atMax ? null : stats.xpLeftForNextLevel,
    nextLevel: atMax ? null : stats.level + 1,
  };
}

export function xpToNextText(hero: Pick<RunnerHero, 'xpToNext' | 'nextLevel'>): string {
  return hero.xpToNext === null || hero.nextLevel === null
    ? 'Max level reached'
    : `${formatInt(hero.xpToNext)} XP to level ${hero.nextLevel}`;
}

// ─── Statceller ───────────────────────────────────────────────────────────────

export interface StatCell {
  key: 'xp' | 'km' | 'challenges' | 'runs' | 'titles';
  value: string;
  label: string;
  tone: Tone;
  /** Visas bara i den bredare desktop-varianten (designens Web Prototype har fem celler, App Prototype tre). */
  wideOnly: boolean;
}

/** `heldTitles` är null medan titlarna laddas eller om de inte gick att läsa — cellen visar då "—". */
export function buildStatCells(user: User, heldTitles: number | null): StatCell[] {
  const wins = user.wins ?? 0;
  const losses = user.losses ?? 0;
  return [
    { key: 'xp', value: formatInt(user.total_xp), label: 'total xp', tone: 'gold', wideOnly: false },
    { key: 'km', value: formatDecimal(user.total_km), label: 'total km', tone: 'default', wideOnly: false },
    { key: 'challenges', value: `${wins}–${losses}`, label: 'challenges', tone: wins >= losses ? 'up' : 'down', wideOnly: false },
    { key: 'runs', value: String(user.runs?.length ?? 0), label: 'runs', tone: 'default', wideOnly: true },
    { key: 'titles', value: heldTitles === null ? '—' : String(heldTitles), label: 'titles held', tone: 'gold', wideOnly: true },
  ];
}

// ─── Statflikar ───────────────────────────────────────────────────────────────

export interface StatRow {
  label: string;
  value: string;
  tone: Tone;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

const dayOf = (run: Pick<Run, 'date'>): string => run.date.slice(0, 10);

export function buildDistanceRows(user: User, now: Date): StatRow[] {
  const stats = leaderboardUtils.calculateUserStats(user);
  const month = stockholmClock(now).date.slice(0, 7);
  const monthKm = (user.runs ?? []).filter((run) => dayOf(run).startsWith(month)).reduce((sum, run) => sum + run.distance, 0);

  return [
    { label: 'Longest run', value: `${formatDecimal(stats.longestRun, 2)} km`, tone: 'default' },
    { label: 'Total', value: `${formatDecimal(user.total_km)} km`, tone: 'default' },
    { label: 'Average per run', value: `${formatDecimal(stats.averageKmPerRun)} km`, tone: 'default' },
    { label: 'This month', value: `${formatDecimal(monthKm)} km`, tone: 'gold' },
  ];
}

type LadderStep = XpConfigResponse['streak_multipliers'][number];

/** Närmaste trappsteg över nuvarande streak, eller null på toppen. */
export function nextTier(streakDays: number, ladder: LadderStep[]): LadderStep | null {
  return [...ladder].sort((a, b) => a.days - b.days).find((step) => step.days > streakDays) ?? null;
}

/**
 * Streak-raderna. Nuvarande streak är den EFFEKTIVA (0 när den brutits, samma regel som Board och
 * Right now), multiplikatorn räknas ur trappan i /api/config/xp — aldrig ur en hårdkodad konstant.
 */
export function buildStreakRows(user: User, now: Date, ladder: LadderStep[]): StatRow[] {
  const row = buildStreakRow(user, now, ladder);
  const multiplier = calculateStreakMultiplier(row.days, ladder);
  const next = nextTier(row.days, ladder);

  return [
    { label: 'Current', value: `${row.days} ${row.days === 1 ? 'day' : 'days'}`, tone: 'default' },
    { label: 'Best', value: `${row.best} ${row.best === 1 ? 'day' : 'days'}`, tone: 'default' },
    { label: 'Multiplier', value: formatMultiplier(multiplier), tone: 'gold' },
    {
      label: 'Next tier at',
      value: next ? `${next.days} days · ${formatMultiplier(next.multiplier)}` : 'Top tier reached',
      tone: 'muted',
    },
  ];
}

export function marathonEquivalents(km: number): number {
  return Math.floor(km / MARATHON_KM);
}

/**
 * Dagar med ett riktigt dubbelpass: två rundor samma dag vars starttider ligger minst 4 h isär (samma 4 h-gräns
 * som titeln The Double Trouble; titeln kräver dessutom 5 km per runda och mäter km, så siffrorna är inte samma sak). En runda utan starttid
 * (manuell loggning) kan inte bevisa avståndet och räknas därför inte.
 */
export function countDoubleRunDays(runs: Pick<Run, 'date' | 'start_time'>[]): number {
  const startsByDay = new Map<string, number[]>();
  for (const run of runs) {
    const start = run.start_time ? new Date(run.start_time).getTime() : NaN;
    if (Number.isNaN(start)) continue;
    const day = dayOf(run);
    startsByDay.set(day, [...(startsByDay.get(day) ?? []), start]);
  }

  let days = 0;
  for (const starts of startsByDay.values()) {
    if (starts.length < 2) continue;
    // Är någon start minst 4 h från den tidigaste har det funnits ett dubbelpass den dagen.
    if (Math.max(...starts) - Math.min(...starts) >= DOUBLE_RUN_MIN_GAP_MS) days += 1;
  }
  return days;
}

/** Veckodagen med flest rundor (lika → mest km, därefter tidigast i veckan mån–sön). null utan rundor. */
export function favouriteWeekday(runs: Pick<Run, 'date' | 'distance'>[]): string | null {
  const byWeekday = new Map<number, { count: number; km: number }>();
  for (const run of runs) {
    const [year, month, day] = dayOf(run).split('-').map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const entry = byWeekday.get(weekday) ?? { count: 0, km: 0 };
    byWeekday.set(weekday, { count: entry.count + 1, km: entry.km + run.distance });
  }
  if (byWeekday.size === 0) return null;

  const mondayFirst = (weekday: number) => (weekday + 6) % 7;
  const [best] = [...byWeekday.entries()].sort(
    ([dayA, a], [dayB, b]) => b.count - a.count || b.km - a.km || mondayFirst(dayA) - mondayFirst(dayB),
  );
  return WEEKDAYS[best[0]];
}

export function buildFunRows(user: User, now: Date): StatRow[] {
  const runs = user.runs ?? [];
  const year = stockholmClock(now).date.slice(0, 4);
  const yearKm = runs.filter((run) => dayOf(run).startsWith(year)).reduce((sum, run) => sum + run.distance, 0);

  return [
    { label: 'Marathon equivalents total', value: String(marathonEquivalents(user.total_km)), tone: 'default' },
    { label: `Marathon equivalents ${year}`, value: String(marathonEquivalents(yearKm)), tone: 'default' },
    { label: 'Double-run days', value: String(countDoubleRunDays(runs)), tone: 'gold' },
    { label: 'Favourite day to run', value: favouriteWeekday(runs) ?? '—', tone: 'gold' },
  ];
}

// ─── Titlar ───────────────────────────────────────────────────────────────────

export interface HeldTitleRow {
  id: string;
  name: string;
  value: string;
}

export interface RunnerUpTitleRow {
  id: string;
  name: string;
  position: number;
  /** "held by Karl" — null om titelns innehavare inte gick att läsa. */
  holder: string | null;
  /** Skillnaden till innehavaren ("5 days"); null för mått där en differens inte är läsbar (tider, tempo). */
  gap: string | null;
  value: string;
}

export interface TitleRows {
  held: HeldTitleRow[];
  runnersUp: RunnerUpTitleRow[];
}

const RUNNER_UP_POSITIONS = [2, 3];

export function buildTitleRows(userTitles: UserTitle[], board: TitleLeaderboard[], gender: string | null | undefined): TitleRows {
  const entryFor = (title: UserTitle) => board.find((entry) => entry.id === title.title_id);
  const nameOf = (title: UserTitle) => resolveGenderedTitle(title.title_name, gender);

  const held = userTitles
    .filter((title) => title.is_current_holder)
    .map((title) => ({ id: title.title_id, name: nameOf(title), value: titleValueText(entryFor(title)?.metric_key, title.value ?? 0) }));

  const runnersUp = userTitles
    .filter((title) => !title.is_current_holder && RUNNER_UP_POSITIONS.includes(title.position))
    .sort((a, b) => a.position - b.position)
    .map((title) => {
      const entry = entryFor(title);
      const metric = entry?.metric_key;
      const holderValue = entry?.holder?.value;
      const linear = hasLinearGap(metric) && holderValue !== undefined;
      return {
        id: title.title_id,
        name: nameOf(title),
        position: title.position,
        holder: entry?.holder?.user_name ?? null,
        gap: linear ? titleValueText(metric, Math.max(0, holderValue - (title.value ?? 0))) : null,
        value: titleValueText(metric, title.value ?? 0),
      };
    });

  return { held, runnersUp };
}

// ─── Head to head ─────────────────────────────────────────────────────────────

export type MeetingResult = 'won' | 'lost' | 'draw';

export interface RecordCell {
  key: 'won' | 'drawn' | 'lost';
  value: number;
  label: string;
  tone: Tone;
}

export interface Meeting {
  id: string;
  result: MeetingResult;
  resultLabel: string;
  /** "Most km · 7 days" */
  what: string;
  /** "42.1 km – 37.0 km", sett ur den inloggades perspektiv (du först). */
  score: string;
  date: string | null;
}

export interface HeadToHeadView {
  cells: RecordCell[];
  total: number;
  meetings: Meeting[];
  /** Pågående eller väntande utmaning mellan paret — då går det inte att skicka en ny. */
  active: 'pending' | 'active' | null;
}

const METRIC_LABEL: Record<ChallengeHistoryItem['metric'], string> = { km: 'Most km', runs: 'Most runs', total_xp: 'Most XP' };
const RESULT_LABEL: Record<MeetingResult, string> = { won: 'Won', lost: 'Lost', draw: 'Draw' };

function metricValueText(metric: ChallengeHistoryItem['metric'], value: number | null): string {
  if (value === null) return '—';
  if (metric === 'km') return `${formatDecimal(value)} km`;
  if (metric === 'runs') return `${Math.round(value)} ${Math.round(value) === 1 ? 'run' : 'runs'}`;
  return `${formatInt(value)} XP`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "4 Oct" i Stockholm-tid. Månadsnamnen är egna: Intl:s förkortningar skiljer mellan ICU-versioner ("Sept"). */
function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const { date } = stockholmClock(new Date(iso));
  const [, month, day] = date.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]}`;
}

export function buildMeeting(item: ChallengeHistoryItem, meId: string): Meeting {
  const iAmChallenger = item.challenger.id === meId;
  const result: MeetingResult =
    item.outcome === 'draw' ? 'draw' : (item.outcome === 'challenger_wins') === iAmChallenger ? 'won' : 'lost';
  const mine = iAmChallenger ? item.challenger_value : item.opponent_value;
  const theirs = iAmChallenger ? item.opponent_value : item.challenger_value;

  return {
    id: item.id,
    result,
    resultLabel: RESULT_LABEL[result],
    what: `${METRIC_LABEL[item.metric]} · ${item.duration_days} ${item.duration_days === 1 ? 'day' : 'days'}`,
    score: `${metricValueText(item.metric, mine)} – ${metricValueText(item.metric, theirs)}`,
    date: shortDate(item.ended_at),
  };
}

export function buildHeadToHead(response: HeadToHeadResponse, meId: string): HeadToHeadView {
  const { record } = response;
  return {
    cells: [
      { key: 'won', value: record.wins, label: 'you won', tone: 'up' },
      { key: 'drawn', value: record.draws, label: 'drawn', tone: 'muted' },
      { key: 'lost', value: record.losses, label: 'you lost', tone: 'down' },
    ],
    total: record.total,
    meetings: response.history.map((item) => buildMeeting(item, meId)),
    active: response.active?.status ?? null,
  };
}
