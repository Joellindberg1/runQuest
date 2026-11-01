import type { Locator, Page } from '@playwright/test';
import { expect } from './test';

/** Marginal för subpixelavrundning: `scrollLeft` är ett heltal, så fadens zon kan ge eller ta en bråkdel av en pixel. */
const ZONE_TOLERANCE_PX = 1;

/**
 * Väntar tills typsnitten är laddade och layouten satt sig. Flikarnas bredd (och därmed var en flik hamnar efter ett heltals-`scrollLeft`) hänger på typsnittet: ett byte som görs medan
 * reservtypsnittet fortfarande gäller mäter en annan geometri än den en användare ser några hundra millisekunder senare.
 */
export async function waitForFontsAndLayout(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));
}

/** Byter `?view=` som en navigering i appen (adressen ändras utan omladdning, som en länk eller bakåtknappen), så att typsnitten redan är laddade när fliken väljs. */
export async function changeViewInTheAddress(page: Page, view: string): Promise<void> {
  await page.evaluate((next) => {
    const url = new URL(location.href);
    url.searchParams.set('view', next);
    history.pushState(null, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, view);
}

/**
 * Den valda fliken i en flikrad med kantfade ligger helt i raden och utanför fadens zon (`scroll-padding-inline`) på de sidor där en fade ritas, så att dess text aldrig tonas ut.
 * Första och sista fliken får ligga mot kanten, eftersom ingen fade ritas där. `tablist` är raden; fadens sidor läses ur `data-fade-start` och `data-fade-end` på dess förälder.
 */
export async function expectSelectedTabClearOfFade(tablist: Locator, message: string): Promise<void> {
  await expect
    .poll(
      async () =>
        tablist.evaluate((element, tolerance) => {
          const outer = element.parentElement!;
          const zone = parseFloat(getComputedStyle(element).scrollPaddingLeft);
          const tab = element.querySelector('[role="tab"][aria-selected="true"]')!.getBoundingClientRect();
          const row = element.getBoundingClientRect();
          const fadeStart = outer.getAttribute('data-fade-start') === 'true';
          const fadeEnd = outer.getAttribute('data-fade-end') === 'true';
          return {
            inRow: tab.left >= row.left - tolerance && tab.right <= row.right + tolerance,
            clearOfStart: !fadeStart || tab.left - row.left >= zone - tolerance,
            clearOfEnd: !fadeEnd || row.right - tab.right >= zone - tolerance,
          };
        }, ZONE_TOLERANCE_PX),
      { message },
    )
    .toEqual({ inRow: true, clearOfStart: true, clearOfEnd: true });
}
