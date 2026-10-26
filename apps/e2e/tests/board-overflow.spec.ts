import type { Page } from '@playwright/test';
import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';
import { waitForStylesApplied } from '../support/stylesApplied';
import { targets } from '../support/targets';

/** Några pixlar marginal för subpixelavrundning i mätningarna. */
const TOLERANCE_PX = 1;

// Bredderna runt desktopbrytpunkten (1024): surfplatta under den, laptop och liggande surfplatta strax över, och bredden där tabellen fick sin fulla layout.
const WIDTHS = [
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1100, height: 800 },
  { width: 1180, height: 820 },
  { width: 1280, height: 800 },
];

function runner(index: number) {
  return {
    id: `board-overflow-${index + 1}`,
    name: `Runner Number${index + 1}`,
    email: `board-overflow-${index + 1}@example.test`,
    is_admin: false,
    total_xp: 6000 - index * 500,
    current_level: 12 - index,
    total_km: 1234.5 - index * 20,
    current_streak: 2,
    longest_streak: 4,
    runs: [],
  };
}

// Sex löpare: podiet tar tre och "Rest of the pack" får tre rader, så tabellens rubrikrad och raderna finns med. Alla har tre visade badges, som en riktig grupp.
const GROUP = Array.from({ length: 6 }, (_, index) => runner(index));
const SHOWCASE = [{ series: 'milestoner', tier: 3 }, { series: 'climber', tier: 5 }, { series: 'night_owl', tier: 6 }];

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

// Svaren sätts i webbläsaren och ersätter svaren från det riktiga eller fejkade API:et (sidans rutt går före kontextens), så provet gäller lika mot staging och stubben.
async function answerWith(page: Page, path: string, data: unknown, extra: object = {}): Promise<void> {
  await page.route(`${targets.apiUrl}/**${path}`, (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS_HEADERS })
      : route.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify({ success: true, data, ...extra }) }),
  );
}

async function openBoard(page: Page, width: number, height: number): Promise<void> {
  await answerWith(page, '/auth/users-with-runs', GROUP);
  await answerWith(page, '/badges/group', { members: GROUP.map((member) => ({ user_id: member.id, showcase: SHOWCASE })), holders: {} }, { meta: { member_count: GROUP.length } });
  await page.setViewportSize({ width, height });
  await page.goto('/board');
  await dismissOverlays(page);
  await expect(page.getByRole('table', { name: 'Rest of the pack' })).toBeVisible();
  await expect(page.getByRole('img', { name: /^Badges:/ })).toHaveCount(GROUP.length);
  await waitForStylesApplied(page);
}

test.describe('the board page', () => {
  for (const { width, height } of WIDTHS) {
    test(`does not scroll sideways and keeps every table cell inside its row on a ${width} px screen`, async ({ page }) => {
      await openBoard(page, width, height);

      const measured = await page.evaluate(() => {
        const table = document.querySelector('[role="table"][aria-label="Rest of the pack"]')!;
        const frame = table.getBoundingClientRect();
        const rows = Array.from(table.querySelectorAll('[role="row"]'));
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          rowCount: rows.length,
          rowsOutsideFrame: rows.filter((row) => row.getBoundingClientRect().right > frame.right + 1).length,
          cellsWithOverflow: rows.flatMap((row) => Array.from(row.querySelectorAll('[role="cell"], [role="columnheader"]'))).filter((cell) => cell.scrollWidth > cell.clientWidth + 1).length,
        };
      });

      expect(measured.rowCount, 'the header row and the three rest rows are on the page').toBe(4);
      expect(measured.overflow, 'the page does not scroll sideways').toBeLessThanOrEqual(0);
      expect(measured.rowsOutsideFrame, 'every row ends inside the table frame').toBe(0);
      expect(measured.cellsWithOverflow, 'no cell has content wider than itself').toBe(0);
    });
  }
});

// Podiekortens statrutor (km total, longest, runs) har tre celler i en rad. På en smal desktop är kortet ~216 px, och en etikett som "longest" fick då inte plats i sin cell:
// den löpte in i nästa cell och "LONGEST RUNS" blev ett ord.
const STAT_WIDTHS = [1024, 1100, 1180, 1280];
for (const width of STAT_WIDTHS) {
  test(`the stat labels on the podium cards are set apart from each other on a ${width} px screen`, async ({ page }) => {
    await openBoard(page, width, 800);

    const measured = await page.evaluate(() => {
      const gapStep = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rq-sp-8'));
      const rows = Array.from(document.querySelectorAll('.rq-board-podium .rq-board-stats')).map((grid) =>
        Array.from(grid.querySelectorAll('.rq-board-stat')).map((cell) => {
          const range = document.createRange();
          range.selectNodeContents(cell.querySelector('.rq-label')!);
          const text = range.getBoundingClientRect();
          const box = cell.getBoundingClientRect();
          return { label: cell.querySelector('.rq-label')!.textContent ?? '', textLeft: text.left, textRight: text.right, cellLeft: box.left, cellRight: box.right };
        }),
      );
      return { gapStep, rows };
    });

    expect(measured.gapStep, 'the spacing step is defined by the theme').toBeGreaterThan(0);
    expect(measured.rows.length, 'the three podium cards each show their stat rows').toBeGreaterThanOrEqual(3);
    for (const cells of measured.rows) {
      for (const [index, cell] of cells.entries()) {
        expect(cell.textLeft, `the label "${cell.label}" starts inside its cell`).toBeGreaterThanOrEqual(cell.cellLeft - TOLERANCE_PX);
        expect(cell.textRight, `the label "${cell.label}" ends inside its cell`).toBeLessThanOrEqual(cell.cellRight + TOLERANCE_PX);
        const next = cells[index + 1];
        if (next) expect(next.textLeft - cell.textRight, `"${cell.label}" and "${next.label}" are at least one spacing step apart`).toBeGreaterThanOrEqual(measured.gapStep - TOLERANCE_PX);
      }
    }
  });
}
