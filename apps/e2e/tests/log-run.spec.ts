import { expect, test } from '../support/test';
import { E2E_RUN_KM, deleteRun, ownTestRuns, ownTotals, readSession, recalculateOwnTotals, removeTestRuns } from '../support/api';
import { dismissOverlays } from '../support/overlays';
import { apiIsStubbed } from '../support/stubApi';

const KM_TEXT = String(E2E_RUN_KM);
const KM_LABEL = `${E2E_RUN_KM.toFixed(1)} km`;

test.describe('logging a run', () => {
  test.skip(apiIsStubbed(), 'Logs and deletes a run through the real API with Node fetch (support/api.ts); the stubbed API has no runs.');

  // Rundan raderas i testet; det här är nätet om testet faller på vägen, så att inget blir kvar på kontot och nästa körning börjar rent.
  test.afterEach(async () => {
    await removeTestRuns(readSession());
  });

  test('a logged run adds XP and distance, shows in the group history, and deleting it restores the totals', async ({ page }) => {
    const session = readSession();
    await removeTestRuns(session);
    await recalculateOwnTotals(session);
    const before = await ownTotals(session);

    await page.goto('/log');
    await dismissOverlays(page);
    await page.getByLabel('Distance (km)').fill(KM_TEXT);
    await page.getByRole('button', { name: 'Log run', exact: true }).click();
    await expect(page.getByText(new RegExp(`Run logged: ${KM_LABEL} for`))).toBeVisible();

    // Servern har räknat om innan svaret kom: totalerna ökar med rundan.
    const after = await ownTotals(session);
    expect(after.xp).toBeGreaterThan(before.xp);
    expect(after.km).toBeCloseTo(before.km + E2E_RUN_KM, 1);

    await page.goto('/log?view=group');
    await dismissOverlays(page);
    const mine = page.getByRole('list', { name: 'Runs in the pack' }).locator('li[data-me="true"]').filter({ hasText: KM_LABEL });
    await expect(mine).toHaveCount(1);

    const created = await ownTestRuns(session);
    expect(created).toHaveLength(1);
    await deleteRun(session, created[0]!.id);

    const restored = await ownTotals(session);
    expect(restored.xp).toBe(before.xp);
    expect(restored.km).toBeCloseTo(before.km, 1);

    await page.reload();
    await dismissOverlays(page);
    await expect(page.locator('li[data-me="true"]').filter({ hasText: KM_LABEL })).toHaveCount(0);
  });

  test('a run below the minimum distance is refused before anything is sent', async ({ page }) => {
    await page.goto('/log');
    await dismissOverlays(page);

    let posted = false;
    page.on('request', (request) => {
      if (request.method() === 'POST' && /\/runs$/.test(request.url())) posted = true;
    });
    await page.getByLabel('Distance (km)').fill('0.4');
    await page.getByRole('button', { name: 'Log run', exact: true }).click();

    await expect(page.getByText('A run needs at least 1.0 km to count').first()).toBeVisible();
    expect(posted).toBe(false);
  });
});
