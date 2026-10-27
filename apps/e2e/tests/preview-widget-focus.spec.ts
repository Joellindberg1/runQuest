import { expect, test } from '../support/test';
import { waitForStylesApplied } from '../support/stylesApplied';

/** Några pixlar marginal för subpixelavrundning i mätningarna. */
const TOLERANCE_PX = 1;
const MAX_TABS = 12;
/** WCAG 1.4.11: en fokusindikator mot sin bakgrund. */
const MIN_RING_CONTRAST = 3;
const THEMES = ['dark', 'light'] as const;

// Kortet på /preview har `overflow: hidden`, så en fokusring som ritas utanför lagerknappen klipps bort. Provet tabbar till kortets knapp och mäter dels att ringens yttre kant
// (knappens rektangel utvidgad med outline-offset och bredd) ligger inom kortets rektangel, dels att ringens färg har minst 3:1 mot kortets ritade bakgrund, i mörkt och ljust tema.
// Sidan är publik och kräver inget API. Temat sätts som next-themes gör: `localStorage.theme` före sidans skript, som ger `data-theme` på <html>.
test.describe('the active challenge card on the preview page', () => {
  for (const theme of THEMES) {
    for (const width of [375, 1440]) {
      test(`keyboard focus on the card draws a visible ring inside the card in the ${theme} theme on a ${width} px screen`, async ({ page }) => {
        await page.addInitScript((value) => window.localStorage.setItem('theme', value), theme);
        await page.setViewportSize({ width, height: 800 });
        await page.goto('/preview');
        await waitForStylesApplied(page);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const cardButton = page.getByRole('button', { name: /^Open challenge against / });
        await expect(cardButton).toBeVisible();

        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        for (let presses = 0; presses < MAX_TABS; presses += 1) {
          await page.keyboard.press('Tab');
          if (await cardButton.evaluate((el) => el === document.activeElement)) break;
        }
        await expect(cardButton).toBeFocused();

        const ring = await cardButton.evaluate((el) => {
          type Rgba = [number, number, number, number];
          const parse = (color: string): Rgba => {
            const [r = 0, g = 0, b = 0, a = 1] = (color.match(/[\d.]+/g) ?? []).map(Number);
            return [r, g, b, a];
          };
          // Kortets ritade bakgrund: lagren från kortet och uppåt blandas ovanpå varandra tills ett lager är ogenomskinligt.
          const paintedBackground = (card: Element): [number, number, number] => {
            const layers: Rgba[] = [];
            for (let node: Element | null = card; node; node = node.parentElement) {
              const layer = parse(getComputedStyle(node).backgroundColor);
              if (layer[3] > 0) layers.push(layer);
              if (layer[3] === 1) break;
            }
            return layers.reduceRight<[number, number, number]>(
              (below, [r, g, b, a]) => [r * a + below[0] * (1 - a), g * a + below[1] * (1 - a), b * a + below[2] * (1 - a)],
              [0, 0, 0],
            );
          };
          const style = getComputedStyle(el);
          const button = el.getBoundingClientRect();
          const cardElement = el.parentElement!;
          const card = cardElement.getBoundingClientRect();
          const reach = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
          const [r, g, b] = parse(style.outlineColor);
          return {
            style: style.outlineStyle,
            width: parseFloat(style.outlineWidth),
            outer: { left: button.left - reach, top: button.top - reach, right: button.right + reach, bottom: button.bottom + reach },
            card: { left: card.left, top: card.top, right: card.right, bottom: card.bottom },
            ringColor: [r, g, b] as [number, number, number],
            background: paintedBackground(cardElement),
          };
        });

        expect(ring.style, 'the focus ring is drawn').not.toBe('none');
        expect(ring.width, 'the focus ring has a width').toBeGreaterThan(0);
        expect(ring.outer.left, 'ring inside the card, left').toBeGreaterThanOrEqual(ring.card.left - TOLERANCE_PX);
        expect(ring.outer.top, 'ring inside the card, top').toBeGreaterThanOrEqual(ring.card.top - TOLERANCE_PX);
        expect(ring.outer.right, 'ring inside the card, right').toBeLessThanOrEqual(ring.card.right + TOLERANCE_PX);
        expect(ring.outer.bottom, 'ring inside the card, bottom').toBeLessThanOrEqual(ring.card.bottom + TOLERANCE_PX);

        const contrast = contrastRatio(ring.ringColor, ring.background);
        console.log(`ring contrast ${theme} ${width}px: ${contrast.toFixed(2)}:1 (ring rgb(${ring.ringColor.join(',')}) on rgb(${ring.background.map(Math.round).join(',')}))`);
        expect(contrast, 'the ring has at least 3:1 against the card').toBeGreaterThanOrEqual(MIN_RING_CONTRAST);
      });
    }
  }
});

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}
