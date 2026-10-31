import type { Page } from '@playwright/test';
import type { ChallengeHistoryItem } from '../../../packages/shared/src/contracts/challenges';
import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';
import { CORS_HEADERS, RUNNER, apiPath, popup, sheet, stubGroup } from '../support/sendFlow';
import { apiIsStubbed } from '../support/stubApi';
import { waitForStylesApplied } from '../support/stylesApplied';

/**
 * Fokus tillbaka till det som öppnade löparens kort, när samma löpare står i flera rader i Match history. Bredder: 320 och 375 (kortet är en egen sida, Back), 1024, 1280 och 1440
 * (kortet är en popup: Esc, Back och Challenge, sedan Cancel i send-arket). Gruppen och historiken läggs över API:et i webbläsaren, så provet gäller lika mot stubben och staging.
 */

const WIDTHS = [320, 375, 1024, 1280, 1440];
const POPUP_MIN_WIDTH = 1024;
const WIDE_DESKTOP_MIN_WIDTH = 1280;
const THEMES = ['dark', 'light'] as const;
/** Dokumentets rullning får skilja högst en rad (plus en pixel för avrundning) före och efter stängningen. */
const SCROLL_TOLERANCE_PX = 1;

type Side = 'left' | 'right';
type Theme = (typeof THEMES)[number];
type Closer = 'Escape' | 'Back' | 'Cancel';

const person = (index: number) => ({ id: `history-member-${index}`, name: `History Member ${index}` });

const item = (index: number, challenger: { id: string; name: string }, opponent: { id: string; name: string }): ChallengeHistoryItem => ({
  id: `history-${index}`,
  tier: 'major',
  metric: 'km',
  duration_days: 14,
  start_date: '2026-10-01',
  end_date: '2026-10-15',
  ended_at: '2026-10-15T22:00:00Z',
  outcome: 'challenger_wins',
  winner_id: challenger.id,
  challenger: { ...challenger, profile_picture: null, level: 18 },
  opponent: { ...opponent, profile_picture: null, level: 17 },
  challenger_value: 41.5,
  opponent_value: 38.25,
  winner_boost: { type: 'multiplier_days', delta: 0.5, duration: 14 },
  loser_boost: { type: 'multiplier_days', delta: -0.25, duration: 14 },
});

/** Fyra rader där löparen står i rad 0 till vänster, rad 2 till höger och rad 3 till vänster. */
const FOUR_ROWS = [item(0, RUNNER, person(1)), item(1, person(2), person(3)), item(2, person(4), RUNNER), item(3, RUNNER, person(5))];
const RUNNER_SEATS: Array<{ row: number; side: Side }> = [
  { row: 0, side: 'left' },
  { row: 2, side: 'right' },
  { row: 3, side: 'left' },
];

/** Tolv rader: löparen står i rad 0 och i rad 11, så sidan måste rulla för att nå den sista. */
const TWELVE_ROWS = Array.from({ length: 12 }, (_value, index) =>
  index === 0 ? item(index, RUNNER, person(1)) : index === 11 ? item(index, person(2 * index), RUNNER) : item(index, person(2 * index), person(2 * index + 1)),
);

async function openHistory(page: Page, rows: ChallengeHistoryItem[], size: { width: number; height: number }, theme: Theme): Promise<void> {
  await stubGroup(page);
  await page.route(apiPath('/challenges/group-history'), (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS_HEADERS })
      : route.fulfill({
          status: 200,
          headers: CORS_HEADERS,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { items: rows }, meta: { total: rows.length, limit: 20, offset: 0, has_more: false } }),
        }),
  );
  await page.addInitScript((value) => window.localStorage.setItem('theme', value), theme);
  await page.setViewportSize(size);
  await page.goto('/duels?view=history');
  await dismissOverlays(page);
  await expect(page.locator('.rq-duels-match')).toHaveCount(rows.length);
  await waitForStylesApplied(page);
  // Runner card är en lazy route: första öppningen väntar på dess kod. Öppnas kortet en gång här är varje senare öppning ett rent adressbyte.
  await page.locator('.rq-duels-match').nth(0).locator('.rq-duels-match__name').first().click();
  await expect(page).toHaveURL(/\/runner\//);
  await page.goBack();
  await expect(page.locator('.rq-duels-match')).toHaveCount(rows.length);
  await waitForStylesApplied(page);
}

const halfOf = (page: Page, row: number, side: Side) => page.locator('.rq-duels-match').nth(row).locator('.rq-duels-match__name').nth(side === 'left' ? 0 : 1);

interface Point {
  x: number;
  y: number;
}

/** Radens delar i fönstrets koordinater, efter att raden rullats till mitten: provpunkterna ligger då i vyn. */
async function geometryOf(page: Page, row: number, side: Side) {
  return page.locator('.rq-duels-match').nth(row).evaluate((element, index) => {
    element.scrollIntoView({ block: 'center' });
    const rect = (target: Element) => {
      const box = target.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    };
    return { row: rect(element), meta: rect(element.querySelector('.rq-duels-match__meta')!), name: rect(element.querySelectorAll('.rq-duels-match__name')[index]!) };
  }, side === 'left' ? 0 : 1);
}

const middleOf = (box: { left: number; right: number; top: number; bottom: number }): Point => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 });

const CLICK_TARGETS = ['the name', 'the outer edge'] as const;
type ClickTarget = (typeof CLICK_TARGETS)[number];

/** Punkten att klicka på, mätt efter att raden rullats till mitten: namnet, eller halvans ytterkant (vänster halvas yttersta pixel, höger halvas högerkant; på bred desktop metakolumnen, som hör till den högra). */
async function pointOf(page: Page, row: number, side: Side, width: number, target: ClickTarget): Promise<Point> {
  const geometry = await geometryOf(page, row, side);
  if (target === 'the name') return middleOf(geometry.name);
  const y = middleOf(geometry.row).y;
  if (side === 'left') return { x: geometry.row.left + 1, y };
  return width >= WIDE_DESKTOP_MIN_WIDTH ? middleOf(geometry.meta) : { x: geometry.row.right - 4, y };
}

async function close(page: Page, how: Closer): Promise<void> {
  if (how === 'Escape') {
    await page.keyboard.press('Escape');
    await expect(popup(page)).toHaveCount(0);
  } else if (how === 'Back') {
    await page.goBack();
    await expect(page).toHaveURL(/\/duels\?view=history$/);
    await expect(popup(page)).toHaveCount(0);
  } else {
    await popup(page).getByRole('link', { name: 'Challenge' }).click();
    await expect(sheet(page)).toBeVisible();
    await sheet(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/duels\?view=history$/);
  }
}

async function open(page: Page, point: Point, width: number): Promise<void> {
  await page.mouse.click(point.x, point.y);
  if (width >= POPUP_MIN_WIDTH) await expect(popup(page)).toBeVisible();
  else await expect(page).toHaveURL(new RegExp(`/runner/${RUNNER.id}$`));
}

const isFullyInView = async (page: Page, row: number, side: Side): Promise<boolean> => {
  const box = await halfOf(page, row, side).boundingBox();
  const viewport = page.viewportSize();
  return !!box && !!viewport && box.y >= 0 && box.y + box.height <= viewport.height && box.x >= 0 && box.x + box.width <= viewport.width;
};

test.describe('the focus after the runner card closes on the match history', () => {
  test.skip(!apiIsStubbed(), 'The screen is filled from a stubbed challenges API; run with E2E_STUB_API=1 against a local build.');

  for (const width of WIDTHS) {
    for (const theme of THEMES) {
      test(`closing the runner card puts the focus back on the half that opened it at ${width} px in the ${theme} theme`, async ({ page }) => {
        await openHistory(page, FOUR_ROWS, { width, height: 800 }, theme);
        const closers: Closer[] = width >= POPUP_MIN_WIDTH ? ['Escape', 'Back', 'Cancel'] : ['Back'];

        for (const { row, side } of RUNNER_SEATS) {
          for (const how of closers) {
            for (const target of CLICK_TARGETS) {
              const where = `${how} after a click on ${target} of the ${side} half of row ${row}`;
              await open(page, await pointOf(page, row, side, width, target), width);
              await close(page, how);

              await expect.soft(halfOf(page, row, side), `${where}: the focus is on that half`).toBeFocused();
              expect.soft(await isFullyInView(page, row, side), `${where}: the half is in view`).toBe(true);
            }
          }
        }
      });
    }
  }

  for (const width of [375, 1280]) {
    test(`closing the runner card from a row far down leaves the page where it was at ${width} px`, async ({ page }) => {
      await openHistory(page, TWELVE_ROWS, { width, height: 800 }, 'dark');
      const closers: Closer[] = width >= POPUP_MIN_WIDTH ? ['Escape', 'Back'] : ['Back'];

      for (const how of closers) {
        const point = await pointOf(page, 11, 'right', width, 'the name');
        const rowHeight = await page.locator('.rq-duels-match').nth(11).evaluate((row) => row.getBoundingClientRect().height);
        const scrolledBefore = await page.evaluate(() => window.scrollY);
        expect(scrolledBefore, 'row 11 is below the first screen').toBeGreaterThan(0);

        await open(page, point, width);
        await close(page, how);

        await expect.soft(halfOf(page, 11, 'right'), `${how}: the focus is on the right half of row 11`).toBeFocused();
        const scrolledAfter = await page.evaluate(() => window.scrollY);
        expect.soft(Math.abs(scrolledAfter - scrolledBefore), `${how}: the page scrolled ${scrolledBefore} px before and ${scrolledAfter} px after`).toBeLessThanOrEqual(rowHeight + SCROLL_TOLERANCE_PX);
        expect.soft(await isFullyInView(page, 11, 'right'), `${how}: row 11 is in view`).toBe(true);
      }
    });
  }
});
