import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';
import { waitForStylesApplied } from '../support/stylesApplied';

/** Några pixlar marginal för subpixelavrundning i mätningarna. */
const TOLERANCE_PX = 1;

const PHONE_WIDTHS = [320, 360, 375];
const PHONE_HEIGHT = 740;

// Statflikarna i den ordning de ritas. Fliken Consistency är den fjärde och den som la sig utanför fönstret på 320 px.
const STAT_TABS = ['Distance', 'Streak', 'Fun facts', 'Consistency'];

// Profilen på de smalaste telefonerna. Måtten läses ur den ritade sidan efter att stilmallarna är tillämpade (support/stylesApplied.ts). Sidan fylls av det fejkade API:et (en löpare utan rundor);
// flikraden och kortet runt den ritas lika för varje löpare, så provet gäller lika mot stagingdatan.
test.describe('the profile on a phone', () => {
  for (const width of PHONE_WIDTHS) {
    test.describe(`${width} px`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width, height: PHONE_HEIGHT });
        await page.goto('/profile');
        await dismissOverlays(page);
        await expect(page.getByRole('tablist', { name: 'Your stats' })).toBeVisible();
        await waitForStylesApplied(page);
      });

      test(`the page does not scroll sideways on a ${width} px phone`, async ({ page }) => {
        const root = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
        expect(root.scrollWidth, 'the page is not wider than the window').toBeLessThanOrEqual(root.clientWidth + TOLERANCE_PX);
      });

      test(`every stat tab can be reached from the tab row on a ${width} px phone`, async ({ page }) => {
        const tablist = page.getByRole('tablist', { name: 'Your stats' });
        const rectOf = (locator: typeof tablist) => locator.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return { left: box.left, right: box.right };
        });

        // Piltangenterna flyttar markeringen och fokus till nästa flik (ViewTabs); webbläsaren för in den fokuserade fliken i bild i flikraden.
        await page.getByRole('tab', { name: STAT_TABS[0] }).click();
        for (const name of STAT_TABS) {
          const tab = page.getByRole('tab', { name });
          if ((await tab.getAttribute('aria-selected')) !== 'true') await page.keyboard.press('ArrowRight');
          await expect(tab).toHaveAttribute('aria-selected', 'true');
          await expect
            .poll(
              async () => {
                const row = await rectOf(tablist);
                const box = await rectOf(tab);
                return { startsInside: box.left >= row.left - TOLERANCE_PX, endsInside: box.right <= row.right + TOLERANCE_PX };
              },
              { message: `the "${name}" tab is inside the tab row` },
            )
            .toEqual({ startsInside: true, endsInside: true });
        }

        const row = await rectOf(tablist);
        expect(row.right, 'the tab row ends inside the window').toBeLessThanOrEqual(width + TOLERANCE_PX);
        await expect(page.getByRole('tabpanel')).toBeVisible();
      });
    });
  }
});
