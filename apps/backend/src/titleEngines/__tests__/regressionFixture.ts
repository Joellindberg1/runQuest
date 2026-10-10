/**
 * Fast fixtur för titelmotorernas regressionstest (RUN-98): rader i DB-form som runs-selecten ger dem
 * (kolumnen heter `distance`; `distance_km` är aliaset som anroparna lägger på). Täcker alla 21 motorer:
 * nattpass, tidiga pass, lunch, söndagar (lastRunOfWeek), helgveckor, veckodagsserie, uppehåll ≥14/≥30 dagar,
 * maraton/halvmaraton/5 km, höjdmeter, pace-spridning samt rader med null/saknade fält.
 * Ligger i __tests__ (inte i titleEngines/) så frontendens driftvakt inte räknar den som en motor.
 */
export type FixtureRow = Record<string, unknown>;

const row = (
  date: string,
  distance: number | string,
  extra: { start?: string | null; elev?: number | null; std?: number | null; time?: number | null } = {},
): FixtureRow => ({
  date,
  distance,
  distance_km: distance,
  start_time: extra.start === undefined ? null : extra.start,
  total_elevation_gain: extra.elev === undefined ? null : extra.elev,
  pace_std_dev: extra.std === undefined ? null : extra.std,
  moving_time: extra.time === undefined ? null : extra.time,
});

export const FIXTURE_ROWS: FixtureRow[] = [
  row('2026-01-05', 5.2, { start: '2026-01-05T05:15:00Z', elev: 40, std: 22.5, time: 1650 }), // mån, tidigt
  row('2026-01-06', '7.5', { start: '2026-01-06T12:30:00Z', elev: 85.5, std: 18, time: 2400 }), // tis, lunch, distance som sträng
  row('2026-01-07', 4.95, { start: '2026-01-07T18:00:00Z', elev: 10, std: 30, time: 1500 }), // ons, 4,95 km (5 km-kvalificerad)
  row('2026-01-08', 10, { start: '2026-01-08T23:30:00Z', elev: 120, std: 15.2, time: 3300 }), // tors, natt
  row('2026-01-09', 3, { start: '2026-01-09T07:00:00Z', elev: 5, std: 40, time: 1000 }), // fre
  row('2026-01-10', 12.3, { start: '2026-01-10T09:00:00Z', elev: 200, std: 25, time: 4200 }), // lör
  row('2026-01-11', 8, { start: '2026-01-11T10:30:00Z', elev: 60, std: 20, time: 2700 }), // sön
  row('2026-01-11', 4, { start: '2026-01-11T20:00:00Z', elev: 15, std: 12, time: 1300 }), // sön, dubbeldag
  row('2026-01-12', 6, { start: '2026-01-12T02:30:00Z', elev: 30, std: 28, time: 2000 }), // mån, natt
  row('2026-01-13', 5, { start: '2026-01-13T12:00:00Z', elev: 25, std: 19, time: 1800 }), // tis, lunch
  row('2026-01-14', 9.9, { start: '2026-01-14T05:59:00Z', elev: 95, std: 21, time: 3200 }), // ons, tidigt
  row('2026-02-20', 15.5, { start: '2026-02-20T17:00:00Z', elev: 310, std: 35, time: 5400 }), // uppehåll 37 dagar
  row('2026-02-21', 21.3, { start: '2026-02-21T08:00:00Z', elev: 150, std: 33, time: 6900 }), // lör, halvmaraton
  row('2026-02-22', 6.1, { start: '2026-02-22T16:45:00Z', elev: 70, std: 14.4, time: 2100 }), // sön, senare söndag
  row('2026-03-10', 25, { start: '2026-03-10T11:00:00Z', elev: 400, std: 45, time: 9000 }), // uppehåll 16 dagar
  row('2026-04-04', 42.5, { start: '2026-04-04T07:30:00Z', elev: 520, std: 50, time: 14400 }), // lör, maraton, uppehåll 25 d
  row('2026-04-05', 3.5, { start: null, elev: null, std: null, time: null }), // sön, saknade fält (lastRunOfWeek-fallback)
  row('2026-05-02', 11, { start: '2026-05-02T13:00:00Z', elev: 90, std: 0, time: 3600 }), // lör, pace_std 0 (ignoreras)
  row('2026-05-03', 5.0, { start: '2026-05-03T04:00:00Z', elev: 0, std: 17, time: 1620 }), // sön, tidigt gräns
  row('2026-06-01', 7, { start: '2026-06-01T22:59:59Z', elev: 55, std: 23, time: 2500 }), // mån
  row('2026-06-02', 7, { start: '2026-06-02T06:00:00Z', elev: 55, std: 24, time: 2510 }), // tis
  row('2026-06-03', 7, { start: '2026-06-03T12:00:00Z', elev: 55, std: 26, time: 2520 }), // ons
  row('2026-06-04', 7, { start: '2026-06-04T13:00:00Z', elev: 55, std: 27, time: 2530 }), // tors
  row('2026-06-05', 7, { start: '2026-06-05T13:30:00Z', elev: 55, std: 29, time: 2540 }), // fre
  row('2026-06-08', 7, { start: '2026-06-08T13:30:00Z', elev: 55, std: 31, time: 2550 }), // mån (serien fortsätter över helgen)
  row('2026-07-12', 14.2, { start: '2026-07-12T09:30:00Z', elev: 180, std: 16, time: 4800 }), // sön, uppehåll 34 d
  row('2026-07-30', 2.2, { start: '2026-07-30T21:00:00Z', elev: 3, std: 11, time: 800 }), // tors
  // Kvalificerande dubbeldag för bestDoubleDayKm: båda ≥ 5 km, båda med start_time, 12 h emellan (≥ 4 h) → 17,5.
  row('2026-08-15', 9, { start: '2026-08-15T06:00:00Z', elev: 40, std: 21, time: 3000 }), // lör
  row('2026-08-15', 8.5, { start: '2026-08-15T18:00:00Z', elev: 35, std: 22, time: 2900 }), // lör, dubbeldag
  // Senaste söndagen på året och utan start_time: lastRunOfWeek-fallbacken date + 'T23:00:00Z' avgör värdet.
  row('2026-08-16', 4, { start: null, elev: 10, std: 13, time: 1400 }), // sön
];

export const FIXTURE_STATS = { totalKm: 306.25, longestStreak: 7 } as const;
