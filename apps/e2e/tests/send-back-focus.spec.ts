import type { Page } from '@playwright/test';
import { expect, test } from '../support/test';
import { apiIsStubbed } from '../support/stubApi';
import {
  BACK_TO_BOARD, DESKTOP, JUMP_PAST_TIME_LIMIT_MS, NO_LOCK, OTHER_MEMBER, PHONE, REFUSED_TEXT, RUNNER, UNCONFIRMED_TEXT, answerAndSettle, collectPageErrors, controlSend, focusIsOnBody, historyOf,
  lockLeftOnPage, open, openSendFromPopup, runnerRow, runnerRowHasFocus, sheet, type ControlSendOptions, type SendControl,
} from '../support/sendFlow';

/**
 * Fokus efter webbläsarens Back från send-arket, och svar som kommer när arket redan är borta. Cancel, ✕, Esc och skrimman går genom avbrytvägen, men Back gör det inte: arket avmonteras
 * utan att något stängs-anrop körs. Fokus ska ändå hamna där Cancel hade lagt det (löparens rad från popupen, annars sidans rubrik, rubrikens Send eller öppnaren), aldrig på `<body>`.
 * Skicket styrs av en rutt som håller svaret (`controlSend`) och en klocka som hoppar förbi tidsgränsen (15 s i appen).
 */
const TOKEN_CARD_SEND = 'Send a minor challenge: Most km, 7 days';
const CONFIRMATION = '.rq-duels-notice';
const OTHER_FIRST_NAME = OTHER_MEMBER.name.split(' ')[0];
const RUNNER_FIRST_NAME = RUNNER.name.split(' ')[0];

test.describe('Back from the send sheet opened by the runner popup when no send is in flight', () => {
  test.skip(!apiIsStubbed(), 'The sheet is filled from a stubbed challenges API; run with E2E_STUB_API=1 against a local build.');

  /** Board, popupen och Challenge in i send-arket; inget skickas. Klockan installeras före sidan så att tidsgränsen går att flytta. */
  async function openSheet(page: Page, options: ControlSendOptions): Promise<{ control: SendControl; boardIdx: number | null; boardLength: number }> {
    await page.clock.install();
    await open(page, '/board', DESKTOP);
    const before = await historyOf(page);
    const control = await controlSend(page, RUNNER, options);
    await openSendFromPopup(page);
    return { control, boardIdx: before.idx, boardLength: before.length };
  }

  /** Back, och det som ska gälla efter det: samma fokus och samma historik som efter Cancel, och inget kvar av dialogen. */
  async function expectLikeCancel(page: Page, history: { boardIdx: number | null; boardLength: number }, errors: string[]): Promise<void> {
    await page.goBack();
    await expect(page).toHaveURL(BACK_TO_BOARD);
    await expect(sheet(page)).toHaveCount(0);
    await expect.poll(() => runnerRowHasFocus(page), { message: 'the runner row has the focus' }).toBe(true);
    expect(await focusIsOnBody(page)).toBe(false);
    expect(await lockLeftOnPage(page)).toEqual(NO_LOCK);
    const after = await historyOf(page);
    expect(after.idx).toBe(history.boardIdx);
    expect(after.length).toBeLessThanOrEqual(history.boardLength + 1);
    expect(errors).toEqual([]);
  }

  test('Back from an idle sheet puts the focus on the runner row, with the same history as Cancel', async ({ page }) => {
    const errors = collectPageErrors(page);
    const { boardIdx, boardLength } = await openSheet(page, { serverCreates: false, neverAnswer: true });

    await expectLikeCancel(page, { boardIdx, boardLength }, errors);
  });

  test('Back after a refused send puts the focus on the runner row', async ({ page }) => {
    const errors = collectPageErrors(page);
    const { control, boardIdx, boardLength } = await openSheet(page, { serverCreates: false, neverAnswer: false, refuse: true });
    await sheet(page).getByRole('button', { name: 'Send challenge' }).click();
    await expect(sheet(page).getByRole('button', { name: 'Sending…' })).toBeDisabled();
    await expect.poll(() => control.sends.length).toBe(1);
    control.answer();
    await expect(sheet(page).getByRole('alert')).toHaveText(REFUSED_TEXT);

    await expectLikeCancel(page, { boardIdx, boardLength }, errors);
  });

  test('Back after the time limit puts the focus on the runner row', async ({ page }) => {
    const errors = collectPageErrors(page);
    const { boardIdx, boardLength } = await openSheet(page, { serverCreates: false, neverAnswer: true });
    await sheet(page).getByRole('button', { name: 'Send challenge' }).click();
    await expect(sheet(page).getByRole('button', { name: 'Sending…' })).toBeDisabled();
    await page.clock.fastForward(JUMP_PAST_TIME_LIMIT_MS);
    await expect(sheet(page).getByRole('alert')).toHaveText(UNCONFIRMED_TEXT);

    await expectLikeCancel(page, { boardIdx, boardLength }, errors);
  });
});

test.describe('Back from the send sheet when the entry has no origin', () => {
  test.skip(!apiIsStubbed(), 'The sheet is filled from a stubbed challenges API; run with E2E_STUB_API=1 against a local build.');

  test('the header Send opens it on desktop: Back keeps the user on duels with the focus on that button', async ({ page }) => {
    await open(page, '/duels?view=live', DESKTOP, { expectRow: false });
    const headerSend = page.getByRole('button', { name: 'Send a challenge', exact: true });
    await headerSend.click();
    await expect(sheet(page)).toBeVisible();

    await page.goBack();

    await expect(page).toHaveURL(/\/duels\?view=live$/);
    await expect(sheet(page)).toHaveCount(0);
    await expect(headerSend).toBeFocused();
    expect(await lockLeftOnPage(page)).toEqual(NO_LOCK);
  });

  test('New > Send a challenge on a phone comes from the board: Back lands there with the focus on the page heading, not on the body', async ({ page }) => {
    await open(page, '/board', PHONE, { expectRow: false });
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByRole('button', { name: /Send a challenge/ }).click();
    await expect(sheet(page)).toBeVisible();

    await page.goBack();

    await expect(page).toHaveURL(BACK_TO_BOARD);
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.locator('main h1').first()).toBeFocused();
    expect(await lockLeftOnPage(page)).toEqual(NO_LOCK);
  });
});

for (const [label, size] of [['desktop', DESKTOP], ['a phone (390 px)', PHONE]] as const) {
  test.describe(`Back during a send from a token card on ${label}, then the answer`, () => {
    test.skip(!apiIsStubbed(), 'The sheet is filled from a stubbed challenges API; run with E2E_STUB_API=1 against a local build.');

    /** Duels, kortets Send, motståndaren Cy Three och Send; skicket hålls. Back lämnar fokus på kortets Send. */
    async function sendFromTokenCardThenBack(page: Page, options: ControlSendOptions): Promise<SendControl> {
      await page.clock.install();
      await open(page, '/duels', size, { expectRow: false });
      const control = await controlSend(page, OTHER_MEMBER, options);
      await page.getByRole('button', { name: TOKEN_CARD_SEND }).click();
      await expect(sheet(page)).toBeVisible();
      await sheet(page).getByRole('radiogroup', { name: '3 · Pick an opponent' }).getByRole('radio', { name: new RegExp(OTHER_MEMBER.name) }).click();
      await sheet(page).getByRole('button', { name: 'Send challenge' }).click();
      await expect(sheet(page).getByRole('button', { name: 'Sending…' })).toBeDisabled();
      await expect.poll(() => control.sends.length).toBe(1);

      await page.goBack();

      await expect(sheet(page)).toHaveCount(0);
      await expect(page.getByRole('button', { name: TOKEN_CARD_SEND })).toBeFocused();
      return control;
    }

    test('a late 201 removes the card that had the focus: the focus goes to the confirmation', async ({ page }) => {
      const control = await sendFromTokenCardThenBack(page, { serverCreates: true, neverAnswer: false });

      await answerAndSettle(page, control);

      await expect(page.getByRole('button', { name: TOKEN_CARD_SEND })).toHaveCount(0);
      const confirmation = page.locator(CONFIRMATION);
      await expect(confirmation).toHaveCount(1);
      await expect(confirmation).toContainText(`Challenge sent to ${OTHER_FIRST_NAME}`);
      await expect(confirmation).toBeFocused();
      expect(await focusIsOnBody(page)).toBe(false);
      expect(control.sends, 'one POST reached the server').toHaveLength(1);
    });

    test('the time limit that refetches the tokens and removes the card: the focus goes to the honest text', async ({ page }) => {
      const control = await sendFromTokenCardThenBack(page, { serverCreates: true, neverAnswer: true });

      await page.clock.fastForward(JUMP_PAST_TIME_LIMIT_MS);
      await page.clock.runFor(1_000);

      await expect(page.getByRole('button', { name: TOKEN_CARD_SEND })).toHaveCount(0);
      const notice = page.locator(CONFIRMATION);
      await expect(notice).toHaveText(UNCONFIRMED_TEXT);
      await expect(notice).toBeFocused();
      expect(await focusIsOnBody(page)).toBe(false);
      expect(control.sends, 'one POST reached the server').toHaveLength(1);
    });

    test('a late 400 leaves the card and the focus where they are, and shows the refusal once', async ({ page }) => {
      const control = await sendFromTokenCardThenBack(page, { serverCreates: false, neverAnswer: false, refuse: true });

      await answerAndSettle(page, control);

      const notice = page.locator(CONFIRMATION);
      await expect(notice).toHaveCount(1);
      await expect(notice).toHaveText(REFUSED_TEXT);
      await expect(notice).toHaveAttribute('data-tone', 'error');
      await expect(page.getByRole('button', { name: TOKEN_CARD_SEND })).toBeFocused();
      expect(control.sends, 'one POST reached the server').toHaveLength(1);
    });
  });
}

test.describe('an answer that comes after Back, seen from the page the user is on', () => {
  test.skip(!apiIsStubbed(), 'The sheet is filled from a stubbed challenges API; run with E2E_STUB_API=1 against a local build.');

  /** Duels (Standings), löparens popup, Challenge och Send; skicket hålls. Back lämnar användaren på Duels med fokus på löparens rad. */
  async function sendFromPopupOnDuelsThenBack(page: Page, options: ControlSendOptions): Promise<SendControl> {
    await page.clock.install();
    await open(page, '/duels?view=standings', DESKTOP);
    const control = await controlSend(page, RUNNER, options);
    await openSendFromPopup(page);
    await sheet(page).getByRole('button', { name: 'Send challenge' }).click();
    await expect(sheet(page).getByRole('button', { name: 'Sending…' })).toBeDisabled();
    await expect.poll(() => control.sends.length).toBe(1);

    await page.goBack();

    await expect(page).toHaveURL(/\/duels\?view=standings$/);
    await expect(sheet(page)).toHaveCount(0);
    await expect.poll(() => runnerRowHasFocus(page)).toBe(true);
    return control;
  }

  test('a sent 201 shows the confirmation once on duels and does not take the focus from the row', async ({ page }) => {
    const control = await sendFromPopupOnDuelsThenBack(page, { serverCreates: true, neverAnswer: false });

    await answerAndSettle(page, control);

    const confirmation = page.locator(CONFIRMATION);
    await expect(confirmation).toHaveCount(1);
    await expect(confirmation).toContainText(`Challenge sent to ${RUNNER_FIRST_NAME}`);
    await expect(page).toHaveURL(/\/duels\?view=standings$/);
    expect(await runnerRowHasFocus(page)).toBe(true);
    expect(control.sends, 'one POST reached the server').toHaveLength(1);
  });

  test('a 400 shows the refusal once on duels', async ({ page }) => {
    const control = await sendFromPopupOnDuelsThenBack(page, { serverCreates: false, neverAnswer: false, refuse: true });

    await answerAndSettle(page, control);

    const confirmation = page.locator(CONFIRMATION);
    await expect(confirmation).toHaveCount(1);
    await expect(confirmation).toHaveText(REFUSED_TEXT);
    await expect(confirmation).toHaveAttribute('data-tone', 'error');
    await expect(page).toHaveURL(/\/duels\?view=standings$/);
    expect(await runnerRowHasFocus(page)).toBe(true);
  });

  test('the time limit shows the honest text once on duels', async ({ page }) => {
    const control = await sendFromPopupOnDuelsThenBack(page, { serverCreates: true, neverAnswer: true });

    await page.clock.fastForward(JUMP_PAST_TIME_LIMIT_MS);
    await page.clock.runFor(1_000);

    const confirmation = page.locator(CONFIRMATION);
    await expect(confirmation).toHaveCount(1);
    await expect(confirmation).toHaveText(UNCONFIRMED_TEXT);
    await expect(page).toHaveURL(/\/duels\?view=standings$/);
    expect(control.sends, 'one POST reached the server').toHaveLength(1);
  });

  test('Back, the popup again and Challenge: the old answer does not land in the new sheet', async ({ page }) => {
    await page.clock.install();
    await open(page, '/board', DESKTOP);
    const control = await controlSend(page, RUNNER, { serverCreates: false, neverAnswer: false, refuse: true });
    await openSendFromPopup(page);
    await sheet(page).getByRole('button', { name: 'Send challenge' }).click();
    await expect(sheet(page).getByRole('button', { name: 'Sending…' })).toBeDisabled();
    await expect.poll(() => control.sends.length).toBe(1);
    await page.goBack();
    await expect(page).toHaveURL(BACK_TO_BOARD);
    await expect(sheet(page)).toHaveCount(0);

    await openSendFromPopup(page);
    await answerAndSettle(page, control);

    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).getByRole('alert')).toHaveText('');
    await expect(sheet(page).getByRole('button', { name: 'Send challenge' })).toBeEnabled();
    await expect(page).toHaveURL(new RegExp(`/duels\\?send=1&opponent=${RUNNER.id}`));
    expect(control.sends, 'one POST reached the server').toHaveLength(1);
  });
});

test.describe('the runner page on a phone', () => {
  test.skip(!apiIsStubbed(), 'The sheet is filled from a stubbed challenges API; run with E2E_STUB_API=1 against a local build.');

  test('a 201 after Back does not take the user away from the runner page or its heading', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.clock.install();
    await open(page, '/board', PHONE);
    const control = await controlSend(page, RUNNER, { serverCreates: true, neverAnswer: false });
    await runnerRow(page).click();
    await expect(page).toHaveURL(new RegExp(`/runner/${RUNNER.id}$`));
    await page.getByRole('link', { name: 'Challenge' }).click();
    await expect(sheet(page)).toBeVisible();
    await sheet(page).getByRole('button', { name: 'Send challenge' }).click();
    await expect(sheet(page).getByRole('button', { name: 'Sending…' })).toBeDisabled();
    await expect.poll(() => control.sends.length).toBe(1);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/runner/${RUNNER.id}$`));
    const heading = page.getByRole('heading', { level: 1, name: RUNNER.name });
    await expect(heading).toBeFocused();

    await answerAndSettle(page, control);

    await expect(page).toHaveURL(new RegExp(`/runner/${RUNNER.id}$`));
    await expect(sheet(page)).toHaveCount(0);
    await expect(heading).toBeFocused();
    expect(await lockLeftOnPage(page)).toEqual(NO_LOCK);
    expect(control.sends, 'one POST reached the server').toHaveLength(1);
    expect(errors).toEqual([]);
  });
});
