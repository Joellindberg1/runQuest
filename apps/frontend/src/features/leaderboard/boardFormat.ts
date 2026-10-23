import type { Run } from '@runquest/types';
import { MS_DAY, daysBetween, stockholmClock, wallClockToInstantMs } from '@runquest/shared';
import { formatAgo } from '@/shared/utils/format';

// Rena formatterare för Board. `now` skickas alltid in så att tiderna går att testa med fasta klockslag.

/**
 * Exakt tidpunkt (epoch-ms) för en runda, om den går att lita på: Strava-rundans `start_time`, eller
 * `created_at` när raden skapades samma Stockholm-dag som rundan (manuell loggning). En runda som
 * loggats i efterhand får inte ge "5 h ago" — då faller vi tillbaka på kalenderdagen.
 *
 * `start_time` är löparens lokala väggklocka med falskt 'Z' (Stravas start_date_local), inte ett UTC-ögonblick;
 * ögonblicket fås via wallClockToInstantMs som antar Europe/Stockholm. En runda gjord utomlands får därför en
 * ålder som är fel med tidszonsskillnaden — avsiktlig förenkling, appens löpare bor i Sverige.
 * `created_at` är ett riktigt ögonblick (timestamptz) och används som det är.
 */
export function preciseRunTime(run: Pick<Run, 'date' | 'start_time' | 'created_at'>): number | null {
  const startMs = run.start_time ? wallClockToInstantMs(run.start_time) : NaN;
  if (!Number.isNaN(startMs)) return startMs;

  const createdMs = run.created_at ? new Date(run.created_at).getTime() : NaN;
  if (!Number.isNaN(createdMs) && stockholmClock(new Date(createdMs)).date === run.date.slice(0, 10)) return createdMs;
  return null;
}

/**
 * Senaste rundan: senast `date`, och samma dag den med senast exakt tidpunkt (numerisk jämförelse via
 * preciseRunTime — blandade tidsformat sorterar fel som strängar). Lika → den första.
 */
export function latestRunOf<T extends Pick<Run, 'date' | 'start_time' | 'created_at'>>(runs: T[] | undefined): T | null {
  if (!runs || runs.length === 0) return null;
  const key = (run: T): [string, number] => [run.date.slice(0, 10), preciseRunTime(run) ?? Number.NEGATIVE_INFINITY];
  return runs.reduce((best, run) => {
    const [bestDate, bestTime] = key(best);
    const [date, time] = key(run);
    if (date !== bestDate) return date > bestDate ? run : best;
    return time > bestTime ? run : best;
  });
}

/** "5 h ago", "4 d ago", "today" (kalenderdag utan klockslag), "just now". */
export function formatRunAge(run: Pick<Run, 'date' | 'start_time' | 'created_at'>, now: Date): string {
  const precise = preciseRunTime(run);
  if (precise !== null) {
    const age = now.getTime() - precise;
    if (age < MS_DAY) return formatAgo(age, 'compact');
  }
  const days = daysBetween(run.date.slice(0, 10), stockholmClock(now).date);
  if (days <= 0) return 'today';
  return formatAgo(days * MS_DAY, 'compact');
}

export type DeltaDirection = 'up' | 'down' | 'flat';

export interface DeltaView {
  direction: DeltaDirection;
  /** Antal placeringar (alltid >= 0). */
  places: number;
  /** "▲ 2", "▼ 1" eller "—". */
  text: string;
}

/** Rank-förändring (positivt = klättrat, som i ADR 007) → pil. null/0 = ingen förändring. */
export function deltaView(delta: number | null | undefined): DeltaView {
  if (!delta) return { direction: 'flat', places: 0, text: '—' };
  return delta > 0
    ? { direction: 'up', places: delta, text: `▲ ${delta}` }
    : { direction: 'down', places: Math.abs(delta), text: `▼ ${Math.abs(delta)}` };
}

/** Skärmläsartext för en delta-pil. */
export function deltaLabel(delta: DeltaView): string {
  if (delta.direction === 'flat') return 'No change';
  const word = delta.direction === 'up' ? 'Up' : 'Down';
  return `${word} ${delta.places} ${delta.places === 1 ? 'place' : 'places'}`;
}
