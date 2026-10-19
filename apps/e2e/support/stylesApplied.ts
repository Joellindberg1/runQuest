import type { Page } from '@playwright/test';

/** Hur länge en stilmall får saknas innan mätningen ger upp och säger vilken det var (nätet för ett test, inte en tolerans: en stilmall som aldrig kommer är ett riktigt fel). */
const STYLESHEETS_TIMEOUT_MS = 15_000;

/**
 * Väntar tills sidans stil är tillämpad, så att ett mått som tas direkt efter är ett mått på det som målas.
 *
 * Stilmallar blockerar ritningen men inte DOMContentLoaded (och inte heller `expect(...).toBeVisible()`): laddaren finns i DOM:en och har en storlek innan stilmallen
 * kommit, men den layouten målas aldrig. Ett mått taget då är ett mått på ett läge ingen användare ser (på ett långsamt nät: laddarens x-läge som skillnad).
 * Därför väntar mätningen först in att varje `link[rel=stylesheet]` är laddad (`sheet` satt; obs: Chrome sätter `sheet` även för en stilmall som inte gick att hämta, så en saknad stilmall syns som ett geometrifel, inte här — tidsgränsen är en säkerhetsmarginal) och sedan två bildrutor, så att
 * layouten räknats om med stilen. Ett mått före det ska aldrig tas; den som mäter anropar den här först.
 */
export async function waitForStylesApplied(page: Page): Promise<void> {
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')).every((link) => link.sheet !== null),
    undefined,
    // Intervall och inte bildruta: ritningen är blockerad så länge stilmallen saknas, och därmed uteblir också bildrutorna som en rAF-baserad avsökning väntar på.
    { polling: 25, timeout: STYLESHEETS_TIMEOUT_MS },
  );
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
