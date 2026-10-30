import type { Locator, Page, Route } from '@playwright/test';
import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';
import { stubRunnerChallenge } from '../support/runnerChallengeStub';
import { waitForStylesApplied } from '../support/stylesApplied';
import { targets } from '../support/targets';

/**
 * Avbryt i send-flödet som löparens popup öppnade, och fokus tillbaka till löparens rad (ADR 006 punkt 5). Gruppen, utmaningarna och skicket läggs över API:et i webbläsaren, så provet
 * gäller lika mot staging och stubben. Historiken mäts med `history.length` och `history.state.idx` (react-routers egen post-räknare).
 */

const RUNNER = { id: 'cancel-12', name: 'Mo Twelve' };
const OTHER_MEMBER = { id: 'cancel-3', name: 'Cy Three' };
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};
const apiPath = (path: string) => new RegExp(`^${targets.apiUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/api)?${path}`);

const daysAgo = (days: number) => {
  const day = new Date();
  day.setDate(day.getDate() - days);
  return day.toISOString().slice(0, 10);
};
const runsFor = (userId: string) =>
  [1, 2, 3].map((days) => ({ id: `${userId}-run-${days}`, user_id: userId, date: daysAgo(days), distance: 5, xp_gained: 60, multiplier: 1, streak_day: 1, base_xp: 15, km_xp: 10, distance_bonus: 5, streak_bonus: 0, is_treadmill: false }));

// Sexton löpare: podiet och en lång rest-lista, så att Board scrollar och löparens rad ligger långt ned. Stub-kontot (inloggad) är inte med; popupen öppnas för en annan löpare.
const GROUP = Array.from({ length: 16 }, (_value, index) => {
  const id = index === 11 ? RUNNER.id : index === 2 ? OTHER_MEMBER.id : `cancel-${index + 1}`;
  const name = index === 11 ? RUNNER.name : index === 2 ? OTHER_MEMBER.name : `Runner Number ${index + 1}`;
  return { id, name, email: `${id}@example.test`, is_admin: false, total_xp: 5000 - index * 100, current_level: 4, total_km: 80 - index, current_streak: 2, longest_streak: 4, runs: runsFor(id) };
});

async function answerWith(page: Page, path: string, body: unknown): Promise<void> {
  await page.route(apiPath(path), (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS_HEADERS })
      : route.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

async function stubGroup(page: Page): Promise<void> {
  await stubRunnerChallenge(page, { scenario: 'ready', runner: RUNNER, other: OTHER_MEMBER });
  await answerWith(page, '/auth/users-with-runs', { success: true, data: GROUP });
  await answerWith(page, '/titles/user/', { success: true, data: [], meta: { user_id: RUNNER.id, total_titles: 0, current_holder_count: 0, timestamp: '2026-10-19T00:00:00.000Z' } });
  await answerWith(page, '/titles/leaderboard', { success: true, data: [], meta: {} });
  await answerWith(page, '/challenges/head-to-head/', {
    success: true,
    data: { opponent: { id: RUNNER.id, name: RUNNER.name, profile_picture: null }, record: { wins: 0, draws: 0, losses: 0, total: 0 }, history: [], active: null },
  });
  await answerWith(page, '/badges/user/', { success: true, data: { items: [], showcase: [] } });
  // Gruppens rundlista (Log, ?view=group): en runda per löpare, så att varje löpare har en rad med `data-runner-id` även där.
  const groupRuns = GROUP.map((member, index) => ({
    id: `group-run-${index}`, user_id: member.id, date: daysAgo(1), distance: 6, xp_gained: 60, multiplier: 1, streak_day: 1, base_xp: 15, km_xp: 10, distance_bonus: 5, streak_bonus: 0,
    source: 'manual', is_treadmill: false, weather_code: null, temperature_c: null, user_name: member.name, user_level: 4, user_total_xp: member.total_xp, start_time: null, created_at: `${daysAgo(1)}T07:00:00Z`, moving_time: null,
  }));
  await page.route(
    (url) => url.href.startsWith(`${targets.apiUrl}/`) && url.pathname.endsWith('/runs/group-history'),
    (route) =>
      route.request().method() === 'OPTIONS'
        ? route.fulfill({ status: 204, headers: CORS_HEADERS })
        : route.fulfill({
            status: 200,
            headers: CORS_HEADERS,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, runs: groupRuns, data: { runs: groupRuns }, meta: { total: groupRuns.length, limit: 50, offset: 0, has_more: false } }),
          }),
  );
  await answerWith(page, '/challenges/send', { success: true, data: { challenge_id: 'challenge-new' } });
}

const runnerRow = (page: Page): Locator => page.locator(`main [data-runner-id="${RUNNER.id}"]:visible`).first();
const popup = (page: Page): Locator => page.getByRole('dialog', { name: `Runner card: ${RUNNER.name}` });
const sheet = (page: Page): Locator => page.getByRole('dialog', { name: 'Send a challenge' });

async function open(page: Page, path: string, size: { width: number; height: number }, { expectRow = true }: { expectRow?: boolean } = {}): Promise<void> {
  await stubGroup(page);
  await page.setViewportSize(size);
  await page.goto(path);
  await dismissOverlays(page);
  if (expectRow) await expect(runnerRow(page)).toBeAttached();
  await waitForStylesApplied(page);
}

const historyOf = (page: Page) => page.evaluate(() => ({ length: window.history.length, idx: (window.history.state as { idx?: number } | null)?.idx ?? null }));

const runnerRowHasFocus = (page: Page) =>
  page.evaluate((id) => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>(`main [data-runner-id="${id}"]`)).filter((row) => row.getClientRects().length > 0);
    return rows.length > 0 && document.activeElement === rows[0];
  }, RUNNER.id);

/** Ligger elementet helt i bild? Lägre än sidans sticky övre kant räknas inte här: kanten mäts separat där den finns. */
const isInViewport = async (page: Page, locator: Locator): Promise<boolean> => {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  return !!box && !!viewport && box.y >= 0 && box.y + box.height <= viewport.height && box.x >= 0 && box.x + box.width <= viewport.width;
};

/** Öppnar löparens popup från raden och följer Challenge in i send-arket. */
async function openSendFromPopup(page: Page): Promise<void> {
  await runnerRow(page).click();
  const dialog = popup(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('link', { name: 'Challenge' }).click();
  await expect(sheet(page)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/duels\\?send=1&opponent=${RUNNER.id}`));
}

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
