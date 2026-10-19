import type { Page } from '@playwright/test';
import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';
import { delayAppScript, delayStylesheets, holdWeek } from '../support/loadingView';
import { LAP_PHASES, measureRunnerDeviations } from '../support/loaderGeometry';

// Löparprickarna i stadion-ovalen (TrackLoader) ska ligga på sina banlinjer under hela varvet, i laddningsvyns 192 px och i sidornas 64 px.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

/** Hur långt en prickes mitt får ligga från sin banlinje, i px. Mätfelet är några hundradelar; en dubbel marginalkompensation gav 2 till 14 px. */
const ON_LANE_TOLERANCE_PX = 1;
/** Yttersta gräns för ett hållet svar: provet släpper det själv, gränsen är bara ett nät. */
const HOLD_MAX_MS = 30_000;
const LOADING_VIEW = '.rq-shell__pending [role="status"]';
const WEEK_PANEL = '.rq-board__loading [role="status"]';

async function expectRunnersOnTheirLanes(page: Page, scope: string, lanes: number): Promise<void> {
  const deviations = await measureRunnerDeviations(page, scope);
  expect(deviations, 'one measurement per lane and phase').toHaveLength(lanes * LAP_PHASES.length);
  expect(
    deviations.filter(({ deviationPx }) => deviationPx > ON_LANE_TOLERANCE_PX),
    `runner dots more than ${ON_LANE_TOLERANCE_PX} px from their lane line`,
  ).toEqual([]);
}

test.describe('the runner dots of the stadium oval', () => {
  test('sit on their lane lines in four phases of the lap in the 192 px loading view', async ({ page }) => {
    await delayStylesheets(page);
    const script = await delayAppScript(page, HOLD_MAX_MS);
    await page.goto('/board', { waitUntil: 'commit' });
    await expect(page.locator(LOADING_VIEW)).toBeVisible();

    await expectRunnersOnTheirLanes(page, LOADING_VIEW, 3);
    script.release();
  });

  test('sit on their lane lines in four phases of the lap in the 64 px loader of the Week view', async ({ page }) => {
    const week = await holdWeek(page, HOLD_MAX_MS);
    await page.goto('/board?view=week');
    await dismissOverlays(page);
    await expect(page.locator(WEEK_PANEL)).toBeVisible();

    await expectRunnersOnTheirLanes(page, WEEK_PANEL, 3);
    week.release();
  });
});
