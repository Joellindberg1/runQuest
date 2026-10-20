import { expect, test } from '../support/test';
import { delayAppScript } from '../support/loadingView';
import { LOADING_VIEW_STATUS, logRunnerPhases, runnerClockErrors } from '../support/runnerPhase';

// index.html kan komma i flera nätverksbitar, så att parsern hunnit skapa bara en eller två av laddarens tre prickar när skriptet i head redan rättat de som fanns. Prickarna som
// parsas senare ska ändå ligga på klockan. Uppdelningen härmas i sidan: dokumentet levereras med ett parserblockerande skript (som hålls 600 ms) mellan första och andra pricken,
// och parsern står då still mitt i laddaren medan bildrutor ritas, som när nästa bit av svaret inte kommit.
test.use({ storageState: { cookies: [], origins: [] }, trace: 'off', screenshot: 'off', video: 'off' });

/** Hur länge parsern står still mitt i laddaren. */
const PAUSE_MS = 600;
/** Hur länge fullappens JS hålls: längre än provet, så laddaren i index.html är det som ritas hela tiden. */
const APP_SCRIPT_HOLD_MS = 6_000;
/** Hur långt en prick får ligga från sin plats på klockan, i px längs banan. */
const CLOCK_TOLERANCE_PX = 2;
/** Ritade bildrutor per bana som provet kräver efter pausen. */
const FRAMES_AFTER_PAUSE = 30;
const PAUSE_SCRIPT = '/__runner-pause.js';
/** Första pricken i laddarens markup: en `div` med `aria-hidden` och ingen text. */
const FIRST_DOT = /<div aria-hidden="true"[^>]*><\/div>/;

test.describe('the runner dots when index.html arrives in pieces', () => {
  test('all sit on the clock, also the dots that are parsed after the first one was aligned', async ({ page }) => {
    const log = await logRunnerPhases(page);
    await delayAppScript(page, APP_SCRIPT_HOLD_MS);
    await page.route(`**${PAUSE_SCRIPT}`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
      await route.fulfill({ contentType: 'text/javascript', body: '' });
    });
    await page.route('**/legal', async (route) => {
      if (route.request().resourceType() !== 'document') return route.fallback();
      const response = await route.fetch();
      const html = await response.text();
      const first = FIRST_DOT.exec(html);
      expect(first, 'a runner dot in the pre-rendered loader').not.toBeNull();
      const cut = first!.index + first![0].length;
      await route.fulfill({ response, body: `${html.slice(0, cut)}<script src="${PAUSE_SCRIPT}"></script>${html.slice(cut)}` });
    });

    await page.goto('/legal', { waitUntil: 'commit' });
    await expect(page.locator(LOADING_VIEW_STATUS)).toBeVisible();
    await expect
      .poll(() => log.samples().filter((sample) => sample.lane === 2).length, { message: `frames with the third dot, after the parser was paused in the loader` })
      .toBeGreaterThanOrEqual(FRAMES_AFTER_PAUSE);

    const errors = runnerClockErrors(log.samples());
    expect(new Set(errors.map((error) => error.lane)), 'all three dots were drawn').toEqual(new Set([0, 1, 2]));
    const worst = Math.max(...errors.map((error) => error.px));
    console.log(`runner dots delivered in pieces: ${errors.length} drawn dots, largest distance from the clock ${worst.toFixed(2)} px`);
    expect(
      errors.filter((error) => error.px > CLOCK_TOLERANCE_PX),
      `drawn dots more than ${CLOCK_TOLERANCE_PX} px from their place on the clock`,
    ).toEqual([]);
  });
});
