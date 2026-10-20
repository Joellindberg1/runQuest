import { MS_DAY, MS_HOUR, MS_MINUTE, addDays, stockholmClock, stockholmWallClockToInstant, streakStatus } from '@runquest/shared';
import { paths } from '@/paths';
import type { RQIconName } from '@/shared/components/icons';

// "Right now": det som tickar just nu (streak-deadline, event, duell, Strava-sync).
// Ren logik — datahämtningen ligger i useRightNow, så allt här går att testa med en fast `now`.

export type RightNowTone = 'down' | 'gold' | 'duel' | 'up';
export type RightNowKind = 'streak' | 'event' | 'duel' | 'strava';

export interface RightNowItem {
  id: string;
  kind: RightNowKind;
  label: string;
  note: string;
  value: string;
  tone: RightNowTone;
  icon: RQIconName;
  to: string;
  tourAnchor?: string;
}

export interface ShellEvent {
  id: string;
  kind: 'participation' | 'competition';
  name: string;
  status: 'active' | 'scheduled';
  startsAt: string;
  endsAt: string;
  rewardXp: number;
  done: boolean;
  rank: number | null;
  /** Jag har en entry i eventet (tävling: jag är med i tabellen). Samma regel som Events-skärmen. */
  entered: boolean;
}

export interface ShellDuel {
  id: string;
  opponentName: string;
  metric: 'km' | 'runs' | 'total_xp';
  startDate?: string | null;
  endDate?: string | null;
}

export interface RightNowInput {
  now: Date;
  streak: { current: number; lastRunDate: string | null } | null;
  events: ShellEvent[];
  duel: ShellDuel | null;
  strava: { connected: boolean } | null;
}


const METRIC_LABELS: Record<ShellDuel['metric'], string> = {
  km: 'Most km',
  runs: 'Most runs',
  total_xp: 'Most XP',
};

/** "28 m", "6h", "3 d" — grov enhet räcker, raden uppdateras varje minut. */
export function formatRemaining(ms: number): string {
  if (ms < MS_MINUTE) return '<1 m';
  if (ms < MS_HOUR) return `${Math.floor(ms / MS_MINUTE)} m`;
  if (ms < MS_DAY) return `${Math.floor(ms / MS_HOUR)}h`;
  return `${Math.floor(ms / MS_DAY)} d`;
}

/**
 * Tid kvar tills streaken bryts (Stockholm-dagar, som backend). Senaste rundan idag → deadline
 * är slutet på morgondagen; igår → slutet på idag; äldre → streaken är redan bruten (null).
 */
export function streakDeadline(
  lastRunDate: string | null,
  now: Date,
): { msLeft: number; ranToday: boolean } | null {
  if (!lastRunDate) return null;
  const clock = stockholmClock(now);
  const msLeftToday = MS_DAY - clock.msIntoDay;
  const status = streakStatus(lastRunDate.slice(0, 10), clock.date);
  if (status === 'ran_today') return { msLeft: msLeftToday + MS_DAY, ranToday: true };
  if (status === 'ran_yesterday') return { msLeft: msLeftToday, ranToday: false };
  return null;
}

function streakItem(input: RightNowInput): RightNowItem | null {
  const { streak, now } = input;
  if (!streak || streak.current <= 0) return null;
  const deadline = streakDeadline(streak.lastRunDate, now);
  if (!deadline) return null;
  return {
    id: 'streak',
    kind: 'streak',
    label: 'Streak',
    note: `${streak.current}-day streak`,
    value: `${formatRemaining(deadline.msLeft)} left`,
    tone: deadline.ranToday ? 'up' : 'down',
    icon: 'flame',
    to: paths.log,
  };
}

function eventItems(input: RightNowInput): RightNowItem[] {
  const nowMs = input.now.getTime();
  return input.events
    .map((event) => {
      const startsMs = new Date(event.startsAt).getTime();
      const endsMs = new Date(event.endsAt).getTime();
      const scheduled = event.status === 'scheduled';
      const sortKey = scheduled ? startsMs : endsMs;
      const value = event.done
        ? 'Done'
        : scheduled
          ? `in ${formatRemaining(Math.max(0, startsMs - nowMs))}`
          : endsMs <= nowMs
            ? 'Settling' // tävling efter slutdatum, väntar på söndagens avräkning (som Events-skärmen)
            : formatRemaining(endsMs - nowMs);
      const note = event.kind === 'participation'
        ? (event.done ? 'Completed' : `+${event.rewardXp} XP`)
        : (event.rank ? `#${event.rank} in the pack` : event.entered ? 'Weekly competition' : 'Not entered');
      const item: RightNowItem = {
        id: `event-${event.id}`,
        kind: 'event',
        label: event.name,
        note,
        value,
        tone: event.done ? 'up' : 'gold',
        icon: 'calendar',
        to: paths.events,
      };
      return { item, sortKey, scheduled };
    })
    .sort((a, b) => Number(a.scheduled) - Number(b.scheduled) || a.sortKey - b.sortKey)
    .map(({ item }) => item);
}

/**
 * Ögonblicket då duellens kalenderdag `day` börjar, 00:00 i gruppens tid (Stockholm). Inte `new Date(`${day}T00:00:00`)`: det är
 * webbläsarens midnatt. NaN för ogiltigt datum.
 */
function groupDayStartMs(day: string, plusDays = 0): number {
  try {
    return stockholmWallClockToInstant(addDays(day, plusDays), 0).getTime();
  } catch {
    return NaN;
  }
}

function duelItem(input: RightNowInput): RightNowItem | null {
  const { duel, now } = input;
  if (!duel || !duel.endDate) return null;
  const nowMs = now.getTime();
  const startMs = duel.startDate ? groupDayStartMs(duel.startDate) : null;
  // Fönstret slutar när slutdagen är över: 00:00 dagen efter, som kalenderdag (inte +24 h, dygnet kan vara 23 eller 25 h).
  const endMs = groupDayStartMs(duel.endDate, 1);
  if (Number.isNaN(endMs)) return null;
  const pending = startMs !== null && startMs > nowMs;
  return {
    id: `duel-${duel.id}`,
    kind: 'duel',
    label: METRIC_LABELS[duel.metric],
    note: `vs ${duel.opponentName}`,
    value: pending ? `in ${formatRemaining(startMs - nowMs)}` : formatRemaining(Math.max(0, endMs - nowMs)),
    tone: 'duel',
    icon: 'swords',
    to: paths.duels,
  };
}

function stravaItem(input: RightNowInput): RightNowItem | null {
  const { strava } = input;
  if (!strava) return null;
  if (!strava.connected) {
    // Ej kopplat: en väg in för nya användare, och ankare för tour-steget.
    return {
      id: 'strava', kind: 'strava', label: 'Strava', note: 'Not connected', value: 'Connect',
      tone: 'up', icon: 'sync', to: paths.settings, tourAnchor: 'right-now-strava',
    };
  }
  // Kopplad: ingen pill. Nästa reservkontroll säger inget om när rundor kommer (de kommer via webhooks).
  return null;
}

/** Brådskande först: streak → event → duell → Strava. Saknas data för en typ visas den inte. */
export function buildRightNow(input: RightNowInput): RightNowItem[] {
  return [streakItem(input), ...eventItems(input), duelItem(input), stravaItem(input)].filter(
    (item): item is RightNowItem => item !== null,
  );
}
