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

// ─── Skick som styrs av provet (specerna send-back-during-send och send-back-focus) ───

/** Hur långt klockan hoppar för att passera tidsgränsen (15 s i appen). */
export const JUMP_PAST_TIME_LIMIT_MS = 16_000;
export const UNCONFIRMED_TEXT = /couldn.t confirm that your challenge was sent/i;
export const REFUSED_TEXT = 'Opponent already has a pending challenge';
export const BACK_TO_BOARD = /\/board$/;

export interface SendControl {
  /** Ett element per POST /challenges/send som nådde "servern". */
  sends: string[];
  /** Antal gånger "mina utmaningar" har hämtats. */
  myFetches: () => number;
  /** Släpper svaret på skicken som hålls (201, eller 400 med `refuse`). */
  answer: () => void;
}

/** Utmaningen "servern" skapar: en väntande utmaning från mig till motståndaren. */
const createdChallenge = (opponent: { id: string; name: string }) => ({
  id: 'challenge-new', group_id: 'g1', token_id: 'token-minor-km', tier: 'minor', challenger_id: 'stub-user-1', challenger_name: 'Stub Runner', opponent_id: opponent.id, opponent_name: opponent.name,
  metric: 'km', duration_days: 7, winner_delta: 0.15, winner_duration: 5, winner_type: 'multiplier_days', loser_delta: -0.07, loser_duration: 5, loser_type: 'multiplier_days',
  challenger_level: 10, opponent_level: 11, status: 'pending', created_at: '2026-10-31T08:00:00Z',
});

export interface ControlSendOptions {
  /** Utmaningen skapas när skicket når "servern", och "mina utmaningar" visar den därefter (tokenet borta). */
  serverCreates: boolean;
  /** Svaret kommer aldrig (tidsgränsen avgör). */
  neverAnswer: boolean;
  /** Svaret som släpps är ett avslag (400, "Opponent already has a pending challenge") i stället för 201. */
  refuse?: boolean;
}

/**
 * Lägger över skicket: svaret hålls tills `answer()` anropas (eller för alltid). Med `serverCreates` skapas utmaningen när skicket når "servern", och "mina utmaningar" visar den därefter (tokenet borta).
 * Registreras efter `open` och går därför före grundstubbens rutter.
 */
export async function controlSend(page: Page, opponent: { id: string; name: string }, { serverCreates, neverAnswer, refuse = false }: ControlSendOptions): Promise<SendControl> {
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
    const reply = refuse
      ? route.fulfill({ status: 400, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify({ success: false, error: REFUSED_TEXT }) })
      : route.fulfill({ status: 201, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify({ success: true, data: { challenge_id: 'challenge-new' } }) });
    return reply.catch(() => {});
  });
  return { sends, myFetches: () => myFetches, answer: release };
}

/** Tiden appen får på sig att reagera på ett svar (omhämtningen och det som följer på den) innan provet tittar: en vilopaus i verklig tid, inte på den fejkade klockan. */
const REACTION_TIME_MS = 1_000;

/** Släpper svaret och väntar tills sidan har fått det och appen hunnit reagera. */
export async function answerAndSettle(page: Page, control: SendControl): Promise<void> {
  const received = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/challenges/send'));
  control.answer();
  await received;
  await page.clock.runFor(REACTION_TIME_MS);
  await page.waitForTimeout(REACTION_TIME_MS);
}

/** Allt som en dialog lämnar efter sig på sidan när den stängs: skrollås, `aria-hidden` och `inert` på appen, och en body som inte tar emot tryck. */
export const lockLeftOnPage = (page: Page) =>
  page.evaluate(() => ({
    scrollLocked: document.body.hasAttribute('data-scroll-locked'),
    bodyPointerEvents: document.body.style.pointerEvents,
    inert: document.querySelectorAll('[inert]').length,
    hiddenBodyChildren: Array.from(document.body.children).filter((child) => child.getAttribute('aria-hidden') === 'true').length,
    openDialogs: document.querySelectorAll('[role="dialog"]').length,
  }));
export const NO_LOCK = { scrollLocked: false, bodyPointerEvents: '', inert: 0, hiddenBodyChildren: 0, openDialogs: 0 };

export const focusIsOnBody = (page: Page) => page.evaluate(() => document.activeElement === document.body || document.activeElement === null);

/** Fel som sidan själv kastar (okontrollerade undantag): Back under ett skick ska inte ge något. */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

export const goToDuelsInApp = async (page: Page) => {
  await page.getByRole('navigation').getByRole('link', { name: 'Challenges' }).first().click();
  await expect(page).toHaveURL(/\/duels/);
};
export const sentSectionTextFor = (member: { name: string }) => new RegExp(`Waiting for ${member.name.split(' ')[0]} to respond`);

/** Öppnar löparens popup från raden och följer Challenge in i send-arket. */
export async function openSendFromPopup(page: Page): Promise<void> {
  await runnerRow(page).click();
  const dialog = popup(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('link', { name: 'Challenge' }).click();
  await expect(sheet(page)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/duels\\?send=1&opponent=${RUNNER.id}`));
}
