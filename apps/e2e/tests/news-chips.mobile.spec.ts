import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';

const CHIP_COUNT = 7;
/** Några pixlar marginal för subpixelavrundning i mätningarna. */
const TOLERANCE_PX = 2;

test.describe('Pack News on a phone', () => {
  test('the seven filter chips scroll sideways inside their row without widening the page', async ({ page }) => {
    // ?type= gör filterkortet synligt även när kontot inte har några nyhetsrader än.
    await page.goto('/news?type=levels');
    await dismissOverlays(page);

    const row = page.getByRole('group', { name: 'Filter' });
    const chips = row.getByRole('button');
    await expect(chips).toHaveCount(CHIP_COUNT);

    // Sju chips är bredare än skärmen: raden scrollar, sidan gör det inte (en dold text som lades utanför flödet gav förut sidled scroll på hela sidan).
    const widths = await row.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
    expect(widths.scroll).toBeGreaterThan(widths.client);
    // Mätt mot den konfigurerade skärmbredden, inte window.innerWidth: en mobil webbläsare vidgar innerWidth till innehållets bredd när något spricker ut.
    const pageScroll = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(pageScroll).toBeLessThanOrEqual(page.viewportSize()!.width + TOLERANCE_PX);
  });

  test('the last chip can be reached with the keyboard and ends up on screen', async ({ page }) => {
    await page.goto('/news?type=levels');
    await dismissOverlays(page);

    const last = page.getByRole('group', { name: 'Filter' }).getByRole('button').last();
    await last.focus();

    await expect
      .poll(async () => {
        const box = await last.boundingBox();
        const viewport = page.viewportSize();
        return box !== null && viewport !== null && box.x >= -TOLERANCE_PX && box.x + box.width <= viewport.width + TOLERANCE_PX;
      })
      .toBe(true);
  });
});
