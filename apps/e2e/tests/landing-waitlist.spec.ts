import type { Page } from '@playwright/test';
import { expect, test } from '../support/test';
import { holdLandingScript } from '../support/loadingView';

// Väntelistans formulär ligger i den förrenderade landningens HTML och syns innan landningens JS hydrerat det (ADR 006, addendum 2026-10-19). Provet håller tillbaka
// landningens JS och försöker använda formuläret under tiden, som en besökare med långsam anslutning. Ingenting här är en hemlighet (en påhittad adress), så spår
// och skärmbilder är påslagna som i övriga specer utom de som skriver lösenord.
test.use({ storageState: { cookies: [], origins: [] } });

/** Bara en yttersta gräns: provet släpper filen själv. */
const LANDING_HOLD_MAX_MS = 30_000;
/** Hur länge ett försök till nativ submit får tid att ge en navigering innan provet avgör att inget hände. */
const NO_NAVIGATION_WINDOW_MS = 750;
const EMAIL = 'anna@example.com';

const waitlistForm = (page: Page) => page.locator('section#waitlist form');
const emailField = (page: Page) => page.locator('#waitlist-email');
const consentBox = (page: Page) => page.locator('#waitlist-consent');
const isHydrated = (page: Page) => page.evaluate(() => Object.keys(document.getElementById('root') ?? {}).some((key) => key.startsWith('__reactContainer')));

/** Öppnar landningen med dess JS hållet: sidan står som ren HTML. Ger filen och en logg över navigeringar som sker därefter. */
async function openWithLandingScriptHeld(page: Page) {
  const landingScript = await holdLandingScript(page, LANDING_HOLD_MAX_MS);
  const navigations: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });
  await page.goto('/', { waitUntil: 'commit' });
  await expect(waitlistForm(page)).toBeAttached();
  await expect.poll(() => landingScript.requested(), { message: 'the landing script was never requested, so / is not the lean landing page' }).toBe(true);
  expect(await isHydrated(page), 'the page had already hydrated').toBe(false);
  // Själva öppnandet räknas inte: bara navigeringar som sker efter att sidan står som ren HTML.
  navigations.length = 0;
  return { landingScript, navigations };
}

/** Försöker använda formuläret som en besökare: klick i fälten, skriv, kryssa i samtycket. `force` hoppar över Playwrights egen väntan på att elementet ska gå att använda. */
async function tryToFillIn(page: Page): Promise<void> {
  await emailField(page).click({ force: true });
  await page.keyboard.type(EMAIL);
  await consentBox(page).click({ force: true });
}

test.describe('the waitlist form on the landing page before it has hydrated', () => {
  test('what is typed before the page hydrates is still there afterwards', async ({ page }) => {
    const { landingScript } = await openWithLandingScriptHeld(page);

    await tryToFillIn(page);
    // Vad fälten innehåller medan sidan är ren HTML. Om formuläret går att fylla i står värdena här; om det inte går tomma. Vilket som: efter hydreringen ska samma värden stå kvar.
    const before = { email: await emailField(page).inputValue(), consent: await consentBox(page).isChecked() };

    landingScript.release();
    await expect.poll(() => isHydrated(page), { message: 'the page never hydrated' }).toBe(true);
    await page.waitForLoadState('networkidle');

    await expect(emailField(page)).toHaveValue(before.email);
    expect(await consentBox(page).isChecked()).toBe(before.consent);
  });

  test('pressing Enter in the email field before the page hydrates does not submit or reload the page', async ({ page }) => {
    const { landingScript, navigations } = await openWithLandingScriptHeld(page);
    const urlBefore = page.url();
    await page.evaluate(() => {
      (window as unknown as { __rqSameDocument: boolean }).__rqSameDocument = true;
    });

    await emailField(page).click({ force: true });
    await page.keyboard.type(EMAIL);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(NO_NAVIGATION_WINDOW_MS);

    expect(page.url(), 'the address changed: the browser submitted the form natively').toBe(urlBefore);
    expect(await page.evaluate(() => (window as unknown as { __rqSameDocument?: boolean }).__rqSameDocument), 'the document was replaced by a reload').toBe(true);
    expect(navigations).toEqual([]);
    landingScript.release();
  });
});

test.describe('the waitlist form after the landing page has hydrated', () => {
  test('can be filled in and sent, and shows the thank-you', async ({ page }) => {
    let sent: { email?: string; consent?: boolean } | null = null;
    await page.route('**/api/waitlist', (route) => {
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      sent = route.request().postDataJSON() as { email?: string; consent?: boolean };
      return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });
    const { landingScript } = await openWithLandingScriptHeld(page);
    landingScript.release();
    await expect.poll(() => isHydrated(page), { message: 'the page never hydrated' }).toBe(true);

    await emailField(page).fill(EMAIL);
    await consentBox(page).check();
    await emailField(page).press('Enter');

    await expect(page.getByText("You're on the list.")).toBeVisible();
    expect(sent).toMatchObject({ email: EMAIL, consent: true });
  });
});
