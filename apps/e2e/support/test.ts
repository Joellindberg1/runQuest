import { expect, test as base } from '@playwright/test';
import { isBlockedRequestUrl } from '../../../scripts/e2e-guard.mjs';
import { trackOnboardingStatus } from './overlays';
import { delayStylesheets } from './loadingView';
import { installStubApi, stubApiRequested } from './stubApi';
import { collectCspViolations, describeViolation, reportViolations, type CspViolationLog } from './cspViolations';

/**
 * Alla specer importerar `test` härifrån, inte från @playwright/test. Den automatiska fixturen `productionGuard` är tredje lagret i E2E-vakten:
 * varje förfrågan till en prodadress avbryts, och testet fäller sig självt om någon gjordes. Pekar ett stagingbygge av misstag på prodens API
 * når alltså ingen läsning eller skrivning fram.
 */
export const test = base.extend<{ productionGuard: void; onboardingTracker: void; stubbedApi: void; slowStylesheets: void; cspGuard: CspViolationLog }>({
  // CSP-överträdelser (RUN-344): blockerar en skarp CSP något fäller provet sig självt; i Report-Only-läget skrivs överträdelserna ut och läggs som anteckning på
  // provet. Samlas från alla sidor och ramar i testets kontext (support/cspViolations.ts).
  cspGuard: [
    async ({ context }, use, testInfo) => {
      const log = await collectCspViolations(context);
      await use(log);
      const enforced = reportViolations(log, testInfo);
      expect(enforced.map(describeViolation), 'the page broke its Content-Security-Policy').toEqual([]);
    },
    { auto: true },
  ],

  // Valfri fördröjning av alla stilmallar (E2E_STYLESHEET_DELAY_MS, millisekunder) för att köra hela sviten som mot ett långsamt nät. Utan variabeln händer ingenting.
  slowStylesheets: [
    async ({ page }, use) => {
      await delayStylesheets(page, Number(process.env.E2E_STYLESHEET_DELAY_MS) || 0);
      await use();
    },
    { auto: true },
  ],

  // Valfritt fejkat API för lokala körningar (E2E_STUB_API=1, se support/stubApi.ts). Utan variabeln händer ingenting: mot staging är API:et alltid det riktiga.
  stubbedApi: [
    async ({ context }, use) => {
      if (stubApiRequested()) await installStubApi(context);
      await use();
    },
    { auto: true },
  ],

  // Håller reda på onboarding-statusens svar åt dismissOverlays (support/overlays.ts).
  onboardingTracker: [
    async ({ page }, use) => {
      trackOnboardingStatus(page);
      await use();
    },
    { auto: true },
  ],

  productionGuard: [
    async ({ context }, use) => {
      const blocked: string[] = [];
      await context.route(
        (url) => isBlockedRequestUrl(url.href),
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
