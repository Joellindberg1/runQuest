import { expect, test } from '../support/test';
import { waitForStylesApplied } from '../support/stylesApplied';

/** Några pixlar marginal för subpixelavrundning i mätningarna. */
const TOLERANCE_PX = 1;
const MAX_TABS = 12;

// Kortet på /preview har `overflow: hidden`, så en fokusring som ritas utanför lagerknappen klipps bort. Provet tabbar till kortets knapp och mäter att ringens yttre kant
// (knappens rektangel utvidgad med outline-offset och bredd) ligger inom kortets rektangel, dvs. att ringen syns. Sidan är publik och kräver inget API.
test.describe('the active challenge card on the preview page', () => {
  for (const width of [375, 1440]) {
    test(`keyboard focus on the card draws a ring inside the card on a ${width} px screen`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/preview');
      await waitForStylesApplied(page);
      const cardButton = page.getByRole('button', { name: /^Open challenge against / });
      await expect(cardButton).toBeVisible();

      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      for (let presses = 0; presses < MAX_TABS; presses += 1) {
        await page.keyboard.press('Tab');
        if (await cardButton.evaluate((el) => el === document.activeElement)) break;
      }
      await expect(cardButton).toBeFocused();

      const ring = await cardButton.evaluate((el) => {
        const style = getComputedStyle(el);
        const button = el.getBoundingClientRect();
        const card = el.parentElement!.getBoundingClientRect();
        const reach = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
        return {
          style: style.outlineStyle,
          width: parseFloat(style.outlineWidth),
          outer: { left: button.left - reach, top: button.top - reach, right: button.right + reach, bottom: button.bottom + reach },
          card: { left: card.left, top: card.top, right: card.right, bottom: card.bottom },
        };
      });

      expect(ring.style, 'the focus ring is drawn').not.toBe('none');
      expect(ring.width, 'the focus ring has a width').toBeGreaterThan(0);
      expect(ring.outer.left, 'ring inside the card, left').toBeGreaterThanOrEqual(ring.card.left - TOLERANCE_PX);
      expect(ring.outer.top, 'ring inside the card, top').toBeGreaterThanOrEqual(ring.card.top - TOLERANCE_PX);
      expect(ring.outer.right, 'ring inside the card, right').toBeLessThanOrEqual(ring.card.right + TOLERANCE_PX);
      expect(ring.outer.bottom, 'ring inside the card, bottom').toBeLessThanOrEqual(ring.card.bottom + TOLERANCE_PX);
    });
  }
});
