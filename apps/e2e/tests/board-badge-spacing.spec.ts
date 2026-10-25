import type { Page } from '@playwright/test';
import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';
import { apiIsStubbed } from '../support/stubApi';
import { waitForStylesApplied } from '../support/stylesApplied';

/** Några pixlar marginal för subpixelavrundning i mätningarna. */
const TOLERANCE_PX = 1;

// Under 360 px rymmer rest-raden inte "N km" och tre badges med --rq-sp-8 på en rad (mittkolumnen är ca 135 px vid 320 px), så där ligger det tätare steget kvar i stället för att raden växer.
const SPACING_STEP = (width: number) => (width < 360 ? '--rq-sp-4' : '--rq-sp-8');

const WIDTHS = [
  { name: 'narrow phone', width: 320, height: 640 },
  { name: 'small android phone', width: 360, height: 740 },
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 800 },
];

const CORS_HEADERS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

// Gruppen som provet lägger över det fejkade API:et: topp 3 på podiet och tre rader i "Rest of the pack". Alla har ett långt namn; de fem första har tre visade badges (en av dem
// Legendary, som har störst glöd) och den sista har ingen, med samma namn som raden ovanför, så radernas höjd går att jämföra med och utan minis.
const LONG_NAME = 'Alexandra Wilhelmina Montgomery';
const SHOWCASE = [{ series: 'milestoner', tier: 3 }, { series: 'climber', tier: 5 }, { series: 'night_owl', tier: 6 }];
const GROUP = Array.from({ length: 6 }, (_, index) => ({
  id: `board-badge-${index + 1}`,
  name: `${LONG_NAME} ${index + 1}`,
  email: `board-badge-${index + 1}@example.test`,
  is_admin: false,
  total_xp: 6000 - index * 500,
  current_level: 12 - index,
  total_km: 1234.5 - index * 20,
  current_streak: 2,
  longest_streak: 4,
  runs: [],
}));
const WITHOUT_BADGES = GROUP.length - 1;

async function stubBoardGroup(page: Page): Promise<void> {
  const reply = (body: unknown) => ({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/auth/users-with-runs', (route) => route.fulfill(reply({ success: true, data: GROUP })));
  await page.route('**/api/badges/group', (route) =>
    route.fulfill(
      reply({
        success: true,
        data: { members: GROUP.map((member, index) => ({ user_id: member.id, showcase: index === WITHOUT_BADGES ? [] : SHOWCASE })), holders: {} },
        meta: { member_count: GROUP.length },
      }),
    ),
  );
}

// Minis-grupperna i Season-raderna (podiekort och rest-rader). Mellanrummet mellan två badges ska vara ett steg ur spacing-skalan (--rq-sp-8, samma som badge-rutnäten
// på Badges-sidan och sammanfattningen), och raderna ska behålla sin höjd och sin bredd när tre badges och ett långt namn delar den.
test.describe('the badges in the leaderboard rows', () => {
  test.skip(!apiIsStubbed(), 'The group is filled from a stubbed API; run with E2E_STUB_API=1 against a local build.');

  for (const { name, width, height } of WIDTHS) {
    test(`are set one spacing step apart and keep the rows intact on a ${name} (${width} px)`, async ({ page }) => {
      await stubBoardGroup(page);
      await page.setViewportSize({ width, height });
      await page.goto('/board');
      await dismissOverlays(page);
      await expect(page.getByRole('heading', { name: 'The standings' })).toBeVisible();
      await expect(page.getByRole('img', { name: /^Badges:/ })).toHaveCount(GROUP.length - 1);
      await waitForStylesApplied(page);

      const measured = await page.evaluate((stepToken) => {
        const step = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(stepToken));
        const groups = Array.from(document.querySelectorAll('.rq-badge-minis')).map((group) => {
          const boxes = Array.from(group.children).map((mini) => mini.getBoundingClientRect());
          const host = group.closest('[role="row"], .rq-board-podium')!;
          const hostBox = host.getBoundingClientRect();
          const box = group.getBoundingClientRect();
          return {
            count: boxes.length,
            gaps: boxes.slice(1).map((next, index) => next.left - boxes[index]!.right),
            sameLine: boxes.every((mini) => Math.abs(mini.top - boxes[0]!.top) <= 1),
            insideHost: box.left >= hostBox.left - 1 && box.right <= hostBox.right + 1,
          };
        });
        const rest = Array.from(document.querySelectorAll('[role="table"][aria-label="Rest of the pack"] [role="row"]')).slice(1);
        const heightOf = (row: Element | undefined) => row?.getBoundingClientRect().height ?? 0;
        return {
          step,
          groups,
          withBadgesHeight: heightOf(rest[rest.length - 2]),
          withoutBadgesHeight: heightOf(rest[rest.length - 1]),
          restRows: rest.length,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      }, SPACING_STEP(width));

      expect(measured.step, 'the spacing step is defined by the theme').toBeGreaterThan(0);
      expect(measured.groups.length, 'every runner with badges shows a group').toBeGreaterThanOrEqual(GROUP.length - 1);
      for (const group of measured.groups) {
        expect(group.count, 'three badges are shown').toBe(3);
        for (const gap of group.gaps) {
          expect(gap, 'two badges are one spacing step apart').toBeGreaterThanOrEqual(measured.step - TOLERANCE_PX);
        }
        expect(group.sameLine, 'the badges stay on one line').toBe(true);
        expect(group.insideHost, 'the badges stay inside their row').toBe(true);
      }
      expect(measured.restRows, 'the rest of the pack lists three runners').toBe(3);
      expect(Math.abs(measured.withBadgesHeight - measured.withoutBadgesHeight), 'a row with three badges is as tall as one without').toBeLessThanOrEqual(TOLERANCE_PX);
      expect(measured.overflow, 'the page does not scroll sideways').toBeLessThanOrEqual(0);
    });
  }
});
