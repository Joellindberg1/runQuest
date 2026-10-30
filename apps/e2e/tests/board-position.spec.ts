import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/test';
import { contrastOf } from '../support/contrast';
import { dismissOverlays } from '../support/overlays';
import { waitForStylesApplied } from '../support/stylesApplied';
import { apiIsStubbed } from '../support/stubApi';
import { targets } from '../support/targets';

/** Några pixlar marginal för subpixelavrundning i mätningarna. */
const TOLERANCE_PX = 1;
/** Minsta träffyta för tumme (temats --rq-control-hit på mobil). */
const MIN_TOUCH_TARGET_PX = 44;
/** Fokusringens minsta tjocklek (temats globala ring är 2 px). */
const MIN_RING_WIDTH_PX = 2;
/** Radens lodräta lägesfel mellan skiljetecknet och texten efter det när de ligger på samma rad. */
const SAME_LINE_PX = 4;

/** WCAG AA för brödtext och för ikontext/ramar (fokusringen). */
const MIN_TEXT_CONTRAST = 4.5;
const MIN_RING_CONTRAST = 3;
/** Golvet för de ovala chipsen: dagens värde (4,04:1 i det ljusa temat) får inte bli sämre. */
const MIN_CHIP_TEXT_CONTRAST = 4;
const THEMES = ['dark', 'light'] as const;

const TABS = ['All-time', 'Week', 'Streaks', 'Position'];
const ROW_WIDTHS = [
  { width: 320, height: 740 },
  { width: 375, height: 740 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

// Gruppen och positionssvaret läggs över API:et i webbläsaren (sidans rutt går före kontextens), så provet gäller det fejkade API:ets löpare. Hoppas över mot staging: där vet provet inte vilket id
// den inloggade löparen har, och positionssvaret måste innehålla just hens rad.
const ME_ID = 'stub-user-1';
const LONG_WORD_NAME = 'Wolfeschlegelsteinhausen Berg';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

function member(id: string, name: string, xp: number) {
  return { id, name, email: `${id}@example.test`, is_admin: false, total_xp: xp, current_level: 8, total_km: 321.5, current_streak: 2, longest_streak: 4, runs: [] };
}

const nameOf = (index: number) => (index === 0 ? 'Stub Runner' : index === 2 ? LONG_WORD_NAME : `Mate Number${index}`);
const idOf = (index: number) => (index === 0 ? ME_ID : `position-mate-${index}`);
const groupOf = (size: number) => Array.from({ length: size }, (_, index) => ({ ...member(idOf(index), nameOf(index), 5000 - index * 200), total_km: 42.5 + index }));

interface HistoryOptions {
  runners: number;
  weeks: number;
  /** Den inloggade kom in i sista veckan: tidigare veckor är null, och de andra placeras tätt utan hen. */
  newRunner?: boolean;
}

// Veckorna räknas bakåt från vecka 35 2026. Placeringarna roterar vecka för vecka och sista veckan är identiteten (löpare k står på plats k + 1), som Standings.
function history({ runners, weeks, newRunner = false }: HistoryOptions) {
  const first = 35 - weeks + 1;
  const weekList = Array.from({ length: weeks }, (_, index) => ({
    start: '2026-08-24',
    end: '2026-08-30',
    iso_week: first + index,
    iso_year: 2026,
    is_current_week: index === weeks - 1,
  }));
  const positions = (runner: number) =>
    weekList.map((_, week) => {
      const present = Array.from({ length: runners }, (_unused, k) => k).filter((k) => !(newRunner && k === 0 && week < weeks - 1));
      if (!present.includes(runner)) return null;
      const ranking = week === weeks - 1 ? present : present.map((_k, i) => present[(i + week) % present.length]!);
      return ranking.indexOf(runner) + 1;
    });
  return {
    as_of: '2026-08-31',
    weeks: weekList,
    runners: Array.from({ length: runners }, (_, index) => ({ user_id: idOf(index), name: nameOf(index), profile_picture: null, member_since: null, positions: positions(index) })),
  };
}

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
  view?: string;
  width: number;
  height?: number;
}

interface Counters {
  positionRequests: () => number;
  chunkRequests: () => number;
}

/** Öppnar Board med en grupp av vald storlek. Returnerar räknarna över positionsbegäran och begäran av vyns chunk (`PositionView-*.js`). */
async function openBoard(page: Page, { members, positions = history({ runners: members, weeks: 8 }), view, width, height = 740 }: OpenOptions): Promise<Counters> {
  let requests = 0;
  let chunks = 0;
  page.on('request', (request) => {
    if (request.url().includes('/leaderboard/positions')) requests += 1;
    if (/\/assets\/PositionView-[^/]*\.js/.test(request.url())) chunks += 1;
  });
  await answerWith(page, '/auth/users-with-runs', { success: true, data: groupOf(members) });
  await answerWith(page, '/leaderboard/positions', { success: true, data: positions });
  await page.setViewportSize({ width, height });
  await page.goto(view ? `/board?view=${view}` : '/board');
  await dismissOverlays(page);
  await expect(page.getByRole('tablist', { name: 'Standings view' })).toBeVisible();
  await waitForStylesApplied(page);
  return { positionRequests: () => requests, chunkRequests: () => chunks };
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

/**
 * Körs i sidan (skickas till `locator.evaluate`, får inte läsa något utanför sig själv): fokusringens kontrast mot elementets sammansatta bakgrund. Färgerna läggs lager för lager på en
 * canvas, som läser alla färgsyntaxer webbläsaren förstår, och kontrasten räknas på de sammansatta pixlarna.
 */
function ringContrastOf(element: Element): { drawn: boolean; width: number; ratio: number } {
  const style = getComputedStyle(element);
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  const paint = (color: string) => {
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
  };
  const read = () => Array.from(context.getImageData(0, 0, 1, 1).data) as [number, number, number, number];
  const luminance = ([r, g, b]: [number, number, number, number]) => {
    const channel = (value: number) => (value / 255 <= 0.03928 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  paint('white');
  const layers: string[] = [];
  for (let node: Element | null = element; node; node = node.parentElement) layers.push(getComputedStyle(node).backgroundColor);
  for (const layer of layers.reverse()) paint(layer);
  const background = read();
  paint(style.outlineColor);
  const ring = read();
  const [lighter, darker] = [luminance(background), luminance(ring)].sort((a, b) => b - a) as [number, number];
  return { drawn: style.outlineStyle !== 'none', width: parseFloat(style.outlineWidth), ratio: Number((((lighter + 0.05) / (darker + 0.05))).toFixed(2)) };
}

const chartOf = (page: Page) => page.getByRole('img', { name: /^Position over time, weeks/ });

test.describe('the Position tab on the board', () => {
  test.skip(!apiIsStubbed(), 'The group and the positions are put over a stubbed API; run with E2E_STUB_API=1 against a local build.');

  for (const { width, height } of ROW_WIDTHS) {
    test(`shows the selected tab in the row and keeps the page still at ${width} px, from the address and from the keyboard`, async ({ page }) => {
      await openBoard(page, { members: 6, view: 'position', width, height });
      const tablist = page.getByRole('tablist', { name: 'Standings view' });
      await expect(page.getByRole('tab')).toHaveText(TABS);
      await expect(chartOf(page)).toBeVisible();
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

      // Via tangentbordet: piltangenterna loopar genom alla fyra, och var och en ligger helt i raden när den är vald, med en synlig ring som ritas inåt.
      await page.getByRole('tab', { name: 'All-time' }).click();
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
        const ring = await tab.evaluate((element) => {
          const style = getComputedStyle(element);
          return { style: style.outlineStyle, width: parseFloat(style.outlineWidth), offset: parseFloat(style.outlineOffset) };
        });
        expect(ring.style, `the "${name}" tab shows a focus ring`).not.toBe('none');
        expect(ring.width, `the ring of the "${name}" tab`).toBeGreaterThanOrEqual(MIN_RING_WIDTH_PX);
        expect(ring.offset, `the ring of the "${name}" tab is drawn inward`).toBeLessThan(0);
      }
      await pageDoesNotScrollSideways(page);
    });

    test(`has tabs of at least 44 px on a phone, and a fade only where the row scrolls, at ${width} px`, async ({ page }) => {
      await openBoard(page, { members: 6, width, height });
      const tablist = page.getByRole('tablist', { name: 'Standings view' });
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
      else expect(mask, 'a row that fits has no fade').toBe('none');
      if (width === 320) expect(overflows, 'four tabs do not fit on 320 px').toBe(true);
    });
  }

  for (const theme of THEMES) {
    for (const { width, height } of [ROW_WIDTHS[0]!, ROW_WIDTHS[3]!]) {
      test(`reads the four tabs and their focus ring with enough contrast in the ${theme} theme at ${width} px`, async ({ page }) => {
        await page.addInitScript((value) => window.localStorage.setItem('theme', value), theme);
        await openBoard(page, { members: 6, view: 'position', width, height });
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(chartOf(page)).toBeVisible();

        // Textfärgen mot flikens egen sammansatta bakgrund. Den valda fliken når AA. De ovala flikarna har chip-receptets textfärg (`.rq-filter`, --rq-text-3), som Season, Week och Streaks hade före
        // Position och som är 4,04:1 i det ljusa temat: det är ett öppet antagande (docs/open-assumptions.md), inte något den här storyn ändrar, så provet vaktar att värdet inte blir sämre.
        const texts = await page.evaluate(contrastOf, { selectors: ['.rq-board__tabs > [role="tab"]'] });
        expect(texts).toHaveLength(TABS.length);
        const selected = await page.locator('.rq-board__tabs > [role="tab"]').evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('aria-selected') === 'true'));
        texts.forEach((sample, index) => {
          test.info().annotations.push({ type: 'measure', description: `${theme} / ${width} px / "${sample.text}"${selected[index] ? ' (selected)' : ''}: ${sample.ratio}:1` });
          expect(sample.ratio, `${theme} / ${width} px: the "${sample.text}" tab`).toBeGreaterThanOrEqual(selected[index] ? MIN_TEXT_CONTRAST : MIN_CHIP_TEXT_CONTRAST);
        });

        // Fokusringen på den valda och en ovald flik mot flikens bakgrund (icke-text: 3:1).
        for (const name of ['Position', 'Week']) {
          const tab = page.getByRole('tab', { name });
          await tab.focus();
          await page.keyboard.press('Shift+Tab');
          await tab.focus();
          const ring = await tab.evaluate(ringContrastOf);
          test.info().annotations.push({ type: 'measure', description: `${theme} / ${width} px / ${name}: ${JSON.stringify(ring)}` });
          expect(ring.drawn, `${theme} / ${width} px: the "${name}" tab shows a ring`).toBe(true);
          expect(ring.ratio, `${theme} / ${width} px: the ring of the "${name}" tab against the tab`).toBeGreaterThanOrEqual(MIN_RING_CONTRAST);
        }
      });
    }
  }

  test('fades the start and keeps the selected tab clear of the fade once the row has been scrolled, at 320 px', async ({ page }) => {
    await openBoard(page, { members: 6, view: 'position', width: 320 });
    const tablist = page.getByRole('tablist', { name: 'Standings view' });
    const wrap = tablist.locator('xpath=..');

    // Position är sista fliken: raden är scrollad till slutet, så fadens slutkant är borta och startkanten syns.
    await expect(wrap).toHaveAttribute('data-fade-start', 'true');
    await expect(wrap).toHaveAttribute('data-fade-end', 'false');

    // Varje flik i tur och ordning: kantfaden följer radens scrollläge, och den valda fliken ligger helt i bild och utanför fadens zon (scroll-padding) på de sidor där en fade ritas.
    for (const name of ['Week', 'Streaks', 'All-time', 'Position']) {
      await page.getByRole('tab', { name }).click();
      await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
      await expect
        .poll(
          async () =>
            tablist.evaluate((element) => {
              const outer = element.parentElement!;
              const zone = parseFloat(getComputedStyle(element).scrollPaddingLeft);
              const tab = element.querySelector('[role="tab"][aria-selected="true"]')!.getBoundingClientRect();
              const row = element.getBoundingClientRect();
              const fadeStart = outer.getAttribute('data-fade-start') === 'true';
              const fadeEnd = outer.getAttribute('data-fade-end') === 'true';
              return {
                startFollowsScroll: fadeStart === element.scrollLeft > 1,
                endFollowsScroll: fadeEnd === element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
                inRow: tab.left >= row.left - 1 && tab.right <= row.right + 1,
                clearOfStart: !fadeStart || tab.left - row.left >= zone - 1,
                clearOfEnd: !fadeEnd || row.right - tab.right >= zone - 1,
              };
            }),
          { message: `the "${name}" tab is in the row, clear of the fade, and the fade follows the scroll` },
        )
        .toEqual({ startFollowsScroll: true, endFollowsScroll: true, inRow: true, clearOfStart: true, clearOfEnd: true });
    }
    // Första fliken står mot början: ingen startfade, slutfaden syns.
    await page.getByRole('tab', { name: 'All-time' }).click();
    await expect(wrap).toHaveAttribute('data-fade-start', 'false');
    await expect(wrap).toHaveAttribute('data-fade-end', 'true');
  });

  for (const width of [320, 375]) {
    test(`keeps the page still with a table of 26 weeks on a ${width} px phone, and makes the table a tab stop only because it scrolls`, async ({ page }) => {
      await openBoard(page, { members: 6, view: 'position', width, positions: history({ runners: 6, weeks: 26 }) });
      await expect(chartOf(page)).toBeVisible();
      await pageDoesNotScrollSideways(page);

      const toggle = page.getByRole('button', { name: 'Show as table' });
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const slot = page.locator('.rq-board-position__table-slot');
      await expect(slot).toBeVisible();
      await expect(slot.locator('thead th')).toHaveCount(27);
      await pageDoesNotScrollSideways(page);

      const measured = await slot.evaluate((element) => {
        const card = element.closest('.rq-card')!.getBoundingClientRect();
        const box = element.getBoundingClientRect();
        return { scrolls: element.scrollWidth > element.clientWidth + 1, tabIndex: element.getAttribute('tabindex'), inside: box.left >= card.left - 1 && box.right <= card.right + 1 };
      });
      expect(measured.scrolls, '26 weeks do not fit the card').toBe(true);
      expect(measured.tabIndex, 'a table that scrolls is a tab stop').toBe('0');
      expect(measured.inside, 'the table sits inside the card').toBe(true);

      // Radrubrikerna bryts vid mellanrum och aldrig mitt i ordet: det långa ordet ligger på en rad.
      const brokenWords = await slot.locator('tbody th[scope="row"]').evaluateAll((cells) =>
        cells.flatMap((cell) => {
          const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
          const broken: string[] = [];
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = node.textContent ?? '';
            for (const match of text.matchAll(/\S+/g)) {
              const range = document.createRange();
              range.setStart(node, match.index ?? 0);
              range.setEnd(node, (match.index ?? 0) + match[0].length);
              const lines = new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top)));
              if (lines.size > 1) broken.push(match[0]);
            }
          }
          return broken;
        }),
      );
      expect(brokenWords, 'no name is broken in the middle of a word').toEqual([]);
      const longWord = LONG_WORD_NAME.split(' ')[0]!;
      await expect(slot.locator('tbody th[scope="row"]', { hasText: longWord })).toHaveCount(1);

      await page.keyboard.press('Tab');
      await slot.focus();
      await expect(slot).toBeFocused();
      const ring = await slot.evaluate((element) => {
        const style = getComputedStyle(element);
        return { drawn: style.outlineStyle !== 'none', width: parseFloat(style.outlineWidth), offset: parseFloat(style.outlineOffset) };
      });
      expect(ring.drawn, 'the table region shows a focus ring').toBe(true);
      expect(ring.width).toBeGreaterThanOrEqual(MIN_RING_WIDTH_PX);
      expect(ring.offset, 'the ring is drawn inward').toBeLessThan(0);
    });
  }

  test('gives a table that fits no tab stop, on a wide screen', async ({ page }) => {
    await openBoard(page, { members: 6, view: 'position', width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Show as table' }).click();
    const slot = page.locator('.rq-board-position__table-slot');
    await expect(slot).toBeVisible();

    const measured = await slot.evaluate((element) => ({ scrolls: element.scrollWidth > element.clientWidth + 1, tabIndex: element.getAttribute('tabindex') }));
    expect(measured.scrolls, 'eight weeks fit the card on a desktop').toBe(false);
    expect(measured.tabIndex, 'a table that fits is not a tab stop').toBeNull();
    await pageDoesNotScrollSideways(page);
  });

  for (const width of [320, 375]) {
    test(`keeps the separator of the eyebrow with the text after it on a ${width} px phone, so no line ends on a lone "·"`, async ({ page }) => {
      await openBoard(page, { members: 6, view: 'position', width });
      await expect(chartOf(page)).toBeVisible();

      const lines = await page.locator('.rq-board-position__part').evaluateAll((parts) =>
        parts.map((part) => {
          const sep = part.querySelector('.rq-board-position__sep');
          const text = sep?.nextElementSibling;
          return { visible: !!sep && getComputedStyle(sep).display !== 'none', sepTop: sep?.getBoundingClientRect().top ?? 0, textTop: text?.getBoundingClientRect().top ?? 0, text: text?.textContent ?? '' };
        }),
      );
      expect(lines.length).toBeGreaterThanOrEqual(2);
      for (const line of lines.filter((entry) => entry.visible)) {
        expect(Math.abs(line.sepTop - line.textTop), `the separator before "${line.text}" is on the same line as the text`).toBeLessThanOrEqual(SAME_LINE_PX);
      }
      await pageDoesNotScrollSideways(page);
    });
  }

  for (const width of [320, 375, 1440]) {
    test(`draws a group of 12, a new runner and the no-finished-week text without moving the page, at ${width} px`, async ({ page }) => {
      await openBoard(page, { members: 12, view: 'position', width, positions: history({ runners: 12, weeks: 8 }) });
      await expect(chartOf(page)).toBeVisible();
      await expect(page.getByRole('region', { name: 'Current order' }).getByRole('button')).toHaveCount(12);
      await pageDoesNotScrollSideways(page);

      await page.unroute(`${targets.apiUrl}/**/leaderboard/positions*`);
      await answerWith(page, '/leaderboard/positions', { success: true, data: history({ runners: 6, weeks: 8, newRunner: true }) });
      await page.reload();
      await dismissOverlays(page);
      await expect(chartOf(page)).toBeVisible();
      await pageDoesNotScrollSideways(page);

      await page.unroute(`${targets.apiUrl}/**/leaderboard/positions*`);
      await answerWith(page, '/leaderboard/positions', { success: true, data: history({ runners: 6, weeks: 1 }) });
      await page.reload();
      await dismissOverlays(page);
      await expect(page.getByText('No finished week yet. Position shows where you stood at the end of each week.')).toBeVisible();
      await expect(page.getByRole('tabpanel').getByRole('button')).toHaveCount(0);
      await expect(page.getByText('Pick a runner to lift their line.')).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Current order' }).getByRole('listitem').filter({ hasText: 'Stub Runner' })).toBeVisible();
      await pageDoesNotScrollSideways(page);
    });
  }

  for (const width of [320, 1440]) {
    test(`draws a group of two, the smallest group with the tab, without moving the page, at ${width} px`, async ({ page }) => {
      await openBoard(page, { members: 2, view: 'position', width, positions: history({ runners: 2, weeks: 8 }) });

      await expect(page.getByRole('tab')).toHaveText(TABS);
      await expect(chartOf(page)).toBeVisible();
      await expect(page.getByRole('region', { name: 'Current order' }).getByRole('button')).toHaveCount(2);
      await pageDoesNotScrollSideways(page);
    });
  }

  test('with one member the tab is hidden, ?view=position falls back to All-time and no position request is made', async ({ page }) => {
    const group = await openBoard(page, { members: 1, view: 'position', width: 375 });

    await expect(page.getByRole('tab')).toHaveText(TABS.slice(0, 3));
    await expect(page.getByRole('tab', { name: 'All-time' })).toHaveAttribute('aria-selected', 'true');
    // Svaret hade hunnit komma: en liten väntan efter att sidan ritats visar att ingen begäran startar efteråt heller.
    await page.waitForTimeout(500);
    expect(group.positionRequests()).toBe(0);
    expect(group.chunkRequests(), 'the chunk of the view is not fetched either').toBe(0);
  });

  test('no position request goes out on the other tabs, and exactly one when Position is opened', async ({ page }) => {
    const group = await openBoard(page, { members: 6, width: 375 });

    for (const name of TABS.slice(0, 3)) {
      await page.getByRole('tab', { name }).click();
      await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
    }
    await page.waitForTimeout(500);
    expect(group.positionRequests()).toBe(0);
    expect(group.chunkRequests(), 'the chunk is not fetched while Position is not wanted').toBe(0);

    await page.getByRole('tab', { name: 'Position' }).click();
    await expect(chartOf(page)).toBeVisible();
    expect(group.positionRequests()).toBe(1);
    expect(group.chunkRequests(), 'the chunk of the view is its own file, fetched once').toBe(1);
  });

  test('fetches the chunk of the view when the pointer or the focus goes to the Position tab, before it is selected', async ({ page }) => {
    const group = await openBoard(page, { members: 6, width: 1440, height: 900 });
    await page.getByRole('tab', { name: 'Week' }).hover();
    await page.waitForTimeout(300);
    expect(group.chunkRequests()).toBe(0);

    await page.getByRole('tab', { name: 'Position' }).hover();
    await expect.poll(() => group.chunkRequests()).toBe(1);
    expect(group.positionRequests(), 'the positions are asked for only when the tab is selected').toBe(0);
  });

  test('leaves the tour anchor on the All-time podium, with four tabs in the row', async ({ page }) => {
    await openBoard(page, { members: 6, width: 375 });

    await expect(page.getByRole('tab')).toHaveText(TABS);
    await expect(page.locator('[data-tour="leaderboard-card"]')).toHaveCount(1);
  });
});
