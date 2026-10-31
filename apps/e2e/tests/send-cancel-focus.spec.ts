
import type { Page, Route } from '@playwright/test';
import { expect, test } from '../support/test';
import { DESKTOP, PHONE, RUNNER, historyOf, isInViewport, open, openSendFromPopup, popup, runnerRow, runnerRowHasFocus, sheet } from '../support/sendFlow';

/**
 * Avbryt i send-flödet som löparens popup öppnade, och fokus tillbaka till löparens rad (ADR 006 punkt 5). Gruppen, utmaningarna och skicket läggs över API:et i webbläsaren
 * (`support/sendFlow.ts`), så provet gäller lika mot staging och stubben. Historiken mäts med `history.length` och `history.state.idx` (react-routers egen post-räknare).
 */

const closers: Array<[string, (page: Page) => Promise<void>]> = [
  ['Cancel', (page) => sheet(page).getByRole('button', { name: 'Cancel' }).click()],
  ['the close button', (page) => sheet(page).getByRole('button', { name: 'Close' }).click()],
  ['Escape', (page) => page.keyboard.press('Escape')],
  ['a click on the scrim', (page) => page.mouse.click(8, 8)],
];

const backgrounds: Array<[string, string, RegExp]> = [
  ['the board', '/board', /\/board$/],
  ['the duels standings', '/duels?view=standings', /\/duels\?view=standings$/],
  ['the group log', '/log?view=group', /\/log\?view=group$/],
];

test.describe('cancelling the send flow that the popup opened (desktop)', () => {
  for (const [background, path, urlAfter] of backgrounds) {
    for (const [how, close] of closers) {
      test(`cancel with ${how} returns to ${background} with the focus on the runner row and no extra history entry`, async ({ page }) => {
        await open(page, path, DESKTOP);
        const beforePopup = await historyOf(page);
        await openSendFromPopup(page);

        await close(page);

        await expect(page).toHaveURL(urlAfter);
        await expect(sheet(page)).toHaveCount(0);
        await expect.poll(() => runnerRowHasFocus(page)).toBe(true);
        expect(await isInViewport(page, runnerRow(page)), 'the focused row is in view').toBe(true);
        // Avbrottet går ett steg bakåt till sidan under popupen: platsen i historiken är den från före popupen, och inget nytt lades till. Posten framåt (send-flödet)
        // ligger kvar i webbläsarens stack tills nästa ny post skriver över den, så längden är högst en över.
        const after = await historyOf(page);
        expect(after.idx).toBe(beforePopup.idx);
        expect(after.length).toBeLessThanOrEqual(beforePopup.length + 1);
      });
    }
  }

  test('one and three rounds of popup, Challenge and cancel leave the same history, and Back from the board leaves the app as it did before the popup', async ({ page }) => {
    await open(page, '/board', DESKTOP);
    const beforePopup = await historyOf(page);
    const afterRounds: Array<{ length: number; idx: number | null }> = [];

    for (const round of [1, 2, 3]) {
      await openSendFromPopup(page);
      await sheet(page).getByRole('button', { name: 'Cancel' }).click();
      await expect(page).toHaveURL(/\/board$/);
      await expect.poll(() => runnerRowHasFocus(page), { message: `round ${round}: the runner row has the focus` }).toBe(true);
      expect(await isInViewport(page, runnerRow(page)), `round ${round}: the focused row is in view`).toBe(true);
      afterRounds.push(await historyOf(page));
    }

    expect(afterRounds[0]?.idx).toBe(beforePopup.idx);
    expect(afterRounds[1]).toEqual(afterRounds[0]);
    expect(afterRounds[2]).toEqual(afterRounds[0]);
    expect(afterRounds[2]!.length).toBeLessThanOrEqual(beforePopup.length + 1);
    // Ett enda Back lämnar Board (posten före är sidan som öppnade appen), som före popupen.
    await page.goBack();
    await expect(page).not.toHaveURL(/\/(board|duels)/);
  });

  test('Back after a cancel never returns into the send sheet', async ({ page }) => {
    await open(page, '/board', DESKTOP);
    await openSendFromPopup(page);
    await sheet(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(/\/board$/);

    await page.goBack();

    await expect(page).not.toHaveURL(/send=1/);
    await expect(sheet(page)).toHaveCount(0);
    await expect(popup(page)).toHaveCount(0);
  });

  test('a sent challenge stays on duels with the focus on the confirmation and adds no history entry', async ({ page }) => {
    await open(page, '/board', DESKTOP);
    await openSendFromPopup(page);
    const atSheet = await historyOf(page);

    await sheet(page).getByRole('button', { name: 'Send challenge' }).click();

    const confirmation = page.locator('.rq-duels-notice');
    await expect(confirmation).toContainText('Challenge sent');
    await expect(confirmation).toBeFocused();
    await expect(page).toHaveURL(/\/duels$/);
    expect(await historyOf(page)).toEqual(atSheet);
  });

  test('the header Send opened after a sent challenge has no origin: Cancel stays on duels', async ({ page }) => {
    await open(page, '/board', DESKTOP);
    await openSendFromPopup(page);
    await sheet(page).getByRole('button', { name: 'Send challenge' }).click();
    await expect(page.locator('.rq-duels-notice')).toContainText('Challenge sent');

    await page.getByRole('button', { name: 'Send a challenge' }).click();
    await expect(sheet(page)).toBeVisible();
    await sheet(page).getByRole('button', { name: 'Cancel' }).click();

    await expect(sheet(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/duels$/);
  });

  test('send a challenge without origin stays on duels, with the focus on the header Send', async ({ page }) => {
    await open(page, '/duels?view=standings', DESKTOP);
    const send = page.getByRole('button', { name: 'Send a challenge' });
    await send.click();
    await expect(sheet(page)).toBeVisible();
    const atSheet = await historyOf(page);

    await sheet(page).getByRole('button', { name: 'Cancel' }).click();

    await expect(sheet(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/duels\?view=standings$/);
    await expect(send).toBeFocused();
    const after = await historyOf(page);
    expect(after.length).toBe(atSheet.length);
  });

  test('the empty Live state keeps the Live tab through the sheet', async ({ page }) => {
    await open(page, '/duels?view=live', DESKTOP, { expectRow: false });
    await page.getByRole('link', { name: 'Send a challenge' }).click();
    await expect(sheet(page)).toBeVisible();
    await expect(page).toHaveURL(/send=1&view=live$/);

    await sheet(page).getByRole('button', { name: 'Cancel' }).click();

    await expect(page).toHaveURL(/\/duels\?view=live$/);
    await expect(page.getByRole('tab', { name: 'Live' })).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('the popup falls back on the page behind it for focus', () => {
  test('while the chunk loads, Escape and a click on the scrim put the focus on the runner row', async ({ page }) => {
    await open(page, '/board', DESKTOP);
    const held: Route[] = [];
    await page.route(/\/assets\/RunnerPopup-.*\.js/, (route) => { held.push(route); });

    await runnerRow(page).click();
    const pending = page.getByRole('dialog', { name: 'Runner card' });
    await expect(pending).toHaveAttribute('aria-busy', 'true');
    await page.keyboard.press('Escape');
    await expect(pending).toHaveCount(0);
    await expect.poll(() => runnerRowHasFocus(page)).toBe(true);

    await runnerRow(page).click();
    await expect(pending).toBeVisible();
    await page.mouse.click(8, 8);
    await expect(pending).toHaveCount(0);
    await expect.poll(() => runnerRowHasFocus(page)).toBe(true);
    await Promise.all(held.map((route) => route.abort()));
  });

  test('when the chunk is blocked, the error card is a dialog: Escape closes it and the focus returns to the runner row', async ({ page }) => {
    await open(page, '/board', DESKTOP);
    await page.route(/\/assets\/RunnerPopup-.*\.js/, (route) => route.abort());

    await runnerRow(page).click();
    const card = page.getByRole('dialog', { name: 'Something broke' });
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('aria-modal', 'true');
    await expect(card).toBeFocused();

    await page.keyboard.press('Escape');

    await expect(card).toHaveCount(0);
    await expect(page).toHaveURL(/\/board$/);
    await expect.poll(() => runnerRowHasFocus(page)).toBe(true);
  });
});

test.describe('the runner page on a phone', () => {
  /** Scrollar Board så långt att löparens rad (rest-listan) ligger nära sidans slut. */
  async function scrollToRunner(page: Page): Promise<void> {
    await runnerRow(page).evaluate((element) => element.scrollIntoView({ block: 'end' }));
    await page.evaluate(() => window.scrollBy(0, 400));
  }

  test('a scrolled Board: the page heading is in view with the focus on it, and Back brings the runner row into view with the focus on it', async ({ page }) => {
    await open(page, '/board', PHONE);
    await scrollToRunner(page);
    expect(await page.evaluate(() => window.scrollY), 'the board is scrolled before the card opens').toBeGreaterThan(300);

    await runnerRow(page).click();
    await expect(page).toHaveURL(new RegExp(`/runner/${RUNNER.id}$`));
    const heading = page.getByRole('heading', { level: 1, name: RUNNER.name });
    await expect(heading).toBeFocused();
    expect(await isInViewport(page, heading), 'the focused heading is in view').toBe(true);

    await page.getByRole('link', { name: /Standings/ }).click();

    await expect(page).toHaveURL(/\/board$/);
    await expect.poll(() => runnerRowHasFocus(page)).toBe(true);
    expect(await isInViewport(page, runnerRow(page)), 'the focused row is in view').toBe(true);
  });
});
