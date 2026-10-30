import type { Page } from '@playwright/test';
import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';
import { contrastOf } from '../support/contrast';
import { waitForStylesApplied } from '../support/stylesApplied';
import { targets } from '../support/targets';

/** Minsta tryckyta på mobil (`--rq-control-hit`), med någon pixel marginal för subpixelavrundning. */
const MIN_HIT_PX = 44;
const TOLERANCE_PX = 1;
/** WCAG AA för text. */
const MIN_TEXT_CONTRAST = 4.5;

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

const RUNNER = { id: 'back-2', name: 'Bo Two' };

function runner(id: string, name: string, totalXp: number) {
  return { id, name, email: `${id}@example.test`, is_admin: false, total_xp: totalXp, current_level: 4, total_km: 40, current_streak: 3, longest_streak: 5, runs: [], wins: 1, losses: 1 };
}
const GROUP = [runner('back-1', 'Ada One', 3000), runner(RUNNER.id, RUNNER.name, 2800), runner('back-3', 'Cy Three', 2600), runner('back-4', 'Di Four', 2400)];

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};
const apiPath = (path: string) => new RegExp(`^${targets.apiUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/api)?${path}`);

// Svaren sätts i webbläsaren och går före det riktiga eller fejkade API:et, så proven gäller lika mot staging och mot stubben och ingen förfrågan om gruppen når ett riktigt API.
async function answerWith(page: Page, path: string, body: unknown): Promise<void> {
  await page.route(apiPath(path), (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS_HEADERS })
      : route.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

async function stubGroup(page: Page): Promise<void> {
  await answerWith(page, '/auth/users-with-runs', { success: true, data: GROUP });
  await answerWith(page, '/titles/user/', { success: true, data: [], meta: { user_id: RUNNER.id, total_titles: 0, current_holder_count: 0, timestamp: '2026-10-19T00:00:00.000Z' } });
  await answerWith(page, '/titles/leaderboard', { success: true, data: [], meta: {} });
  await answerWith(page, '/challenges/head-to-head/', {
    success: true,
    data: { opponent: { id: RUNNER.id, name: RUNNER.name, profile_picture: null }, record: { wins: 1, draws: 0, losses: 1, total: 2 }, history: [], active: null },
  });
  await answerWith(page, '/badges/user/', { success: true, data: { items: [], showcase: [] } });
}

interface OpenOptions {
  size: { width: number; height: number };
  /** Temat sätts som next-themes gör: `localStorage.theme` före sidans skript. */
  theme?: 'dark' | 'light';
}

async function prepare(page: Page, { size, theme }: OpenOptions): Promise<void> {
  await stubGroup(page);
  if (theme) await page.addInitScript((value) => window.localStorage.setItem('theme', value), theme);
  await page.setViewportSize(size);
}

/** Mobil: Board, sedan löparens rad: Runner card nås genom klientnavigering med Board som föregående post i historiken. */
async function openFromBoard(page: Page, options: OpenOptions): Promise<void> {
  await prepare(page, options);
  await page.goto('/board');
  await dismissOverlays(page);
  await page.locator(`[data-runner-id="${RUNNER.id}"]:visible`).first().click();
  await expect(page.getByRole('heading', { level: 1, name: RUNNER.name })).toBeVisible();
  await waitForStylesApplied(page);
}

/** Direktladdning: ingen historik före kortet, och på desktop visas sidan i stället för popupen. */
async function openDirect(page: Page, options: OpenOptions): Promise<void> {
  await prepare(page, options);
  await page.goto(`/runner/${RUNNER.id}`);
  await dismissOverlays(page);
  await expect(page.getByRole('heading', { level: 1, name: RUNNER.name })).toBeVisible();
  await waitForStylesApplied(page);
}

const backLink = (page: Page) => page.getByRole('link', { name: 'Standings' });
const heading = (page: Page) => page.getByRole('heading', { level: 1, name: RUNNER.name });

for (const [label, size] of [['390 px (mobile)', MOBILE], ['1280 px (direct load on desktop)', DESKTOP]] as const) {
  test.describe(`the Runner card page at ${label}`, () => {
    test('the back control is a link named Standings to the board, and the arrow is hidden from assistive technology', async ({ page }) => {
      await openDirect(page, { size });

      const link = backLink(page);
      await expect(link).toHaveAttribute('href', '/board');
      await expect(link).toHaveText('← Standings');
      expect(await link.locator('[aria-hidden="true"]').textContent()).toBe('←');
      await expect(page.getByRole('button', { name: /Standings|Back/ })).toHaveCount(0);
    });

    test('focus is on the heading on a direct load', async ({ page }) => {
      await openDirect(page, { size });

      await expect(heading(page)).toBeFocused();
      await expect(heading(page)).toHaveAttribute('tabindex', '-1');
    });

    test('a direct load has no history to step back into, so the back control goes to the board', async ({ page }) => {
      await openDirect(page, { size });

      await backLink(page).click();
      await expect(page).toHaveURL(/\/board$/);
    });

    test('Ctrl-click and middle-click open the board in a new tab and leave the card where it is', async ({ page, context }) => {
      await openDirect(page, { size });

      for (const click of [{ modifiers: ['Control' as const] }, { button: 'middle' as const }]) {
        const opened = context.waitForEvent('page');
        await backLink(page).click(click);
        const tab = await opened;
        await tab.waitForLoadState('domcontentloaded');
        expect(new URL(tab.url()).pathname).toBe('/board');
        await tab.close();
        expect(new URL(page.url()).pathname).toBe(`/runner/${RUNNER.id}`);
      }
    });
  });
}

test.describe('the Runner card page opened from the board on a phone', () => {
  test('focus is on the heading, and a plain click on the back control goes one step back to the board', async ({ page }) => {
    await openFromBoard(page, { size: MOBILE });
    await expect(heading(page)).toBeFocused();

    await backLink(page).click();
    await expect(page).toHaveURL(/\/board$/);
    await expect(heading(page)).toHaveCount(0);
    // Ett steg bakåt i historiken lämnar kortet kvar som posten framåt; en ny navigering till /board hade skrivit över den.
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`/runner/${RUNNER.id}$`));
  });
});

test.describe('the back control on a phone', () => {
  test(`the touch target is at least ${MIN_HIT_PX} px tall`, async ({ page }) => {
    await openDirect(page, { size: MOBILE });

    const box = (await backLink(page).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(MIN_HIT_PX - TOLERANCE_PX);
    expect(box.width).toBeGreaterThanOrEqual(MIN_HIT_PX - TOLERANCE_PX);
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`the text is at least ${MIN_TEXT_CONTRAST}:1 in the ${theme} theme, and the focus ring is drawn`, async ({ page }) => {
      await openDirect(page, { size: MOBILE, theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      const samples = await page.evaluate(contrastOf, { selectors: ['.rq-runner__bar .rq-back'] });
      expect(samples.length).toBeGreaterThan(0);
      for (const sample of samples) expect(sample.ratio, `${sample.selector} "${sample.text}"`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);

      // Fokus börjar på rubriken; bakåt i tabbordningen kommer först Challenge och sedan tillbakalänken (överst i toppraden). Tangentbordsfokus ritar ringen.
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Shift+Tab');
      await expect(backLink(page)).toBeFocused();
      const outline = await backLink(page).evaluate((element) => {
        const style = getComputedStyle(element);
        return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
      });
      expect(outline.style).toBe('solid');
      expect(outline.width).toBeGreaterThanOrEqual(2);
    });
  }
});
