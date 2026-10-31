import type { Locator, Page } from '@playwright/test';
import { expect } from './test';
import { dismissOverlays } from './overlays';
import { stubRunnerChallenge } from './runnerChallengeStub';
import { waitForStylesApplied } from './stylesApplied';
import { targets } from './targets';

/**
 * Gemensamt för specerna som mäter send-flödet från löparens popup (`send-cancel-focus`, `send-back-during-send`): gruppen, utmaningarna och skicket läggs över API:et i webbläsaren,
 * så provet gäller lika mot staging och stubben. Historiken mäts med `history.length` och `history.state.idx` (react-routers egen post-räknare).
 */

export const RUNNER = { id: 'cancel-12', name: 'Mo Twelve' };
export const OTHER_MEMBER = { id: 'cancel-3', name: 'Cy Three' };
export const DESKTOP = { width: 1280, height: 800 };
export const PHONE = { width: 390, height: 844 };

export const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};
export const apiPath = (path: string) => new RegExp(`^${targets.apiUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/api)?${path}`);

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

export async function stubGroup(page: Page): Promise<void> {
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

export const runnerRow = (page: Page): Locator => page.locator(`main [data-runner-id="${RUNNER.id}"]:visible`).first();
export const popup = (page: Page): Locator => page.getByRole('dialog', { name: `Runner card: ${RUNNER.name}` });
export const sheet = (page: Page): Locator => page.getByRole('dialog', { name: 'Send a challenge' });

export async function open(page: Page, path: string, size: { width: number; height: number }, { expectRow = true }: { expectRow?: boolean } = {}): Promise<void> {
  await stubGroup(page);
  await page.setViewportSize(size);
  await page.goto(path);
  await dismissOverlays(page);
  if (expectRow) await expect(runnerRow(page)).toBeAttached();
  await waitForStylesApplied(page);
}

export const historyOf = (page: Page) => page.evaluate(() => ({ length: window.history.length, idx: (window.history.state as { idx?: number } | null)?.idx ?? null }));

export const runnerRowHasFocus = (page: Page) =>
  page.evaluate((id) => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>(`main [data-runner-id="${id}"]`)).filter((row) => row.getClientRects().length > 0);
    return rows.length > 0 && document.activeElement === rows[0];
  }, RUNNER.id);

/** Ligger elementet helt i bild? Lägre än sidans sticky övre kant räknas inte här: kanten mäts separat där den finns. */
export const isInViewport = async (page: Page, locator: Locator): Promise<boolean> => {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  return !!box && !!viewport && box.y >= 0 && box.y + box.height <= viewport.height && box.x >= 0 && box.x + box.width <= viewport.width;
};

/** Öppnar löparens popup från raden och följer Challenge in i send-arket. */
export async function openSendFromPopup(page: Page): Promise<void> {
  await runnerRow(page).click();
  const dialog = popup(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('link', { name: 'Challenge' }).click();
  await expect(sheet(page)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/duels\\?send=1&opponent=${RUNNER.id}`));
}
