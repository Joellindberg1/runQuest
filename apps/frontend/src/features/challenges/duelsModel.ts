import type { Challenge, Run } from '@runquest/types';
import { firstName } from '@/shared/utils/format';
import {
  LEGENDARY_AUTO_START_DAYS, MS_DAY, MS_HOUR, STOCKHOLM_TZ, boostRemaining, boostWindow, compareChallengeStandings, type BoostRow,
  type ChallengeGroupStat, type ChallengeHistoryItem, type ChallengeMetric, type ChallengeStanding, type ChallengeTier, type MyBoost, type MyChallengesData,
} from '@runquest/shared';
import {
  TIERS, durationLongText, durationText, formatDayMonth, formatMetricValue, metricLabel, metricUnit,
  startsInText, stakeOf, tierLabel, timeLeft, type Stake, type TimeLeft,
} from './duelsFormat';

// Duels-skärmens vymodeller: live-kort, inkommande, tokens, standings, historik, boosts, send-sheetens val.
// Ren logik — ingen DOM, ingen datahämtning. `now` skickas alltid in så att tiderna går att testa.

// ─── Delvyer ──────────────────────────────────────────────────────────────────

export type DuelsView = 'standings' | 'live' | 'rules' | 'history';
export const DUELS_VIEWS: readonly DuelsView[] = ['standings', 'live', 'rules', 'history'];
export const DEFAULT_DUELS_VIEW: DuelsView = 'live';

// ─── Indata ───────────────────────────────────────────────────────────────────
// Formerna backend svarar med (GET /challenges/my och /group-stats) är MyChallengesData och ChallengeGroupStat i @runquest/shared.

/** GET /challenges/:id/progress — [utmanare, motståndare]. */
export type ProgressByChallenge = Record<string, Array<{ user_id: string; value: number }>>;

const UNKNOWN = 'Unknown';

export function nameMap(stats: readonly ChallengeGroupStat[]): Record<string, string> {
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
  fromShort: string;
  tier: ChallengeTier;
  tierLabel: string;
  /** "Most km · 7 d" */
  what: string;
  stake: Stake;
  /** Legendary kan inte avböjas (backend: 400). */
  canDecline: boolean;
  note: string | null;
}

const LEGENDARY_AUTO_START_MS = LEGENDARY_AUTO_START_DAYS * MS_DAY;
const HOURS_PER_DAY = 24;

/** "Auto-starts in 2 d 5 h" — legendary startar av sig själv fyra dagar efter att den skickats (challengeScheduler). */
export function autoStartText(sentAt: string | null | undefined, now: Date): string | null {
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
      fromShort: firstName(from),
      tier: c.tier,
      tierLabel: tierLabel(c.tier),
      what: `${metricLabel(c.metric)} · ${durationText(c.duration_days)}`,
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
  toShort: string;
  tier: ChallengeTier;
  tierLabel: string;
  what: string;
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
    toShort: firstName(to),
    tier: sent.tier,
    tierLabel: tierLabel(sent.tier),
    what: `${metricLabel(sent.metric)} · ${durationText(sent.duration_days)}`,
    stake: stakeOf(sent),
    canWithdraw: sent.tier !== 'legendary',
    note: `Waiting for ${firstName(to)} to respond`,
  };
}

// ─── Tokens ───────────────────────────────────────────────────────────────────

/** Ett kort per token: tokenets eget mått, längd och insats. Identiska tokens är separata kort. */
export interface TokenCard {
  /** Tokenets id — det som skickas, och nyckeln för förvalet. */
  tokenKey: string;
  tier: ChallengeTier;
  metric: ChallengeMetric;
  /** "Most km" */
  metricLabel: string;
  durationDays: number;
  /** "7 days" */
  durationLabel: string;
  /** "Runs for 7 days" */
  lengthText: string;
  stake: Stake;
}

/** Alltid en grupp per nivå. `empty` = inga tokens; en tom nivå går inte att välja (`selectable: false`). */
export interface TierGroup {
  tier: ChallengeTier;
  label: string;
  count: number;
  empty: boolean;
  selectable: boolean;
  cards: TokenCard[];
}

const METRIC_ORDER: readonly ChallengeMetric[] = ['km', 'runs', 'total_xp'];

const toCard = (token: MyChallengesData['tokens'][number]): TokenCard => ({
  tokenKey: token.id,
  tier: token.tier,
  metric: token.metric,
  metricLabel: metricLabel(token.metric),
  durationDays: token.duration_days,
  durationLabel: durationLongText(token.duration_days),
  lengthText: `Runs for ${durationLongText(token.duration_days)}`,
  stake: stakeOf(token),
});

/**
 * Osända tokens per nivå (minor → major → legendary, alltid alla tre). Ett token fixerar mått, längd och insats, så varje
 * token blir ett eget kort — inga sammanslagningar med antal. Korten ordnas på mått, sedan längd (stabilt: lika tokens
 * behåller sin inbördes ordning).
 */
export function buildTokenGroups(tokens: MyChallengesData['tokens']): TierGroup[] {
  return TIERS.map((tier): TierGroup => {
    const cards = tokens
      .filter((token) => token.tier === tier)
      .map(toCard)
      .sort((a, b) => METRIC_ORDER.indexOf(a.metric) - METRIC_ORDER.indexOf(b.metric) || a.durationDays - b.durationDays);
    return {
      tier,
      label: tierLabel(tier),
      count: cards.length,
      empty: cards.length === 0,
      selectable: cards.length > 0,
      cards,
    };
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

const points = (stat: Pick<ChallengeGroupStat, 'wins' | 'draws' | 'losses'>): number | null => {
  const total = stat.wins + stat.draws + stat.losses;
  return total === 0 ? null : (stat.wins + stat.draws * 0.5) / total;
};

const toStanding = (stat: ChallengeGroupStat): ChallengeStanding => ({
  id: stat.user_id, name: stat.name, wins: stat.wins, draws: stat.draws, losses: stat.losses,
});

/**
 * Ordningen är den delade komparatorn `compareChallengeStandings` — samma som GET /challenges/group-stats och nyhetens rank_passed
 * (ADR 011 beslut 6), så tabellen och nyhetens rang aldrig skiljer sig åt. Spelade före ospelade, oavrundade poäng (vinst 1, oavgjort ½),
 * flest vinster, sedan namn utan locale och id. Ingen localeCompare här: den ger olika ordning per webbläsarspråk.
 * `pct` är bara visning (avrundad) och påverkar aldrig ordningen.
 */
export function buildStandings(stats: readonly ChallengeGroupStat[], meId: string): StandingRow[] {
  const sorted = [...stats].sort((a, b) => compareChallengeStandings(toStanding(a), toStanding(b)));
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

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Boostens rad i den form shared/boostWindow läser: det sparade fönstret, eller för en rad utan det created_at/expires_at. */
const boostRow = (boost: MyBoost): BoostRow => ({
  type: boost.type,
  created_at: boost.created_at,
  expires_at: boost.expires_at ?? null,
  start_date: boost.start_date ?? null,
  end_date: boost.end_date ?? null,
});

/** Aktiva boosts. `runs` (mina) behövs bara för boosts per runda: laddningarna är totala och förbrukas av rundor efter skapandet. */
export function buildBoosts(
  boosts: readonly MyBoost[],
  history: readonly Challenge[],
  meId: string,
  names: Record<string, string>,
  now: Date,
  runs?: ReadonlyArray<Pick<Run, 'date'>>,
  timeZone: string = STOCKHOLM_TZ,
): BoostView[] {
  return boosts.flatMap((boost): BoostView[] => {
    const sign = boost.delta < 0 ? '−' : '+';
    const amount = `${sign}${Number(Math.abs(boost.delta).toFixed(2))}×`;

    let window = '';
    if (boost.type === 'multiplier_runs') {
      const charges = boost.remaining ?? 0;
      // Samma startdag som XP-beräkningen: boostens sparade fönster (shared/boostWindow).
      const { startDay: startedOn } = boostWindow(boostRow(boost));
      const used = runs ? runs.filter((run) => run.date >= startedOn).length : 0;
      const left = charges - used;
      if (left <= 0) return [];
      window = ` for ${plural(left, 'run')}`;
    } else if (boost.expires_at || boost.end_date) {
      // Dagar kvar ur det sparade fönstret, idag i gruppens zon: en ny 3-dagarsboost visar 3 före och på sin startdag.
      const left = boostRemaining({ ...boostRow(boost), type: 'multiplier_days' }, now, timeZone) ?? 0;
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

export function buildRecord(stat: Pick<ChallengeGroupStat, 'wins' | 'draws' | 'losses'> | undefined): RecordCell[] {
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

