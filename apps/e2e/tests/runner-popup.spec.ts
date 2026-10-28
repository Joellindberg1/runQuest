import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';
import { waitForStylesApplied } from '../support/stylesApplied';
import { targets } from '../support/targets';

/** Några pixlar marginal för subpixelavrundning i mätningarna. */
const TOLERANCE_PX = 1;

/** Popupens bredd: `--rq-modal-w` (index.css), som krymper till 95 % av fönstret. */
const MODAL_WIDTH_PX = 860;

const RUNNER = { id: 'popup-2', name: 'Bo Two' };

function runner(id: string, name: string, totalXp: number) {
  return { id, name, email: `${id}@example.test`, is_admin: false, total_xp: totalXp, current_level: 4, total_km: 40, current_streak: 3, longest_streak: 5, runs: [] };
}

// Podiet tar plats 1-3. Stub-kontot (inloggad) ligger sist: popupen öppnas för en annan löpare, och en egen profil har ingen popup.
const GROUP = [runner('popup-1', 'Ada One', 3000), runner(RUNNER.id, RUNNER.name, 2800), runner('popup-3', 'Cy Three', 2600), runner('popup-4', 'Di Four', 2400)];

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

const apiPath = (path: string) => new RegExp(`^${targets.apiUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/api)?${path}`);

// Svaren sätts i webbläsaren och ersätter svaret från det riktiga eller fejkade API:et (sidans rutt går före kontextens), så proven gäller lika mot staging och mot stubben, och ingen
// förfrågan om gruppen når ett riktigt API.
async function answerWith(page: Page, path: string, body: unknown): Promise<void> {
  await page.route(apiPath(path), (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS_HEADERS })
      : route.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

const holder = (index: number) => ({
  title_id: `popup-title-${index}`,
  title_name: `The Title Number ${index}`,
  title_description: '',
  position: 1,
  value: index,
  earned_at: '2026-10-01T00:00:00.000Z',
  is_current_holder: true,
  status: 'holder',
});

/** Gruppen, och löparens titlar (så många som provet ber om): innehållet i popupen blir högre ju fler. */
async function stubGroup(page: Page, titles: number): Promise<void> {
  await answerWith(page, '/auth/users-with-runs', { success: true, data: GROUP });
  await answerWith(page, '/titles/user/', {
    success: true,
    data: Array.from({ length: titles }, (_, index) => holder(index + 1)),
    meta: { user_id: RUNNER.id, total_titles: titles, current_holder_count: titles, timestamp: '2026-10-19T00:00:00.000Z' },
  });
  await answerWith(page, '/titles/leaderboard', {
    success: true,
    data: Array.from({ length: titles }, (_, index) => ({
      id: `popup-title-${index + 1}`, name: `The Title Number ${index + 1}`, description: '', unlock_requirement: 0, metric_key: 'runs',
      holder: { user_id: RUNNER.id, user_name: RUNNER.name, value: index + 1, earned_at: '' }, runners_up: [],
    })),
    meta: {},
  });
  await answerWith(page, '/challenges/head-to-head/', {
    success: true,
    data: { opponent: { id: RUNNER.id, name: RUNNER.name, profile_picture: null }, record: { wins: 1, draws: 0, losses: 1, total: 2 }, history: [], active: null },
  });
  await answerWith(page, '/badges/user/', { success: true, data: { items: [], showcase: [] } });
}

async function openBoard(page: Page, width: number, height: number, titles = 3): Promise<void> {
  await stubGroup(page, titles);
  await page.setViewportSize({ width, height });
  await page.goto('/board');
  await dismissOverlays(page);
  await expect(runnerRow(page)).toBeVisible();
  await waitForStylesApplied(page);
}

/** Raden som öppnar löparen: det första synliga elementet med löparens id, som fokus ska tillbaka till. */
const runnerRow = (page: Page): Locator => page.locator(`[data-runner-id="${RUNNER.id}"]:visible`).first();
const popup = (page: Page): Locator => page.getByRole('dialog', { name: `Runner card: ${RUNNER.name}` });

async function openPopup(page: Page): Promise<Locator> {
  await runnerRow(page).click();
  const dialog = popup(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('region', { name: "Frodo's journey" })).toBeVisible();
  await waitForStylesApplied(page);
  return dialog;
}

/**
 * Sidan bakom popupen går inte att scrolla: skrollåset (Radix) är på, och hjulrörelser över både skrimman och dialogen (även efter att innehållet nått sitt slut) flyttar inte sidan.
 * Brädet bakom är högre än fönstret, så `scrollHeight` säger inget om saken; det som räknas är att sidan står still.
 */
async function expectPageLocked(page: Page, dialog: Locator): Promise<void> {
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow), 'the page behind is scroll-locked').toBe('hidden');
  const box = (await dialog.boundingBox())!;
  await page.mouse.move(4, 4);
  await page.mouse.wheel(0, 800);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 3000);
  await page.mouse.wheel(0, 3000);
  const scrolled = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  expect(scrolled.y, 'the page did not scroll down').toBe(0);
  expect(scrolled.x, 'the page did not scroll sideways').toBe(0);
}

const activeIsRunnerRow = (page: Page) =>
  page.evaluate((id) => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>(`[data-runner-id="${id}"]`)).filter((row) => row.getClientRects().length > 0);
    return document.activeElement === rows[0];
  }, RUNNER.id);

test.describe('the profile popup on desktop', () => {
  test('focus moves to the heading, and Tab and Shift+Tab stay inside the dialog', async ({ page }) => {
    await openBoard(page, 1280, 900);
    const dialog = await openPopup(page);

    const heading = dialog.getByRole('heading', { level: 2, name: `Runner card: ${RUNNER.name}` });
    await expect(heading).toBeFocused();

    const inside = () => dialog.evaluate((element) => element.contains(document.activeElement));
    for (let press = 1; press <= 40; press += 1) {
      await page.keyboard.press('Tab');
      expect(await inside(), `Tab ${press} stays inside the dialog`).toBe(true);
    }
    for (let press = 1; press <= 40; press += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await inside(), `Shift+Tab ${press} stays inside the dialog`).toBe(true);
    }
  });

  test('the dialog is a modal named by its heading, with no description', async ({ page }) => {
    await openBoard(page, 1280, 900);
    const dialog = await openPopup(page);

    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).not.toHaveAttribute('aria-describedby');
    // Chrome sätter ihop namnet ur rubriken: ett mellanrum före kolonet ("Runner card : Bo Two") vore ett fel i den dolda texten.
    await expect(page.getByRole('dialog', { name: 'Runner card: Bo Two', exact: true })).toBeVisible();
  });

  for (const [label, close] of [
    ['Escape', (page: Page) => page.keyboard.press('Escape')],
    ['the close button', (page: Page) => popup(page).getByRole('button', { name: 'Close' }).click()],
    ['a click on the scrim', (page: Page) => page.mouse.click(8, 8)],
  ] as const) {
    test(`closing with ${label} returns focus to the runner row, also when the row had no focus at the click`, async ({ page }) => {
      await openBoard(page, 1280, 900);
      // Ett musklick ger inte alltid raden fokus (Safari, Firefox på Mac): rensa det, så provet gäller fallet där Radix standard inte räcker.
      await openPopup(page);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

      await close(page);
      await expect(popup(page)).toBeHidden();
      await expect.poll(() => activeIsRunnerRow(page), { message: 'the runner row has focus' }).toBe(true);
    });
  }

  test('the width is --rq-modal-w, 860 px, on 1024 and 1280 px screens', async ({ page }) => {
    for (const width of [1024, 1280]) {
      await openBoard(page, width, 900);
      const dialog = await openPopup(page);
      const box = await dialog.boundingBox();
      expect(box?.width, `the dialog on a ${width} px screen`).toBeCloseTo(MODAL_WIDTH_PX, 0);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }
  });

  for (const height of [900, 768]) {
    test(`the page does not scroll and the dialog fits the window on a ${height} px tall screen`, async ({ page }) => {
      await openBoard(page, 1280, height);
      const dialog = await openPopup(page);

      await expectPageLocked(page, dialog);
      const box = (await dialog.boundingBox())!;
      expect(box.y, 'the dialog starts inside the window').toBeGreaterThanOrEqual(-TOLERANCE_PX);
      expect(box.y + box.height, 'the dialog ends inside the window').toBeLessThanOrEqual(height + TOLERANCE_PX);
    });
  }

  for (const height of [768, 256]) {
    test(`with 15 titles the content scrolls inside the dialog on a ${height} px tall screen, and the heading row stays`, async ({ page }) => {
      await openBoard(page, 1024, height, 15);
      const dialog = await openPopup(page);

      const content = dialog.locator('.rq-runner-popup__content');
      const bar = dialog.locator('.rq-runner-popup__bar');
      const before = (await bar.boundingBox())!;
      const scrolls = await content.evaluate((element) => ({ scroll: element.scrollHeight, client: element.clientHeight }));
      expect(scrolls.scroll, 'the content is taller than its scroll area').toBeGreaterThan(scrolls.client);

      await content.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      const after = (await bar.boundingBox())!;
      expect(after.y, 'the heading row did not scroll away').toBeCloseTo(before.y, 0);
      expect(await content.evaluate((element) => element.scrollTop), 'the content scrolled').toBeGreaterThan(0);

      const box = (await dialog.boundingBox())!;
      expect(box.y, 'the dialog starts inside the window').toBeGreaterThanOrEqual(-TOLERANCE_PX);
      expect(box.y + box.height, 'the dialog is never taller than the window').toBeLessThanOrEqual(height + TOLERANCE_PX);
      await expectPageLocked(page, dialog);
    });
  }

  test('the focus ring of a stat tab is drawn inside the tab, so the scroll area does not clip it', async ({ page }) => {
    await openBoard(page, 1280, 900);
    const dialog = await openPopup(page);
    const tabs = dialog.getByRole('tablist', { name: 'Runner stats' }).getByRole('tab');

    await tabs.first().focus();
    await page.keyboard.press('ArrowRight');
    const measured = await tabs.nth(1).evaluate((tab) => {
      const style = getComputedStyle(tab);
      const box = tab.getBoundingClientRect();
      const offset = parseFloat(style.outlineOffset);
      const width = parseFloat(style.outlineWidth);
      // Ringens yttre kant ligger (offset + bredd) utanför flikens kant; med en inåtriktad ring (negativ offset) ligger den vid eller innanför kanten.
      const reach = offset + width;
      return { focusVisible: tab.matches(':focus-visible'), ringTop: box.top - reach, ringBottom: box.bottom + reach, boxTop: box.top, boxBottom: box.bottom };
    });
    expect(measured.focusVisible, 'the tab has a keyboard focus ring').toBe(true);
    expect(measured.ringTop, 'the ring starts at or below the tab top').toBeGreaterThanOrEqual(measured.boxTop - TOLERANCE_PX);
    expect(measured.ringBottom, 'the ring ends at or above the tab bottom').toBeLessThanOrEqual(measured.boxBottom + TOLERANCE_PX);
  });
});

test.describe('the runner card as a page', () => {
  test('a direct load of /runner/:id renders the page, not the popup, on a 1280 px screen', async ({ page }) => {
    await stubGroup(page, 3);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/runner/${RUNNER.id}`);
    await dismissOverlays(page);

    await expect(page.getByRole('heading', { level: 1, name: RUNNER.name })).toBeVisible();
    await expect(page.getByRole('button', { name: /Back/ })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('on a 390 px phone the row opens the page, not a popup', async ({ page }) => {
    await openBoard(page, 390, 800);
    await runnerRow(page).click();

    await expect(page.getByRole('heading', { level: 1, name: RUNNER.name })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/runner/${RUNNER.id}$`));
  });
});
