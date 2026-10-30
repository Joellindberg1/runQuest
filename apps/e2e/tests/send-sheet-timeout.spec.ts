import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';
import { stubSendSheetApi, type SendSheetStubOptions } from '../support/sendSheetStub';
import { apiIsStubbed } from '../support/stubApi';

/**
 * Ett skick som inte får något svar (tidsgränsen) eller inte når fram (nätverksfel). Tiden styrs med Playwrights klocka: webbläsarens timers hoppar framåt i stället för att
 * provet väntar ut gränsen på riktigt, och skicket får därmed samma gräns som i produktion (ingen testkonfiguration i appen). Gränsen är 15 s i appen; hoppet är längre.
 */
const JUMP_PAST_TIME_LIMIT_MS = 16_000;
const UNCONFIRMED_TEXT = /couldn.t confirm that your challenge was sent/i;
const UNREACHABLE_TEXT = /couldn.t reach RunQuest/i;

test.describe('the send-a-challenge sheet: a send without an answer or without a connection', () => {
  test.skip(!apiIsStubbed(), 'The sheet is filled from a stubbed challenges API; run with E2E_STUB_API=1 against a local build.');

  const sheetOf = (page: Page): Locator => page.getByRole('dialog', { name: 'Send a challenge' });
  const focusNow = (page: Page) => page.evaluate(() => ({ text: document.activeElement?.textContent ?? '', inside: !!document.activeElement?.closest('.rq-duels-sheet') }));

  /** Öppnar arket från minor-kortet "Most runs", väljer Anna och trycker Send. Klockan installeras före sidan så att skickets timer går att flytta. */
  async function sendFromTheSheet(page: Page, options: Omit<SendSheetStubOptions, 'members'>): Promise<Locator> {
    await page.clock.install();
    await stubSendSheetApi(page, { members: 7, ...options });
    await page.setViewportSize({ width: 1280, height: 768 });
    await page.goto('/duels');
    await dismissOverlays(page);
    await page.getByRole('region', { name: 'Your tokens' }).getByRole('button', { name: /^Send a minor challenge: Most runs/ }).click();
    const sheet = sheetOf(page);
    await sheet.getByRole('radiogroup', { name: '3 · Pick an opponent' }).getByRole('radio', { name: /Anna Lindqvist/ }).click();
    await sheet.getByRole('button', { name: 'Send challenge' }).click();
    return sheet;
  }

  test('a send that never gets an answer: after the time limit Send, Cancel and the close button are on again, with the focus on Send and an honest text', async ({ page }) => {
    const sheet = await sendFromTheSheet(page, { holdSend: new Promise<void>(() => {}) });
    await expect(sheet.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    await expect(sheet.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await expect(sheet.getByRole('button', { name: 'Close' })).toBeDisabled();

    await page.clock.fastForward(JUMP_PAST_TIME_LIMIT_MS);

    const send = sheet.getByRole('button', { name: 'Send challenge' });
    await expect(send).toBeEnabled();
    await expect(sheet.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    await expect(sheet.getByRole('button', { name: 'Close' })).toBeEnabled();
    await expect(send).toBeFocused();
    await expect(sheet.getByRole('alert')).toHaveText(UNCONFIRMED_TEXT);
    await expect(page.locator('.rq-duels-notice')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  });

  test('a send that reached the server but never got an answer shows up as sent after the time limit, and the token is gone', async ({ page }) => {
    const sheet = await sendFromTheSheet(page, { holdSend: new Promise<void>(() => {}), serverCreates: true });
    await expect(sheet.getByRole('button', { name: 'Sending…' })).toBeDisabled();

    await page.clock.fastForward(JUMP_PAST_TIME_LIMIT_MS);

    await expect(sheet.getByRole('alert')).toHaveText(UNCONFIRMED_TEXT);
    await expect(sheet.getByRole('button', { name: 'Close' })).toBeEnabled();
    // Omhämtningen visar att utmaningen finns: arket säger att den väntar på svar, och fokus har inte tappats till <body> när Send försvann.
    await expect(sheet.getByRole('status')).toContainText('is waiting for an answer');
    expect(await focusNow(page), 'the focus stays in the sheet').toMatchObject({ inside: true });

    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByText('Waiting for Anna to respond')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Your tokens' }).getByRole('button', { name: /^Send a minor challenge: Most runs/ })).toHaveCount(0);
  });

  test('a network error shows a human text, not "Failed to fetch", and gives the sheet back', async ({ page }) => {
    const sheet = await sendFromTheSheet(page, { abortSend: true });

    await expect(sheet.getByRole('alert')).toHaveText(UNREACHABLE_TEXT);
    await expect(sheet.getByRole('alert')).not.toContainText('Failed to fetch');
    const send = sheet.getByRole('button', { name: 'Send challenge' });
    await expect(send).toBeEnabled();
    await expect(send).toBeFocused();
    await expect(sheet.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  test('an answer that comes after the time limit gives no confirmation and no second send', async ({ page }) => {
    let answer: () => void = () => {};
    const sendLog: string[] = [];
    const sheet = await sendFromTheSheet(page, { holdSend: new Promise<void>((resolve) => { answer = resolve; }), sendLog });
    await page.clock.fastForward(JUMP_PAST_TIME_LIMIT_MS);
    await expect(sheet.getByRole('alert')).toHaveText(UNCONFIRMED_TEXT);

    answer();
    // Webbläsaren har redan avbrutit anropet: den sena 201:an når aldrig sidan. En stund av klockan räcker för att ett eventuellt svar skulle hinna ge sin bekräftelse.
    await page.clock.runFor(2_000);

    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('alert')).toHaveText(UNCONFIRMED_TEXT);
    await expect(page.locator('.rq-duels-notice')).toHaveCount(0);
    expect(sendLog, 'one POST reached the server').toHaveLength(1);
  });
});
