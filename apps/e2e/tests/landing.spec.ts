import type { Page } from '@playwright/test';
import type { OnboardingStatusResponse } from '../../../packages/shared/src/contracts/onboarding';
import { expect, test } from '../support/test';
import { submitSignIn } from '../support/signIn';
import { userCredentials } from '../support/targets';
import { capturePageviews, umamiBuildExpected } from '../support/analytics';
import { stylesheetTransferBytes } from '../support/transfer';
import {
  delayAppScript,
  failStandings,
  holdLandingScript,
  holdStandings,
  isBlankFrame,
  isBoardWithoutStandings,
  logFrames,
  watchForLanding,
  type FrameLog,
  type HeldResponse,
  type HeldScript,
} from '../support/loadingView';

// Den förrenderade landningen på exakt / och laddningsvyn i övergångarna till appen (ADR 006, addendum 2026-10-19, punkt 3 och 11). Inloggningsspecerna skriver in
// lösenordet och startar utloggade: ingen sparad session, och inget spår som bär de ifyllda värdena (som login.spec.ts).
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

const SIGNED_OUT = { cookies: [], origins: [] };
/** Laddningsvyn ska synas direkt när adressen bytts, inte först när appen ritat. */
const LOADER_VISIBLE_MS = 500;
/** Hur länge landningens JS hålls tillbaka för provet av animationerna: bara en yttersta gräns, provet släpper filen själv. */
const LANDING_HOLD_MAX_MS = 30_000;

const loaderOf = (page: Page) => page.locator('.rq-shell__pending').getByRole('status');
// Landningens rubrik, utpekad med sitt id: index.html har en egen h1 i <noscript>, så en rollsökning på nivå 1 skulle också träffa fallbacken utan JavaScript.
const landingHeadline = (page: Page) => page.locator('h1#landing-title');
const shellOf = (page: Page) => page.locator('.rq-shell[data-shell]');
/** Rotens React-behållare finns när hydreringen (eller en klientrendering) startat: det är markören för "trädet är levande". */
const isHydrated = (page: Page) => page.evaluate(() => Object.keys(document.getElementById('root') ?? {}).some((key) => key.startsWith('__reactContainer')));
/** Pågående sidvisningar och omdirigeringar hinner landa innan en räkning av dem avgörs. */
const SETTLE_MS = 1_500;
/** Stilmallsbudgeten (Lighthouse: resource-summary:stylesheet:size), överförda bytes inklusive svarshuvuden. */
const STYLESHEET_BUDGET_BYTES = 50_000;
/** Yttersta gräns för ett hållet topplistesvar: provet släpper det själv, gränsen är bara ett nät. */
const STANDINGS_HOLD_MAX_MS = 30_000;
/** Tid appen får på sig att rita Board om den tänkte göra det utan topplistan, innan provet släpper svaret. */
const STANDINGS_WAIT_MS = 750;
/** Laddningsvyns tak i appen (FirstBoardGate: 8 s) och marginalen innan provet säger att den hängt kvar. */
const LOADER_CAP_MS = 8_000;
const LOADER_CAP_MARGIN_MS = 4_000;
/** Antal Tab-tryck som kritikern använde för att nå tourens stängknapp (driver.js lägger fokus i popovern). */
const TAB_PRESSES_TO_CLOSE_BUTTON = 6;

/** Laddningsvyn syns inom gränsen, är en status med texten "Loading" (skärmläsare) och fullappens JS är fortfarande fördröjd. */
async function expectLoaderWhileAppLoads(page: Page, script: HeldScript): Promise<void> {
  const loader = loaderOf(page);
  await expect(loader).toBeVisible({ timeout: LOADER_VISIBLE_MS });
  await expect(loader).toContainText('Loading');
  expect(script.releasedAt(), 'the app script was already delivered, so this did not prove the loader before the app code').toBeNull();
}

/** Ingen bildruta var blank, och laddningsvyn ritades i det nya dokumentet innan fullappens JS levererats. */
function expectNoBlankFrames(log: FrameLog, script: HeldScript, path: string): void {
  const frames = log.frames();
  expect(frames.filter(isBlankFrame), 'frames with nothing drawn in #root (no children or no text)').toEqual([]);
  const releasedAt = script.releasedAt() ?? Number.POSITIVE_INFINITY;
  expect(
    frames.some((frame) => frame.path === path && frame.loader && !frame.shell && frame.at < releasedAt),
    `the loader was never drawn on ${path} before the app script arrived`,
  ).toBe(true);
}

/** Appen har koden och har bett om topplistan, men svaret hålls: laddningsvyn ska stå kvar och skalet ska inte ritas. Därefter släpps svaret. */
async function expectLoaderUntilStandingsArrive(page: Page, standings: HeldResponse): Promise<void> {
  await expect.poll(() => standings.requestedAt(), { message: 'the app never asked for the standings' }).not.toBeNull();
  await page.waitForTimeout(STANDINGS_WAIT_MS);
  await expect(loaderOf(page)).toBeVisible();
  await expect(loaderOf(page)).toContainText('Loading');
  await expect(shellOf(page)).toHaveCount(0);
  standings.release();
}

/** Podiet är ifyllt när Board syns, och ingen bildruta visade Board utan det eller skalet innan svaret kom. */
async function expectBoardDrawnWithStandings(page: Page, log: FrameLog, standings: HeldResponse): Promise<void> {
  await expect(shellOf(page)).toBeVisible();
  await expect(page.getByTestId('podium-1')).toBeVisible();
  await expect(loaderOf(page)).toBeHidden();

  const frames = log.frames();
  const requestedAt = standings.requestedAt() ?? Number.POSITIVE_INFINITY;
  const releasedAt = standings.releasedAt() ?? Number.POSITIVE_INFINITY;
  expect(frames.filter(isBoardWithoutStandings), 'frames with Board drawn but no podium').toEqual([]);
  expect(frames.filter((frame) => frame.shell && frame.at < releasedAt), 'frames with the shell drawn before the standings arrived').toEqual([]);
  expect(
    frames.some((frame) => frame.loader && frame.at > requestedAt && frame.at < releasedAt),
    'the loader was never drawn while the standings were held',
  ).toBe(true);
}

test.describe('the prerendered landing page', () => {
  test.use({ storageState: SIGNED_OUT });

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    test('the headline is in the document', async ({ page }) => {
      await page.goto('/');
      await expect(landingHeadline(page)).toBeVisible();
    });
  });

  test('the animations keep their start time when the page hydrates', async ({ page }) => {
    // Landningens JS hålls tillbaka: sidan står som ren HTML, animationerna körs redan, och först när filen släpps hydreras trädet.
    const landingScript = await holdLandingScript(page, LANDING_HOLD_MAX_MS);
    await page.goto('/', { waitUntil: 'commit' });
    await expect(landingHeadline(page)).toBeVisible();
    // Det är landingsfilen som hålls: serverades något annat på / hade ingen landningsfil begärts.
    await expect.poll(() => landingScript.requested(), { message: 'the landing script was never requested, so / is not the lean landing page' }).toBe(true);

    // Starttiden sätts först när animationen är redo (första bildrutan); före det är den null.
    const before = await page.evaluate(async () => {
      const animations = document.getAnimations();
      await Promise.all(animations.map((animation) => animation.ready));
      (window as unknown as { __rqBefore: Array<{ animation: Animation; start: number | null }> }).__rqBefore = animations.map((animation) => ({ animation, start: animation.startTime as number | null }));
      return animations.length;
    });
    expect(before, 'the page has no running animation to compare').toBeGreaterThan(0);

    landingScript.release();
    await expect
      .poll(() => page.evaluate(() => Object.keys(document.getElementById('root') ?? {}).some((key) => key.startsWith('__reactContainer'))), { message: 'the page never hydrated' })
      .toBe(true);
    await page.waitForLoadState('networkidle');

    // Samma Animation-objekt ska finnas kvar med samma starttid: en klientrenderad om gräns skapar nya element och startar om dem.
    const after = await page.evaluate(() =>
      (window as unknown as { __rqBefore: Array<{ animation: Animation; start: number | null }> }).__rqBefore.map(({ animation, start }) => ({
        name: (animation as CSSAnimation).animationName,
        sameStart: animation.startTime === start,
        attached: ((animation.effect as KeyframeEffect | null)?.target as Element | null | undefined)?.isConnected === true,
      })),
    );
    expect(after.filter((item) => !item.sameStart || !item.attached)).toEqual([]);
    expect(after).toHaveLength(before);
  });

  test('/login opens the sign-in dialog over the landing page', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('dialog', { name: 'Sign in' })).toBeVisible();
    await expect(landingHeadline(page)).toBeVisible();
  });

  test('/landing.html/ with a trailing slash ends on / without a reload loop', async ({ page }) => {
    // Caddy omdirigerar bara /landing och /landing.html; med avslutande snedstreck serveras index.html, och adressen ska ändå landa på landningen utan att sidan laddar om sig själv.
    const documents: string[] = [];
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(new URL(request.url()).pathname);
    });
    await page.goto('/landing.html/');
    await expect(landingHeadline(page)).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await page.waitForTimeout(SETTLE_MS);

    expect(new URL(page.url()).pathname).toBe('/');
    expect(documents.length, `document requests: ${documents.join(', ')}`).toBeLessThanOrEqual(3);
  });

  test('signing in from / shows the loader until the board is drawn, with no blank frame', async ({ page }) => {
    const log = await logFrames(page);
    const script = await delayAppScript(page);
    const standings = await holdStandings(page, STANDINGS_HOLD_MAX_MS);
    await page.goto('/');
    await page.getByRole('link', { name: 'Sign in' }).first().click();
    await submitSignIn(page, userCredentials());

    await expect(page).toHaveURL(/\/board$/);
    await expectLoaderWhileAppLoads(page, script);
    await expect(page.locator('.rq-landing')).toHaveCount(0);
    await expectLoaderUntilStandingsArrive(page, standings);

    await expectBoardDrawnWithStandings(page, log, standings);
    expectNoBlankFrames(log, script, '/board');
  });

  test('the landing page stays when storage is blocked', async ({ page }) => {
    // Webbläsare med blockerad lagring kastar SecurityError vid åtkomst till localStorage. Sessionstipset och AuthProvider läser den direkt efter hydreringen.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('blocked for the test', 'SecurityError');
        },
      });
    });
    await page.goto('/');
    await expect(landingHeadline(page)).toBeVisible();
    await expect.poll(() => isHydrated(page), { message: 'the page never hydrated' }).toBe(true);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(SETTLE_MS);

    await expect(landingHeadline(page)).toBeVisible();
    await expect(page.locator('.rq-landing')).toHaveCount(1);
  });

  test('the stylesheets on / and /legal stay under the budget', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'The transfer size is read from the Chrome DevTools protocol.');
    const landing = await stylesheetTransferBytes(page, '/');
    const legal = await stylesheetTransferBytes(page, '/legal');
    console.log(`stylesheet transfer: / ${landing} B, /legal ${legal} B (budget ${STYLESHEET_BUDGET_BYTES} B)`);
    expect(landing, 'stylesheet bytes on /').toBeGreaterThan(0);
    expect(landing, 'stylesheet bytes on /').toBeLessThan(STYLESHEET_BUDGET_BYTES);
    expect(legal, 'stylesheet bytes on /legal').toBeGreaterThan(0);
    expect(legal, 'stylesheet bytes on /legal').toBeLessThan(STYLESHEET_BUDGET_BYTES);
  });

  test('opening /legal directly shows the loader before the app code has loaded', async ({ page }) => {
    const log = await logFrames(page);
    const script = await delayAppScript(page);
    await page.goto('/legal', { waitUntil: 'commit' });

    await expectLoaderWhileAppLoads(page, script);
    await expect(page.getByRole('heading', { name: 'Privacy & Terms' })).toBeVisible();
    expectNoBlankFrames(log, script, '/legal');
  });
});

test.describe('a signed-in visitor', () => {
  // Utan override: sessionen som setup-projektet sparade.
  test('on / goes straight to the board, sees the loader first and never the landing page', async ({ page }) => {
    const landingSeen = await watchForLanding(page);
    const log = await logFrames(page);
    const script = await delayAppScript(page);
    const standings = await holdStandings(page, STANDINGS_HOLD_MAX_MS);
    const documents: string[] = [];
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(new URL(request.url()).pathname);
    });
    await page.goto('/', { waitUntil: 'commit' });

    await expect(page).toHaveURL(/\/board$/);
    await expectLoaderWhileAppLoads(page, script);
    await expectLoaderUntilStandingsArrive(page, standings);

    await expectBoardDrawnWithStandings(page, log, standings);
    expect(landingSeen(), 'the landing page was in the DOM').toBe(false);
    // Exakt två dokument: landing.html (som skickar vidare före första ritning) och index.html på /board. Fler vore en omladdningsloop.
    expect(documents).toEqual(['/', '/board']);
    expectNoBlankFrames(log, script, '/board');
  });

  test('opening /board directly shows the loader before the app code has loaded', async ({ page }) => {
    const log = await logFrames(page);
    const script = await delayAppScript(page);
    const standings = await holdStandings(page, STANDINGS_HOLD_MAX_MS);
    await page.goto('/board', { waitUntil: 'commit' });

    await expectLoaderWhileAppLoads(page, script);
    await expectLoaderUntilStandingsArrive(page, standings);

    await expectBoardDrawnWithStandings(page, log, standings);
    expectNoBlankFrames(log, script, '/board');
  });

  test('moving on inside the app does not show the loader again', async ({ page }) => {
    const log = await logFrames(page);
    await page.goto('/board');
    await expect(page.getByTestId('podium-1')).toBeVisible();
    const firstPodiumAt = log.frames().find((frame) => frame.podium > 0)?.at ?? Number.POSITIVE_INFINITY;

    // Klientsidig navigering, inget nytt dokument: bildrutorna efter klicken loggas av samma sida.
    await page.getByRole('link', { name: 'Titles' }).first().click();
    await expect(page).toHaveURL(/\/titles$/);
    await page.getByRole('link', { name: /^(Ranks|Leaderboard)$/ }).first().click();
    await expect(page).toHaveURL(/\/board$/);
    await expect(page.getByTestId('podium-1')).toBeVisible();

    expect(log.frames().filter((frame) => frame.loader && frame.at > firstPodiumAt), 'frames that showed the loader after the first load').toEqual([]);
  });

  test('a failed first fetch of the standings ends the loader in the board error view', async ({ page }) => {
    await failStandings(page);
    await page.goto('/board');

    // Laddaren ger vika vid det första misslyckade försöket; Board tar över med sin vanliga väg, och felvyn kommer när omförsöken (1 + 2 + 4 s) är slut.
    await expect(shellOf(page)).toBeVisible({ timeout: LOADER_CAP_MS });
    await expect(loaderOf(page)).toBeHidden();
    await expect(page.getByText("Couldn't load the standings")).toBeVisible({ timeout: LOADER_CAP_MS + LOADER_CAP_MARGIN_MS });
  });

  test('a standings answer that never comes does not keep the loader on for longer than the cap', async ({ page }) => {
    const log = await logFrames(page);
    const standings = await holdStandings(page, 2 * LOADER_CAP_MS);
    await page.goto('/board');
    await expect.poll(() => standings.requestedAt(), { message: 'the app never asked for the standings' }).not.toBeNull();
    const askedAt = standings.requestedAt() ?? 0;

    await expect(shellOf(page)).toBeVisible({ timeout: LOADER_CAP_MS + LOADER_CAP_MARGIN_MS });
    await expect(loaderOf(page)).toBeHidden();
    const shellAt = log.frames().find((frame) => frame.shell)?.at ?? 0;
    expect(shellAt - askedAt, 'ms the loader stood after the request').toBeGreaterThan(LOADER_CAP_MS - 2_000);
    expect(shellAt - askedAt, 'ms the loader stood after the request').toBeLessThan(LOADER_CAP_MS + LOADER_CAP_MARGIN_MS);
    // Tills svaret kommer visar Board sin egen laddning, aldrig ett podium som låtsas vara klart.
    expect(log.frames().filter((frame) => frame.shell && frame.podium > 0 && frame.at < (standings.releasedAt() ?? Number.POSITIVE_INFINITY))).toEqual([]);
  });
});

test.describe('pageviews', () => {
  test.skip(!umamiBuildExpected(), 'A staging build never loads the analytics script. Run against a build with a website id and E2E_UMAMI_BUILD=1 (docs/e2e.md).');

  test.describe('signed out', () => {
    test.use({ storageState: SIGNED_OUT });

    test('a visit with campaign parameters counts one pageview, without anything that is not allow-listed', async ({ page }) => {
      const pageviews = await capturePageviews(page);
      await page.goto('/?utm_source=instagram&utm_medium=social&utm_campaign=not-listed&email=someone@example.test');
      await expect.poll(() => pageviews.views().length).toBeGreaterThan(0);
      await page.waitForTimeout(SETTLE_MS);

      const views = pageviews.views();
      expect(views).toHaveLength(1);
      expect(views[0]).toBe('/?utm_source=instagram&utm_medium=social');
    });

    test('signing in from the landing page counts /, /login and /board once each', async ({ page }) => {
      const pageviews = await capturePageviews(page);
      await page.goto('/');
      await expect.poll(() => pageviews.views()).toEqual(['/']);
      await page.getByRole('link', { name: 'Sign in' }).first().click();
      await expect.poll(() => pageviews.views()).toEqual(['/', '/login']);
      await submitSignIn(page, userCredentials());
      await expect(page).toHaveURL(/\/board$/);
      await expect(shellOf(page)).toBeVisible();
      await expect.poll(() => pageviews.views()).toEqual(['/', '/login', '/board']);
      await page.waitForTimeout(SETTLE_MS);

      expect(pageviews.views()).toEqual(['/', '/login', '/board']);
    });
  });

  test('a signed-in visitor who reaches the landing page without the head hint ends on the board and counts only /board', async ({ page }) => {
    // Sessionstipset i <head> tas bort ur svaret: besökaren hydrerar landningen, sessionen återställs efter hydreringen och överlämningen sker i React.
    // Besöket ska ändå bara räknas som /board (landningen räknar inte under överlämningen). Provet är en säkerhetsrad, inte ett bevis för vakten: tidpunkten avgör om en visning hinner skickas.
    await page.route((url) => url.pathname === '/', async (route) => {
      const response = await route.fetch();
      const html = await response.text();
      const withoutHint = html.replace(/<script>[^<]*runquest_token[^<]*<\/script>/, '');
      if (withoutHint === html) throw new Error('the session hint was not found in landing.html, so this test would prove nothing');
      await route.fulfill({ response, body: withoutHint });
    });
    const pageviews = await capturePageviews(page);
    await page.goto('/');
    await expect(page).toHaveURL(/\/board$/);
    await expect(shellOf(page)).toBeVisible();
    await expect.poll(() => pageviews.views().length).toBeGreaterThan(0);
    await page.waitForTimeout(SETTLE_MS);

    expect(pageviews.views()).toEqual(['/board']);
  });

  test('a signed-in visit to / counts only /board', async ({ page }) => {
    const pageviews = await capturePageviews(page);
    await page.goto('/');
    await expect(page).toHaveURL(/\/board$/);
    await expect.poll(() => pageviews.views().length).toBeGreaterThan(0);
    await page.waitForTimeout(SETTLE_MS);

    expect(pageviews.views()).toEqual(['/board']);
  });
});

test.describe('the onboarding tour', () => {
  test('the close button shows a focus ring when it is reached with the keyboard', async ({ page }) => {
    // Kontot har sett turen. Statusen byts ut mot "inget sett" så att förstagångsturen startar; ingenting skrivs (turen stängs aldrig här).
    await page.route('**/onboarding/status', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify({ seen: [] } satisfies OnboardingStatusResponse) }),
    );
    await page.goto('/board');
    await page.locator('.driver-popover').waitFor({ state: 'visible', timeout: 15_000 });

    const reached: Array<{ className: string; outlineStyle: string; outlineWidth: string }> = [];
    for (let press = 0; press < TAB_PRESSES_TO_CLOSE_BUTTON; press += 1) {
      await page.keyboard.press('Tab');
      reached.push(
        await page.evaluate(() => {
          const active = document.activeElement;
          const style = active ? getComputedStyle(active) : null;
          return { className: String(active?.className ?? ''), outlineStyle: style?.outlineStyle ?? '', outlineWidth: style?.outlineWidth ?? '' };
        }),
      );
    }
    const closeButton = reached.find((item) => item.className.includes('driver-popover-close-btn'));
    expect(closeButton, `the close button was not reached in ${TAB_PRESSES_TO_CLOSE_BUTTON} Tab presses: ${JSON.stringify(reached)}`).toBeDefined();
    expect(closeButton?.outlineStyle).not.toBe('none');
    expect(Number.parseFloat(closeButton?.outlineWidth ?? '0')).toBeGreaterThan(0);
  });
});
