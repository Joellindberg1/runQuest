import type { Locator, Page } from '@playwright/test';
import { POSITION_WEEKS_ALL_TIME, POSITION_WEEKS_DEFAULT } from '../../../packages/shared/src/contracts/leaderboard';
import { expect } from './test';
import { targets } from './targets';

// Gemensamt för Position-specerna (board-position och profile-position): positionssvaret per vy (Last 8 weeks / All time) läggs över API:et i webbläsaren, och mätningar av veckoetiketterna och av växeln.

export { POSITION_WEEKS_ALL_TIME, POSITION_WEEKS_DEFAULT };

/** Bredderna där ingen sida får scrolla i sidled (320 till 1440 px, båda temana). */
export const RANGE_WIDTHS = [320, 375, 768, 1024, 1280, 1440] as const;
/** Minsta luft i px mellan två veckoetiketter (provet kräver att de inte ens nuddar varandra). */
export const MIN_LABEL_GAP_PX = 4;
/** Antalet veckor "All time" har i stubben: en grupp som är yngre än taket (104) får färre veckor, som servern ger. */
export const ALL_TIME_STUB_WEEKS = 44;

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

export interface PositionBodies {
  /** Svaret för de senaste åtta veckorna (och för varje annat antal veckor när `allTime` saknas). */
  recent: unknown;
  /** Svaret för `weeks=104`. */
  allTime?: unknown;
  /** Hur länge svaret för All time hålls tillbaka. */
  allTimeDelayMs?: number;
}

/** Lägger positionssvaret över API:et, valt efter `weeks` i adressen. Returnerar antalet veckor som begärts, i ordning. */
export async function answerPositions(page: Page, bodies: PositionBodies): Promise<{ weeksAsked: () => number[] }> {
  const asked: number[] = [];
  await page.route(`${targets.apiUrl}/**/leaderboard/positions*`, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }
    const weeks = Number(new URL(route.request().url()).searchParams.get('weeks'));
    asked.push(weeks);
    const allTime = weeks === POSITION_WEEKS_ALL_TIME && bodies.allTime !== undefined;
    if (allTime && bodies.allTimeDelayMs) await new Promise((resolve) => setTimeout(resolve, bodies.allTimeDelayMs));
    await route.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify({ success: true, data: allTime ? bodies.allTime : bodies.recent }) });
  });
  return { weeksAsked: () => [...asked] };
}

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const boxesOf = (locator: Locator): Promise<Box[]> =>
  locator.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    }),
  );

/** Mellanrummen i px mellan efterföljande veckoetiketter (negativt = de ligger över varandra) och antalet etiketter. */
export async function measureWeekLabels(labels: Locator): Promise<{ count: number; gaps: number[]; minGap: number }> {
  const boxes = await boxesOf(labels);
  const gaps = boxes.slice(1).map((box, index) => box.left - boxes[index]!.right);
  return { count: boxes.length, gaps, minGap: gaps.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...gaps) };
}

/**
 * Veckoetiketterna ligger i stigande ordning, ingen nuddar nästa (minst MIN_LABEL_GAP_PX emellan) och alla ligger inom `within` (grafens yta). Returnerar minsta mellanrum för anteckningen.
 */
export async function expectWeekLabelsClear(labels: Locator, within: Locator, message: string): Promise<{ count: number; minGap: number }> {
  const boxes = await boxesOf(labels);
  const frame = (await boxesOf(within))[0]!;
  const { count, gaps, minGap } = await measureWeekLabels(labels);
  expect(count, `${message}: there are labels`).toBeGreaterThan(0);
  for (const [index, gap] of gaps.entries()) expect(gap, `${message}: the gap between label ${index + 1} and ${index + 2}`).toBeGreaterThanOrEqual(MIN_LABEL_GAP_PX);
  for (const [index, box] of boxes.entries()) {
    expect(box.left, `${message}: label ${index + 1} starts inside the chart`).toBeGreaterThanOrEqual(frame.left - 1);
    expect(box.right, `${message}: label ${index + 1} ends inside the chart`).toBeLessThanOrEqual(frame.right + 1);
  }
  return { count, minGap };
}

/** Fokusringen på ett element: ritas den, hur tjock och åt vilket håll (negativ offset = inåt). */
export const ringOf = (locator: Locator) =>
  locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { drawn: style.outlineStyle !== 'none', width: parseFloat(style.outlineWidth), offset: parseFloat(style.outlineOffset) };
  });
