/**
 * Kalender och Stockholm-tid — EN implementation för backend, frontend och shared (RUN-218).
 *
 * Före sammanslagningen fanns addDays i fyra kopior, mondayOf i sju, daysBetween i fyra, Stockholm-offset i sex och
 * MS_DAY i sju filer plus 22 literaler. De läste dessutom "idag" olika (UTC / processens tidszon / Stockholm).
 * Allt som gäller datumaritmetik och Stockholm-tid ligger nu här; streak.ts bygger på samma funktioner.
 *
 * Två slags värden, och de blandas aldrig:
 *
 *  - KALENDERDAG: en `YYYY-MM-DD`-sträng (runs.date, utmaningens start_date, ...). Aritmetiken är ren kalenderaritmetik via
 *    UTC (ingen sommartid kan flytta ett datum), tidszonsfri och oberoende av processens tidszon och systemklocka. Ogiltig
 *    indata ger RangeError (addDays, mondayOf, stockholmDay) eller NaN (daysBetween, dayOfWeek) — aldrig en tyst felaktig dag.
 *  - ÖGONBLICK: en `Date`. "Idag" tas fram på ETT ställe, `stockholmDay(new Date())`, och skickas in i logiken; funktionerna
 *    här som tar kalenderdagar läser aldrig klockan själva.
 *
 * Konventionen för `runs.start_time`:
 *
 * Strava-importen fyller kolumnen med `start_date_local` — löparens lokala väggklocka — men med ett falskt
 * 'Z', och kolumnen är timestamptz. Värdet '2026-07-04T06:00:00Z' betyder alltså "06:00 hos löparen", inte
 * 06:00 UTC. Därför gäller:
 *
 *  - KLOCKSLAG (tid på dygnet): läs siffrorna rakt av (`wallClockMinutes`) — väggklockan ligger i UTC-fälten, ingen konvertering.
 *  - ÖGONBLICK (tidsdifferenser mot "nu", API-anrop): gå via `wallClockToInstantMs`, aldrig `new Date(start_time)`.
 *
 * Manuella rundor har start_time = null och berörs inte.
 */

export const MS_DAY = 86_400_000;

export const STOCKHOLM_TZ = 'Europe/Stockholm';

// ─── Kalenderdagar (YYYY-MM-DD) ──────────────────────────────────────────────────────────────────

function utcMidnightMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Lägger N dagar till en YYYY-MM-DD-sträng. Går via UTC-middag, så ingen sommartidsförskjutning kan flytta datumet. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0)).toISOString().slice(0, 10);
}

/** Heltalsdagar från `from` till `to` (negativt om `to` ligger före). NaN för ogiltiga datum. */
export function daysBetween(from: string, to: string): number {
  return (utcMidnightMs(to) - utcMidnightMs(from)) / MS_DAY;
}

/** Veckodagen för en kalenderdag: 0 = söndag … 6 = lördag. NaN för ogiltigt datum. */
export function dayOfWeek(day: string): number {
  return new Date(utcMidnightMs(day)).getUTCDay();
}

/** Måndagen i veckan (mån–sön) som kalenderdagen tillhör; en söndag hör till veckan som slutar. */
export function mondayOf(day: string): string {
  return addDays(day, -((dayOfWeek(day) + 6) % 7));
}

// ─── Tidszon: väggklocka <-> ögonblick ───────────────────────────────────────────────────────────

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Väggklockan i `timeZone` vid ögonblicket `instantMs`, uttryckt som om den vore UTC (ms). RangeError för ogiltigt ögonblick. */
export function wallClockMsAt(instantMs: number, timeZone = STOCKHOLM_TZ): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
}

/** Tidszonens UTC-offset (ms, positiv öster om UTC) vid ett ögonblick; sekundavrundat eftersom formatet saknar ms. */
export function zoneOffsetMs(instantMs: number, timeZone = STOCKHOLM_TZ): number {
  const floored = Math.floor(instantMs / 1000) * 1000;
  return wallClockMsAt(floored, timeZone) - floored;
}

/** Stockholm-kalenderdagen (YYYY-MM-DD) för ett ögonblick — oberoende av processens tidszon. */
export function stockholmDay(at: Date): string {
  return new Date(wallClockMsAt(at.getTime())).toISOString().slice(0, 10);
}

export interface StockholmClock {
  /** Stockholm-kalenderdagen (YYYY-MM-DD). */
  date: string;
  /** Millisekunder sedan Stockholm-midnatt (sekundupplösning). */
  msIntoDay: number;
}

/** Stockholm-datum + ms in i dygnet för ett ögonblick. */
export function stockholmClock(at: Date): StockholmClock {
  const wall = wallClockMsAt(at.getTime());
  return { date: new Date(wall).toISOString().slice(0, 10), msIntoDay: ((wall % MS_DAY) + MS_DAY) % MS_DAY };
}

const WALL_CLOCK_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?(?:Z|[+-]00(?::?00)?)$/;

/**
 * Det verkliga ögonblicket (epoch-ms) för en `start_time` som är lokal väggklocka i `timeZone`
 * (standard Europe/Stockholm — appens användare antas bo där). Tar `…Z` och `…+00:00`; allt annat,
 * inklusive riktiga offset och orimliga datum, ger NaN. Ogiltigt `timeZone` ger RangeError (programmeringsfel).
 *
 * Sommartidsgränser, samma konvention som `new Date(y, m, d, h, min)`:
 *  - dubbeltydigt klockslag (höstens extratimme, t.ex. 02:30) -> första förekomsten (sommartid);
 *  - klockslag som inte finns (vårens hoppade timme, t.ex. 02:30) -> tolkas med offset före hoppet.
 *
 * Oberoende av processens tidszon: allt går via Intl med explicit timeZone och Date.UTC.
 */
export function wallClockToInstantMs(startTime: string, timeZone = STOCKHOLM_TZ): number {
  const m = WALL_CLOCK_PATTERN.exec(startTime);
  if (!m) return NaN;

  const [, y, mo, d, h, mi, s, ms] = m;
  const year = Number(y), month = Number(mo), day = Number(d);
  const hour = Number(h), minute = Number(mi), second = Number(s ?? 0);
  const wall = Date.UTC(year, month - 1, day, hour, minute, second, Number((ms ?? '').padEnd(3, '0') || 0));

  // Date.UTC rullar över ogiltiga fält (månad 13, timme 25); kräv att fälten överlever tur och retur.
  const check = new Date(wall);
  if (
    check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day ||
    check.getUTCHours() !== hour || check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second
  ) {
    return NaN;
  }

  // Offseten dygnet före/efter täcker en eventuell sommartidsgräns vid just detta klockslag.
  const before = zoneOffsetMs(wall - MS_DAY, timeZone);
  const after = zoneOffsetMs(wall + MS_DAY, timeZone);

  const valid = [wall - before, wall - after]
    .filter(candidate => wallClockMsAt(Math.floor(candidate / 1000) * 1000, timeZone) === Math.floor(wall / 1000) * 1000)
    .sort((a, b) => a - b);

  // Tom lista = klockslaget finns inte (vårens hopp): offset före hoppet.
  return valid.length > 0 ? valid[0] : wall - before;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Ögonblicket då klockan i Stockholm slår `hour`:`minute` på kalenderdagen `day`. Offseten tas vid själva klockslaget, så
 * 00:00 på en sommartidsdag blir rätt även om dagens middag ligger i den andra offseten. Sommartidens dubbeltydiga och
 * saknade klockslag följer `wallClockToInstantMs`. RangeError för ogiltig dag eller ogiltigt klockslag.
 */
export function stockholmWallClockToInstant(day: string, hour: number, minute = 0): Date {
  const ms = wallClockToInstantMs(`${day}T${pad2(hour)}:${pad2(minute)}:00Z`);
  if (Number.isNaN(ms)) throw new RangeError(`Ogiltig Stockholm-tid: ${day} ${hour}:${minute}`);
  return new Date(ms);
}

/** ISO-ögonblicket (UTC) då Stockholm-dagen `day` (YYYY-MM-DD) börjar, kl 00:00 lokal tid. DST-säker. */
export function stockholmMidnightIso(day: string): string {
  return stockholmWallClockToInstant(day, 0).toISOString();
}

export interface GroupMidnight {
  /** Kalenderdagen (YYYY-MM-DD) som börjar vid midnatten — den nya dagens datum i gruppens tid. */
  day: string;
  /** Själva ögonblicket då klockan i gruppens tidszon slår 00:00 den dagen. */
  instant: Date;
}

/**
 * Gruppens nästa midnatt (00:00) efter ögonblicket `at`, i gruppens lokala tid. DEN enda definitionen av när en duell startar:
 * en accepterad duell börjar vid nästa midnatt och aldrig i samma ögonblick som den accepteras (ägarens regel 2026-10-19),
 * annars går det att utnyttja. Midnatten är alltid strikt efter `at` — är klockan exakt 00:00:00 är nästa midnatt dagen efter.
 *
 * `timeZone` är Europe/Stockholm tills tidszon per grupp finns (RUN-21): då skickas gruppens zon hit, och backend (start_date vid
 * accept) och frontend (duellfönstret) följer med utan att ändras. Oberoende av processens tidszon; sommartidens 23- och
 * 25-timmarsdygn hanteras eftersom offseten tas vid själva midnatten.
 */
export function groupNextMidnight(at: Date, timeZone = STOCKHOLM_TZ): GroupMidnight {
  const today = new Date(wallClockMsAt(at.getTime(), timeZone)).toISOString().slice(0, 10);
  const day = addDays(today, 1);
  const ms = wallClockToInstantMs(`${day}T00:00:00Z`, timeZone);
  if (Number.isNaN(ms)) throw new RangeError(`Ogiltig midnatt: ${day} i ${timeZone}`);
  return { day, instant: new Date(ms) };
}

/**
 * Minuter sedan midnatt i löparens lokala väggklocka, ur `start_time`.
 * `start_time` är Strava `start_date_local` lagrad med falskt 'Z' (ADR 009 beslut 2): siffrorna ÄR
 * väggklockan. Klockslaget läses direkt ur strängen — ingen Date, alltså ingen konvertering till
 * någon tidszon (processens, DST, en angiven offset eller löparens). Null, rent datum utan klockslag
 * eller ogiltigt klockslag (manuella rundor) => null = ingen räkning.
 */
export function wallClockMinutes(startTime: string | null): number | null {
  if (!startTime) return null;
  const match = /T(\d{2}):(\d{2})/.exec(startTime);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}
