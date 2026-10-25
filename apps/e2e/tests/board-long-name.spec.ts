import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';
import { waitForStylesApplied } from '../support/stylesApplied';
import { targets } from '../support/targets';

/** Några pixlar marginal för subpixelavrundning i mätningarna. */
const TOLERANCE_PX = 1;

const PHONE_WIDTHS = [320, 360, 375];
const PHONE_HEIGHT = 812;

// Ett enda ord utan brytpunkt (30 tecken) som är bredare än mittkolumnen på 320 px. Orden i ett vanligt namn bryts vid mellanslag som förut; bara ett ord som inte ryms bryts mitt i.
const LONG_WORD = 'Montgomery-Featherstonehaugh';
const LONG_NAME = `${LONG_WORD} 1`;
const NORMAL_NAME = 'Sam Rest';
const OTHER_NORMAL_NAME = 'Kim Rest';

function runner(id: string, name: string, totalXp: number) {
  return {
    id,
    name,
    email: `${id}@example.test`,
    is_admin: false,
    total_xp: totalXp,
    current_level: 4,
    total_km: 40,
    current_streak: 3,
    longest_streak: 5,
    runs: [],
  };
}

// Podiet tar plats 1-3, så namnen på plats 4-6 ritas som rest-rader ("Rest of the pack"): ett långt, och två vanliga som visar att radhöjden för vanliga namn inte ändras.
const GROUP = [
  runner('board-1', 'Ada One', 3000),
  runner('board-2', 'Bo Two', 2800),
  runner('board-3', 'Cy Three', 2600),
  runner('board-4', LONG_NAME, 2400),
  runner('board-5', NORMAL_NAME, 2200),
  runner('board-6', OTHER_NORMAL_NAME, 2000),
];

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

// Gruppen sätts i webbläsaren och ersätter svaret från det riktiga eller fejkade API:et (sidans rutt går före kontextens), så provet gäller lika mot staging och mot stubben, och ingen
// förfrågan om gruppen når ett riktigt API.
test.describe('the rest of the pack with a very long name', () => {
  for (const width of PHONE_WIDTHS) {
    test(`a name with a very long word stays inside its row and the page does not scroll sideways on a ${width} px phone`, async ({ page }) => {
      await page.route(`${targets.apiUrl}/**/auth/users-with-runs`, (route) =>
        route.request().method() === 'OPTIONS'
          ? route.fulfill({ status: 204, headers: CORS_HEADERS })
          : route.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify({ success: true, data: GROUP }) }),
      );
      await page.setViewportSize({ width, height: PHONE_HEIGHT });
      await page.goto('/board');
      await dismissOverlays(page);
      const table = page.getByRole('table', { name: 'Rest of the pack' });
      await expect(table.getByRole('button', { name: LONG_NAME, exact: true })).toBeVisible();
      await waitForStylesApplied(page);

      const measured = await table.evaluate((element, longName) => {
        const frame = element.getBoundingClientRect();
        const rows = Array.from(element.querySelectorAll('[role="row"]')).filter((row) => row.querySelector('[role="cell"]'));
        const textRect = (node: Element) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          return range.getBoundingClientRect();
        };
        return {
          rows: rows.map((row) => {
            const box = row.getBoundingClientRect();
            const name = row.querySelector('button')!;
            const text = textRect(name);
            return {
              name: name.textContent ?? '',
              isLong: name.textContent === longName,
              height: box.height,
              rowLeft: box.left - frame.left,
              rowRight: frame.right - box.right,
              textLeft: text.left - box.left,
              textRight: box.right - text.right,
            };
          }),
          pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      }, LONG_NAME);

      expect(measured.rows.length, 'the long name and the two ordinary names are in the rest rows').toBe(3);
      for (const row of measured.rows) {
        expect(row.rowLeft, `the row of "${row.name}" starts inside the frame`).toBeGreaterThanOrEqual(-TOLERANCE_PX);
        expect(row.rowRight, `the row of "${row.name}" ends inside the frame`).toBeGreaterThanOrEqual(-TOLERANCE_PX);
        expect(row.textLeft, `"${row.name}" starts inside its row`).toBeGreaterThanOrEqual(-TOLERANCE_PX);
        expect(row.textRight, `"${row.name}" ends inside its row`).toBeGreaterThanOrEqual(-TOLERANCE_PX);
      }
      expect(measured.pageOverflow, 'the page does not scroll sideways').toBeLessThanOrEqual(TOLERANCE_PX);

      // Raderna med vanliga namn har samma uppbyggnad och därmed samma höjd: det långa namnet får bara sin egen rad att växa.
      const ordinary = measured.rows.filter((row) => !row.isLong).map((row) => row.height);
      expect(Math.max(...ordinary) - Math.min(...ordinary), 'rows with ordinary names have the same height').toBeLessThanOrEqual(TOLERANCE_PX);
    });
  }
});
