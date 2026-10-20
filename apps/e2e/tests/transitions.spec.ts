import type { Page } from '@playwright/test';
import { expect, test } from '../support/test';
import { submitSignIn } from '../support/signIn';
import { userCredentials } from '../support/targets';
import { AUTH_FILE } from '../support/paths';
import { isBlankFrame, logFrames, type FrameLog, type FrameSample } from '../support/loadingView';

// Övergångarna mellan inloggat och utloggat inuti fullappen (ADR 006, addendum 2026-10-19, punkt 11): #root är aldrig tom, och laddarens rektangel står still där den visas.
// Loggen över bildrutor och DOM-ändringar (logFrames) fångar också en commit som tömmer #root utan att hinna ritas, så provet beror inte på tajming.
// Inloggningsspecerna skriver in lösenordet och startar utloggade: ingen sparad session, och inget spår som bär de ifyllda värdena (som login.spec.ts).
test.use({ storageState: { cookies: [], origins: [] }, trace: 'off', screenshot: 'off', video: 'off' });

/** Laddarens omslutande rektangel: en 192 px bred ruta (3 x 64) med höjden 0,62 x bredden, lutad -16 grader. Mått med lutningen, i px (som landing.spec.ts). */
const LOADER_WIDTH_PX = 217.4;
const LOADER_HEIGHT_PX = 167.3;
/** Hur mycket en ritad bildruta får avvika från laddarens slutliga rektangel, i px. */
const FRAME_RECT_TOLERANCE_PX = 1;

const landingHeadline = (page: Page) => page.locator('h1#landing-title');
const shellOf = (page: Page) => page.locator('.rq-shell[data-shell]');

/**
 * Bildrutor där #root är tom, eller där en ritad bildruta inte visar något: Suspense gömmer det gamla innehållet med display: none medan fallbacken laddar, och det gömda
 * räknas som text i `isBlankFrame`. En ritad ruta ska alltså visa en laddare med storlek, landningen eller skalet. Nedkokade till det som provet visar när det fäller.
 */
function blankFramesOf(log: FrameLog) {
  return log
    .frames()
    .filter((frame) => isBlankFrame(frame) || (frame.painted && !frame.loaderRect && !frame.landing && !frame.shell))
    .map(({ path, rootChildren, textLength, painted }) => ({ path, rootChildren, textLength, painted }));
}

/** Laddarens rektangel i varje ritad bildruta har sin storlek och står på samma plats: inget hopp mellan övergångens vyer (jämfört med den första ritade laddaren). */
function expectLoaderRectStill(frames: FrameSample[]): void {
  const drawn = frames.filter((frame) => frame.painted && frame.loaderRect);
  expect(drawn.length, 'painted frames with the loader').toBeGreaterThan(0);
  const first = drawn[0]!.loaderRect!;
  const near = (a: number, b: number) => Math.abs(a - b) <= FRAME_RECT_TOLERANCE_PX;
  expect(near(first.width, LOADER_WIDTH_PX) && near(first.height, LOADER_HEIGHT_PX), `the loader is ${first.width} x ${first.height} px`).toBe(true);
  const moved = drawn.filter(({ loaderRect }) => {
    const rect = loaderRect!;
    return !(near(rect.x, first.x) && near(rect.y, first.y) && near(rect.width, first.width) && near(rect.height, first.height));
  });
  expect(moved.map(({ loaderRect, path }) => ({ ...loaderRect, path })), 'painted frames with the loader outside the first loader rectangle').toEqual([]);
}

test.describe('moving between signed out and signed in inside the app', () => {
  test('signing in from /login?next=/titles never draws an empty #root', async ({ page }) => {
    const log = await logFrames(page);
    await page.goto('/login?next=%2Ftitles');
    await expect(landingHeadline(page)).toBeVisible();
    await submitSignIn(page, userCredentials());

    await expect(page).toHaveURL(/\/titles$/);
    await expect(shellOf(page)).toBeVisible();
    expect(blankFramesOf(log), 'frames with nothing drawn in #root').toEqual([]);
    // Överlämningen mellan landningen och skalet är laddningsvyn, inte ett tomt rum.
    expect(log.frames().some((frame) => frame.path === '/login' && frame.loader), 'the loader was never drawn between the landing page and the app').toBe(true);
    expectLoaderRectStill(log.frames());
  });

  test('a signed-out direct load of /titles never draws an empty #root', async ({ page }) => {
    const log = await logFrames(page);
    await page.goto('/titles');

    await expect(page).toHaveURL(/\/login\?next=%2Ftitles$/);
    await expect(landingHeadline(page)).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Sign in' })).toBeVisible();
    expect(blankFramesOf(log), 'frames with nothing drawn in #root').toEqual([]);
    expectLoaderRectStill(log.frames());
  });

  test('a signed-out direct load of /challenges?x=1 never draws an empty #root on its way to the sign-in page', async ({ page }) => {
    const log = await logFrames(page);
    await page.goto('/challenges?x=1');

    // /challenges → /duels (sökparametrarna med) → RequireAuth → /login: två omdirigeringar i rad.
    await expect(page).toHaveURL(/\/login\?next=%2Fduels%3Fx%3D1$/);
    await expect(landingHeadline(page)).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Sign in' })).toBeVisible();
    expect(blankFramesOf(log), 'frames with nothing drawn in #root').toEqual([]);
    expectLoaderRectStill(log.frames());
  });

  test.describe('with a saved session', () => {
    test.use({ storageState: AUTH_FILE });

    test('a signed-in direct load of /challenges?x=1 never draws an empty #root on its way to /duels', async ({ page }) => {
      const log = await logFrames(page);
      await page.goto('/challenges?x=1');

      await expect(page).toHaveURL(/\/duels\?x=1$/);
      await expect(shellOf(page)).toBeVisible();
      expect(blankFramesOf(log), 'frames with nothing drawn in #root').toEqual([]);
      expectLoaderRectStill(log.frames());
    });
  });
});
