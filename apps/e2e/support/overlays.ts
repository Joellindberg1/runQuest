import type { Page } from '@playwright/test';

// Tiderna är rymliga med flit: en tur startar först när onboarding-statusen hämtats och efter en startfördröjning (600-800 ms), och nästa tur
// startar först när den förra markerats sedd. Ett nytt konto möter flera i följd; ett konto som redan sett dem möter inga, och då kostar väntan bara tiden.
const QUIET_MS = 3_000;
const HIDE_WAIT_MS = 3_000;
const MAX_ROUNDS = 8;

/**
 * Stänger det som kan lägga sig över en inloggad sida: välkomstturen och sidoturerna (driver.js sätter `driver-active` på body), "What's new"-popupen och
 * badge-/nivåpopuparna (dialoger). Escape stänger dem alla och markerar dem sedda, så ett nytt testkonto möter dem en gång. Sidan är fri när inget nytt
 * dykt upp under en lugn stund. Anropas direkt efter en sidladdning, före åtgärder, och inte på inloggningsdialogen (som också är en dialog) eller
 * med en popover öppen (kontomenyn är en dialog den med).
 */
export async function dismissOverlays(page: Page): Promise<void> {
  const overlay = page.locator('body.driver-active, [role="dialog"]').first();
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const appeared = await overlay.waitFor({ state: 'visible', timeout: QUIET_MS }).then(
      () => true,
      () => false,
    );
    if (!appeared) return;
    await page.keyboard.press('Escape');
    await overlay.waitFor({ state: 'hidden', timeout: HIDE_WAIT_MS }).catch(() => undefined);
  }
}
