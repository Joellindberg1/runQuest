import type { ChallengeMetric, ChallengeTier } from '@runquest/types';
import { stockholmClock } from '@/app-shell/rightNowItems';
import { daysBetween } from '@/features/leaderboard/boardFormat';

// Rena formatterare för Duels: tier, mått, insatser, tider. `now` skickas alltid in så att tiderna går att testa.
// Engelskt UI — tal och datum i en-GB (som resten av redesignen).

export const TIERS: readonly ChallengeTier[] = ['minor', 'major', 'legendary'];

const TIER_LABEL: Record<ChallengeTier, string> = { minor: 'Minor', major: 'Major', legendary: 'Legendary' };
const METRIC_LABEL: Record<ChallengeMetric, string> = { km: 'Most km', runs: 'Most runs', total_xp: 'Most XP' };
const METRIC_UNIT: Record<ChallengeMetric, string> = { km: 'km', runs: 'runs', total_xp: 'xp' };

export const tierLabel = (tier: ChallengeTier): string => TIER_LABEL[tier];
export const metricLabel = (metric: ChallengeMetric): string => METRIC_LABEL[metric];
export const metricUnit = (metric: ChallengeMetric): string => METRIC_UNIT[metric];

const MINUS = '−';
const MS_HOUR = 3_600_000;
const HOURS_PER_DAY = 24;

const WHOLE = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const ONE_DECIMAL = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Måttets värde utan enhet: km med en decimal, runs och XP som heltal ("1,820"). */
export function formatMetricValue(metric: ChallengeMetric, value: number | null): string {
  if (value === null) return '—';
  return metric === 'km' ? ONE_DECIMAL.format(value) : WHOLE.format(Math.round(value));
}

/** Värde + enhet för löptext: "38.4 km", "5 runs", "1,820 XP". */
export function formatMetricWithUnit(metric: ChallengeMetric, value: number | null): string {
  if (value === null) return '—';
  if (metric === 'km') return `${formatMetricValue(metric, value)} km`;
  if (metric === 'runs') return `${formatMetricValue(metric, value)} ${Math.round(value) === 1 ? 'run' : 'runs'}`;
  return `${formatMetricValue(metric, value)} XP`;
}

/** Fält som bär en insats — token, utmaning och historikrad har alla dem (typen saknas på tokens). */
export interface StakeSource {
  winner_delta: number;
  winner_duration: number;
  winner_type?: string;
  loser_delta: number;
  loser_duration: number;
  loser_type?: string;
}

export type StakeTone = 'up' | 'down' | 'muted';

export interface Stake {
  /** "+0.15× / 5 d" */
  win: string;
  /** "−0.07× / 5 d", eller "No penalty" när straffet är 0. */
  lose: string;
  loseTone: StakeTone;
  /** Kort form utan längd, för token-raderna: "+0.15× win · −0.07× loss" / "+0.5× win · no penalty". */
  summary: string;
}

const trimmed = (value: number): string => String(Number(Math.abs(value).toFixed(2)));

/** "+0.15×" / "−0.07×". Förlorarens delta är negativt i databasen. */
export const deltaText = (delta: number): string => `${delta < 0 ? MINUS : '+'}${trimmed(delta)}×`;

function windowText(duration: number, type: string | undefined): string {
  return type === 'multiplier_runs' ? `${duration} ${duration === 1 ? 'run' : 'runs'}` : `${duration} d`;
}

/** Boostens storlek och längd: "+0.15× / 5 d". */
export function boostText(delta: number, duration: number, type?: string): string {
  return `${deltaText(delta)} / ${windowText(duration, type)}`;
}

export function stakeOf(source: StakeSource): Stake {
  const noPenalty = source.loser_delta === 0;
  return {
    win: boostText(source.winner_delta, source.winner_duration, source.winner_type),
    lose: noPenalty ? 'No penalty' : boostText(source.loser_delta, source.loser_duration, source.loser_type),
    loseTone: noPenalty ? 'muted' : 'down',
    summary: `${deltaText(source.winner_delta)} win · ${noPenalty ? 'no penalty' : `${deltaText(source.loser_delta)} loss`}`,
  };
}

/** Förnamnet — designen visar "Karl", inte "Karl Persson", i korten. */
export const firstName = (name: string): string => name.trim().split(/\s+/)[0] || name;

export const durationText = (days: number): string => `${days} d`;
export const durationLongText = (days: number): string => `${days} ${days === 1 ? 'day' : 'days'}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "21 Aug" i Stockholm-tid. Månadsnamnen är egna: Intl:s förkortningar skiljer mellan ICU-versioner ("Sept"). */
export function formatDayMonth(iso: string | null): string | null {
  if (!iso) return null;
  const { date } = stockholmClock(new Date(iso));
  const [, month, day] = date.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]}`;
}

export type TimeTone = 'neutral' | 'duel' | 'down';

export interface TimeLeft {
  text: string;
  tone: TimeTone;
}

/** "9 d left" · "ends tomorrow" · "ends today" ur slutdatumet (kalenderdag, Stockholm). */
export function timeLeft(endDate: string | undefined, now: Date): TimeLeft | null {
  if (!endDate) return null;
  const days = daysBetween(stockholmClock(now).date, endDate);
  if (days < 0) return { text: 'settling', tone: 'neutral' };
  if (days === 0) return { text: 'ends today', tone: 'down' };
  if (days === 1) return { text: 'ends tomorrow', tone: 'duel' };
  return { text: `${days} d left`, tone: 'neutral' };
}

/** Timmar kvar till startdagens midnatt (Stockholm); null när utmaningen redan har startat. */
export function hoursUntilStart(startDate: string | undefined, now: Date): number | null {
  if (!startDate) return null;
  const clock = stockholmClock(now);
  const days = daysBetween(clock.date, startDate);
  if (days <= 0) return null;
  return Math.max(1, Math.ceil((days * HOURS_PER_DAY * MS_HOUR - clock.msIntoDay) / MS_HOUR));
}

/** "starts in 14 h" (inom ett dygn) eller "starts in 2 d". */
export function startsInText(startDate: string | undefined, now: Date): string | null {
  const hours = hoursUntilStart(startDate, now);
  if (hours === null) return null;
  return hours <= HOURS_PER_DAY ? `starts in ${hours} h` : `starts in ${Math.ceil(hours / HOURS_PER_DAY)} d`;
}
