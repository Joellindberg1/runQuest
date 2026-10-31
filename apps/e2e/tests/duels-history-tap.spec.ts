import type { Page } from '@playwright/test';
import type { ChallengeGroupStat, ChallengeHistoryItem, MyChallengesData } from '../../../packages/shared/src/contracts/challenges';
import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';
import { apiIsStubbed, STUB_USER } from '../support/stubApi';
import { waitForStylesApplied } from '../support/stylesApplied';

/** Minsta tryckyta (WCAG 2.5.5, och appens egen regel för knappar). */
const MIN_TAP_PX = 44;
/** Några pixlar marginal för subpixelavrundning i mätningarna. */
const TOLERANCE_PX = 1;
const PHONE_WIDTHS = [320, 375, 390];
const DESKTOP_SIZE = { width: 1280, height: 800 };
/** Steget mellan provpunkterna i sidled när en halvas träffyta mäts. */
const SAMPLE_STEP_PX = 6;

const CORS_HEADERS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

const NAMES: Record<string, string> = {
  [STUB_USER.id]: STUB_USER.name,
  'member-1': 'Maria Johansson',
  'member-2': 'Olof Bergstrom',
  'member-3': 'Sebastian Andersson',
  'member-4': 'Jonathan Söderström',
};

// Rad 0 är min (jag är utmanaren), rad 1 är min (jag är motståndaren), rad 2 och 3 är andras och rad 3 slutar oavgjort.
const PAIRS: Array<[string, string]> = [
  [STUB_USER.id, 'member-1'],
  ['member-2', STUB_USER.id],
  ['member-3', 'member-4'],
  ['member-4', 'member-1'],
];

const history: ChallengeHistoryItem[] = PAIRS.map(([challengerId, opponentId], index) => ({
  id: `history-${index}`,
  tier: 'major',
  metric: 'km',
  duration_days: 14,
  start_date: '2026-10-01',
  end_date: '2026-10-15',
  ended_at: '2026-10-15T22:00:00Z',
  outcome: index === 3 ? 'draw' : index % 2 === 0 ? 'challenger_wins' : 'opponent_wins',
  winner_id: index === 3 ? null : index % 2 === 0 ? challengerId : opponentId,
  challenger: { id: challengerId, name: NAMES[challengerId]!, profile_picture: null, level: 18 },
  opponent: { id: opponentId, name: NAMES[opponentId]!, profile_picture: null, level: 17 },
  challenger_value: 41.5,
  opponent_value: index === 3 ? 41.5 : 38.25,
  winner_boost: { type: 'multiplier_days', delta: 0.5, duration: 14 },
  loser_boost: { type: 'multiplier_days', delta: -0.25, duration: 14 },
}));

const myChallenges: MyChallengesData = { tokens: [], sent_challenge: null, received_challenges: [], boosts: [], history: [], group_active: [] };
const groupStats: ChallengeGroupStat[] = Object.entries(NAMES).map(([id, name], index) => ({
  user_id: id, name, wins: 5 - index, draws: 1, losses: index, total: 6, points: 50 - index * 5, challenge_active: false, has_pending_challenge: false, current_level: 10, profile_picture: null,
}));

async function stubDuelsApi(page: Page): Promise<void> {
  await page.route('**/api/challenges/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const reply = (data: unknown, extra: object = {}) =>
      route.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify({ success: true, data, ...extra }) });
    if (path === '/challenges/my') return reply(myChallenges);
    if (path === '/challenges/group-stats') return reply(groupStats);
    if (path === '/challenges/group-history') return reply({ items: history }, { meta: { total: history.length, limit: 20, offset: 0, has_more: false } });
    return route.fulfill({ status: 404, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'not stubbed' }) });
  });
}

async function openHistory(page: Page, size: { width: number; height: number }): Promise<void> {
  await stubDuelsApi(page);
  await page.addInitScript(() => window.localStorage.setItem('theme', 'dark'));
  await page.setViewportSize(size);
  await page.goto('/duels?view=standings');
  await dismissOverlays(page);
  await waitForStylesApplied(page);
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.locator('.rq-duels-match')).toHaveCount(history.length);
  await waitForStylesApplied(page);
  // Runner card är en lazy route: första trycket väntar på dess kod. Öppnas den en gång här är varje senare tryck ett rent adressbyte som kan avgöras på kort tid.
  await page.locator('.rq-duels-match').nth(2).locator('.rq-duels-match__name').first().click();
  await expect(page).toHaveURL(/\/runner\//);
  await page.goBack();
  await expect(page.locator('.rq-duels-match')).toHaveCount(history.length);
  await waitForStylesApplied(page);
}

type Side = 'left' | 'right';
const SIDE_INDEX: Record<Side, number> = { left: 0, right: 1 };

interface Point {
  x: number;
  y: number;
}

/** Radens rutor i sidans koordinater, för provpunkter. Raden rullas till mitten av fönstret först, så att punkterna ligger i vyn. */
async function rowGeometry(page: Page, rowIndex: number) {
  return page.locator('.rq-duels-match').nth(rowIndex).evaluate((row) => {
    row.scrollIntoView({ block: 'center' });
    const rect = (element: Element | null) => {
      const box = element!.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const sides = Array.from(row.querySelectorAll('.rq-duels-match__side'));
    return {
      row: rect(row),
      vs: rect(row.querySelector('.rq-duels-match__vs')),
      meta: rect(row.querySelector('.rq-duels-match__meta')),
      name: [rect(sides[0]!.querySelector('.rq-duels-match__name')), rect(sides[1]!.querySelector('.rq-duels-match__name'))],
      score: [rect(sides[0]!.querySelector('.rq-duels-match__score')), rect(sides[1]!.querySelector('.rq-duels-match__score'))],
    };
  });
}

const centre = (box: { left: number; right: number; top: number; bottom: number }): Point => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 });

/** Klickar i en punkt och ger id:t på löparen vars kort öppnades (adressen `/runner/<id>`), sedan tillbaka till historiken. */
async function tapAndReadRunner(page: Page, point: Point): Promise<string | null> {
  const before = page.url();
  await page.mouse.click(point.x, point.y);
  // Ett tryck som inte träffar något ändrar inte adressen: vänta kort på en ändring i stället för att anta den.
  const changed = await page.waitForURL((url) => url.toString() !== before, { timeout: 1500 }).then(() => true, () => false);
  // Mitt eget kort öppnas som min profil (`/profile`) i stället för `/runner/<mitt id>`.
  const opened = changed ? runnerIdFromUrl(page.url()) : null;
  if (changed) {
    await page.goBack();
    await expect(page.locator('.rq-duels-match')).toHaveCount(history.length);
    await waitForStylesApplied(page);
  }
  return opened;
}

function runnerIdFromUrl(url: string): string | null {
  const { pathname } = new URL(url);
  if (pathname === '/profile') return STUB_USER.id;
  const match = /^\/runner\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]!) : null;
}

interface HitArea {
  /** Antal pixlar i höjd som provpunkterna i halvan träffar namnknappen (alltså knappen och dess utökade träffyta). */
  height: number;
  /** Antal pixlar i bredd, mätt på samma sätt. */
  width: number;
}

/**
 * Mäter en halvas tryckyta på det en tryckning träffar: raden rastreras med `elementFromPoint` över halvans bredd och radens hela höjd,
 * och varje punkt som landar i halvans namnknapp räknas. Ytan är rutan runt alla sådana punkter.
 */
async function measureHitArea(page: Page, rowIndex: number, side: Side, splitX: number | null): Promise<HitArea> {
  const geometry = await rowGeometry(page, rowIndex);
  return page.locator('.rq-duels-match').nth(rowIndex).evaluate(
    (row, { index, rowBox, split, step }) => {
      const button = row.querySelectorAll<HTMLElement>('.rq-duels-match__name')[index]!;
      const from = index === 0 ? rowBox.left : split;
      const to = index === 0 ? split : rowBox.right;
      let top = Infinity;
      let bottom = -Infinity;
      let left = Infinity;
      let right = -Infinity;
      for (let y = Math.floor(rowBox.top); y < rowBox.bottom; y += 1) {
        for (let x = Math.ceil(from); x < to; x += step) {
          const hit = document.elementFromPoint(x, y);
          if (hit && button.contains(hit)) {
            top = Math.min(top, y);
            bottom = Math.max(bottom, y + 1);
            left = Math.min(left, x);
            right = Math.max(right, x + 1);
          }
        }
      }
      return top === Infinity ? { height: 0, width: 0 } : { height: bottom - top, width: right - left };
    },
    { index: SIDE_INDEX[side], rowBox: geometry.row, split: splitX ?? centre(geometry.row).x, step: SAMPLE_STEP_PX },
  );
}

test.describe('the match history rows', () => {
  test.skip(!apiIsStubbed(), 'The screen is filled from a stubbed challenges API; run with E2E_STUB_API=1 against a local build.');

  for (const width of PHONE_WIDTHS) {
    test(`each half of a history row is at least ${MIN_TAP_PX} px tall to tap at ${width} px`, async ({ page }) => {
      await openHistory(page, { width, height: 800 });

      for (let rowIndex = 0; rowIndex < history.length; rowIndex += 1) {
        for (const side of ['left', 'right'] as const) {
          const area = await measureHitArea(page, rowIndex, side, null);
          expect.soft(area.height, `the ${side} half of row ${rowIndex} reacts to a tap over at least ${MIN_TAP_PX} px of height`).toBeGreaterThanOrEqual(MIN_TAP_PX - TOLERANCE_PX);
        }
      }
    });

    test(`a tap in either half of a history row, outside the name, opens that participant at ${width} px`, async ({ page }) => {
      await openHistory(page, { width, height: 800 });

      for (let rowIndex = 0; rowIndex < history.length; rowIndex += 1) {
        const [leftId, rightId] = PAIRS[rowIndex]!;
        const geometry = await rowGeometry(page, rowIndex);
        const middle = centre(geometry.row);
        const edge = 4;

        expect.soft(await tapAndReadRunner(page, centre(geometry.name[0]!)), `row ${rowIndex}: the name of the left side`).toBe(leftId);
        expect.soft(await tapAndReadRunner(page, centre(geometry.name[1]!)), `row ${rowIndex}: the name of the right side`).toBe(rightId);
        expect.soft(await tapAndReadRunner(page, { x: geometry.row.left + edge, y: middle.y }), `row ${rowIndex}: the left edge of the row`).toBe(leftId);
        expect.soft(await tapAndReadRunner(page, { x: geometry.row.right - edge, y: middle.y }), `row ${rowIndex}: the right edge of the row`).toBe(rightId);
        expect.soft(await tapAndReadRunner(page, centre(geometry.score[0]!)), `row ${rowIndex}: the score of the left side`).toBe(leftId);
        expect.soft(await tapAndReadRunner(page, centre(geometry.score[1]!)), `row ${rowIndex}: the score of the right side`).toBe(rightId);
        // Metaraden ligger under paret på mobil: ett tryck där öppnar den sida som trycket ligger på.
        const metaY = (geometry.meta.top + geometry.meta.bottom) / 2;
        expect.soft(await tapAndReadRunner(page, { x: geometry.row.left + geometry.row.width * 0.2, y: metaY }), `row ${rowIndex}: the meta line, left of the middle`).toBe(leftId);
        expect.soft(await tapAndReadRunner(page, { x: geometry.row.left + geometry.row.width * 0.8, y: metaY }), `row ${rowIndex}: the meta line, right of the middle`).toBe(rightId);
      }
    });
  }

  test('on desktop the pair splits at the middle of "vs", and a tap on the meta columns opens the right participant', async ({ page }) => {
    await openHistory(page, DESKTOP_SIZE);

    for (let rowIndex = 0; rowIndex < history.length; rowIndex += 1) {
      const [leftId, rightId] = PAIRS[rowIndex]!;
      const geometry = await rowGeometry(page, rowIndex);
      const vsX = centre(geometry.vs).x;
      const y = centre(geometry.row).y;

      expect.soft(await tapAndReadRunner(page, centre(geometry.name[0]!)), `row ${rowIndex}: the name of the left side`).toBe(leftId);
      expect.soft(await tapAndReadRunner(page, centre(geometry.name[1]!)), `row ${rowIndex}: the name of the right side`).toBe(rightId);
      expect.soft(await tapAndReadRunner(page, { x: vsX - 6, y }), `row ${rowIndex}: just left of the middle of "vs"`).toBe(leftId);
      expect.soft(await tapAndReadRunner(page, { x: vsX + 6, y }), `row ${rowIndex}: just right of the middle of "vs"`).toBe(rightId);
      expect.soft(await tapAndReadRunner(page, centre(geometry.score[0]!)), `row ${rowIndex}: the score of the left side`).toBe(leftId);
      expect.soft(await tapAndReadRunner(page, centre(geometry.score[1]!)), `row ${rowIndex}: the score of the right side`).toBe(rightId);
      expect.soft(await tapAndReadRunner(page, centre(geometry.meta)), `row ${rowIndex}: the meta column`).toBe(rightId);
    }
  });

  test('a row has one tab stop per participant, and no interactive element sits inside another', async ({ page }) => {
    await openHistory(page, { width: 375, height: 812 });

    for (let rowIndex = 0; rowIndex < history.length; rowIndex += 1) {
      const row = page.locator('.rq-duels-match').nth(rowIndex);
      const [leftId, rightId] = PAIRS[rowIndex]!;
      await expect(row.locator('button, a, [tabindex], [role="button"], [role="link"]'), `row ${rowIndex} has exactly two interactive elements`).toHaveCount(2);
      await expect(row.locator('button button, button a, a button, a a'), `row ${rowIndex} nests no interactive element in another`).toHaveCount(0);
      await expect(row.getByRole('button', { name: NAMES[leftId!] })).toHaveCount(1);
      await expect(row.getByRole('button', { name: NAMES[rightId!] })).toHaveCount(1);
    }
  });

  test('keyboard focus on a participant draws an inward ring around the whole half that a tap would hit', async ({ page }) => {
    await openHistory(page, { width: 375, height: 812 });

    const rowIndex = 2;
    const left = page.locator('.rq-duels-match').nth(rowIndex).locator('.rq-duels-match__name').first();
    await left.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(left).toBeFocused();

    const ring = await left.evaluate((button) => {
      const own = getComputedStyle(button);
      const half = getComputedStyle(button, '::after');
      return {
        ownOutline: own.outlineStyle,
        halfOutline: half.outlineStyle,
        halfOutlineWidth: parseFloat(half.outlineWidth),
        halfOffset: parseFloat(half.outlineOffset),
      };
    });

    expect(ring.ownOutline, 'the name itself draws no ring').toBe('none');
    expect(ring.halfOutline, 'the hit area draws the ring').not.toBe('none');
    expect(ring.halfOutlineWidth, 'the ring has a width').toBeGreaterThan(0);
    expect(ring.halfOffset, 'the ring is drawn inwards, so no clipping container cuts it').toBeLessThan(0);
  });
});
