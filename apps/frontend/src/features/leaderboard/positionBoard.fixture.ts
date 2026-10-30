import type { PositionHistoryResponse, PositionRunner, PositionWeek } from '@runquest/shared';

// Fixturer för Position-fliken (graf, "Current order" och tabell): ett svar ur GET /api/leaderboard/positions med löpare i Standings ordning.
// Samma data som den godkända prototypen: sex löpare över åtta veckor, och tolv där en kom in mitt i perioden. Bild-URL:erna är stubbar och
// hämtas aldrig (testerna körs utan nätverk).

export const ME_ID = 'u-joel';

/** En bild-URL som aldrig hämtas i ett test; harnessen pekar den på en lokal fil. */
export const pictureOf = (id: string) => `https://img.test/${id}.png`;

export function weeksOf(count: number, firstIsoWeek = 27, isoYear = 2026): PositionWeek[] {
  return Array.from({ length: count }, (_, i) => ({
    start: '2026-07-06',
    end: '2026-07-12',
    iso_week: firstIsoWeek + i,
    iso_year: isoYear,
    is_current_week: i === count - 1,
  }));
}

/** Vecka 50 2026 till vecka 4 2027, med vecka 53. */
export const YEAR_END_WEEKS: PositionWeek[] = [50, 51, 52, 53, 1, 2, 3, 4].map((iso_week, i, all) => ({
  start: '2026-12-14',
  end: '2026-12-20',
  iso_week,
  iso_year: iso_week >= 50 ? 2026 : 2027,
  is_current_week: i === all.length - 1,
}));

export const runnerOf = (user_id: string, name: string, positions: Array<number | null>, profile_picture: string | null = null): PositionRunner => ({
  user_id,
  name,
  profile_picture,
  member_since: null,
  positions,
});

export const responseOf = (weeks: PositionWeek[], runners: PositionRunner[]): PositionHistoryResponse => ({ as_of: '2026-08-26', weeks, runners });

// Prototypens sex löpare i Standings ordning (live-placeringen i sista kolumnen). Joel är den inloggade.
export function six(): PositionHistoryResponse {
  return responseOf(weeksOf(8), [
    runnerOf('u-karl', 'Karl Persson', [2, 2, 1, 2, 2, 2, 2, 1], pictureOf('u-karl')),
    runnerOf(ME_ID, 'Joel Lindberg', [1, 1, 2, 1, 1, 1, 1, 2], pictureOf(ME_ID)),
    runnerOf('u-adam', 'Adam Einstein', [3, 4, 3, 3, 4, 3, 3, 3], pictureOf('u-adam')),
    runnerOf('u-nicklas', 'Nicklas von Elling', [5, 5, 5, 6, 5, 6, 6, 4]),
    runnerOf('u-daniel', 'Daniel Lindblad Lüthje', [4, 3, 4, 4, 3, 4, 4, 5]),
    runnerOf('u-johan', 'Johan Björell', [6, 6, 6, 5, 6, 5, 5, 6], pictureOf('u-johan')),
  ]);
}

const TWELVE_NAMES = [
  'Karl Persson', 'Joel Lindberg', 'Adam Einstein', 'Sara Ek', 'Erik Sund', 'Daniel Lindblad Lüthje',
  'Maja Holm', 'Oskar Dahl', 'Nicklas von Elling', 'Johan Björell', 'Lina Berg', 'Emma Lund',
];
const TWELVE_IDS = ['u-karl', ME_ID, 'u-adam', 'u-sara', 'u-erik', 'u-daniel', 'u-maja', 'u-oskar', 'u-nicklas', 'u-johan', 'u-lina', 'u-emma'];

/** Deterministisk blandning (ingen Math.random): samma data i varje körning. */
function shuffled(count: number, seed: number): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  let state = seed;
  for (let i = count - 1; i > 0; i -= 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/**
 * Tolv löpare över åtta veckor. Sista veckan är identiteten (löpare k står på plats k + 1), tidigare veckor är blandade. `joinsWeek` (index) låter en
 * löpare komma in mitt i perioden: dess tidigare veckor är null och de andra placeras tätt (1..n) utan hen, som servern gör.
 */
export function twelve(joiner: { id: string; firstIndex: number } | null = { id: 'u-sara', firstIndex: 3 }): PositionHistoryResponse {
  const weekCount = 8;
  const positions: Array<Array<number | null>> = TWELVE_IDS.map(() => []);
  for (let week = 0; week < weekCount; week += 1) {
    const present = TWELVE_IDS.map((id, k) => ({ id, k })).filter(({ id }) => !(joiner && id === joiner.id && week < joiner.firstIndex));
    const ranking = week === weekCount - 1 ? present.map((p) => p.k) : shuffled(present.length, 7 + week * 13).map((i) => present[i].k);
    TWELVE_IDS.forEach((_, k) => positions[k].push(ranking.includes(k) ? ranking.indexOf(k) + 1 : null));
  }
  return responseOf(
    weeksOf(weekCount),
    TWELVE_IDS.map((id, k) => runnerOf(id, TWELVE_NAMES[k], positions[k], k % 3 === 0 ? null : pictureOf(id))),
  );
}

/** `count` löpare (2..12) ur samma lista, samma sista vecka, för mätning av 1/6/12. Den inloggade är alltid med. */
export function packOf(count: number): PositionHistoryResponse {
  if (count >= 12) return twelve(null);
  const ids = TWELVE_IDS.slice(0, count);
  const full = twelve(null);
  const kept = full.runners.filter((r) => ids.includes(r.user_id));
  // Placeringarna räknas om tätt bland de kvarvarande, vecka för vecka, så att varje vecka är 1..count.
  const dense = kept.map((runner) => ({
    ...runner,
    positions: runner.positions.map((_, week) => 1 + kept.filter((other) => (other.positions[week] ?? 0) < (runner.positions[week] ?? 0)).length),
  }));
  return responseOf(full.weeks, dense);
}
