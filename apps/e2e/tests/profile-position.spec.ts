import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';
import { ALL_TIME_STUB_WEEKS, RANGE_WIDTHS, answerPositions, boxesOf, expectWeekLabelsClear, ringOf } from '../support/positionRange';
import { waitForStylesApplied } from '../support/stylesApplied';
import { apiIsStubbed } from '../support/stubApi';
import { changeViewInTheAddress, expectSelectedTabClearOfFade, waitForFontsAndLayout } from '../support/tabFade';
import { targets } from '../support/targets';

/** Några pixlar marginal för subpixelavrundning i mätningarna. */
const TOLERANCE_PX = 1;
/** Minsta träffyta för tumme (temats --rq-control-hit på mobil). */
const MIN_TOUCH_TARGET_PX = 44;
/** Fokusringens minsta tjocklek (temats globala ring är 2 px). */
const MIN_RING_WIDTH_PX = 2;

const TABS = ['Distance', 'Streak', 'Fun facts', 'Consistency', 'Position'];
const PHONE_WIDTHS = [320, 375];
/** Bredderna där flikraden skrollar och en flik kan hamna en bråkdel av en pixel förbi kanten efter ett heltals-`scrollLeft`. */
const NARROW_PHONE_WIDTHS = [320, 340, 360];
const PROFILE_VIEWS = [
  { view: 'distance', name: 'Distance' },
  { view: 'streak', name: 'Streak' },
  { view: 'fun', name: 'Fun facts' },
  { view: 'consistency', name: 'Consistency' },
  { view: 'position', name: 'Position' },
];
const ROW_WIDTHS = [
  { width: 320, height: 740 },
  { width: 375, height: 740 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

// Gruppen och positionssvaret läggs över API:et i webbläsaren (sidans rutt går före kontextens), så provet gäller det fejkade API:ets löpare. Hoppas över mot staging: där vet provet inte vilket id
// den inloggade löparen har, och positionssvaret måste innehålla just hens rad.
const ME_ID = 'stub-user-1';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

function member(id: string, name: string, xp: number) {
  return { id, name, email: `${id}@example.test`, is_admin: false, total_xp: xp, current_level: 8, total_km: 321.5, current_streak: 2, longest_streak: 4, runs: [] };
}
const groupOf = (size: number) => [
  { ...member(ME_ID, 'Stub Runner', 5000), total_km: 42.5 },
  ...Array.from({ length: size - 1 }, (_, index) => member(`position-mate-${index + 1}`, `Mate Number${index + 1}`, 4800 - index * 300)),
];

// Åtta veckor över årsskiftet: 2026 har en vecka 53 (28 dec - 3 jan), och veckan som pågår är vecka 1 2027.
const ISO_WEEKS = [
  { start: '2026-11-16', end: '2026-11-22', iso_week: 47, iso_year: 2026, is_current_week: false },
  { start: '2026-11-23', end: '2026-11-29', iso_week: 48, iso_year: 2026, is_current_week: false },
  { start: '2026-11-30', end: '2026-12-06', iso_week: 49, iso_year: 2026, is_current_week: false },
  { start: '2026-12-07', end: '2026-12-13', iso_week: 50, iso_year: 2026, is_current_week: false },
  { start: '2026-12-14', end: '2026-12-20', iso_week: 51, iso_year: 2026, is_current_week: false },
  { start: '2026-12-21', end: '2026-12-27', iso_week: 52, iso_year: 2026, is_current_week: false },
  { start: '2026-12-28', end: '2027-01-03', iso_week: 53, iso_year: 2026, is_current_week: false },
  { start: '2027-01-04', end: '2027-01-10', iso_week: 1, iso_year: 2027, is_current_week: true },
];

function positionsOf(mine: Array<number | null>, weeks = ISO_WEEKS.slice(-mine.length)) {
  const others = ['position-mate-1', 'position-mate-2', 'position-mate-3'].map((id) => ({ user_id: id, name: id, profile_picture: null, member_since: null, positions: mine.map(() => 2) }));
  return {
    as_of: '2027-01-05',
    weeks,
    runners: [{ user_id: ME_ID, name: 'Stub Runner', profile_picture: null, member_since: null, positions: mine }, ...others],
  };
}
/** ISO-veckan `back` veckor före vecka 1 2027. 2026 har 53 veckor, så en period över en vecka korsar årsskiftet. */
const WEEKS_IN_2026 = 53;
const isoWeekBack = (back: number) => {
  const week = 1 - back;
  return week >= 1 ? { iso_week: week, iso_year: 2027 } : { iso_week: week + WEEKS_IN_2026, iso_year: 2026 };
};
const longWeeks = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ start: '2026-11-16', end: '2026-11-22', ...isoWeekBack(count - 1 - index), is_current_week: index === count - 1 }));

const READY = positionsOf([1, 1, 2, 1, 1, 1, 1, 2]);
// All time: 44 veckor. Bäst #1 de fem första veckorna, sämst #4 var nionde vecka, annars #3, och de senaste åtta veckorna är samma som READY. Best, Lowest och Now ska följa vyn.
const LAST_EIGHT = [1, 1, 2, 1, 1, 1, 1, 2];
const ALL_TIME_MINE = Array.from({ length: ALL_TIME_STUB_WEEKS }, (_, i) => (i >= ALL_TIME_STUB_WEEKS - 8 ? LAST_EIGHT[i - (ALL_TIME_STUB_WEEKS - 8)]! : i < 5 ? 1 : i % 9 === 0 ? 4 : 3));
const ALL_TIME = positionsOf(ALL_TIME_MINE, longWeeks(ALL_TIME_STUB_WEEKS));
const NEW_RUNNER = positionsOf([null, null, null, null, null, null, null, 3]);
const NO_FINISHED_WEEK = positionsOf([1], [ISO_WEEKS[7]!]);

async function answerWith(page: Page, path: string, body: unknown): Promise<void> {
  await page.route(`${targets.apiUrl}/**${path}*`, (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS_HEADERS })
      : route.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

interface OpenOptions {
  members: number;
  positions?: unknown;
  /** Svaret för All time (`weeks=104`). Utan det ger varje antal veckor `positions`. */
  allTime?: unknown;
  /** Hur länge svaret för All time hålls tillbaka. */
  allTimeDelayMs?: number;
  view?: string;
  width: number;
  height?: number;
}

/** Öppnar profilen med en grupp av vald storlek. Returnerar räknarna över positionsbegäran och antalet veckor varje begäran gällde. */
async function openProfile(
  page: Page,
  { members, positions = READY, allTime, allTimeDelayMs, view, width, height = 740 }: OpenOptions,
): Promise<{ positionRequests: () => number; weeksAsked: () => number[] }> {
  let requests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/leaderboard/positions')) requests += 1;
  });
  await answerWith(page, '/auth/users-with-runs', { success: true, data: groupOf(members) });
  const answers = await answerPositions(page, { recent: positions, allTime, allTimeDelayMs });
  await page.setViewportSize({ width, height });
  await page.goto(view ? `/profile?view=${view}` : '/profile');
  await dismissOverlays(page);
  await expect(page.getByRole('tablist', { name: 'Your stats' })).toBeVisible();
  await waitForStylesApplied(page);
  return { positionRequests: () => requests, weeksAsked: answers.weeksAsked };
}

const rowAndTab = (tablist: Locator, tab: Locator) =>
  Promise.all([
    tablist.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right };
    }),
    tab.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right };
    }),
  ]);

async function pageDoesNotScrollSideways(page: Page): Promise<void> {
  const root = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(root.scrollWidth, 'the page is not wider than the window').toBeLessThanOrEqual(root.clientWidth + TOLERANCE_PX);
}

test.describe('the Position tab on the profile', () => {
  test.skip(!apiIsStubbed(), 'The group and the positions are put over a stubbed API; run with E2E_STUB_API=1 against a local build.');

  for (const width of PHONE_WIDTHS) {
    test(`the chart, the table toggle and the year-end week work on a ${width} px phone`, async ({ page }) => {
      await openProfile(page, { members: 6, view: 'position', width });
      const chart = page.getByRole('img', { name: /^Position in the group, week 47, 2026 to week 1, 2027/ });
      await expect(chart).toBeVisible();

      await pageDoesNotScrollSideways(page);

      // Show as table: aria-expanded följer tabellen, som är dold (hidden) tills den öppnas.
      const toggle = page.getByRole('button', { name: 'Show as table' });
      const table = page.locator('.rq-profile-position__table');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(table).toBeHidden();

      // Fokusringen på knappen: tangentbordsfokus (:focus-visible) ritar en ring som syns och ligger inom kortet och fönstret.
      await page.keyboard.press('Tab');
      await toggle.focus();
      const ring = await toggle.evaluate((element) => {
        const style = getComputedStyle(element);
        const reach = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
        const box = element.getBoundingClientRect();
        const card = element.closest('.rq-card')!.getBoundingClientRect();
        return {
          drawn: style.outlineStyle !== 'none',
          width: parseFloat(style.outlineWidth),
          focused: document.activeElement === element,
          insideCard: box.left - reach >= card.left - 1 && box.right + reach <= card.right + 1 && box.top - reach >= card.top - 1 && box.bottom + reach <= card.bottom + 1,
          insideWindow: box.left - reach >= -1 && box.right + reach <= innerWidth + 1,
        };
      });
      expect(ring.focused).toBe(true);
      expect(ring.drawn, 'the toggle shows a focus ring').toBe(true);
      expect(ring.width, 'the ring is at least 2 px').toBeGreaterThanOrEqual(MIN_RING_WIDTH_PX);
      expect(ring.insideCard, 'the ring is not clipped by the card').toBe(true);
      expect(ring.insideWindow, 'the ring is inside the window').toBe(true);

      await page.keyboard.press('Enter');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(table).toBeVisible();
      // Årsskiftet: veckorna har år i de talade etiketterna (vecka 53 hör till 2026), och tabellen ligger inom kortet utan sidled scroll.
      const rowHeaders = await table.locator('tbody th').evaluateAll((cells) => cells.map((cell) => cell.textContent ?? ''));
      expect(rowHeaders).toHaveLength(ISO_WEEKS.length);
      expect(rowHeaders.some((text) => text.includes('week 53, 2026')), 'a row says week 53, 2026').toBe(true);
      expect(rowHeaders.at(-1), 'the current week is week 1, 2027').toContain('week 1, 2027');
      await expect(table.locator('caption')).toHaveText(/week 47, 2026 to week 1, 2027/);
      await pageDoesNotScrollSideways(page);
      const fit = await table.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const card = element.closest('.rq-card')!.getBoundingClientRect();
        return box.left >= card.left - 1 && box.right <= card.right + 1;
      });
      expect(fit, 'the table is inside the card').toBe(true);

      await page.keyboard.press('Space');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(table).toBeHidden();
      await pageDoesNotScrollSideways(page);
    });

    test(`the new-runner and no-finished-week texts fit a ${width} px phone`, async ({ page }) => {
      await openProfile(page, { members: 6, view: 'position', width, positions: NEW_RUNNER });
      await expect(page.getByText('First week in the group. Position appears after your first week')).toBeVisible();
      await pageDoesNotScrollSideways(page);
      await page.unroute(`${targets.apiUrl}/**/leaderboard/positions*`);
      await answerWith(page, '/leaderboard/positions', { success: true, data: NO_FINISHED_WEEK });
      await page.reload();
      await dismissOverlays(page);
      await expect(page.getByText('No finished week yet. Position shows where you stood at the end of each week.')).toBeVisible();
      await pageDoesNotScrollSideways(page);
    });
  }

  test('with one member the tab is hidden, ?view=position falls back to Distance and no position request is made', async ({ page }) => {
    const group = await openProfile(page, { members: 1, view: 'position', width: 375 });

    await expect(page.getByRole('tab')).toHaveText(TABS.slice(0, 4));
    await expect(page.getByRole('tab', { name: 'Distance' })).toHaveAttribute('aria-selected', 'true');
    // Svaret hade hunnit komma: en liten väntan efter att sidan ritats visar att ingen begäran startar efteråt heller.
    await page.waitForTimeout(500);
    expect(group.positionRequests()).toBe(0);
  });

  test('no position request goes out on the other tabs, and exactly one when Position is opened', async ({ page }) => {
    const group = await openProfile(page, { members: 6, width: 375 });

    for (const name of TABS.slice(0, 4)) {
      await page.getByRole('tab', { name }).click();
      await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
    }
    await page.waitForTimeout(500);
    expect(group.positionRequests()).toBe(0);

    await page.getByRole('tab', { name: 'Position' }).click();
    await expect(page.getByRole('img', { name: /^Position in the group/ })).toBeVisible();
    expect(group.positionRequests()).toBe(1);
  });
});

test.describe('the five-tab row of the profile', () => {
  test.skip(!apiIsStubbed(), 'The group is put over a stubbed API; run with E2E_STUB_API=1 against a local build.');

  for (const { width, height } of ROW_WIDTHS) {
    test(`shows the selected tab in the row and keeps the page still at ${width} px, from the address and from the keyboard`, async ({ page }) => {
      await openProfile(page, { members: 6, view: 'position', width, height });
      const tablist = page.getByRole('tablist', { name: 'Your stats' });
      await expect(page.getByRole('tab')).toHaveText(TABS);
      await pageDoesNotScrollSideways(page);

      // Via adressen: Position är vald och ligger helt i raden.
      const position = page.getByRole('tab', { name: 'Position' });
      await expect(position).toHaveAttribute('aria-selected', 'true');
      await expect
        .poll(async () => {
          const [row, tab] = await rowAndTab(tablist, position);
          return tab.left >= row.left - TOLERANCE_PX && tab.right <= row.right + TOLERANCE_PX;
        })
        .toBe(true);

      // Via tangentbordet: piltangenterna loopar genom alla fem, och var och en ligger helt i raden när den är vald.
      await page.getByRole('tab', { name: 'Distance' }).click();
      for (const name of [...TABS.slice(1), TABS[0]!]) {
        const tab = page.getByRole('tab', { name });
        await page.keyboard.press('ArrowRight');
        await expect(tab).toBeFocused();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        await expect
          .poll(async () => {
            const [row, box] = await rowAndTab(tablist, tab);
            return box.left >= row.left - TOLERANCE_PX && box.right <= row.right + TOLERANCE_PX;
          }, { message: `the "${name}" tab is inside the tab row` })
          .toBe(true);
        // Fokusringen ritas inåt och har en annan färg än guldet under den valda fliken, annars flyter ringen ihop med understrykningen.
        const ring = await tab.evaluate((element) => {
          const style = getComputedStyle(element);
          return { style: style.outlineStyle, width: parseFloat(style.outlineWidth), offset: parseFloat(style.outlineOffset), color: style.outlineColor, underline: style.borderBottomColor };
        });
        expect(ring.style, `the "${name}" tab shows a focus ring`).not.toBe('none');
        expect(ring.width, `the ring of the "${name}" tab`).toBeGreaterThanOrEqual(MIN_RING_WIDTH_PX);
        expect(ring.offset, `the ring of the "${name}" tab is drawn inward`).toBeLessThan(0);
        expect(ring.color, `the ring of the "${name}" tab differs from the gold under the selected tab`).not.toBe(ring.underline);
      }
      await pageDoesNotScrollSideways(page);
    });

    test(`has tabs of at least 44 px on a phone and equal widths when they all fit, with a fade only where the row scrolls, at ${width} px`, async ({ page }) => {
      await openProfile(page, { members: 6, width, height });
      const tablist = page.getByRole('tablist', { name: 'Your stats' });
      const wrap = tablist.locator('xpath=..');

      const heights = await page.getByRole('tab').evaluateAll((tabs) => tabs.map((tab) => tab.getBoundingClientRect().height));
      expect(heights).toHaveLength(TABS.length);
      if (width < 1024) heights.forEach((value, index) => expect(value, `the "${TABS[index]}" tab`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX));

      const metrics = await tablist.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
      const overflows = metrics.scrollWidth > metrics.clientWidth + TOLERANCE_PX;
      // Kantfaden syns åt slutet när raden scrollar och står på första fliken, och inte alls när allt ryms.
      await expect(wrap).toHaveAttribute('data-fade-end', String(overflows));
      await expect(wrap).toHaveAttribute('data-fade-start', 'false');
      const mask = await tablist.evaluate((element) => getComputedStyle(element).maskImage);
      if (overflows) expect(mask, 'the end of the row is faded').not.toBe('none');
      else {
        expect(mask).toBe('none');
        const widths = await page.getByRole('tab').evaluateAll((tabs) => tabs.map((tab) => tab.getBoundingClientRect().width));
        expect(Math.max(...widths) - Math.min(...widths), 'the five tabs are equally wide').toBeLessThanOrEqual(TOLERANCE_PX);
      }
    });
  }

  // Webbläsaren ger `scrollLeft` som heltal, så en flik som förs i bild kan hamna en bråkdel av en pixel förbi kanten (Consistency mot högerkanten vid 320 till 360 px): fadens 24 px frihet ska ändå läggas på.
  // Typsnittet är laddat före varje byte (det är så en användare byter flik efter första ritningen).
  for (const width of NARROW_PHONE_WIDTHS) {
    test(`keeps the selected tab clear of the fade for each of the five tabs, from the address and from the keyboard, at ${width} px`, async ({ page }) => {
      await openProfile(page, { members: 6, view: PROFILE_VIEWS[0]!.view, width });
      await waitForFontsAndLayout(page);
      const tablist = page.getByRole('tablist', { name: 'Your stats' });

      for (const { view, name } of PROFILE_VIEWS) {
        await changeViewInTheAddress(page, view);
        await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
        await expectSelectedTabClearOfFade(tablist, `the "${name}" tab, opened from the address, is in the row and clear of the fade at ${width} px`);
      }

      await page.getByRole('tab', { name: PROFILE_VIEWS[0]!.name }).click();
      for (const { name } of PROFILE_VIEWS.slice(1)) {
        await page.keyboard.press('ArrowRight');
        await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
        await expectSelectedTabClearOfFade(tablist, `the "${name}" tab, reached with ArrowRight, is in the row and clear of the fade at ${width} px`);
      }
    });
  }

  test('fades the start and keeps the selected tab clear of the fade once the row has been scrolled, at 320 px', async ({ page }) => {
    await openProfile(page, { members: 6, view: 'position', width: 320 });
    const tablist = page.getByRole('tablist', { name: 'Your stats' });
    const wrap = tablist.locator('xpath=..');

    // Position är sista fliken: raden är scrollad till slutet, så fadens slutkant är borta och startkanten syns.
    await expect(wrap).toHaveAttribute('data-fade-start', 'true');
    await expect(wrap).toHaveAttribute('data-fade-end', 'false');

    // En flik i mitten: båda kanterna syns, och fliken ligger utanför fadens zon (scroll-padding) på de sidor där en fade ritas.
    await page.getByRole('tab', { name: 'Fun facts' }).click();
    await expect(wrap).toHaveAttribute('data-fade-start', 'true');
    await expect(wrap).toHaveAttribute('data-fade-end', 'true');
    await expect
      .poll(async () =>
        tablist.evaluate((element) => {
          const zone = parseFloat(getComputedStyle(element).scrollPaddingLeft);
          const tab = element.querySelector('[role="tab"][aria-selected="true"]')!.getBoundingClientRect();
          const row = element.getBoundingClientRect();
          return { zone, clearOfStart: tab.left - row.left >= zone - 1, clearOfEnd: row.right - tab.right >= zone - 1 };
        }),
      )
      .toMatchObject({ clearOfStart: true, clearOfEnd: true });
  });
});

const rangeSwitchOf = (page: Page) => page.getByRole('group', { name: 'Position range' });
const rangeButtonOf = (page: Page, name: string) => rangeSwitchOf(page).getByRole('button', { name });
/** Bilden i båda vyerna: "week 47, 2026 to week 1, 2027" för åtta veckor över årsskiftet, "week 11, 2026 to week 1, 2027" för All time (44 veckor). */
const positionChartOf = (page: Page) => page.getByRole('img', { name: /^Position in the group, / });
const RECENT_CHART = /^Position in the group, week 47, 2026 to week 1, 2027/;
const ALL_TIME_CHART = /^Position in the group, week 11, 2026 to week 1, 2027/;
const statsOf = (page: Page) => page.locator('.rq-profile-position__stats');
const THEMES = ['dark', 'light'] as const;

test.describe('the Position range switch on the profile', () => {
  test.skip(!apiIsStubbed(), 'The group and the positions are put over a stubbed API; run with E2E_STUB_API=1 against a local build.');

  const open = (page: Page, width: number, extra: Partial<OpenOptions> = {}) =>
    openProfile(page, { members: 6, view: 'position', width, positions: READY, allTime: ALL_TIME, ...extra });

  for (const theme of THEMES) {
    for (const width of RANGE_WIDTHS) {
      test(`switches to All time and back with readable week labels, dots and a still page, in the ${theme} theme at ${width} px`, async ({ page }) => {
        await page.addInitScript((value) => window.localStorage.setItem('theme', value), theme);
        const group = await open(page, width, { height: width < 1024 ? 740 : 900 });
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const labels = page.locator('.rq-profile-position__week');
        const plot = page.locator('.rq-profile-position__chart');
        const dots = page.locator('.rq-profile-position__dot');

        // Standard: de senaste åtta veckorna, en etikett och en dotta per vecka. Best, Lowest och Now är för de veckorna.
        await expect(positionChartOf(page)).toHaveAccessibleName(RECENT_CHART);
        await expect(rangeButtonOf(page, 'Last 8 weeks')).toHaveAttribute('aria-pressed', 'true');
        await expect(rangeButtonOf(page, 'All time')).toHaveAttribute('aria-pressed', 'false');
        await expect(statsOf(page)).toContainText('Best #1 · 6 of 7 weeks');
        await expect(statsOf(page)).toContainText('Lowest #2');
        // En etikett och en dotta per vecka där åtta ryms, annars färre: aldrig närmare än 4 px, på alla sex bredder.
        await expect(labels.first()).toHaveText('W47');
        await expect(labels.last()).toHaveText('W1');
        const eight = await expectWeekLabelsClear(labels, plot, `${theme} / ${width} px / last 8 weeks`);
        await expect(dots).toHaveCount(eight.count);
        await pageDoesNotScrollSideways(page);

        // All time: 44 veckor, glesare etiketter och dottar bara över etiketterna, och Best, Lowest och Now gäller hela perioden.
        await rangeButtonOf(page, 'All time').click();
        await expect(positionChartOf(page)).toHaveAccessibleName(ALL_TIME_CHART);
        await expect(rangeButtonOf(page, 'All time')).toHaveAttribute('aria-pressed', 'true');
        await expect(statsOf(page)).toContainText('Best #1 · 11 of 43 weeks');
        await expect(statsOf(page)).toContainText('Lowest #4');
        await expect(statsOf(page)).toContainText('Now #2');
        expect(await labels.count()).toBeGreaterThanOrEqual(2);
        expect(await labels.count()).toBeLessThanOrEqual(7);
        await expect(labels.first()).toHaveText('W11');
        await expect(labels.last()).toHaveText('W1');
        await expect(labels.last()).toHaveAttribute('data-current', 'true');
        const all = await expectWeekLabelsClear(labels, plot, `${theme} / ${width} px / all time`);
        test.info().annotations.push({ type: 'measure', description: `${theme} / ${width} px: label gap, last 8 weeks ${eight.minGap.toFixed(1)} px (${eight.count} labels), all time ${all.minGap.toFixed(1)} px (${all.count} labels)` });
        await expect(dots).toHaveCount(all.count);
        // Dottarna är 24 px och ligger över etiketterna: ingen nuddar nästa.
        const dotBoxes = await boxesOf(dots);
        dotBoxes.slice(1).forEach((box, index) => expect(box.left - dotBoxes[index]!.right, `dot ${index + 1} and ${index + 2}`).toBeGreaterThanOrEqual(0));
        await expect(page.locator('.rq-profile-position__dot[data-hollow="true"]')).toHaveCount(1);
        await pageDoesNotScrollSideways(page);

        // Tabellen har alla veckor och ligger kvar i kortet.
        await page.getByRole('button', { name: 'Show as table' }).click();
        await expect(page.locator('.rq-profile-position__table tbody tr')).toHaveCount(ALL_TIME_STUB_WEEKS);
        await pageDoesNotScrollSideways(page);
        const tableBox = (await boxesOf(page.locator('.rq-profile-position__table')))[0]!;
        const cardBox = (await boxesOf(page.locator('.rq-profile-statcard')))[0]!;
        expect(tableBox.left).toBeGreaterThanOrEqual(cardBox.left - TOLERANCE_PX);
        expect(tableBox.right).toBeLessThanOrEqual(cardBox.right + TOLERANCE_PX);
        await page.getByRole('button', { name: 'Show as table' }).click();

        // Tillbaka: åtta veckor igen, och begäran gällde åtta veckor och sedan taket.
        await rangeButtonOf(page, 'Last 8 weeks').click();
        await expect(positionChartOf(page)).toHaveAccessibleName(RECENT_CHART);
        await expect(statsOf(page)).toContainText('Best #1 · 6 of 7 weeks');
        await expect(labels).toHaveCount(eight.count);
        expect(group.weeksAsked()).toEqual([8, 104]);
        await pageDoesNotScrollSideways(page);
      });
    }
  }

  for (const width of [375, 1280]) {
    test(`the switch is one tab stop with arrows, a ring drawn inward and a 44 px target on a phone, at ${width} px`, async ({ page }) => {
      await open(page, width);
      await expect(positionChartOf(page)).toBeVisible();
      const recent = rangeButtonOf(page, 'Last 8 weeks');
      const allTime = rangeButtonOf(page, 'All time');

      await expect(recent).toHaveAttribute('tabindex', '0');
      await expect(allTime).toHaveAttribute('tabindex', '-1');
      await page.getByRole('tab', { name: 'Position' }).focus();
      await page.keyboard.press('Tab');
      await expect(recent).toBeFocused();
      const ring = await ringOf(recent);
      expect(ring.drawn, 'the switch shows a focus ring').toBe(true);
      expect(ring.width).toBeGreaterThanOrEqual(MIN_RING_WIDTH_PX);
      expect(ring.offset, 'the ring is drawn inward').toBeLessThan(0);
      if (width < 1024) {
        for (const box of await boxesOf(rangeSwitchOf(page).getByRole('button'))) expect(box.bottom - box.top).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
      }
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Show as table' })).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(recent).toBeFocused();

      await page.keyboard.press('ArrowRight');
      await expect(allTime).toBeFocused();
      await expect(allTime).toHaveAttribute('aria-pressed', 'true');
      await expect(allTime).toHaveAttribute('tabindex', '0');
      await expect(positionChartOf(page)).toHaveAccessibleName(ALL_TIME_CHART);
      await page.keyboard.press('ArrowRight');
      await expect(recent).toBeFocused();
      await expect(positionChartOf(page)).toHaveAccessibleName(RECENT_CHART);
      await page.keyboard.press('End');
      await expect(allTime).toBeFocused();
      await page.keyboard.press('Home');
      await expect(recent).toBeFocused();
      await pageDoesNotScrollSideways(page);
    });
  }

  test('keeps the old chart marked as busy while All time loads, never an empty box, and caches each view', async ({ page }) => {
    const group = await open(page, 375, { allTimeDelayMs: 1_200 });
    await expect(positionChartOf(page)).toBeVisible();

    await rangeButtonOf(page, 'All time').click();
    await expect(page.locator('.rq-profile-position')).toHaveAttribute('aria-busy', 'true');
    await expect(positionChartOf(page)).toHaveAccessibleName(RECENT_CHART);
    await expect(page.getByText('Loading position')).toHaveCount(0);
    await expect(positionChartOf(page)).toHaveAccessibleName(ALL_TIME_CHART);
    await expect(page.locator('.rq-profile-position')).toHaveAttribute('aria-busy', 'false');

    await rangeButtonOf(page, 'Last 8 weeks').click();
    await expect(positionChartOf(page)).toHaveAccessibleName(RECENT_CHART);
    await rangeButtonOf(page, 'All time').click();
    await expect(positionChartOf(page)).toHaveAccessibleName(ALL_TIME_CHART);
    expect(group.weeksAsked()).toEqual([8, 104]);
  });

  test('starts again on Last 8 weeks when the tab is opened again, and writes nothing to the address', async ({ page }) => {
    await open(page, 375);
    await rangeButtonOf(page, 'All time').click();
    await expect(positionChartOf(page)).toHaveAccessibleName(ALL_TIME_CHART);
    expect(new URL(page.url()).search, 'the choice is not in the address').toBe('?view=position');

    await page.getByRole('tab', { name: 'Streak' }).click();
    await expect(page.getByRole('tab', { name: 'Streak' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Position' }).click();
    await expect(positionChartOf(page)).toBeVisible();

    await expect(rangeButtonOf(page, 'Last 8 weeks')).toHaveAttribute('aria-pressed', 'true');
    await expect(positionChartOf(page)).toHaveAccessibleName(RECENT_CHART);
    expect(new URL(page.url()).search).toBe('?view=position');
  });

  test('offers no switch for a new runner or a group with no finished week', async ({ page }) => {
    await openProfile(page, { members: 6, view: 'position', width: 375, positions: NEW_RUNNER });
    await expect(page.getByText('First week in the group. Position appears after your first week')).toBeVisible();
    await expect(rangeSwitchOf(page)).toHaveCount(0);

    await page.unroute(`${targets.apiUrl}/**/leaderboard/positions*`);
    await answerWith(page, '/leaderboard/positions', { success: true, data: NO_FINISHED_WEEK });
    await page.reload();
    await dismissOverlays(page);
    await expect(page.getByText('No finished week yet. Position shows where you stood at the end of each week.')).toBeVisible();
    await expect(rangeSwitchOf(page)).toHaveCount(0);
  });
});
