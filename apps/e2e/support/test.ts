import { expect, test as base } from '@playwright/test';
import { isProdRequestUrl } from '../../../scripts/e2e-guard.mjs';

/**
 * Alla specer importerar `test` härifrån, inte från @playwright/test. Den automatiska fixturen `productionGuard` är tredje lagret i E2E-vakten:
 * varje förfrågan till en prodadress avbryts, och testet fäller sig självt om någon gjordes. Pekar ett stagingbygge av misstag på prodens API
 * når alltså ingen läsning eller skrivning fram.
 */
export const test = base.extend<{ productionGuard: void }>({
  productionGuard: [
    async ({ context }, use) => {
      const blocked: string[] = [];
      await context.route(
        (url) => isProdRequestUrl(url.href),
        (route) => {
          blocked.push(new URL(route.request().url()).host);
          return route.abort('blockedbyclient');
        },
      );
      await use();
      expect(blocked, 'the page tried to reach production, which the E2E suite must never do').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
