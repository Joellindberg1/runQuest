import type { Challenge, ChallengeMetric, ChallengeTier, ChallengeToken, Run, UserBoost } from '@runquest/types';
import type { ChallengeHistoryItem } from '@runquest/shared';
import { stockholmClock } from '@/app-shell/rightNowItems';
import {
  TIERS, durationLongText, durationText, firstName, formatDayMonth, formatMetricValue, metricLabel, metricUnit,
  startsInText, stakeOf, tierLabel, timeLeft, type Stake, type StakeSource, type TimeLeft,
} from './duelsFormat';

// Duels-skärmens vymodeller: live-kort, inkommande, tokens, standings, historik, boosts, send-sheetens val.
// Ren logik — ingen DOM, ingen datahämtning. `now` skickas alltid in så att tiderna går att testa.

// ─── Delvyer ──────────────────────────────────────────────────────────────────

export type DuelsView = 'standings' | 'live' | 'rules' | 'history';
export const DUELS_VIEWS: readonly DuelsView[] = ['standings', 'live', 'rules', 'history'];
export const DEFAULT_DUELS_VIEW: DuelsView = 'live';

// ─── Indata (formerna backend redan svarar med) ───────────────────────────────

/** GET /challenges/my. Token-raderna bär även `winner_type`/`loser_type`, men typen i packages/types saknar dem. */
export interface MyChallenges {
  tokens: Array<ChallengeToken & Partial<Pick<StakeSource, 'winner_type' | 'loser_type'>>>;
  sent_challenge: Challenge | null;
  received_challenges: Challenge[];
  boosts: UserBoost[];
  history: Challenge[];
  group_active: Challenge[];
}

/** GET /challenges/group-stats: en rad per gruppmedlem. */
export interface GroupStat {
  user_id: string;
  name: string;
  wins: number;
  draws: number;
  losses: number;
  total: number;
  points: number;
  challenge_active: boolean;
  has_pending_challenge: boolean;
  current_level: number;
  profile_picture: string | null;
}

/** GET /challenges/:id/progress — [utmanare, motståndare]. */
export type ProgressByChallenge = Record<string, Array<{ user_id: string; value: number }>>;

const UNKNOWN = 'Unknown';

export function nameMap(stats: readonly GroupStat[]): Record<string, string> {
  return Object.fromEntries(stats.map((stat) => [stat.user_id, stat.name]));
}

const challengerName = (c: Challenge, names: Record<string, string>) => names[c.challenger_id] ?? c.challenger_name ?? UNKNOWN;
const opponentName = (c: Challenge, names: Record<string, string>) => names[c.opponent_id] ?? c.opponent_name ?? UNKNOWN;

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

// ─── Live now ─────────────────────────────────────────────────────────────────

export type SideTone = 'mine' | 'lead' | 'trail';

export interface LiveSide {
  userId: string;
  name: string;
  shortName: string;
  value: string;
  unit: string;
  tone: SideTone;
}

export interface LiveCard {
  id: string;
  tier: ChallengeTier;
  tierLabel: string;
  metric: string;
  duration: string;
  mine: boolean;
  /** "9 d left" · "ends tomorrow" · "starts in 14 h" — null utan slutdatum. */
  time: TimeLeft | null;
  sides: [LiveSide, LiveSide];
  stake: Stake;
}

function liveSides(c: Challenge, progress: ProgressByChallenge[string] | undefined, meId: string, names: Record<string, string>): [LiveSide, LiveSide] {
  const valueOf = (userId: string) => progress?.find((entry) => entry.user_id === userId)?.value;
  const draft = [
    { userId: c.challenger_id, name: challengerName(c, names) },
    { userId: c.opponent_id, name: opponentName(c, names) },
  ].map((party) => ({ ...party, raw: valueOf(party.userId) }));

  // Ledaren till vänster (designens ordning); lika → utmanaren först. Saknad framdrift sorteras sist.
  const ordered = [...draft].sort((a, b) => (b.raw ?? -1) - (a.raw ?? -1));
  const side = (party: (typeof draft)[number], index: number): LiveSide => ({
    userId: party.userId,
    name: party.name,
    shortName: firstName(party.name),
    value: formatMetricValue(c.metric, party.raw ?? null),
    unit: metricUnit(c.metric),
    tone: party.userId === meId ? 'mine' : index === 0 ? 'lead' : 'trail',
  });
  return [side(ordered[0], 0), side(ordered[1], 1)];
}

export function buildLiveCards(
  active: readonly Challenge[],
  progress: ProgressByChallenge,
  meId: string,
  names: Record<string, string>,
  now: Date,
): LiveCard[] {
  const cards = active.map((c): LiveCard => {
    const starts = startsInText(c.start_date, now);
    return {
      id: c.id,
      tier: c.tier,
      tierLabel: tierLabel(c.tier),
      metric: metricLabel(c.metric),
      duration: durationText(c.duration_days),
      mine: c.challenger_id === meId || c.opponent_id === meId,
      time: starts ? { text: starts, tone: 'neutral' } : timeLeft(c.end_date, now),
      sides: liveSides(c, progress[c.id], meId, names),
      stake: stakeOf(c),
    };
  });
  const endOf = (card: LiveCard) => active.find((c) => c.id === card.id)?.end_date ?? '';
  // Min duell först, sedan det som slutar snart.
  return cards.sort((a, b) => Number(b.mine) - Number(a.mine) || endOf(a).localeCompare(endOf(b)));
}

// ─── Inkommande och skickad ───────────────────────────────────────────────────

export interface IncomingCard {
  id: string;
  fromId: string;
  from: string;
  tier: ChallengeTier;
  tierLabel: string;
  /** "Nicklas · Most km · 7 d" */
  headline: string;
  stake: Stake;
  /** Legendary kan inte avböjas (backend: 400). */
  canDecline: boolean;
  note: string | null;
}

const LEGENDARY_AUTO_START_MS = 4 * 86_400_000;
const MS_HOUR = 3_600_000;
const HOURS_PER_DAY = 24;

/** "Auto-starts in 2 d 5 h" — legendary startar av sig själv fyra dagar efter att den skickats (challengeScheduler). */
export function autoStartText(sentAt: string | undefined, now: Date): string | null {
  if (!sentAt) return null;
  const left = new Date(sentAt).getTime() + LEGENDARY_AUTO_START_MS - now.getTime();
  if (left <= 0) return 'Auto-starts soon';
  const hours = Math.floor(left / MS_HOUR);
  return `Auto-starts in ${Math.floor(hours / HOURS_PER_DAY)} d ${hours % HOURS_PER_DAY} h`;
}

export function buildIncoming(received: readonly Challenge[], names: Record<string, string>, now: Date): IncomingCard[] {
  return received.map((c) => {
    const from = challengerName(c, names);
    return {
      id: c.id,
      fromId: c.challenger_id,
      from,
      tier: c.tier,
      tierLabel: tierLabel(c.tier),
      headline: `${firstName(from)} · ${metricLabel(c.metric)} · ${durationText(c.duration_days)}`,
      stake: stakeOf(c),
      canDecline: c.tier !== 'legendary',
      note: c.tier === 'legendary' ? autoStartText(c.legendary_sent_at, now) : null,
    };
  });
}

export interface SentCard {
  id: string;
  toId: string;
  to: string;
  tier: ChallengeTier;
  tierLabel: string;
  headline: string;
  stake: Stake;
  /** Legendary kan inte dras tillbaka (backend: 400). */
  canWithdraw: boolean;
  note: string;
}

export function buildSent(sent: Challenge | null, names: Record<string, string>): SentCard | null {
  if (!sent) return null;
  const to = opponentName(sent, names);
  return {
    id: sent.id,
    toId: sent.opponent_id,
    to,
    tier: sent.tier,
    tierLabel: tierLabel(sent.tier),
    headline: `${firstName(to)} · ${metricLabel(sent.metric)} · ${durationText(sent.duration_days)}`,
    stake: stakeOf(sent),
    canWithdraw: sent.tier !== 'legendary',
    note: `Waiting for ${firstName(to)} to respond`,
  };
}

// ─── Tokens ───────────────────────────────────────────────────────────────────

export interface TokenCombo {
  key: string;
  tier: ChallengeTier;
  metric: ChallengeMetric;
  metricLabel: string;
  durationDays: number;
  durationLabel: string;
  count: number;
  /** Ett token ur gruppen — det som skickas. */
  tokenId: string;
  stake: Stake;
}

export interface TierGroup {
  tier: ChallengeTier;
  label: string;
  count: number;
  stake: Stake;
  combos: TokenCombo[];
}

const METRIC_ORDER: readonly ChallengeMetric[] = ['km', 'runs', 'total_xp'];

/**
 * Osända tokens per nivå (minor → legendary, designens ordning). Ett token fixerar mått och längd, så tokens med samma
 * nivå/mått/längd slås ihop till en rad med antal; send-sheeten väljer bland raderna.
 */
export function buildTokenGroups(tokens: MyChallenges['tokens']): TierGroup[] {
  return TIERS.flatMap((tier): TierGroup[] => {
    const own = tokens.filter((token) => token.tier === tier);
    if (own.length === 0) return [];

    const combos = new Map<string, TokenCombo>();
    for (const token of own) {
      const key = `${tier}|${token.metric}|${token.duration_days}`;
      const existing = combos.get(key);
      if (existing) existing.count += 1;
      else {
        combos.set(key, {
          key, tier, metric: token.metric, metricLabel: metricLabel(token.metric), durationDays: token.duration_days,
          durationLabel: durationLongText(token.duration_days), count: 1, tokenId: token.id, stake: stakeOf(token),
        });
      }
    }
    const sorted = [...combos.values()].sort(
      (a, b) => METRIC_ORDER.indexOf(a.metric) - METRIC_ORDER.indexOf(b.metric) || a.durationDays - b.durationDays,
    );
    return [{ tier, label: tierLabel(tier), count: own.length, stake: sorted[0].stake, combos: sorted }];
  });
}

export const tokenTotal = (groups: readonly TierGroup[]): number => groups.reduce((sum, group) => sum + group.count, 0);

// ─── Standings ────────────────────────────────────────────────────────────────

export interface StandingRow {
  userId: string;
  rank: number;
  name: string;
  wins: number;
  draws: number;
  losses: number;
  /** "0.667" eller "—" utan avgjorda matcher. */
  pct: string;
  played: number;
  mine: boolean;
}

const points = (stat: Pick<GroupStat, 'wins' | 'draws' | 'losses'>): number | null => {
  const total = stat.wins + stat.draws + stat.losses;
  return total === 0 ? null : (stat.wins + stat.draws * 0.5) / total;
};

/** Poäng (vinst 1, oavgjort ½) per spelad match; ospelade sist. Lika poäng → flest vinster → namn. */
export function buildStandings(stats: readonly GroupStat[], meId: string): StandingRow[] {
  const sorted = [...stats].sort(
    (a, b) => (points(b) ?? -1) - (points(a) ?? -1) || b.wins - a.wins || a.name.localeCompare(b.name),
  );
  return sorted.map((stat, index) => {
    const pts = points(stat);
    return {
      userId: stat.user_id,
      rank: index + 1,
      name: stat.name,
      wins: stat.wins,
      draws: stat.draws,
      losses: stat.losses,
      pct: pts === null ? '—' : pts.toFixed(3),
      played: stat.wins + stat.draws + stat.losses,
      mine: stat.user_id === meId,
    };
  });
}

// ─── Match history ────────────────────────────────────────────────────────────

export type ResultTone = 'up' | 'down' | 'muted';

export interface HistorySide {
  userId: string;
  name: string;
  score: string;
  result: 'Win' | 'Loss' | 'Draw';
  tone: ResultTone;
  mine: boolean;
  /** Vinnaren (och båda vid oavgjort) står med starkare text. */
  emphasis: boolean;
}

export interface HistoryRow {
  id: string;
  left: HistorySide;
  right: HistorySide;
  /** "Major · Most runs" */
  what: string;
  /** "5 d" */
  days: string;
  /** Vinnarens boost, eller "No change" vid oavgjort. */
  reward: string;
  date: string | null;
  mine: boolean;
}

export function buildHistoryRows(items: readonly ChallengeHistoryItem[], meId: string, mineOnly: boolean): HistoryRow[] {
  const rows = items.map((item): HistoryRow => {
    const draw = item.outcome === 'draw';
    const challengerWon = item.outcome === 'challenger_wins';
    const side = (party: ChallengeHistoryItem['challenger'], value: number | null, won: boolean): HistorySide => ({
      userId: party.id,
      name: party.name,
      score: formatMetricValue(item.metric, value),
      result: draw ? 'Draw' : won ? 'Win' : 'Loss',
      tone: draw ? 'muted' : won ? 'up' : 'down',
      mine: party.id === meId,
      emphasis: draw || won,
    });
    return {
      id: item.id,
      left: side(item.challenger, item.challenger_value, challengerWon),
      right: side(item.opponent, item.opponent_value, !challengerWon),
      what: `${tierLabel(item.tier)} · ${metricLabel(item.metric)}`,
      days: durationText(item.duration_days),
      reward: draw
        ? 'No change'
        : stakeOf({
            winner_delta: item.winner_boost.delta,
            winner_duration: item.winner_boost.duration ?? 0,
            winner_type: item.winner_boost.type,
            loser_delta: item.loser_boost.delta,
            loser_duration: item.loser_boost.duration ?? 0,
            loser_type: item.loser_boost.type,
          }).win,
      date: formatDayMonth(item.ended_at),
      mine: item.challenger.id === meId || item.opponent.id === meId,
    };
  });
  return mineOnly ? rows.filter((row) => row.mine) : rows;
}

// ─── Boosts ───────────────────────────────────────────────────────────────────

export interface BoostView {
  id: string;
  positive: boolean;
  /** "+0.2× for 4 days" */
  headline: string;
  /** "Won against Adam · most runs · 5 d" när utmaningen finns i min historik. */
  detail: string | null;
}

const MS_DAY = 86_400_000;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Aktiva boosts. `runs` (mina) behövs bara för boosts per runda: laddningarna är totala och förbrukas av rundor efter skapandet. */
export function buildBoosts(
  boosts: readonly UserBoost[],
  history: readonly Challenge[],
  meId: string,
  names: Record<string, string>,
  now: Date,
  runs?: ReadonlyArray<Pick<Run, 'date'>>,
): BoostView[] {
  return boosts.flatMap((boost): BoostView[] => {
    const sign = boost.delta < 0 ? '−' : '+';
    const amount = `${sign}${Number(Math.abs(boost.delta).toFixed(2))}×`;

    let window = '';
    if (boost.type === 'multiplier_runs') {
      const charges = boost.remaining ?? 0;
      const startedOn = stockholmClock(new Date(boost.created_at)).date;
      const used = runs ? runs.filter((run) => run.date >= startedOn).length : 0;
      const left = charges - used;
      if (left <= 0) return [];
      window = ` for ${plural(left, 'run')}`;
    } else if (boost.expires_at) {
      const left = Math.ceil((new Date(boost.expires_at).getTime() - now.getTime()) / MS_DAY);
      if (left <= 0) return [];
      window = ` for ${plural(left, 'day')}`;
    }

    const source = history.find((c) => c.id === boost.challenge_id);
    let detail: string | null = null;
    if (source) {
      const otherId = source.challenger_id === meId ? source.opponent_id : source.challenger_id;
      const other = names[otherId] ?? (source.challenger_id === meId ? source.opponent_name : source.challenger_name) ?? UNKNOWN;
      detail = `${boost.outcome === 'winner' ? 'Won against' : 'Lost to'} ${firstName(other)} · ${lowerFirst(metricLabel(source.metric))} · ${durationText(source.duration_days)}`;
    }
    return [{ id: boost.id, positive: boost.delta >= 0, headline: `${amount}${window}`, detail }];
  });
}

// ─── Min rekord ───────────────────────────────────────────────────────────────

export interface RecordCell {
  key: 'won' | 'drawn' | 'lost' | 'rate';
  value: string;
  label: string;
  tone: 'up' | 'down' | 'muted' | 'gold';
}

export function buildRecord(stat: Pick<GroupStat, 'wins' | 'draws' | 'losses'> | undefined): RecordCell[] {
  const wins = stat?.wins ?? 0;
  const draws = stat?.draws ?? 0;
  const losses = stat?.losses ?? 0;
  const total = wins + draws + losses;
  return [
    { key: 'won', value: String(wins), label: 'won', tone: 'up' },
    { key: 'drawn', value: String(draws), label: 'drawn', tone: 'muted' },
    { key: 'lost', value: String(losses), label: 'lost', tone: 'down' },
    { key: 'rate', value: total === 0 ? '—' : `${Math.round((wins / total) * 100)}%`, label: 'win rate', tone: 'gold' },
  ];
}

// ─── Rubrikrad och primärhandling ─────────────────────────────────────────────

export interface DuelsCounts {
  live: number;
  waitingOnMe: number;
  tokens: number;
}

/** Mobil: "3 live · 5 tokens". Desktop: "3 live · 1 waiting on you · 5 tokens unspent". */
export function summaryText(counts: DuelsCounts, desktop: boolean): string {
  const parts = [`${counts.live} live`];
  if (desktop && counts.waitingOnMe > 0) parts.push(`${counts.waitingOnMe} waiting on you`);
  parts.push(`${plural(counts.tokens, 'token')}${desktop ? ' unspent' : ''}`);
  return parts.join(' · ');
}

