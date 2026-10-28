import type { Page } from '@playwright/test';
import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';
import { waitForStylesApplied } from '../support/stylesApplied';
import { targets } from '../support/targets';

/** Några pixlar marginal för subpixelavrundning i mätningarna. */
const TOLERANCE_PX = 1;

// Bredderna där raden ritas olika: 1024 (cellerna under rad ett), 1280 (en rad, namnet bryter till två) och 1440 (prototypens bredd).
const WIDTHS = [
  { width: 1024, height: 800 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];

// Mobilbredderna: 320 (minsta telefonen) och 375.
const MOBILE_WIDTHS = [320, 375];

/** Ett riktigt gruppnamn av vanlig längd (ca 210 px i versaler): ska synas helt, aldrig klippas med ellips. */
const REAL_NAME = 'Daniel Lindblad Lüthje';

function run(id: string, over: Record<string, unknown>) {
  return {
    id, user_id: `log-history-${id}`, date: '2026-10-03', distance: 8.4, xp_gained: 51, multiplier: 1.6, streak_day: 8, base_xp: 15, km_xp: 16, distance_bonus: 5,
    streak_bonus: 10, source: 'strava', is_treadmill: false, weather_code: 2, temperature_c: 17.2, user_name: 'Karl Persson', user_level: 24, user_total_xp: 5539,
    start_time: '2026-10-03T06:10:00Z', created_at: '2026-10-03T07:00:00Z', moving_time: null, ...over,
  };
}

// Rundor med och utan tid (manuell, löpband, distans 0, tid 0), kort och långt namn, och siffror i ytterkanterna (111 h, 100,5 km, 112 streakdagar).
const RUNS = [
  run('a', { user_name: 'Joel Lindberg', distance: 8, xp_gained: 44, streak_day: 12, multiplier: 1.8, weather_code: 0, temperature_c: 19.4, moving_time: 2670 }),
  run('b', { user_name: 'Nicklas von Elling', distance: 12.1, xp_gained: 78, is_treadmill: true, source: 'manual', weather_code: null, temperature_c: null }),
  run('c', { user_name: REAL_NAME, distance: 10, xp_gained: 70, moving_time: 0 }),
  run('d', { user_name: 'Alexandra Wilhelmina Montgomery-Featherstonehaugh', distance: 42.2, xp_gained: 412, streak_day: 112, multiplier: 2.5, moving_time: 15180 }),
  run('e', { user_name: 'Adam Einstein', distance: 0, xp_gained: 5, moving_time: 1200 }),
  run('f', { user_name: 'Maria Johansson', distance: 100.5, xp_gained: 1234, streak_day: 123, multiplier: 2.5, moving_time: 400000 }),
  // Långa syntetiska namn (två långa för- och efternamn) och ett ord utan brytpunkt, med tid över en timme: mobilens namn ska bryta till högst två rader.
  run('g', { user_name: 'Maximilian Bartholomew Featherstonehaugh Montgomery-Wetherspoon', distance: 21.1, xp_gained: 190, moving_time: 4180 }),
  run('h', { user_name: 'Pneumonoultramicroscopicsilicovolcanoconiosis Hippopotomonstrosesquippedaliophobia', distance: 12.1, xp_gained: 78, moving_time: 3130 }),
];

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

// Svaret sätts i webbläsaren och ersätter svaret från det riktiga eller fejkade API:et (sidans rutt går före kontextens), så provet gäller lika mot staging och stubben.
async function openGroupHistory(page: Page, width: number, height: number): Promise<void> {
  await page.route(
    (url) => url.href.startsWith(`${targets.apiUrl}/`) && url.pathname.endsWith('/runs/group-history'),
    (route) =>
      route.request().method() === 'OPTIONS'
        ? route.fulfill({ status: 204, headers: CORS_HEADERS })
        : route.fulfill({
            status: 200,
            headers: CORS_HEADERS,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, runs: RUNS, data: { runs: RUNS }, meta: { total: RUNS.length, limit: 10, offset: 0, has_more: false } }),
          }),
  );
  await page.setViewportSize({ width, height });
  await page.goto('/log?view=group');
  await dismissOverlays(page);
  await expect(page.getByRole('list', { name: 'Runs in the pack' })).toBeVisible();
  await expect(page.locator('.rq-log-run')).toHaveCount(RUNS.length);
  await waitForStylesApplied(page);
}

test.describe('the group history on the log page', () => {
  for (const { width, height } of WIDTHS) {
    test(`does not scroll sideways, keeps every cell and the distance and XP inside its card, and shows a real name in full on a ${width} px screen`, async ({ page }) => {
      await openGroupHistory(page, width, height);

      const measured = await page.evaluate((realName) => {
        const cards = Array.from(document.querySelectorAll<HTMLElement>('.rq-log-run'));
        const inside = (el: Element, frame: DOMRect) => {
          const box = el.getBoundingClientRect();
          return box.width > 0 && box.left >= frame.left - 1 && box.right <= frame.right + 1;
        };
        const nameOf = (card: HTMLElement) => card.querySelector<HTMLElement>('.rq-log-run__name')!;
        const real = cards.map(nameOf).find((name) => name.textContent === realName)!;
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          cardCount: cards.length,
          // Allt som syns (bredd över 1 px: skärmläsartexten är 1 x 1 px) ligger inom kortets sidor.
          outsideCard: cards.flatMap((card) => {
            const frame = card.getBoundingClientRect();
            return Array.from(card.querySelectorAll('*')).filter((el) => {
              const box = el.getBoundingClientRect();
              return box.width > 1 && (box.left < frame.left - 1 || box.right > frame.right + 1);
            }).map((el) => String(el.className));
          }),
          totalsMissing: cards.filter((card) => !inside(card.querySelector('.rq-log-run__km')!, card.getBoundingClientRect()) || !inside(card.querySelector('.rq-log-run__xp')!, card.getBoundingClientRect())).length,
          cellLabelsCut: cards.flatMap((card) => Array.from(card.querySelectorAll<HTMLElement>('.rq-log-cell__label'))).filter((label) => label.scrollWidth > label.parentElement!.clientWidth + 1).length,
          cellsWrapped: cards.flatMap((card) => Array.from(card.querySelectorAll<HTMLElement>('.rq-log-cell__label'))).filter((label) => label.getBoundingClientRect().height > parseFloat(getComputedStyle(label).fontSize) * 1.6).length,
          timePaceCut: cards.flatMap((card) => Array.from(card.querySelectorAll<HTMLElement>('.rq-log-run__stat'))).filter((stat) => stat.scrollWidth > stat.clientWidth + 1).length,
          realNameCutSideways: real.scrollWidth > real.clientWidth + 1,
          realNameCutBelow: real.scrollHeight > real.clientHeight + 1,
          realNameLines: Math.round(real.getBoundingClientRect().height / parseFloat(getComputedStyle(real).lineHeight || '1')),
        };
      }, REAL_NAME);

      expect(measured.cardCount, 'every run has a card').toBe(RUNS.length);
      expect(measured.overflow, 'the page does not scroll sideways').toBeLessThanOrEqual(0);
      expect(measured.outsideCard, 'nothing visible sticks out of its card').toEqual([]);
      expect(measured.totalsMissing, 'the distance and the XP are inside every card').toBe(0);
      expect(measured.cellLabelsCut, 'no cell label is wider than its cell').toBe(0);
      expect(measured.cellsWrapped, 'no cell label breaks onto a second line').toBe(0);
      expect(measured.timePaceCut, 'time and pace fit their column').toBe(0);
      expect(measured.realNameCutSideways, `"${REAL_NAME}" is not cut off at the side (no ellipsis)`).toBe(false);
      expect(measured.realNameCutBelow, `"${REAL_NAME}" is not cut off below (no ellipsis after the last line)`).toBe(false);
      expect(measured.realNameLines, 'the name takes at most two lines').toBeLessThanOrEqual(2);
    });
  }

  for (const width of MOBILE_WIDTHS) {
    test(`on a ${width} px screen long names break to at most two lines beside the distance and XP, nothing scrolls sideways, and the time line sits above the distance`, async ({ page }) => {
      await openGroupHistory(page, width, 800);

      const measured = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll<HTMLElement>('.rq-log-run'));
        const lines = (el: HTMLElement) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
        const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          outsideCard: cards.flatMap((card) => {
            const frame = card.getBoundingClientRect();
            return Array.from(card.querySelectorAll('*')).filter((el) => {
              const box = el.getBoundingClientRect();
              return box.width > 1 && (box.left < frame.left - 1 || box.right > frame.right + 1);
            }).map((el) => String(el.className));
          }),
          // Namnet mot högergruppen (tid, km, XP): ingen överlappning, och namnet bryter till högst två rader.
          nameOverlapsTotals: cards.filter((card) => overlaps(card.querySelector('.rq-log-run__name')!.getBoundingClientRect(), card.querySelector('.rq-log-run__totals')!.getBoundingClientRect())).length,
          nameLines: cards.map((card) => lines(card.querySelector<HTMLElement>('.rq-log-run__name')!)),
          nameWiderThanColumn: cards.filter((card) => {
            const name = card.querySelector<HTMLElement>('.rq-log-run__name')!;
            return name.scrollWidth > name.clientWidth + 1;
          }).length,
          totalsCut: cards.filter((card) => {
            const totals = card.querySelector<HTMLElement>('.rq-log-run__totals')!;
            return totals.scrollWidth > totals.clientWidth + 1;
          }).length,
          // Raden ovanför km: finns bara med tid, är en rad, ≥ 11 px, högerställd mot km och ligger över den.
          timelines: cards.map((card) => {
            const line = card.querySelector<HTMLElement>('.rq-log-run__timeline');
            if (!line) return null;
            const box = line.getBoundingClientRect();
            const km = card.querySelector('.rq-log-run__km')!.getBoundingClientRect();
            return { fontSize: parseFloat(getComputedStyle(line).fontSize), lines: lines(line), above: box.bottom <= km.top + 1, rightEdgeGap: Math.abs(box.right - km.right) };
          }),
          dashes: cards.filter((card) => card.textContent!.includes('—') || card.textContent!.includes('no time recorded')).length,
        };
      });

      expect(measured.overflow, 'the page does not scroll sideways').toBeLessThanOrEqual(0);
      expect(measured.outsideCard, 'nothing visible sticks out of its card').toEqual([]);
      expect(measured.nameOverlapsTotals, 'no name reaches into the distance and XP group').toBe(0);
      expect(Math.max(...measured.nameLines), 'every name takes at most two lines').toBeLessThanOrEqual(2);
      expect(measured.totalsCut, 'the distance and XP group is never squeezed').toBe(0);
      // Utan tid finns ingen rad och inget tankstreck; med tid finns raden på exakt de korten.
      const timedIds = RUNS.map((r) => r.moving_time !== null && r.moving_time > 0 && r.distance > 0);
      expect(measured.timelines.map((line) => line !== null)).toEqual(timedIds);
      expect(measured.dashes, 'no card shows a dash or hidden "no time recorded" on mobile').toBe(0);
      for (const line of measured.timelines.filter((candidate) => candidate !== null)) {
        expect(line.fontSize, 'the line is at least 11 px').toBeGreaterThanOrEqual(11);
        expect(line.lines, 'the line is one line').toBe(1);
        expect(line.above, 'the line sits above the distance').toBe(true);
        expect(line.rightEdgeGap, 'the line is right-aligned with the distance').toBeLessThanOrEqual(TOLERANCE_PX);
      }
    });
  }

  test('the time and pace column has the same width on a run with a time and a run without one', async ({ page }) => {
    await openGroupHistory(page, 1440, 900);
    const widths = await page.evaluate(() => Array.from(document.querySelectorAll('.rq-log-run__timepace')).map((el) => Math.round(el.getBoundingClientRect().width)));
    expect(widths.length).toBe(RUNS.length);
    for (const width of widths) expect(Math.abs(width - widths[0]!), 'every row has the same column width').toBeLessThanOrEqual(TOLERANCE_PX);
  });
});
