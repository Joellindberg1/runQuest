import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';
import { waitForStylesApplied } from '../support/stylesApplied';

/** Några pixlar marginal för subpixelavrundning i mätningarna. */
const TOLERANCE_PX = 1;

/** Minsta träffyta för tumme (WCAG 2.5.5 / temats --rq-control-hit på mobil). */
const MIN_TOUCH_TARGET_PX = 44;

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

      test(`every stat tab is at least 44 px tall on a ${width} px phone`, async ({ page }) => {
        const heights = await page.getByRole('tab').evaluateAll((tabs) => tabs.map((tab) => tab.getBoundingClientRect().height));
        expect(heights).toHaveLength(STAT_TABS.length);
        heights.forEach((height, index) => expect(height, `the "${STAT_TABS[index]}" tab`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX));
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

// Flikraden på alla bredder (också datorbredd, där den inte scrollar). overflow-x: auto gör overflow-y till auto, så en fokusring som ritas utanför flikens kant klipps av raden; och flikarna ska fortfarande
// dela raden lika (flex: 1) som förut.
const ROW_WIDTHS = [
  { width: 320, height: PHONE_HEIGHT },
  { width: 375, height: PHONE_HEIGHT },
  { width: 1440, height: 900 },
];

test.describe('the stat tab row at every width', () => {
  for (const { width, height } of ROW_WIDTHS) {
    test(`the focus ring of a stat tab is not clipped by the tab row at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/profile');
      await dismissOverlays(page);
      const tablist = page.getByRole('tablist', { name: 'Your stats' });
      await expect(tablist).toBeVisible();
      await waitForStylesApplied(page);

      // Fokusringen visas bara för tangentbordsfokus (:focus-visible), så flikarna nås med piltangenterna: Streak, Fun facts, Consistency och, runt, Distance.
      await page.getByRole('tab', { name: STAT_TABS[0] }).click();
      for (const name of [...STAT_TABS.slice(1), STAT_TABS[0]!]) {
        const tab = page.getByRole('tab', { name });
        await page.keyboard.press('ArrowRight');
        await expect(tab).toBeFocused();
        // Ringen ritas från flikens kant, förskjuten med outline-offset (negativt = inåt) och outline-width utåt. En rad som klipper (overflow annat än visible) får inte ha ringen utanför sin rektangel
        // (efter att raden scrollat fliken i bild).
        await expect
          .poll(
            async () =>
              tab.evaluate((element) => {
                const style = getComputedStyle(element);
                const reach = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
                const box = element.getBoundingClientRect();
                const rowElement = element.parentElement!;
                const row = rowElement.getBoundingClientRect();
                const rowStyle = getComputedStyle(rowElement);
                const clips = rowStyle.overflowX !== 'visible' || rowStyle.overflowY !== 'visible';
                const inside =
                  box.top - reach >= row.top - 1 && box.bottom + reach <= row.bottom + 1 && box.left - reach >= row.left - 1 && box.right + reach <= row.right + 1;
                return { drawn: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0, clipped: clips && !inside };
              }),
            { message: `the focus ring of the "${name}" tab is not clipped` },
          )
          .toEqual({ drawn: true, clipped: false });
      }
    });
  }

  test('the stat tabs keep their natural height on a desktop width (the 44 px touch target is for phones)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/profile');
    await dismissOverlays(page);
    await expect(page.getByRole('tablist', { name: 'Your stats' })).toBeVisible();
    await waitForStylesApplied(page);
    // Höjden jämförs med samma flikar utan min-height: på datorbredd är den noll, så ingenting ska ha växt.
    const measured = await page.getByRole('tab').evaluateAll(async (tabs) => {
      const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const heightsOf = () => tabs.map((tab) => tab.getBoundingClientRect().height);
      const drawn = heightsOf();
      tabs.forEach((tab) => (tab as HTMLElement).style.setProperty('min-height', '0'));
      await nextFrame();
      const natural = heightsOf();
      tabs.forEach((tab) => (tab as HTMLElement).style.removeProperty('min-height'));
      return { drawn, natural };
    });
    expect(measured.drawn).toHaveLength(STAT_TABS.length);
    measured.drawn.forEach((value, index) => expect(Math.abs(value - measured.natural[index]!), `the "${STAT_TABS[index]}" tab keeps its height`).toBeLessThanOrEqual(TOLERANCE_PX));
  });

  for (const { width, height } of ROW_WIDTHS.filter((size) => size.width >= 375)) {
    test(`the four stat tabs share the tab row evenly at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/profile');
      await dismissOverlays(page);
      await expect(page.getByRole('tablist', { name: 'Your stats' })).toBeVisible();
      await waitForStylesApplied(page);
      // Flikarna delar raden som `flex: 1` (lika andel av det som blir över, aldrig smalare än sin text): de ritade bredderna jämförs med samma flikar med `flex: 1` satt direkt på dem. På datorbredd, där alla
      // ryms, blir de dessutom lika breda. En annan flex-regel (till exempel `1 0 auto`, som lägger överskottet på texten) ger andra bredder.
      const measured = await page.getByRole('tab').evaluateAll(async (tabs) => {
        const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const widthsOf = () => tabs.map((tab) => tab.getBoundingClientRect().width);
        const drawn = widthsOf();
        tabs.forEach((tab) => (tab as HTMLElement).style.setProperty('flex', '1'));
        await nextFrame();
        const reference = widthsOf();
        tabs.forEach((tab) => (tab as HTMLElement).style.removeProperty('flex'));
        return { drawn, reference };
      });
      expect(measured.drawn).toHaveLength(STAT_TABS.length);
      measured.drawn.forEach((value, index) => expect(Math.abs(value - measured.reference[index]!), `the "${STAT_TABS[index]}" tab keeps its width`).toBeLessThanOrEqual(TOLERANCE_PX));
      if (width >= 1024) expect(Math.max(...measured.drawn) - Math.min(...measured.drawn), 'all four tabs are equally wide').toBeLessThanOrEqual(TOLERANCE_PX);
    });
  }
});
