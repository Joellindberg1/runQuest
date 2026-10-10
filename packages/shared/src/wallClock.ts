/**
 * Konventionen för `runs.start_time`:
 *
 * Strava-importen fyller kolumnen med `start_date_local` — löparens lokala väggklocka — men med ett falskt
 * 'Z', och kolumnen är timestamptz. Värdet '2026-07-04T06:00:00Z' betyder alltså "06:00 hos löparen", inte
 * 06:00 UTC. Därför gäller:
 *
 *  - KLOCKSLAG (tid på dygnet): läs med getUTC* — väggklockan ligger i UTC-fälten.
 *  - ÖGONBLICK (tidsdifferenser mot "nu", API-anrop): gå via `wallClockToInstantMs`, aldrig `new Date(start_time)`.
 *
 * Manuella rundor har start_time = null och berörs inte.
 */

const WALL_CLOCK_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?(?:Z|[+-]00(?::?00)?)$/;

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

/** Väggklockan i `timeZone` vid ögonblicket `instantMs`, uttryckt som om den vore UTC (ms). */
function wallClockMsAt(instantMs: number, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
}

/** Tidszonens UTC-offset (ms, väst om UTC är negativt) vid ett ögonblick; sekundavrundat eftersom formatet saknar ms. */
function offsetMsAt(instantMs: number, timeZone: string): number {
  const floored = Math.floor(instantMs / 1000) * 1000;
  return wallClockMsAt(floored, timeZone) - floored;
}

const DAY_MS = 24 * 60 * 60 * 1000;

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
export function wallClockToInstantMs(startTime: string, timeZone = 'Europe/Stockholm'): number {
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
  const before = offsetMsAt(wall - DAY_MS, timeZone);
  const after = offsetMsAt(wall + DAY_MS, timeZone);

  const valid = [wall - before, wall - after]
    .filter(candidate => wallClockMsAt(Math.floor(candidate / 1000) * 1000, timeZone) === Math.floor(wall / 1000) * 1000)
    .sort((a, b) => a - b);

  // Tom lista = klockslaget finns inte (vårens hopp): offset före hoppet.
  return valid.length > 0 ? valid[0] : wall - before;
}
