import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';
import { waitForStylesApplied } from '../support/stylesApplied';

/** Några pixlar marginal för subpixelavrundning i mätningarna. */
const TOLERANCE_PX = 1;

const WIDTHS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 800 },
];

// Tabellen "The basics" (kapitlet What counts as a run) har ett långt svar ("As you save, backup every 12 hours"). Raderna och svaren ska ligga inom rutans kant
// (listan med raderna, som har rutans bakgrund) och rutan inom skärmen. Texten är kapitlets egen, så provet gäller både mot staging och det fejkade API:et.
test.describe('the Playbook table "The basics"', () => {
  for (const { name, width, height } of WIDTHS) {
    test(`every answer stays inside the box on a ${name} (${width} px)`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/playbook?view=run');
      await dismissOverlays(page);
      const box = page.getByRole('region', { name: 'The basics' });
      await expect(box).toBeVisible();
      await waitForStylesApplied(page);

      const measured = await box.evaluate((element) => {
        const rows = element.querySelector('dl')!.getBoundingClientRect();
        const textRect = (node: Element) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          return range.getBoundingClientRect();
        };
        const entries = Array.from(element.querySelectorAll('dl > div')).map((row) => {
          const answer = row.querySelector('dd')!;
          const text = textRect(answer);
          const rowRect = row.getBoundingClientRect();
          return {
            text: answer.textContent ?? '',
            textLeft: text.left - rows.left,
            textRight: rows.right - text.right,
            rowLeft: rowRect.left - rows.left,
            rowRight: rows.right - rowRect.right,
          };
        });
        return { entries, pageOverflow: document.documentElement.scrollWidth - window.innerWidth };
      });

      expect(measured.entries.length, 'the table has its rows').toBeGreaterThan(0);
      for (const entry of measured.entries) {
        expect(entry.textLeft, `"${entry.text}" starts inside the box`).toBeGreaterThanOrEqual(-TOLERANCE_PX);
        expect(entry.textRight, `"${entry.text}" ends inside the box`).toBeGreaterThanOrEqual(-TOLERANCE_PX);
        expect(entry.rowLeft, `the row of "${entry.text}" starts inside the box`).toBeGreaterThanOrEqual(-TOLERANCE_PX);
        expect(entry.rowRight, `the row of "${entry.text}" ends inside the box`).toBeGreaterThanOrEqual(-TOLERANCE_PX);
      }
      expect(measured.pageOverflow, 'the page does not scroll sideways').toBeLessThanOrEqual(TOLERANCE_PX);
    });
  }
});
