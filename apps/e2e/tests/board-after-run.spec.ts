import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/test';
import { E2E_RUN_KM, readSession, recalculateOwnTotals, removeTestRuns } from '../support/api';
import { dismissOverlays } from '../support/overlays';
import { apiIsStubbed } from '../support/stubApi';

// Mot staging skriver provet en riktig runda på testkontot, på samma sätt som log-run.spec.ts (samma markördistans, samma städning före och efter), för att Board ska
// visas mot den riktiga kedjan: servern räknar om, `users-with-runs` svarar med de nya totalerna och Boards cache hämtas om. Mot det fejkade API:et (E2E_STUB_API=1) finns
// ingen databas att städa: stubben har sitt eget tillstånd per test, och inget lämnar webbläsaren.

const KM_LABEL = `${E2E_RUN_KM.toFixed(1)} km`;

/** Löparens totala km ur de senaste svaren på `GET /auth/users-with-runs`: det Board har fått, inte det ett Node-anrop läser vid sidan av. */
function trackStandings(page: Page, userId: string) {
  let totalKm: number | undefined;
  page.on('response', async (response) => {
    if (!response.url().endsWith('/auth/users-with-runs') || !response.ok()) return;
    const body = (await response.json().catch(() => null)) as { data?: Array<{ id: string; total_km: number | string | null }> } | null;
    const me = body?.data?.find((runner) => runner.id === userId);
    if (me) totalKm = Number(me.total_km ?? 0);
  });
  return { totalKm: () => totalKm };
}

/** Samma avrundning som Board ("1 126", heltal med mellanrum): provet jämför med det som står på sidan. */
const boardKm = (km: number) => Math.round(km).toLocaleString('sv-SE');

/** Löparens kort eller rad på Board, var i rankningen hen än står: podiekortet (topp 3) eller en rad i tabellen. */
function ownEntry(page: Page, name: string): Locator {
  return page.locator('[data-testid^="podium-"], [role="row"]').filter({ has: page.getByRole('button', { name, exact: true }) });
}

test.describe('the board after logging a run', () => {
  // Sparade inloggningen finns först när setup-projektet kört, så den läses i testen och inte när specerna samlas in (`--list`).
  test.beforeEach(async () => {
    if (apiIsStubbed()) return;
    const session = readSession();
    await removeTestRuns(session);
    await recalculateOwnTotals(session);
  });

  // Rundan ska inte finnas kvar om testet föll på vägen, så att nästa körning (och log-run.spec.ts) börjar rent.
  test.afterEach(async () => {
    if (apiIsStubbed()) return;
    await removeTestRuns(readSession());
  });

  test('a logged run changes the runner\'s total on the board, with no reload', async ({ page }) => {
    const session = readSession();
    const standings = trackStandings(page, session.userId);

    await page.goto('/board');
    await dismissOverlays(page);
    const entry = ownEntry(page, session.userName);
    await expect(entry).toHaveCount(1);
    await expect.poll(standings.totalKm, { message: 'Board has not received the group yet' }).toBeDefined();
    const kmBefore = standings.totalKm() ?? 0;
    await expect(entry).toContainText(boardKm(kmBefore));

    // Klientsidig navigering hela vägen: ett nytt dokument skulle tömma cachen och ge Board nya data av sig själv, vilket inte bevisar invalideringen efter en runda.
    await page.getByRole('link', { name: 'Log Runs' }).first().click();
    await expect(page).toHaveURL(/\/log$/);
    await dismissOverlays(page);
    await page.getByLabel('Distance (km)').fill(String(E2E_RUN_KM));
    await page.getByRole('button', { name: 'Log run', exact: true }).click();
    await expect(page.getByText(new RegExp(`Run logged: ${KM_LABEL} for`))).toBeVisible();

    await page.getByRole('link', { name: /^(Ranks|Leaderboard)$/ }).first().click();
    await expect(page).toHaveURL(/\/board$/);
    await expect.poll(standings.totalKm, { message: 'Board never fetched the group again after the run' }).toBeCloseTo(kmBefore + E2E_RUN_KM, 1);

    // Avrundningen till heltal ger alltid ett nytt tal för 1,5 km, så ett kort som inte uppdaterats skulle fortfarande visa det gamla.
    const kmAfter = standings.totalKm() ?? 0;
    expect(boardKm(kmAfter)).not.toBe(boardKm(kmBefore));
    await expect(ownEntry(page, session.userName)).toContainText(boardKm(kmAfter));
  });
});
