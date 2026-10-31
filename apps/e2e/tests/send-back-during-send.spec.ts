import type { Page } from '@playwright/test';
import { expect, test } from '../support/test';
import { apiIsStubbed } from '../support/stubApi';
import { CORS_HEADERS, DESKTOP, OTHER_MEMBER, PHONE, RUNNER, apiPath, historyOf, open, openSendFromPopup, runnerRow, runnerRowHasFocus, sheet } from '../support/sendFlow';

/**
 * Webbläsarens Back medan ett skick pågår. Send-arket låser Cancel, ✕, Esc och skrimman under skicket, men inte Back: arket avmonteras och utfallet har ingen yta att visas på.
 * Skicket styrs här av en rutt som håller svaret (aldrig, eller tills provet släpper det) och en klocka som hoppar förbi tidsgränsen (15 s i appen).
 */
const JUMP_PAST_TIME_LIMIT_MS = 16_000;
const UNCONFIRMED_TEXT = /couldn.t confirm that your challenge was sent/i;
const BACK_TO_BOARD = /\/board$/;

interface SendControl {
  /** Ett element per POST /challenges/send som nådde "servern". */
  sends: string[];
  /** Antal gånger "mina utmaningar" har hämtats. */
  myFetches: () => number;
  /** Släpper svaret (201) på skicken som hålls. */
  answer: () => void;
}

/** Utmaningen "servern" skapar: en väntande utmaning från mig till löparen i popupen. */
const createdChallenge = (opponent: { id: string; name: string }) => ({
  id: 'challenge-new', group_id: 'g1', token_id: 'token-minor-km', tier: 'minor', challenger_id: 'stub-user-1', challenger_name: 'Stub Runner', opponent_id: opponent.id, opponent_name: opponent.name,
  metric: 'km', duration_days: 7, winner_delta: 0.15, winner_duration: 5, winner_type: 'multiplier_days', loser_delta: -0.07, loser_duration: 5, loser_type: 'multiplier_days',
  challenger_level: 10, opponent_level: 11, status: 'pending', created_at: '2026-10-31T08:00:00Z',
});

/**
 * Lägger över skicket: svaret hålls tills `answer()` anropas (eller för alltid). Med `serverCreates` skapas utmaningen när skicket når "servern", och "mina utmaningar" visar den därefter (tokenet borta).
 * Registreras efter `open` och går därför före grundstubbens rutter.
 */
async function controlSend(page: Page, opponent: { id: string; name: string }, { serverCreates, neverAnswer }: { serverCreates: boolean; neverAnswer: boolean }): Promise<SendControl> {
  const sends: string[] = [];
  let created = false;
  let myFetches = 0;
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });

  await page.route(apiPath('/challenges/my'), async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS_HEADERS });
    myFetches += 1;
    // Innan utmaningen finns svarar grundstubben (inget token är använt); efteråt är tokenet borta och utmaningen skickad.
    if (!created) return route.fallback();
    const data = { tokens: [], sent_challenge: createdChallenge(opponent), received_challenges: [], boosts: [], history: [], group_active: [] };
    return route.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
  });
  await page.route(apiPath('/challenges/send'), async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS_HEADERS });
    sends.push(route.request().url());
    if (serverCreates) created = true;
    if (neverAnswer) await new Promise<void>(() => {});
    await held;
    // Webbläsaren kan ha gett upp och avbrutit anropet: då finns inget att svara, och det är inget fel i stubben.
    return route.fulfill({ status: 201, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify({ success: true, data: { challenge_id: 'challenge-new' } }) }).catch(() => {});
  });
  return { sends, myFetches: () => myFetches, answer: release };
}

/** Tiden appen får på sig att reagera på ett svar (omhämtningen och det som följer på den) innan provet tittar: en vilopaus i verklig tid, inte på den fejkade klockan. */
const REACTION_TIME_MS = 1_000;

/** Släpper svaret och väntar tills sidan har fått det och appen hunnit reagera. */
async function answerAndSettle(page: Page, control: SendControl): Promise<void> {
  const received = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/challenges/send'));
  control.answer();
  await received;
  await page.clock.runFor(REACTION_TIME_MS);
  await page.waitForTimeout(REACTION_TIME_MS);
}

/** Allt som en dialog lämnar efter sig på sidan när den stängs: skrollås, `aria-hidden` och `inert` på appen, och en body som inte tar emot tryck. */
const lockLeftOnPage = (page: Page) =>
  page.evaluate(() => ({
    scrollLocked: document.body.hasAttribute('data-scroll-locked'),
    bodyPointerEvents: document.body.style.pointerEvents,
    inert: document.querySelectorAll('[inert]').length,
    hiddenBodyChildren: Array.from(document.body.children).filter((child) => child.getAttribute('aria-hidden') === 'true').length,
    openDialogs: document.querySelectorAll('[role="dialog"]').length,
  }));
const NO_LOCK = { scrollLocked: false, bodyPointerEvents: '', inert: 0, hiddenBodyChildren: 0, openDialogs: 0 };

const focusIsOnBody = (page: Page) => page.evaluate(() => document.activeElement === document.body || document.activeElement === null);

/** Fel som sidan själv kastar (okontrollerade undantag): Back under ett skick ska inte ge något. */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

const goToDuelsInApp = async (page: Page) => {
  await page.getByRole('navigation').getByRole('link', { name: 'Challenges' }).first().click();
  await expect(page).toHaveURL(/\/duels/);
};
const sentSectionText = new RegExp(`Waiting for ${RUNNER.name.split(' ')[0]} to respond`);

test.describe('Back while a challenge is being sent from the runner popup (desktop)', () => {
  test.skip(!apiIsStubbed(), 'The sheet is filled from a stubbed challenges API; run with E2E_STUB_API=1 against a local build.');

  /** Popup, Challenge och Send; skicket hålls av rutten. Klockan installeras före sidan så att tidsgränsen går att flytta. */
  async function sendFromPopup(page: Page, options: { serverCreates: boolean; neverAnswer: boolean }): Promise<SendControl> {
    await page.clock.install();
    await open(page, '/board', DESKTOP);
    const control = await controlSend(page, RUNNER, options);
    await openSendFromPopup(page);
    await sheet(page).getByRole('button', { name: 'Send challenge' }).click();
    await expect(sheet(page).getByRole('button', { name: 'Sending…' })).toBeDisabled();
    await expect.poll(() => control.sends.length).toBe(1);
    return control;
  }

  test('Back while the send never gets an answer: no crash, the focus is on the runner row and no lock is left', async ({ page }) => {
    const errors = collectPageErrors(page);
    await sendFromPopup(page, { serverCreates: false, neverAnswer: true });

    await page.goBack();

    await expect(page).toHaveURL(BACK_TO_BOARD);
    await expect(sheet(page)).toHaveCount(0);
    await expect.poll(() => runnerRowHasFocus(page), { message: 'the runner row has the focus' }).toBe(true);
    expect(await focusIsOnBody(page)).toBe(false);
    expect(await lockLeftOnPage(page)).toEqual(NO_LOCK);
    expect(errors).toEqual([]);
  });

  test('Back while the send never gets an answer: after the time limit the page is still the board and the created challenge shows on duels without a reload', async ({ page }) => {
    const errors = collectPageErrors(page);
    const control = await sendFromPopup(page, { serverCreates: true, neverAnswer: true });
    await page.goBack();
    await expect(page).toHaveURL(BACK_TO_BOARD);

    await page.clock.fastForward(JUMP_PAST_TIME_LIMIT_MS);

    // Tidsgränsen avgörs efter att arket är borta: användaren dras inte till Duels, fokus tas inte, och listorna hämtas om så att utmaningen syns när hen kommer dit.
    await page.clock.runFor(1_000);
    await expect(page).toHaveURL(BACK_TO_BOARD);
    await expect.poll(() => runnerRowHasFocus(page)).toBe(true);
    await goToDuelsInApp(page);
    await expect(page.getByText(sentSectionText)).toBeVisible();
    expect(control.sends, 'one POST reached the server').toHaveLength(1);
    expect(await lockLeftOnPage(page)).toEqual(NO_LOCK);
    expect(errors).toEqual([]);
  });

  test('an answer that comes after Back keeps the user on the board, refreshes the lists and gives no second send', async ({ page }) => {
    const errors = collectPageErrors(page);
    const control = await sendFromPopup(page, { serverCreates: true, neverAnswer: false });
    await page.goBack();
    await expect(page).toHaveURL(BACK_TO_BOARD);

    await answerAndSettle(page, control);

    await expect(page).toHaveURL(BACK_TO_BOARD);
    await expect.poll(() => runnerRowHasFocus(page), { message: 'the answer does not take the focus' }).toBe(true);
    await goToDuelsInApp(page);
    await expect(page.getByText(sentSectionText)).toBeVisible();
    expect(control.sends, 'one POST reached the server').toHaveLength(1);
    expect(await lockLeftOnPage(page)).toEqual(NO_LOCK);
    expect(errors).toEqual([]);
  });

  test('an unconfirmed send: Cancel after the time limit returns to the board with the focus on the runner row and the same history', async ({ page }) => {
    await page.clock.install();
    await open(page, '/board', DESKTOP);
    const beforePopup = await historyOf(page);
    await controlSend(page, RUNNER, { serverCreates: false, neverAnswer: true });
    await openSendFromPopup(page);
    await sheet(page).getByRole('button', { name: 'Send challenge' }).click();
    await expect(sheet(page).getByRole('button', { name: 'Sending…' })).toBeDisabled();

    await page.clock.fastForward(JUMP_PAST_TIME_LIMIT_MS);
    await expect(sheet(page).getByRole('alert')).toHaveText(UNCONFIRMED_TEXT);
    await sheet(page).getByRole('button', { name: 'Cancel' }).click();

    await expect(page).toHaveURL(BACK_TO_BOARD);
    await expect(sheet(page)).toHaveCount(0);
    await expect.poll(() => runnerRowHasFocus(page)).toBe(true);
    const after = await historyOf(page);
    expect(after.idx).toBe(beforePopup.idx);
    expect(after.length).toBeLessThanOrEqual(beforePopup.length + 1);
  });

  test('Close in the reason view after the server created the challenge returns to the board with the focus on the runner row', async ({ page }) => {
    await page.clock.install();
    await open(page, '/board', DESKTOP);
    const beforePopup = await historyOf(page);
    await controlSend(page, RUNNER, { serverCreates: true, neverAnswer: true });
    await openSendFromPopup(page);
    await sheet(page).getByRole('button', { name: 'Send challenge' }).click();
    await expect(sheet(page).getByRole('button', { name: 'Sending…' })).toBeDisabled();

    await page.clock.fastForward(JUMP_PAST_TIME_LIMIT_MS);
    await expect(sheet(page).getByRole('status')).toContainText('is waiting for an answer');
    await sheet(page).getByRole('button', { name: 'Close' }).last().click();

    await expect(page).toHaveURL(BACK_TO_BOARD);
    await expect(sheet(page)).toHaveCount(0);
    await expect.poll(() => runnerRowHasFocus(page)).toBe(true);
    const after = await historyOf(page);
    expect(after.idx).toBe(beforePopup.idx);
    expect(after.length).toBeLessThanOrEqual(beforePopup.length + 1);
  });
});

test.describe('Back while a challenge is being sent on /duels (no origin)', () => {
  test.skip(!apiIsStubbed(), 'The sheet is filled from a stubbed challenges API; run with E2E_STUB_API=1 against a local build.');

  /** Rubrikens Send, motståndaren Cy Three och Send; skicket hålls av rutten. */
  async function sendFromDuels(page: Page, options: { serverCreates: boolean; neverAnswer: boolean }): Promise<SendControl> {
    await page.clock.install();
    await open(page, '/duels?view=live', DESKTOP, { expectRow: false });
    const control = await controlSend(page, OTHER_MEMBER, options);
    await page.getByRole('button', { name: 'Send a challenge' }).click();
    await expect(sheet(page)).toBeVisible();
    await sheet(page).getByRole('radiogroup', { name: '3 · Pick an opponent' }).getByRole('radio', { name: new RegExp(OTHER_MEMBER.name) }).click();
    await sheet(page).getByRole('button', { name: 'Send challenge' }).click();
    await expect(sheet(page).getByRole('button', { name: 'Sending…' })).toBeDisabled();
    await expect.poll(() => control.sends.length).toBe(1);
    return control;
  }

  test('Back keeps the user on duels with the focus on the page, and a 201 afterwards shows the confirmation once, without a second send', async ({ page }) => {
    const errors = collectPageErrors(page);
    const control = await sendFromDuels(page, { serverCreates: true, neverAnswer: false });
    await page.goBack();
    await expect(page).toHaveURL(/\/duels\?view=live$/);
    await expect(sheet(page)).toHaveCount(0);
    expect(await focusIsOnBody(page), 'the focus is not on the body').toBe(false);
    expect(await lockLeftOnPage(page)).toEqual(NO_LOCK);

    await answerAndSettle(page, control);

    const confirmation = page.locator('.rq-duels-notice');
    await expect(confirmation).toHaveCount(1);
    await expect(confirmation).toContainText(`Challenge sent to ${OTHER_MEMBER.name.split(' ')[0]}`);
    await expect(page).toHaveURL(/\/duels\?view=live$/);
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.getByText(new RegExp(`Waiting for ${OTHER_MEMBER.name.split(' ')[0]} to respond`))).toBeVisible();
    expect(control.sends, 'one POST reached the server').toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test('Back, then the time limit: the honest text shows on duels and the created challenge is listed', async ({ page }) => {
    const control = await sendFromDuels(page, { serverCreates: true, neverAnswer: true });
    await page.goBack();
    await expect(page).toHaveURL(/\/duels\?view=live$/);

    await page.clock.fastForward(JUMP_PAST_TIME_LIMIT_MS);

    await expect(page.locator('.rq-duels-notice')).toHaveText(UNCONFIRMED_TEXT);
    await expect(page.locator('.rq-duels-notice')).toHaveAttribute('data-tone', 'error');
    await expect(page.getByText(new RegExp(`Waiting for ${OTHER_MEMBER.name.split(' ')[0]} to respond`))).toBeVisible();
    expect(control.sends, 'one POST reached the server').toHaveLength(1);
    expect(await lockLeftOnPage(page)).toEqual(NO_LOCK);
  });
});

test.describe('the runner page on a phone', () => {
  test.skip(!apiIsStubbed(), 'The sheet is filled from a stubbed challenges API; run with E2E_STUB_API=1 against a local build.');

  /** Board → löparens sida → Challenge. */
  async function openSendFromRunnerPage(page: Page): Promise<{ boardIdx: number | null }> {
    await open(page, '/board', PHONE);
    const boardIdx = (await historyOf(page)).idx;
    await runnerRow(page).click();
    await expect(page).toHaveURL(new RegExp(`/runner/${RUNNER.id}$`));
    await page.getByRole('link', { name: 'Challenge' }).click();
    await expect(sheet(page)).toBeVisible();
    return { boardIdx };
  }

  test('Challenge on the runner page has no origin: Cancel stays on duels, two entries after the board and one after the page (documented, ADR 006 point 5)', async ({ page }) => {
    const { boardIdx } = await openSendFromRunnerPage(page);
    expect(boardIdx).not.toBeNull();
    await expect(page).toHaveURL(new RegExp(`/duels\\?send=1&opponent=${RUNNER.id}`));
    expect((await historyOf(page)).idx).toBe(boardIdx! + 2);

    await sheet(page).getByRole('button', { name: 'Cancel' }).click();

    await expect(sheet(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/duels$/);
    expect((await historyOf(page)).idx).toBe(boardIdx! + 2);
    // Challenge-länken på löparens sida finns inte längre; fokus går till rubrikens Send (mobilens "Send").
    await expect(page.locator('[data-tour="duels-send"]')).toBeFocused();
    // Back lämnar Duels och kommer till löparens sida, inte tillbaka in i arket.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/runner/${RUNNER.id}$`));
    await expect(sheet(page)).toHaveCount(0);
  });

  test('Back while the send is pending lands on the runner page with the focus on its heading and no lock', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.clock.install();
    await open(page, '/board', PHONE);
    const control = await controlSend(page, RUNNER, { serverCreates: true, neverAnswer: true });
    await runnerRow(page).click();
    await expect(page).toHaveURL(new RegExp(`/runner/${RUNNER.id}$`));
    await page.getByRole('link', { name: 'Challenge' }).click();
    await expect(sheet(page)).toBeVisible();
    await sheet(page).getByRole('button', { name: 'Send challenge' }).click();
    await expect(sheet(page).getByRole('button', { name: 'Sending…' })).toBeDisabled();
    await expect.poll(() => control.sends.length).toBe(1);

    await page.goBack();

    await expect(page).toHaveURL(new RegExp(`/runner/${RUNNER.id}$`));
    await expect(page.getByRole('heading', { level: 1, name: RUNNER.name })).toBeFocused();
    expect(await lockLeftOnPage(page)).toEqual(NO_LOCK);
    await page.clock.fastForward(JUMP_PAST_TIME_LIMIT_MS);
    await page.clock.runFor(1_000);
    await expect(page).toHaveURL(new RegExp(`/runner/${RUNNER.id}$`));
    expect(errors).toEqual([]);
  });
});
