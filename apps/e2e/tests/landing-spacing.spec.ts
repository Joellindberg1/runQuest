import { expect, test } from '../support/test';
import { waitForStylesApplied } from '../support/stylesApplied';

/** Några pixlar marginal för subpixelavrundning i mätningarna. */
const TOLERANCE_PX = 1;

const WIDTHS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 800 },
];

test.use({ storageState: { cookies: [], origins: [] } });

// Väntelistan ligger under funktionskorten (Events, Strava sync, The journey på datorbredd). Avståndet dit ska vara samma steg som mellan "How it works" och
// funktionskorten, alltså sidans sektionsavstånd, och inte noll.
test.describe('the landing page spacing above the waitlist', () => {
  for (const { name, width, height } of WIDTHS) {
    test(`the waitlist is set apart from the feature cards by the section gap on a ${name} (${width} px)`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await expect(page.locator('section#waitlist')).toBeVisible();
      await waitForStylesApplied(page);

      const gaps = await page.evaluate(() => {
        const top = (element: Element) => element.getBoundingClientRect().top;
        const bottom = (element: Element) => element.getBoundingClientRect().bottom;
        const how = document.querySelector('.rq-landing-how')!;
        const cards = document.querySelector('.rq-landing-features__list')!;
        const waitlist = document.querySelector('section#waitlist')!;
        return { section: top(cards) - bottom(how.lastElementChild!), waitlist: top(waitlist) - bottom(cards) };
      });

      expect(gaps.section, 'the gap between How it works and the feature cards is the section gap').toBeGreaterThan(0);
      expect(gaps.waitlist, 'the waitlist is not glued to the feature cards').toBeGreaterThan(0);
      expect(Math.abs(gaps.waitlist - gaps.section), 'the waitlist gap is the same step as the other sections').toBeLessThanOrEqual(TOLERANCE_PX);
    });
  }
});
