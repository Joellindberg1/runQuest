import type { User } from '@runquest/types';
import { calculateCompleteRunXP, MAX_LEVEL, type AdminSettings, type StreakMultiplier } from '@runquest/shared';
import { nextCheckpointInfo } from '@/features/profile/frodoModel';
import { leaderboardUtils } from '@/shared/utils/leaderboardUtils';
import { MIN_RUN_DISTANCE_KM } from '@/constants/appConstants';
import { formatInt, formatKm, formatTimes } from './logFormat';
import { streakOutlook, validateDate, type StreakOutlook } from './logModel';

// Estimated XP och "What this run does": shared-formeln (`calculateCompleteRunXP`, ADR 004) över XP-konfigen från
// GET /config/xp, plus effekterna rundan får på streak, nivå, Frodos resa och rankingen. Ren logik — ingen DOM.
// Förhandsvisningen räknar inte med aktiva utmaningsboostar: servern lägger på dem när rundan sparas.

export type Tone = 'default' | 'gold' | 'up' | 'down' | 'muted';

/** Det förhandsvisningen behöver av XP-konfigen (en delmängd av `XpConfigResponse`). */
export interface XpRules {
  settings: AdminSettings;
  streak_multipliers: StreakMultiplier[];
}

export interface BreakdownRow {
  key: 'base' | 'distance' | 'bonus' | 'streak';
  label: string;
  value: string;
  tone: Tone;
}

export interface EffectRow {
  key: 'hint' | 'streak' | 'level' | 'journey' | 'board';
  label: string;
  value: string;
  tone: Tone;
}

export interface XpPreview {
  /** false tills distansen är giltig — då visas "—" och en uppmaning i stället för siffror. */
  ready: boolean;
  /** "~44" eller "—". */
  total: string;
  totalXp: number | null;
  rows: BreakdownRow[];
  effects: EffectRow[];
}

export interface PreviewInput {
  /** Parsad distans; null medan fältet är tomt eller inte ett tal. */
  km: number | null;
  /** Rundans datum (YYYY-MM-DD). Ett ogiltigt datum räknas som idag, felet visas i formuläret. */
  date: string;
  today: string;
  me: User;
  /** Hela gruppen (inkl. mig) ur users-with-runs. */
  users: User[];
  rules: XpRules;
}

const DASH = '—';
const firstName = (name: string): string => name.split(' ')[0] ?? name;

function breakdownRows(input: PreviewInput, outlook: StreakOutlook): { rows: BreakdownRow[]; totalXp: number | null } {
  const { km, rules } = input;
  const streakLabel = `Streak · day ${outlook.day}`;

  if (km === null || km < MIN_RUN_DISTANCE_KM) {
    return {
      totalXp: null,
      rows: [
        { key: 'base', label: 'Base', value: String(rules.settings.base_xp), tone: 'muted' },
        { key: 'distance', label: 'Distance', value: DASH, tone: 'muted' },
        { key: 'bonus', label: 'Distance bonus', value: DASH, tone: 'muted' },
        { key: 'streak', label: streakLabel, value: DASH, tone: 'muted' },
      ],
    };
  }

  const xp = calculateCompleteRunXP(km, outlook.day, rules.settings, rules.streak_multipliers);
  return {
    totalXp: xp.finalXP,
    rows: [
      { key: 'base', label: 'Base', value: String(xp.baseXP), tone: 'default' },
      { key: 'distance', label: `Distance · ${formatKm(km)} km × ${rules.settings.xp_per_km}`, value: `+${xp.kmXP}`, tone: 'default' },
      { key: 'bonus', label: 'Distance bonus', value: xp.distanceBonus > 0 ? `+${xp.distanceBonus}` : '0', tone: xp.distanceBonus > 0 ? 'up' : 'muted' },
      { key: 'streak', label: streakLabel, value: formatTimes(xp.multiplier), tone: xp.multiplier > 1 ? 'gold' : 'muted' },
    ],
  };
}

function streakEffect(outlook: StreakOutlook, isToday: boolean): EffectRow {
  if (outlook.kind === 'continue') {
    return { key: 'streak', label: 'Streak', value: `${isToday ? 'Stays alive' : 'Continues'} · day ${outlook.day}`, tone: 'up' };
  }
  if (outlook.kind === 'counted') {
    return { key: 'streak', label: 'Streak', value: `Already counted · day ${outlook.day}`, tone: 'default' };
  }
  return { key: 'streak', label: 'Streak', value: 'New streak · day 1', tone: 'default' };
}

function levelEffect(me: User, estimated: number): EffectRow {
  const before = leaderboardUtils.calculateUserStats(me);
  if (before.level >= MAX_LEVEL) return { key: 'level', label: `Level ${before.level}`, value: 'Max level', tone: 'gold' };

  const after = leaderboardUtils.calculateUserStats({ ...me, total_xp: me.total_xp + estimated });
  if (after.level > before.level) return { key: 'level', label: `Level ${after.level}`, value: 'Level up', tone: 'gold' };
  return { key: 'level', label: `Level ${before.level + 1}`, value: `${formatInt(Math.max(0, before.xpLeftForNextLevel - estimated))} XP to go`, tone: 'default' };
}

function journeyEffect(me: User, km: number): EffectRow {
  const label = 'Frodo’s journey';
  const next = nextCheckpointInfo(me.total_km);
  if (!next) return { key: 'journey', label, value: 'Journey complete', tone: 'gold' };
  if (me.total_km + km >= next.km) return { key: 'journey', label, value: `Reaches ${next.name}`, tone: 'up' };
  return { key: 'journey', label, value: `+${formatKm(km)} km toward ${next.name}`, tone: 'default' };
}

/** Rankingen före/efter rundan med samma sortering som Board (nivå, sedan XP). Utan plats på tavlan → inget. */
function boardEffect(input: PreviewInput, estimated: number): EffectRow | null {
  const { me, users } = input;
  const before = leaderboardUtils.filterAndSortUsers(users);
  if (!before.some((user) => user.id === me.id)) return null;

  const projectedMe = { ...me, total_xp: me.total_xp + estimated };
  const after = leaderboardUtils.filterAndSortUsers(users.map((user) => (user.id === me.id ? projectedMe : user)));
  const rankBefore = leaderboardUtils.getUserPosition(me, before);
  const rankAfter = leaderboardUtils.getUserPosition(projectedMe, after);
  const label = 'Leaderboard';

  if (rankAfter < rankBefore) {
    const passed = before.slice(rankAfter - 1, rankBefore - 1).reverse();
    const extra = passed.length > 1 ? ` and ${passed.length - 1} more` : '';
    return { key: 'board', label, value: `Passes ${firstName(passed[0].name)}${extra}`, tone: 'up' };
  }
  if (rankBefore === 1) {
    const second = after[1];
    return {
      key: 'board',
      label,
      value: second ? `Holds 1st · leads by ${formatInt(projectedMe.total_xp - second.total_xp)} XP` : 'Holds 1st',
      tone: 'gold',
    };
  }
  const above = before[rankBefore - 2];
  const gap = above.total_xp - projectedMe.total_xp;
  return gap > 0
    ? { key: 'board', label, value: `Closes on ${firstName(above.name)} · ${formatInt(gap)} XP behind`, tone: 'up' }
    : { key: 'board', label, value: `Level with ${firstName(above.name)}`, tone: 'default' };
}

/** Allt "Estimated XP"-kortet och "What this run does" visar för formulärets nuvarande värden. */
export function buildXpPreview(input: PreviewInput): XpPreview {
  const date = validateDate(input.date, input.today) ? input.today : input.date;
  const outlook = streakOutlook(input.me.runs ?? [], date);
  const { rows, totalXp } = breakdownRows(input, outlook);

  if (totalXp === null || input.km === null) {
    return {
      ready: false,
      total: DASH,
      totalXp: null,
      rows,
      effects: [{ key: 'hint', label: 'Enter a distance', value: `min ${formatKm(MIN_RUN_DISTANCE_KM)} km`, tone: 'muted' }],
    };
  }

  const effects = [
    streakEffect(outlook, date === input.today),
    levelEffect(input.me, totalXp),
    journeyEffect(input.me, input.km),
    boardEffect(input, totalXp),
  ].filter((effect): effect is EffectRow => effect !== null);

  return { ready: true, total: `~${formatInt(totalXp)}`, totalXp, rows, effects };
}
