/**
 * Titelmåtten: hur ett mått kodas till `user_titles.value` (backend, titelmotorerna) och avkodas för visning (frontend).
 *
 * Titelvärdena sorteras alltid fallande (högre = bättre), så mått där lägre är bättre kodas om:
 *
 *  - tid (fastest5km, fastestHalfMarathon, fastestMarathon): referensminuter minus rörelsetiden i minuter, alltså
 *    snabbare tid ger högre värde. Referensen (60 / 360 / 720) är en tak-tid som ingen löpare överskrider.
 *    "Ingen kvalificerande runda" är sentinelvärdet -9999, långt under varje riktigt värde.
 *  - spridning (avgPaceStdDev): 10000 delat med pace-spridningen i s/km, så jämnare löpning ger högre
 *    värde. "Ingen runda" är 0.
 *  - lastRunOfWeek: väggklockan för den senaste söndagsrundan som epok-sekunder. start_time är löparens lokala väggklocka med ett
 *    falskt 'Z' (se calendar.ts), så ögonblicket ÄR väggklockan och dagen läses i UTC.
 *
 * Kodningen ändras inte utan en omräkning av alla titlar: lagrade värden i user_titles är kodade med exakt de här formlerna.
 * Båda sidor importerar härifrån, så en konstant kan inte ändras på ena sidan och bli tyst fel på den andra.
 */
import { dayOfWeek, mondayOf } from './calendar.js';

/** Titlar med kodat värde, i den ordning de dokumenteras ovan. */
export const ENCODED_TITLE_METRICS = [
  'fastest5km',
  'fastestHalfMarathon',
  'fastestMarathon',
  'avgPaceStdDev',
  'lastRunOfWeek',
] as const;

export type EncodedTitleMetric = (typeof ENCODED_TITLE_METRICS)[number];

type TimeMetric = 'fastest5km' | 'fastestHalfMarathon' | 'fastestMarathon';
type SpreadMetric = 'avgPaceStdDev';

/** Taktid i minuter per tidsmått: 1 h, 6 h och 12 h. */
const TIME_REFERENCE_MINUTES: Record<TimeMetric, number> = {
  fastest5km: 60,
  fastestHalfMarathon: 360,
  fastestMarathon: 720,
};

/** Spridningen kodas som PACE_STD_DEV_SCALE / s/km. */
const PACE_STD_DEV_SCALE = 10000;

/** Sentinelvärdet för tidsmått utan kvalificerande runda. */
export const NO_TIME_VALUE = -9999;

/** Ett tidsvärde under den här gränsen är "ingen tid". En riktigt långsam tid kan ge ett negativt värde men hamnar ovanför gränsen. */
const NO_TIME_THRESHOLD = -100;

export const SECONDS_PER_MINUTE = 60;
export const MINUTES_PER_HOUR = 60;

function isTimeMetric(key: EncodedTitleMetric): key is TimeMetric {
  return key in TIME_REFERENCE_MINUTES;
}

function isSpreadMetric(key: EncodedTitleMetric): key is SpreadMetric {
  return key === 'avgPaceStdDev';
}

/**
 * Indata `x` per mått: tidsmått = rörelsetid i sekunder, spridningsmått = pace-spridning i s/km, lastRunOfWeek =
 * väggklockan som epok-millisekunder. Returnerar värdet som lagras i user_titles.value.
 */
export function encodeTitleMetric(key: EncodedTitleMetric, x: number): number {
  if (isTimeMetric(key)) return TIME_REFERENCE_MINUTES[key] - x / SECONDS_PER_MINUTE;
  if (isSpreadMetric(key)) return PACE_STD_DEV_SCALE / x;
  return x / 1000;
}

/**
 * Tvärtom mot encodeTitleMetric: tidsmått ger avrundade sekunder, spridningsmått s/km, lastRunOfWeek epok-ms.
 * null = "inget värde" (tidsmått under -100, spridning 0 eller lägre) — visas som tankstreck.
 */
export function decodeTitleMetric(key: 'lastRunOfWeek', value: number): number;
export function decodeTitleMetric(key: EncodedTitleMetric, value: number): number | null;
export function decodeTitleMetric(key: EncodedTitleMetric, value: number): number | null {
  if (isTimeMetric(key)) {
    if (value < NO_TIME_THRESHOLD) return null;
    return Math.round((TIME_REFERENCE_MINUTES[key] - value) * SECONDS_PER_MINUTE);
  }
  if (isSpreadMetric(key)) {
    if (value <= 0) return null;
    return PACE_STD_DEV_SCALE / value;
  }
  return value * 1000;
}

/** Värdet motorn returnerar när ingen runda kvalificerar: -9999 för tidsmåtten, 0 för övriga. */
export function noValueFor(key: EncodedTitleMetric): number {
  return isTimeMetric(key) ? NO_TIME_VALUE : 0;
}

// ─── Maraton ──────────────────────────────────────────────────────────────────────────────────────

/** Maratonets distans: en "maraton-ekvivalent" är så här många km (Runner card). */
export const MARATHON_DISTANCE_KM = 42.195;

/**
 * Undre distansgräns för titeln Fastest Marathon. Medvetet 42,2 och inte 42,195: titeln kräver en runda på minst 42,2 km
 * (GPS-marginal), medan ekvivalenterna räknar den exakta distansen. De två värdena är olika regler och ska inte slås ihop.
 */
export const MARATHON_TITLE_MIN_KM = 42.2;

// ─── Dubbelpass ───────────────────────────────────────────────────────────────────────────────────

/** Två rundor räknas som ett dubbelpass först när de startat minst så här långt ifrån varandra (4 h). */
export const DOUBLE_RUN_MIN_GAP_MS = 4 * 60 * 60 * 1000;

/**
 * Finns det två starter minst DOUBLE_RUN_MIN_GAP_MS isär? Starterna är epok-ms (väggklocka, se calendar.ts); ordningen spelar ingen
 * roll och ogiltiga starter (NaN) hoppas över. Titeln The Double Trouble och Runner cardens dubbelpassdagar delar den här regeln;
 * titeln ställer dessutom krav på 5 km per runda.
 */
export function hasDoubleRunGap(startsMs: readonly number[]): boolean {
  const starts = startsMs.filter(Number.isFinite);
  if (starts.length < 2) return false;
  return Math.max(...starts) - Math.min(...starts) >= DOUBLE_RUN_MIN_GAP_MS;
}

// ─── Helgsnitt ────────────────────────────────────────────────────────────────────────────────────

export interface WeekendRun {
  /** Kalenderdag, YYYY-MM-DD. */
  day: string;
  km: number;
}

const SUNDAY = 0;
const SATURDAY = 6;

/**
 * Snittet av km per helg: lördag och söndag i samma vecka (mån–sön, via måndagen) är en helg. Veckor utan helgrunda ingår inte;
 * utan helgrundor alls är snittet 0. Summeringen sker i inkommande ordning (flyttalet är en del av det lagrade titelvärdet).
 */
export function weekendAverageKm(runs: readonly WeekendRun[]): number {
  const weekendTotals = new Map<string, number>();

  for (const run of runs) {
    const weekday = dayOfWeek(run.day);
    if (weekday !== SUNDAY && weekday !== SATURDAY) continue;
    const weekKey = mondayOf(run.day);
    weekendTotals.set(weekKey, (weekendTotals.get(weekKey) ?? 0) + run.km);
  }

  const totals = Array.from(weekendTotals.values());
  return totals.length > 0 ? totals.reduce((sum, total) => sum + total, 0) / totals.length : 0;
}
