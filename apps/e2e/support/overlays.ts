import type { Page } from '@playwright/test';

// Turerna och "What's new" avgörs av onboarding-statusen (GET /onboarding/status) och startar sedan efter en fördröjning (600-800 ms; popupen 500 ms).
// Först väntas därför statusen ut, och sedan en lugn stund: inget nytt dök upp inom FIRST_QUIET_MS efter den (eller NEXT_QUIET_MS efter förra stängningen,
// som markerar nästa tur och hämtar om statusen).
const STATUS_WAIT_MS = 10_000;
const STATUS_POLL_MS = 100;
const FIRST_QUIET_MS = 2_500;
const NEXT_QUIET_MS = 3_000;
const HIDE_WAIT_MS = 3_000;
const MAX_ROUNDS = 8;

interface StatusClock {
  /** När sidan senast begärde ett nytt dokument (en riktig sidladdning; inte en navigering inne i appen). */
  navigatedAt: number;
  /** När statusen senast svarade. */
  answeredAt: number;
}
const clocks = new WeakMap<Page, StatusClock>();

/**
 * Börjar hålla reda på när sidan laddats om och när onboarding-statusen svarat. Anropas av testfixturen (support/test.ts) före första navigeringen.
 * Dokumentbegäran kommer alltid före appens egna anrop i samma laddning, så ett svar som är nyare än den är svaret för den här sidan.
 */
export function trackOnboardingStatus(page: Page): void {
  const clock: StatusClock = { navigatedAt: 0, answeredAt: 0 };
  clocks.set(page, clock);
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) clock.navigatedAt = Date.now();
  });
  page.on('response', (response) => {
    if (response.url().includes('/onboarding/status')) clock.answeredAt = Date.now();
  });
}

async function waitForStatus(page: Page): Promise<void> {
  const clock = clocks.get(page);
  if (!clock) return;
  const deadline = Date.now() + STATUS_WAIT_MS;
  while (clock.answeredAt <= clock.navigatedAt && Date.now() < deadline) {
    await page.waitForTimeout(STATUS_POLL_MS);
  }
}

/**
 * Stänger det som kan lägga sig över en inloggad sida: välkomstturen och sidoturerna (driver.js sätter `driver-active` på body), "What's new"-popupen och
 * badge-/nivåpopuparna (dialoger). Escape stänger dem alla och markerar dem sedda, så ett nytt testkonto möter dem en gång. Anropas direkt efter en sidladdning,
 * före åtgärder, och inte på inloggningsdialogen (som också är en dialog) eller med en popover öppen (kontomenyn är en dialog den med).
 */
export async function dismissOverlays(page: Page): Promise<void> {
  // Kommer statusen aldrig (felsvar) går vi vidare efter taket, på den lugna stunden.
  await waitForStatus(page);

  const overlay = page.locator('body.driver-active, [role="dialog"]').first();
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const appeared = await overlay.waitFor({ state: 'visible', timeout: round === 0 ? FIRST_QUIET_MS : NEXT_QUIET_MS }).then(
      () => true,
      () => false,
    );
    if (!appeared) return;
    await page.keyboard.press('Escape');
    await overlay.waitFor({ state: 'hidden', timeout: HIDE_WAIT_MS }).catch(() => undefined);
  }
}
