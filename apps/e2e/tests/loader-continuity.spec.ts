import { expect, test } from '../support/test';
import { submitSignIn } from '../support/signIn';
import { userCredentials } from '../support/targets';
import { delayAppScript, holdStandings } from '../support/loadingView';
import { LOADING_VIEW_STATUS, loaderCount, logRunnerPhases, runnerHops, type RunnerPhaseLog } from '../support/runnerPhase';

// Löparprickarna i laddningsvyns 192 px-oval ska stå kvar var de var när vyn byter nod eller dokument: index.html -> React -> gaten, och en sidladdning till.
// Rektangeln står redan still (laddarens geometriprov); här mäts prickarnas fas. Ritningen väntar på stilmallarna, så varje ritad bildruta har sin stil tillämpad.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

/** Hur mycket en prick får avvika från sin plats på klockan vid ett byte, i px längs banan (kriteriet; frånsett mätbrus är avvikelsen 0). */
const CONTINUITY_TOLERANCE_PX = 2;
/** Yttersta gräns för ett hållet svar: provet släpper det själv, gränsen är bara ett nät. */
const HOLD_MAX_MS = 30_000;
/** Hur länge fullappens JS hålls i provet av två dokument: så länge att båda dokumentens index.html-laddare hinner ritas innan appen tar över. */
const APP_SCRIPT_HOLD_MS = 5_000;
/** Bildrutor (per bana) som en laddare ska ha ritats i innan provet går vidare: en bildruta efter ett byte räcker inte för att se att pricken fortsätter. */
const FRAMES_PER_LOADER = 30;

const loader = (page: Parameters<typeof logRunnerPhases>[0]) => page.locator(LOADING_VIEW_STATUS);

const framesOf = (log: RunnerPhaseLog, loaderId: string | undefined) => log.samples().filter((sample) => sample.loader === loaderId && sample.lane === 0).length;

/** Väntar tills prickarna setts i minst `loaders` olika noder och den senaste noden ritats i en stund (dess första bildrutor visar själva bytet). */
async function waitForSwaps(log: RunnerPhaseLog, loaders: number): Promise<void> {
  await expect
    .poll(() => loaderCount(log.samples()) >= loaders && framesOf(log, log.samples().at(-1)?.loader) >= FRAMES_PER_LOADER, {
      message: `the runner dots were seen on ${loaders} different loaders, the last one for ${FRAMES_PER_LOADER} frames`,
    })
    .toBe(true);
}

function expectDotsContinue(log: RunnerPhaseLog, across: 'nodes' | 'documents'): void {
  const hops = runnerHops(log.samples());
  const compared = hops.filter((hop) => (across === 'documents' ? hop.acrossDocuments : hop.fromLoader !== hop.toLoader));
  expect(compared.length, `compared frames on both sides of a swap of ${across === 'documents' ? 'document' : 'loader node'}`).toBeGreaterThan(0);
  const worst = (list: typeof hops) => Math.max(0, ...list.map((hop) => hop.px));
  console.log(`runner dots: ${loaderCount(log.samples())} loaders, ${compared.length} ${across} swaps compared, largest hop at a swap ${worst(compared).toFixed(2)} px, largest hop in any frame ${worst(hops).toFixed(2)} px`);
  expect(
    hops.filter((hop) => hop.px > CONTINUITY_TOLERANCE_PX),
    `runner dots that jumped more than ${CONTINUITY_TOLERANCE_PX} px along their lane`,
  ).toEqual([]);
}

test.describe('the runner dots of the loading view', () => {
  test('keep their place through the swaps from index.html to React to the gate', async ({ page }) => {
    const log = await logRunnerPhases(page);
    await delayAppScript(page);
    const standings = await holdStandings(page, HOLD_MAX_MS);
    await page.goto('/board', { waitUntil: 'commit' });
    await expect(loader(page)).toBeVisible();

    await waitForSwaps(log, 2);
    standings.release();
    await expect(page.locator('.rq-board')).toBeVisible();

    expectDotsContinue(log, 'nodes');
  });

  test('keep their place from one document to the next', async ({ page }) => {
    const log = await logRunnerPhases(page);
    await delayAppScript(page, APP_SCRIPT_HOLD_MS);
    await page.goto('/board', { waitUntil: 'commit' });
    await expect(loader(page)).toBeVisible();
    await expect.poll(() => framesOf(log, log.samples().at(-1)?.loader)).toBeGreaterThanOrEqual(FRAMES_PER_LOADER);

    await page.reload({ waitUntil: 'commit' });
    await expect(loader(page)).toBeVisible();
    await waitForSwaps(log, 2);

    expectDotsContinue(log, 'documents');
  });

  test.describe('after signing in from the landing page', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('keep their place through the handoff to the app and on to the gate', async ({ page }) => {
      const log = await logRunnerPhases(page);
      await delayAppScript(page);
      const standings = await holdStandings(page, HOLD_MAX_MS);
      await page.goto('/');
      await page.getByRole('link', { name: 'Sign in' }).first().click();
      await submitSignIn(page, userCredentials());
      await expect(page).toHaveURL(/\/board$/);

      // Landningens egen laddare (överlämningen) hinner inte alltid ritas innan sidan lämnas, så minst två: index.html och React.
      await waitForSwaps(log, 2);
      standings.release();
      await expect(page.locator('.rq-board')).toBeVisible();

      expectDotsContinue(log, 'nodes');
    });
  });
});
