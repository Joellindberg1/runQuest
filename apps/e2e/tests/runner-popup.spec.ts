import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';
import { contrastOf } from '../support/contrast';
import { waitForStylesApplied } from '../support/stylesApplied';
import { stubRunnerChallenge, type RunnerChallengeScenario } from '../support/runnerChallengeStub';
import { targets } from '../support/targets';

/** Några pixlar marginal för subpixelavrundning i mätningarna. */
const TOLERANCE_PX = 1;

/** Popupens bredd: `--rq-modal-w` (index.css), som krymper till 95 % av fönstret. */
const MODAL_WIDTH_PX = 860;

/** Dialogens höjd på 1440x900 och 1280x768 när innehållet ryms: bannern plus panelytans fasta höjd (`--rq-runner-popup-panel-h`). */
const DIALOG_HEIGHT_PX = 669;

/** Etiketter i bannern: minst 11 px och WCAG AA för text (4,5:1) i båda teman. */
const MIN_LABEL_PX = 11;
const MIN_LABEL_CONTRAST = 4.5;
/** Fokusringen är en grafisk komponent: minst 3:1 mot ytan (WCAG 1.4.11). */
const MIN_RING_CONTRAST = 3;

/** Panelytan scrollar för sig: en rullist tar upp till ca 20 px av bredden. */
const SCROLLBAR_ALLOWANCE_PX = 20;

const RUNNER = { id: 'popup-2', name: 'Bo Two' };
/** En annan medlem av gruppen: mottagaren av min skickade utmaning i Challenge-proven. */
const OTHER_MEMBER = { id: 'popup-3', name: 'Cy Three' };

/** Rundor med datum så många dagar bakåt som listan anger, så att de ligger i aktivitetskartans 12 månader oavsett när provet körs. */
function runsDaysAgo(userId: string, daysAgo: number[]) {
  return daysAgo.map((days) => {
    const day = new Date();
    day.setDate(day.getDate() - days);
    const date = day.toISOString().slice(0, 10);
    return { id: `${userId}-run-${days}`, user_id: userId, date, distance: 5 + (days % 4), xp_gained: 60, multiplier: 1, streak_day: 1, base_xp: 15, km_xp: 10, distance_bonus: 5, streak_bonus: 0, is_treadmill: false };
  });
}

function runner(id: string, name: string, totalXp: number, extra: Record<string, unknown> = {}) {
  return { id, name, email: `${id}@example.test`, is_admin: false, total_xp: totalXp, current_level: 4, total_km: 40, current_streak: 3, longest_streak: 5, runs: [], ...extra };
}

// Podiet tar plats 1-3. Stub-kontot (inloggad) ligger sist: popupen öppnas för en annan löpare, och en egen profil har ingen popup.
const RUNNER_RUN_DAYS_AGO = [1, 2, 3, 9, 16, 30, 45, 61, 90, 120, 200, 300];
const RUNNER_RECORD = { wins: 3, losses: 1 };
const GROUP = [
  runner('popup-1', 'Ada One', 3000),
  runner(RUNNER.id, RUNNER.name, 2800, { runs: runsDaysAgo(RUNNER.id, RUNNER_RUN_DAYS_AGO), ...RUNNER_RECORD }),
  runner('popup-3', 'Cy Three', 2600),
  runner('popup-4', 'Di Four', 2400),
];

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

/** Serierna i BADGE_SERIES (packages/shared/src/badges.ts): löparens badges i proven som vill ha en full samling (en post per serie). */
const BADGE_SERIES_KEYS = ['milestoner', 'earth_trotter', 'climber', 'streak_keeper', 'early_bird', 'night_owl', 'speedster', 'precisionist'];

/** Läget för Head to head-svaret: `record` = 1-0-1 (lika), `none` = inga dueller, `loading` = svaret kommer aldrig, `error` = servern felar, `win` = 2-0-1 till den inloggade. */
type HeadToHeadStub = 'record' | 'win' | 'none' | 'loading' | 'error';
const HEAD_TO_HEAD_RECORDS = { record: { wins: 1, draws: 0, losses: 1 }, win: { wins: 2, draws: 0, losses: 1 }, none: { wins: 0, draws: 0, losses: 0 } } as const;

/** Titlarnas mått (`metric_key`, cyklas över titlarna; avgör kategorin i typfiltret) och hur många runner-up-titlar löparen har (position 2, mått ur `RUNNER_UP_METRICS`). */
interface TitleStub {
  titleMetrics?: readonly string[];
  runnersUp?: number;
}
const RUNNER_UP_METRICS = ['longestStreak', 'fastestMarathon'] as const;
const runnerUp = (index: number) => ({
  title_id: `popup-runner-up-${index}`, title_name: `The Runner Up Number ${index}`, title_description: '', position: 2, value: 9, earned_at: '2026-10-01T00:00:00.000Z', is_current_holder: false, status: 'runner_up',
});

/** Gruppen, och löparens titlar (så många som provet ber om): innehållet i popupen blir högre ju fler. `badges` = antal serier löparen har intjänade (0-8). */
async function stubGroup(page: Page, titles: number, badges = 0, headToHead: HeadToHeadStub = 'record', challenge: RunnerChallengeScenario = 'ready', runnerKm?: number, { titleMetrics = ['runs'], runnersUp = 0 }: TitleStub = {}): Promise<void> {
  await stubRunnerChallenge(page, { scenario: challenge, runner: RUNNER, other: OTHER_MEMBER });
  await answerWith(page, '/auth/users-with-runs', { success: true, data: runnerKm === undefined ? GROUP : GROUP.map((member) => (member.id === RUNNER.id ? { ...member, total_km: runnerKm } : member)) });
  await answerWith(page, '/titles/user/', {
    success: true,
    data: [...Array.from({ length: titles }, (_, index) => holder(index + 1)), ...Array.from({ length: runnersUp }, (_, index) => runnerUp(index + 1))],
    meta: { user_id: RUNNER.id, total_titles: titles + runnersUp, current_holder_count: titles, timestamp: '2026-10-19T00:00:00.000Z' },
  });
  await answerWith(page, '/titles/leaderboard', {
    success: true,
    data: [
      ...Array.from({ length: titles }, (_, index) => ({
        id: `popup-title-${index + 1}`, name: `The Title Number ${index + 1}`, description: '', unlock_requirement: 0, metric_key: titleMetrics[index % titleMetrics.length],
        holder: { user_id: RUNNER.id, user_name: RUNNER.name, value: index + 1, earned_at: '' }, runners_up: [],
      })),
      ...Array.from({ length: runnersUp }, (_, index) => ({
        id: `popup-runner-up-${index + 1}`, name: `The Runner Up Number ${index + 1}`, description: '', unlock_requirement: 0, metric_key: RUNNER_UP_METRICS[index % RUNNER_UP_METRICS.length],
        holder: { user_id: OTHER_MEMBER.id, user_name: OTHER_MEMBER.name, value: 14, earned_at: '' }, runners_up: [],
      })),
    ],
    meta: {},
  });
  if (headToHead === 'loading') {
    await page.route(apiPath('/challenges/head-to-head/'), () => {});
  } else if (headToHead === 'error') {
    await page.route(apiPath('/challenges/head-to-head/'), (route) => route.fulfill({ status: 500, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'stubbed failure' }) }));
  } else {
    const { wins, draws, losses } = HEAD_TO_HEAD_RECORDS[headToHead];
    await answerWith(page, '/challenges/head-to-head/', {
      success: true,
      data: { opponent: { id: RUNNER.id, name: RUNNER.name, profile_picture: null }, record: { wins, draws, losses, total: wins + draws + losses }, history: [], active: null },
    });
  }
  const earned = BADGE_SERIES_KEYS.slice(0, badges);
  await answerWith(page, '/badges/user/', {
    success: true,
    data: { items: earned.map((series, index) => ({ series, tier: 1 + (index % 6), earned_at: '2026-10-01T12:00:00Z' })), showcase: earned.slice(0, 3) },
  });
}

interface OpenOptions {
  headToHead?: HeadToHeadStub;
  /** Vad kontot och löparen kan i Challenge-knappen; standard `ready` (länk). */
  challenge?: RunnerChallengeScenario;
  /** Temat sätts som next-themes gör: `localStorage.theme` före sidans skript, som ger `data-theme` på <html>. */
  theme?: 'dark' | 'light';
  /** Löparens totala km (Frodo's journey); standard 40. */
  runnerKm?: number;
  /** Titlarnas mått och antalet runner-up-titlar (se `TitleStub`). */
  titles?: TitleStub;
}

async function openBoard(page: Page, width: number, height: number, titles = 3, badges = 0, { headToHead = 'record', challenge = 'ready', theme, runnerKm, titles: titleStub }: OpenOptions = {}): Promise<void> {
  await stubGroup(page, titles, badges, headToHead, challenge, runnerKm, titleStub);
  if (theme) await page.addInitScript((value) => window.localStorage.setItem('theme', value), theme);
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
  await expect(dialog.getByRole('tablist', { name: 'Runner sections' })).toBeVisible();
  await waitForStylesApplied(page);
  return dialog;
}

const SECTIONS = ['Overview', 'The Journey', 'Titles held', 'Badges'] as const;
const sectionTab = (dialog: Locator, name: (typeof SECTIONS)[number]): Locator => dialog.getByRole('tablist', { name: 'Runner sections' }).getByRole('tab', { name });
const sectionPanel = (dialog: Locator): Locator => dialog.locator('.rq-runner-popup-panel');
const OVERVIEW_VIEWS = ['Activity', 'Distance', 'Streak', 'Fun facts'] as const;
const overviewButton = (dialog: Locator, name: (typeof OVERVIEW_VIEWS)[number]): Locator => dialog.getByRole('group', { name: 'Overview view', exact: true }).getByRole('button', { name });

/** Väntar tills flikens egen panel är ritad med sitt innehåll (inte laddaren), så att höjden mäts i det läge användaren ser. */
async function expectSectionLoaded(dialog: Locator, name: (typeof SECTIONS)[number]): Promise<void> {
  const panel = sectionPanel(dialog);
  // Head to head ligger i bannern (ovanför flikarna), inte i Overview-panelen: Overview är klar när statflikarna ritats och bannern har fått sitt svar (meningen).
  if (name === 'Overview') {
    await expect(panel.getByRole('group', { name: 'Overview view', exact: true })).toBeVisible();
    await expect(dialog.getByText(/^Head to head: /)).toBeAttached();
  }
  if (name === 'The Journey') await expect(panel.getByRole('region', { name: "Frodo's journey" })).toBeVisible();
  if (name === 'Titles held') await expect(panel.getByRole('list', { name: 'Titles held' })).toBeVisible();
  if (name === 'Badges') await expect(panel.getByRole('list', { name: 'Earned badges' })).toBeVisible();
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

  test('with 15 titles on a 768 px tall screen the list of titles scrolls on its own, and the heading row, the tabs and the panel stay', async ({ page }) => {
    await openBoard(page, 1024, 768, 15);
    const dialog = await openPopup(page);
    await sectionTab(dialog, 'Titles held').click();
    await expectSectionLoaded(dialog, 'Titles held');

    const panel = sectionPanel(dialog);
    const list = panel.getByRole('region', { name: 'Title list' });
    const bar = dialog.locator('.rq-runner-popup__bar');
    const tabs = dialog.getByRole('tablist', { name: 'Runner sections' });
    const before = { bar: (await bar.boundingBox())!, tabs: (await tabs.boundingBox())! };
    const panelSizes = await panel.evaluate((element) => ({ scroll: element.scrollHeight, client: element.clientHeight }));
    expect(panelSizes.scroll, 'the panel itself has nothing to scroll: the list inside it does').toBeLessThanOrEqual(panelSizes.client + TOLERANCE_PX);
    const scrolls = await list.evaluate((element) => ({ scroll: element.scrollHeight, client: element.clientHeight }));
    expect(scrolls.scroll, 'the 15 titles are taller than the list').toBeGreaterThan(scrolls.client);

    await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    expect(await list.evaluate((element) => element.scrollTop), 'the list scrolled').toBeGreaterThan(0);
    expect(await panel.evaluate((element) => element.scrollTop), 'the panel did not scroll').toBe(0);
    expect((await bar.boundingBox())!.y, 'the heading row did not scroll away').toBeCloseTo(before.bar.y, 0);
    expect((await tabs.boundingBox())!.y, 'the tabs did not scroll away').toBeCloseTo(before.tabs.y, 0);

    const box = (await dialog.boundingBox())!;
    expect(box.y, 'the dialog starts inside the window').toBeGreaterThanOrEqual(-TOLERANCE_PX);
    expect(box.y + box.height, 'the dialog ends inside the window').toBeLessThanOrEqual(768 + TOLERANCE_PX);
    await expectPageLocked(page, dialog);
  });

  test('with 15 titles on a 256 px tall screen the content scrolls inside the dialog, the heading row stays and the dialog is never taller than the window', async ({ page }) => {
    await openBoard(page, 1024, 256, 15);
    const dialog = await openPopup(page);
    await sectionTab(dialog, 'Titles held').click();
    await expectSectionLoaded(dialog, 'Titles held');

    const content = dialog.locator('.rq-runner-popup__content');
    const bar = dialog.locator('.rq-runner-popup__bar');
    const before = (await bar.boundingBox())!;
    const scrolls = await content.evaluate((element) => ({ scroll: element.scrollHeight, client: element.clientHeight }));
    expect(scrolls.scroll, 'the content is taller than its scroll area').toBeGreaterThan(scrolls.client);

    await content.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    expect((await bar.boundingBox())!.y, 'the heading row did not scroll away').toBeCloseTo(before.y, 0);
    expect(await content.evaluate((element) => element.scrollTop), 'the content scrolled').toBeGreaterThan(0);

    const box = (await dialog.boundingBox())!;
    expect(box.y, 'the dialog starts inside the window').toBeGreaterThanOrEqual(-TOLERANCE_PX);
    expect(box.y + box.height, 'the dialog is never taller than the window').toBeLessThanOrEqual(256 + TOLERANCE_PX);
    await expectPageLocked(page, dialog);
  });

  // Stabil höjd: panelytan har fast höjd, så dialogen är lika hög på alla fyra flikar, också med 15 titlar och en full badge-samling, och både medan en flik laddar och när den är klar.
  for (const [width, height] of [[1440, 900], [1280, 768]] as const) {
    test(`the dialog is equally tall on every tab, with 15 titles and many badges, on a ${width}x${height} screen`, async ({ page }, testInfo) => {
      await openBoard(page, width, height, 15, BADGE_SERIES_KEYS.length);
      const dialog = await openPopup(page);

      const heights: Record<string, number> = {};
      for (const name of SECTIONS) {
        await sectionTab(dialog, name).click();
        heights[`${name} (just selected)`] = (await dialog.boundingBox())!.height;
        await expectSectionLoaded(dialog, name);
        heights[`${name} (loaded)`] = (await dialog.boundingBox())!.height;
      }
      testInfo.annotations.push({ type: 'dialog heights', description: JSON.stringify(heights) });

      const values = Object.values(heights);
      expect(Math.max(...values) - Math.min(...values), `the dialog height varies: ${JSON.stringify(heights)}`).toBeLessThanOrEqual(TOLERANCE_PX);
      // Bannern är lägre än förut, och panelytan har växt lika mycket (`--rq-runner-popup-panel-h`): dialogen är kvar på sina 669 px.
      expect(Math.abs((values[0] ?? 0) - DIALOG_HEIGHT_PX), `the dialog height is ${DIALOG_HEIGHT_PX} px: ${JSON.stringify(heights)}`).toBeLessThanOrEqual(TOLERANCE_PX);
      const box = (await dialog.boundingBox())!;
      expect(box.y, 'the dialog starts inside the window').toBeGreaterThanOrEqual(-TOLERANCE_PX);
      expect(box.y + box.height, 'the dialog ends inside the window').toBeLessThanOrEqual(height + TOLERANCE_PX);
      // Fliken med 15 titlar överstiger listan: det som inte ryms scrollar i listan, inte i panelen eller dialogen.
      await sectionTab(dialog, 'Titles held').click();
      await expectSectionLoaded(dialog, 'Titles held');
      const titles = await sectionPanel(dialog).getByRole('region', { name: 'Title list' }).evaluate((element) => ({ scroll: element.scrollHeight, client: element.clientHeight }));
      expect(titles.scroll, '15 titles do not fit in the list').toBeGreaterThan(titles.client);
    });
  }

  test('the tabs move with the arrow keys, Home and End, keep one tab stop, and Tab goes on to the panel', async ({ page }) => {
    await openBoard(page, 1280, 900);
    const dialog = await openPopup(page);

    await sectionTab(dialog, 'Overview').focus();
    await page.keyboard.press('ArrowRight');
    await expect(sectionTab(dialog, 'The Journey')).toBeFocused();
    await expect(sectionTab(dialog, 'The Journey')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(sectionTab(dialog, 'Badges')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(sectionTab(dialog, 'Overview')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(sectionTab(dialog, 'Badges')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(sectionTab(dialog, 'Overview')).toBeFocused();

    const stops = await dialog.getByRole('tablist', { name: 'Runner sections' }).getByRole('tab').evaluateAll((tabs) => tabs.filter((tab) => (tab as HTMLElement).tabIndex === 0).length);
    expect(stops, 'only the selected tab is a tab stop').toBe(1);

    await page.keyboard.press('Tab');
    await expect(sectionPanel(dialog)).toBeFocused();
  });

  test('the tab state resets when the popup is opened again', async ({ page }) => {
    await openBoard(page, 1280, 900);
    let dialog = await openPopup(page);
    await overviewButton(dialog, 'Streak').click();
    await expect(overviewButton(dialog, 'Streak')).toHaveAttribute('aria-pressed', 'true');
    await sectionTab(dialog, 'Titles held').click();
    await expect(sectionTab(dialog, 'Titles held')).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(new URL(page.url()).search, 'no search parameter was written for the tabs').toBe('');

    dialog = await openPopup(page);
    await expect(sectionTab(dialog, 'Overview')).toHaveAttribute('aria-selected', 'true');
    await expect(overviewButton(dialog, 'Activity')).toHaveAttribute('aria-pressed', 'true');
    await expect(overviewButton(dialog, 'Streak')).toHaveAttribute('aria-pressed', 'false');
  });

  test('the selected tab has the selected tint and edge, and the focus ring of a tab is drawn inside it', async ({ page }) => {
    await openBoard(page, 1280, 900);
    const dialog = await openPopup(page);
    const selected = sectionTab(dialog, 'Overview');
    const other = sectionTab(dialog, 'Badges');

    const colours = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return { tint: parseFloat(root.getPropertyValue('--rq-tint-selected')), edge: parseFloat(root.getPropertyValue('--rq-edge-selected')) };
    });
    expect(colours, 'the selected tokens exist').toEqual({ tint: 0.14, edge: 0.5 });
    const alpha = (value: string) => Number(/\/\s*([\d.]+)\)$/.exec(value)?.[1] ?? /rgba\(.*,\s*([\d.]+)\)$/.exec(value)?.[1] ?? 1);
    const style = (tab: Locator) => tab.evaluate((element) => { const s = getComputedStyle(element); return { background: s.backgroundColor, top: s.borderTopColor }; });
    expect(alpha((await style(selected)).background), 'selected background tint').toBeCloseTo(0.14, 2);
    expect(alpha((await style(selected)).top), 'selected edge').toBeCloseTo(0.5, 2);
    expect(alpha((await style(other)).background), 'an unselected tab has no tint').toBe(0);

    await selected.focus();
    await page.keyboard.press('ArrowRight');
    const ring = await sectionTab(dialog, 'The Journey').evaluate((tab) => {
      const s = getComputedStyle(tab);
      const box = tab.getBoundingClientRect();
      const reach = parseFloat(s.outlineOffset) + parseFloat(s.outlineWidth);
      return { focusVisible: tab.matches(':focus-visible'), top: box.top - reach, bottom: box.bottom + reach, boxTop: box.top, boxBottom: box.bottom };
    });
    expect(ring.focusVisible, 'the tab has a keyboard focus ring').toBe(true);
    expect(ring.top, 'the ring starts at or below the tab top').toBeGreaterThanOrEqual(ring.boxTop - TOLERANCE_PX);
    expect(ring.bottom, 'the ring ends at or above the tab bottom').toBeLessThanOrEqual(ring.boxBottom + TOLERANCE_PX);
  });

  test('the focus ring of an Overview button is drawn inside the button, so the scroll area does not clip it', async ({ page }) => {
    await openBoard(page, 1280, 900);
    const dialog = await openPopup(page);
    const tabs = dialog.getByRole('group', { name: 'Overview view', exact: true }).getByRole('button');

    await tabs.first().focus();
    await page.keyboard.press('Tab');
    const measured = await tabs.nth(1).evaluate((tab) => {
      const style = getComputedStyle(tab);
      const box = tab.getBoundingClientRect();
      const offset = parseFloat(style.outlineOffset);
      const width = parseFloat(style.outlineWidth);
      // Ringens yttre kant ligger (offset + bredd) utanför flikens kant; med en inåtriktad ring (negativ offset) ligger den vid eller innanför kanten.
      const reach = offset + width;
      return { focusVisible: tab.matches(':focus-visible'), ringTop: box.top - reach, ringBottom: box.bottom + reach, boxTop: box.top, boxBottom: box.bottom };
    });
    expect(measured.focusVisible, 'the button has a keyboard focus ring').toBe(true);
    expect(measured.ringTop, 'the ring starts at or below the button top').toBeGreaterThanOrEqual(measured.boxTop - TOLERANCE_PX);
    expect(measured.ringBottom, 'the ring ends at or above the button bottom').toBeLessThanOrEqual(measured.boxBottom + TOLERANCE_PX);
  });
});

// Overview-fliken (ADR 006 punkt 3): en segmentstyrd växling över profilens statistikinnehåll. Dialogen står på sina 669 px i alla vyer, också medan Streak-trappan laddar eller felar.
test.describe('the Overview of the profile popup', () => {
  const XP_CONFIG_PATH = '/config/xp';

  /** Höjden på dialogen i varje vy, mätt både direkt efter valet och när vyn är klar (`ready` väntar in det som vyn ska visa). */
  async function overviewHeights(dialog: Locator, ready: (view: (typeof OVERVIEW_VIEWS)[number]) => Promise<void>): Promise<Record<string, number>> {
    const heights: Record<string, number> = {};
    for (const view of OVERVIEW_VIEWS) {
      await overviewButton(dialog, view).click();
      heights[`${view} (just selected)`] = (await dialog.boundingBox())!.height;
      await ready(view);
      heights[`${view} (ready)`] = (await dialog.boundingBox())!.height;
    }
    return heights;
  }

  function expectStableHeight(heights: Record<string, number>): void {
    const values = Object.values(heights);
    expect(Math.max(...values) - Math.min(...values), `the dialog height varies: ${JSON.stringify(heights)}`).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs((values[0] ?? 0) - DIALOG_HEIGHT_PX), `the dialog height is ${DIALOG_HEIGHT_PX} px: ${JSON.stringify(heights)}`).toBeLessThanOrEqual(TOLERANCE_PX);
  }

  const viewReady = (dialog: Locator) => async (view: (typeof OVERVIEW_VIEWS)[number]): Promise<void> => {
    const content = dialog.locator('.rq-runner-overview__content');
    if (view === 'Activity') await expect(content.getByRole('region', { name: /^Run heatmap: / })).toBeVisible();
    if (view === 'Distance') await expect(content.getByLabel('Distance', { exact: true })).toBeVisible();
    if (view === 'Streak') await expect(content.getByLabel('Streak', { exact: true })).toBeVisible();
    if (view === 'Fun facts') await expect(content.getByLabel('Fun facts', { exact: true })).toBeVisible();
  };

  test('starts on Activity with the four views in order, an activity map of the runner and no tab of its own', async ({ page }) => {
    await openBoard(page, 1280, 900);
    const dialog = await openPopup(page);
    await expectSectionLoaded(dialog, 'Overview');

    const group = dialog.getByRole('group', { name: 'Overview view', exact: true });
    await expect(group.getByRole('button')).toHaveText(['Activity', 'Distance', 'Streak', 'Fun facts']);
    await expect(overviewButton(dialog, 'Activity')).toHaveAttribute('aria-pressed', 'true');
    for (const view of OVERVIEW_VIEWS.slice(1)) await expect(overviewButton(dialog, view)).toHaveAttribute('aria-pressed', 'false');

    const heat = sectionPanel(dialog).locator('.rq-profile-heat');
    await expect(heat.locator('.rq-profile-heat__total')).toHaveText(String(RUNNER_RUN_DAYS_AGO.length));
    await expect(heat.locator('.rq-profile-heat__unit')).toHaveText(/^runs in the last 12 months$/);
    await expect(sectionPanel(dialog).getByRole('region', { name: new RegExp(`^Run heatmap: ${RUNNER_RUN_DAYS_AGO.length} runs on ${RUNNER_RUN_DAYS_AGO.length} of \\d+ days$`) })).toBeVisible();
    await expect(sectionPanel(dialog).getByRole('tab')).toHaveCount(0);
    await expect(dialog.getByRole('tabpanel')).toHaveCount(1);
  });

  test('a runner without any run gets an empty map with 0 runs, in the same height', async ({ page }) => {
    await stubGroup(page, 3);
    await answerWith(page, '/auth/users-with-runs', { success: true, data: GROUP.map((member) => (member.id === RUNNER.id ? { ...member, runs: [] } : member)) });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/board');
    await dismissOverlays(page);
    await expect(runnerRow(page)).toBeVisible();
    await waitForStylesApplied(page);
    const dialog = await openPopup(page);

    await expect(sectionPanel(dialog).locator('.rq-profile-heat__total')).toHaveText('0');
    await expect(sectionPanel(dialog).getByRole('region', { name: /^Run heatmap: 0 runs on 0 of \d+ days$/ })).toBeVisible();
    expect(Math.abs((await dialog.boundingBox())!.height - DIALOG_HEIGHT_PX)).toBeLessThanOrEqual(TOLERANCE_PX);
  });

  for (const [width, height] of [[1440, 900], [1280, 768]] as const) {
    test(`the dialog is ${DIALOG_HEIGHT_PX} px in every Overview view, with the tiers loaded, on a ${width}x${height} screen`, async ({ page }, testInfo) => {
      await openBoard(page, width, height, 15, BADGE_SERIES_KEYS.length);
      const dialog = await openPopup(page);
      await expectSectionLoaded(dialog, 'Overview');

      const heights = await overviewHeights(dialog, viewReady(dialog));
      testInfo.annotations.push({ type: 'dialog heights', description: JSON.stringify(heights) });
      expectStableHeight(heights);
      const box = (await dialog.boundingBox())!;
      expect(box.y + box.height, 'the dialog ends inside the window').toBeLessThanOrEqual(height + TOLERANCE_PX);
    });

    test(`the dialog is ${DIALOG_HEIGHT_PX} px while the streak tiers load and when they fail, on a ${width}x${height} screen`, async ({ page }, testInfo) => {
      await openBoard(page, width, height, 15, BADGE_SERIES_KEYS.length);
      // Svaret på trappan hålls: laddaren (role="status") står kvar i Streak-vyn.
      await page.route(apiPath(XP_CONFIG_PATH), () => {});
      const dialog = await openPopup(page);
      await expectSectionLoaded(dialog, 'Overview');

      const heights: Record<string, number> = { 'Activity (ready)': (await dialog.boundingBox())!.height };
      await overviewButton(dialog, 'Streak').click();
      await expect(dialog.getByRole('status').filter({ hasText: 'Loading streak' })).toBeAttached();
      heights['Streak (loading)'] = (await dialog.boundingBox())!.height;
      await overviewButton(dialog, 'Fun facts').click();
      await overviewButton(dialog, 'Streak').click();
      heights['Streak (loading, again)'] = (await dialog.boundingBox())!.height;
      await page.unroute(apiPath(XP_CONFIG_PATH));

      // Felet: servern svarar 500, och efter ett omförsök kommer felkortet med Retry.
      await page.route(apiPath(XP_CONFIG_PATH), (route) => route.fulfill({ status: 500, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'stubbed failure' }) }));
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await page.reload();
      await dismissOverlays(page);
      await expect(runnerRow(page)).toBeVisible();
      await waitForStylesApplied(page);
      const again = await openPopup(page);
      await overviewButton(again, 'Streak').click();
      await expect(again.getByText("Couldn't load streak tiers")).toBeVisible();
      heights['Streak (error)'] = (await again.boundingBox())!.height;
      await expect(again.getByRole('button', { name: 'Retry' })).toBeVisible();

      testInfo.annotations.push({ type: 'dialog heights', description: JSON.stringify(heights) });
      expectStableHeight(heights);
    });
  }

  test('the challenge record is a row in Fun facts and in no other view, and the banner no longer has it', async ({ page }) => {
    await openBoard(page, 1280, 900);
    const dialog = await openPopup(page);

    for (const view of ['Activity', 'Distance', 'Streak'] as const) {
      await overviewButton(dialog, view).click();
      await expect(dialog.getByText('Challenges won–lost')).toHaveCount(0);
    }
    await overviewButton(dialog, 'Fun facts').click();
    const row = dialog.locator('.rq-profile-row').filter({ hasText: 'Challenges won–lost' });
    await expect(row).toHaveCount(1);
    await expect(row.locator('dd')).toHaveText(`${RUNNER_RECORD.wins}–${RUNNER_RECORD.losses}`);
    // Bannern har inte längre CHALLENGES-rutan: rekordet bor bara här.
    await expect(dialog.getByRole('region', { name: 'Runner', exact: true })).not.toContainText('Challenges');
  });

  test('no id is used twice, and every aria reference to a popup id has a target, in every Overview view', async ({ page }) => {
    await openBoard(page, 1280, 900);
    const dialog = await openPopup(page);

    for (const view of OVERVIEW_VIEWS) {
      await overviewButton(dialog, view).click();
      await viewReady(dialog)(view);
      const report = await page.evaluate(() => {
        const ids = Array.from(document.querySelectorAll('[id]')).map((element) => element.id);
        const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
        const missing = Array.from(document.querySelectorAll('[aria-labelledby], [aria-controls]')).flatMap((element) =>
          (element.getAttribute('aria-labelledby') ?? element.getAttribute('aria-controls') ?? '').split(' ').filter((id) => id.startsWith('runner-') && !document.getElementById(id)));
        return { duplicates, missing, profileIds: ids.filter((id) => id.startsWith('profile-stats')) };
      });
      expect(report, `ids in the ${view} view`).toEqual({ duplicates: [], missing: [], profileIds: [] });
    }
  });

  test('the switch is a group of buttons with a tab stop each, and Enter picks the focused one', async ({ page }) => {
    await openBoard(page, 1280, 900);
    const dialog = await openPopup(page);
    await expectSectionLoaded(dialog, 'Overview');

    await sectionPanel(dialog).focus();
    for (const view of OVERVIEW_VIEWS) {
      await page.keyboard.press('Tab');
      await expect(overviewButton(dialog, view)).toBeFocused();
    }
    await page.keyboard.press('Enter');
    await expect(overviewButton(dialog, 'Fun facts')).toHaveAttribute('aria-pressed', 'true');
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`the focus ring of a resting Overview button is drawn inside it and is at least 3:1 against its surface in the ${theme} theme`, async ({ page }, testInfo) => {
      await openBoard(page, 1280, 900, 3, 0, { theme });
      const dialog = await openPopup(page);
      await expectSectionLoaded(dialog, 'Overview');

      await overviewButton(dialog, 'Activity').focus();
      await page.keyboard.press('Tab');
      const resting = overviewButton(dialog, 'Distance');
      await expect(resting).toBeFocused();
      const ring = await resting.evaluate((element) => {
        const style = getComputedStyle(element);
        element.setAttribute('data-ring-probe', '');
        // Ringfärgen lånas som textfärg en stund: kontrastmätningen läser textfärgen mot den sammansatta bakgrunden.
        (element as HTMLElement).style.color = style.outlineColor;
        return { focusVisible: element.matches(':focus-visible'), pressed: element.getAttribute('aria-pressed'), offset: parseFloat(style.outlineOffset) };
      });
      const [measured] = await page.evaluate(contrastOf, { selectors: ['[data-ring-probe]'] });
      await resting.evaluate((element) => { (element as HTMLElement).style.color = ''; element.removeAttribute('data-ring-probe'); });

      expect(ring.focusVisible, 'the button has a keyboard focus ring').toBe(true);
      expect(ring.pressed, 'the measured button is not the pressed one').toBe('false');
      expect(ring.offset, 'the ring is drawn inside the button').toBeLessThan(0);
      testInfo.annotations.push({ type: `ring contrast (${theme})`, description: String(measured?.ratio) });
      expect(measured?.ratio, 'ring against its surface').toBeGreaterThanOrEqual(3);
    });

    test(`the labels are at least ${MIN_LABEL_PX} px and the new text is at least ${MIN_LABEL_CONTRAST}:1 in the ${theme} theme at 1024, 1280 and 1440 px`, async ({ page }, testInfo) => {
      const report: Record<string, Record<string, number>> = {};
      for (const width of [1024, 1280, 1440]) {
        await openBoard(page, width, 900, 3, 3, { theme });
        const dialog = await openPopup(page);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expectSectionLoaded(dialog, 'Overview');

        const measured: Record<string, number> = {};
        const sample = async (label: string, selectors: string[]) => {
          for (const found of await page.evaluate(contrastOf, { selectors })) measured[`${label}${found.index === 0 ? '' : ` #${found.index}`}`] = found.ratio;
        };
        const sizeOf = (selector: string) => dialog.locator(selector).evaluateAll((elements) => elements.map((element) => parseFloat(getComputedStyle(element).fontSize)));

        await overviewButton(dialog, 'Distance').click();
        await sample('switch: resting button', ['.rq-runner-overview__switch > .rq-filter[aria-pressed="false"]']);
        await sample('switch: pressed button', ['.rq-runner-overview__switch > .rq-filter[aria-pressed="true"]']);
        for (const size of await sizeOf('.rq-runner-overview__switch > .rq-filter')) expect(size, 'switch label size').toBeGreaterThanOrEqual(MIN_LABEL_PX);

        await sample('rows: label', ['.rq-runner-overview__content .rq-profile-row dt']);
        await sample('rows: value', ['.rq-runner-overview__content .rq-profile-row dd']);
        // Rader med ton muted: "Next tier at" i Streak (trappan laddad) och "Longest gap between runs" i Fun facts.
        await overviewButton(dialog, 'Streak').click();
        await expect(dialog.locator('.rq-runner-overview__content').getByLabel('Streak', { exact: true })).toBeVisible();
        await sample('streak: muted value', ['.rq-runner-overview__content dd[data-tone="muted"]']);
        await overviewButton(dialog, 'Fun facts').click();
        await sample('fun facts: muted value', ['.rq-runner-overview__content dd[data-tone="muted"]']);
        await sample('challenge record: label', ['.rq-runner-overview__content .rq-profile-row:last-child dt']);
        await sample('challenge record: value', ['.rq-runner-overview__content .rq-profile-row:last-child dd']);
        await overviewButton(dialog, 'Activity').click();
        await sample('map: runs in the last months', ['.rq-profile-heat__unit']);
        await sample('map: month labels', ['.rq-profile-heat__month-label']);
        await sample('map: stat labels', ['.rq-profile-heat__stat-label']);
        await sample('map: legend', ['.rq-profile-heat__legend']);
        // Veckodagsbokstäverna (M, W, F, S) är läsbar text, inte dekor: de räknas med.
        await sample('map: weekday letters', ['.rq-profile-heat__day']);
        await sample('map: today line', ['.rq-profile-heat__today']);
        await sample('map: stat values', ['.rq-profile-heat__stat-value']);
        for (const size of await sizeOf('.rq-profile-heat__unit, .rq-profile-heat__month-label, .rq-profile-heat__stat-label, .rq-profile-heat__legend, .rq-profile-heat__day')) expect(size, 'map label size').toBeGreaterThanOrEqual(MIN_LABEL_PX);

        report[`${width}px`] = measured;
        const tooLow = Object.entries(measured).filter(([, ratio]) => ratio < MIN_LABEL_CONTRAST);
        expect(tooLow, `text below ${MIN_LABEL_CONTRAST}:1 at ${width} px: ${JSON.stringify(measured)}`).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
      }
      testInfo.annotations.push({ type: `contrast (${theme})`, description: JSON.stringify(report) });
    });
  }
});

// Fliken The Journey: Frodos väg ur samma modell som profilens kort, i dialogens fasta panelyta (ingen intern scroll, samma höjd), med förloppet som text och läsbara etiketter.
test.describe('the Journey tab of the profile popup', () => {
  /** Doors of Durin: en löpare mitt på vägen, så att både tier 1- och tier 2-etiketter, ticks och markören syns. */
  const JOURNEY_KM = 988.4;
  const journey = (dialog: Locator): Locator => dialog.getByRole('region', { name: "Frodo's journey" });
  const zoomButton = (dialog: Locator): Locator => journey(dialog).getByRole('button');

  async function openJourney(page: Page, width: number, height: number, options: OpenOptions = {}): Promise<Locator> {
    await openBoard(page, width, height, 3, 0, { runnerKm: JOURNEY_KM, ...options });
    const dialog = await openPopup(page);
    await sectionTab(dialog, 'The Journey').click();
    await expectSectionLoaded(dialog, 'The Journey');
    return dialog;
  }

  for (const [width, height] of [[1440, 900], [1280, 768]] as const) {
    test(`the dialog is ${DIALOG_HEIGHT_PX} px on the tab at every zoom level and the panel does not scroll, on a ${width}x${height} screen`, async ({ page }, testInfo) => {
      const dialog = await openJourney(page, width, height);

      const measured: Record<string, { dialog: number; scroll: number; client: number }> = {};
      for (const zoom of ['Overview', 'Zoomed', 'Close-up']) {
        await expect(zoomButton(dialog)).toHaveText(zoom);
        const scrolls = await sectionPanel(dialog).evaluate((element) => ({ scroll: element.scrollHeight, client: element.clientHeight }));
        measured[zoom] = { dialog: (await dialog.boundingBox())!.height, ...scrolls };
        expect(Math.abs(measured[zoom]!.dialog - DIALOG_HEIGHT_PX), `the dialog is ${DIALOG_HEIGHT_PX} px at ${zoom}: ${JSON.stringify(measured)}`).toBeLessThanOrEqual(TOLERANCE_PX);
        expect(scrolls.scroll, `the Journey panel has no scroll of its own at ${zoom}: ${JSON.stringify(measured)}`).toBeLessThanOrEqual(scrolls.client + TOLERANCE_PX);
        await zoomButton(dialog).click();
      }
      testInfo.annotations.push({ type: 'journey tab', description: JSON.stringify(measured) });
    });
  }

  test('the progress bar tells a screen reader the percent, the km and the last checkpoint, and the zoom button is the only button', async ({ page }) => {
    const dialog = await openJourney(page, 1280, 900);

    const bar = journey(dialog).getByRole('progressbar', { name: 'Progress to Mount Doom' });
    await expect(bar).toHaveAttribute('aria-valuenow', '30');
    await expect(bar).toHaveAttribute('aria-valuetext', /^30\.3% of the way to Mount Doom, 988 of 3\s266 km, last checkpoint Doors of Durin$/);
    await expect(journey(dialog).getByRole('button')).toHaveCount(1);
    // The fill is the gold token, resolved in the active theme: a probe element coloured by `var(--rq-gold)` reads the same colour as the fill.
    const colours = await bar.evaluate((element) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--rq-gold)';
      element.append(probe);
      const gold = getComputedStyle(probe).color;
      probe.remove();
      return { fill: getComputedStyle(element.querySelector('.rq-fill')!).backgroundColor, gold };
    });
    expect(colours.fill, 'the fill is --rq-gold').toBe(colours.gold);
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`the labels are at least ${MIN_LABEL_PX} px and the text is at least ${MIN_LABEL_CONTRAST}:1 in the ${theme} theme at 1024, 1280 and 1440 px, at every zoom level`, async ({ page }, testInfo) => {
      const report: Record<string, Record<string, number>> = {};
      for (const width of [1024, 1280, 1440]) {
        const dialog = await openJourney(page, width, 900, { theme });
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

        const measured: Record<string, number> = {};
        const sizes: Record<string, number> = {};
        for (const zoom of ['Overview', 'Zoomed', 'Close-up']) {
          await expect(zoomButton(dialog)).toHaveText(zoom);
          for (const [label, selector] of [
            ['title', '.rq-runner-journey .rq-runner-head'],
            ['zoom button', '.rq-runner-journey button'],
            ['waypoint label', '.rq-runner-wp__label'],
            ['road end', '.rq-runner-road__end'],
            ['checkpoint line', '.rq-runner-journey__sum'],
            ['checkpoint name', '.rq-runner-journey__cp'],
          ] as const) {
            for (const found of await page.evaluate(contrastOf, { selectors: [selector] })) measured[`${zoom}: ${label}${found.index === 0 ? '' : ` #${found.index}`}`] = found.ratio;
            const found = await dialog.locator(selector).evaluateAll((elements) => elements.map((element) => parseFloat(getComputedStyle(element).fontSize)));
            for (const size of found) sizes[`${zoom}: ${label}`] = Math.min(sizes[`${zoom}: ${label}`] ?? Infinity, size);
          }
          await zoomButton(dialog).click();
        }
        report[`${width}px`] = measured;
        const tooLow = Object.entries(measured).filter(([, ratio]) => ratio < MIN_LABEL_CONTRAST);
        expect(tooLow, `text below ${MIN_LABEL_CONTRAST}:1 at ${width} px: ${JSON.stringify(measured)}`).toEqual([]);
        const tooSmall = Object.entries(sizes).filter(([, size]) => size < MIN_LABEL_PX);
        expect(tooSmall, `text below ${MIN_LABEL_PX} px at ${width} px: ${JSON.stringify(sizes)}`).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
      }
      testInfo.annotations.push({ type: `journey contrast (${theme})`, description: JSON.stringify(report) });
    });
  }
});

// Aktivitetskartan i Overview: tabbstopp bara när den scrollar, och intron en gång per öppning.
test.describe('the activity map of the Overview of the profile popup', () => {
  const heatRegion = (dialog: Locator): Locator => dialog.getByRole('region', { name: /^Run heatmap: / });
  const firstWeekAnimation = (dialog: Locator) => dialog.locator('.rq-profile-heat__week').first().evaluate((element) => getComputedStyle(element).animationName);

  for (const width of [1024, 1280, 1440]) {
    test(`the map is a tab stop exactly when it scrolls, on a ${width} px screen`, async ({ page }, testInfo) => {
      await openBoard(page, width, 900);
      const dialog = await openPopup(page);
      await expectSectionLoaded(dialog, 'Overview');

      const region = heatRegion(dialog);
      await expect(region).toBeVisible();
      const measured = await region.evaluate((element) => ({ scrolls: element.scrollWidth - element.clientWidth > 8, tabindex: element.getAttribute('tabindex'), fits: element.getAttribute('data-fits') }));
      testInfo.annotations.push({ type: 'map', description: JSON.stringify(measured) });
      expect(measured.tabindex, `a map that ${measured.scrolls ? 'scrolls' : 'fits'}: ${JSON.stringify(measured)}`).toBe(measured.scrolls ? '0' : null);
      expect(measured.fits).toBe(String(!measured.scrolls));
    });
  }

  test('the map grows in the first time it is shown in an opening, not when Activity or Overview is picked again, and again in the next opening', async ({ page }) => {
    await openBoard(page, 1280, 900);
    let dialog = await openPopup(page);
    await expect(heatRegion(dialog)).toBeVisible();
    expect(await firstWeekAnimation(dialog), 'first time in this opening').toBe('rqGrowY');

    await overviewButton(dialog, 'Distance').click();
    await overviewButton(dialog, 'Activity').click();
    await expect(heatRegion(dialog)).toBeVisible();
    expect(await firstWeekAnimation(dialog), 'Activity picked again').toBe('none');

    await sectionTab(dialog, 'The Journey').click();
    await sectionTab(dialog, 'Overview').click();
    await expect(heatRegion(dialog)).toBeVisible();
    expect(await firstWeekAnimation(dialog), 'back from another tab').toBe('none');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    dialog = await openPopup(page);
    await expect(heatRegion(dialog)).toBeVisible();
    expect(await firstWeekAnimation(dialog), 'a new opening').toBe('rqGrowY');
  });

  test('the activity map on the profile page carries no data-intro and still grows in', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/profile?view=consistency');
    await dismissOverlays(page);
    const region = page.getByRole('region', { name: /^Run heatmap: / });
    await expect(region).toBeVisible();
    await waitForStylesApplied(page);

    await expect(page.locator('.rq-profile-heat')).not.toHaveAttribute('data-intro', /.*/);
    const animation = await page.locator('.rq-profile-heat__week').first().evaluate((element) => getComputedStyle(element).animationName);
    expect(animation, 'the profile map has its intro').toBe('rqGrowY');
  });

  test('the Overview switch has a name of its own, apart from the Overview panel that holds it', async ({ page }) => {
    await openBoard(page, 1280, 900);
    const dialog = await openPopup(page);
    await expectSectionLoaded(dialog, 'Overview');

    await expect(sectionPanel(dialog).getByRole('group', { name: 'Overview view', exact: true })).toBeVisible();
    await expect(sectionPanel(dialog).getByRole('group', { name: 'Overview', exact: true })).toHaveCount(0);
  });
});

// Bannern och Head to head i sin egen panel uppe till höger (ADR 006 punkt 4): inga layoutsprång mellan lägena, ingen överlappning med namnet, läsbara etiketter och en mening för skärmläsaren.
test.describe('the banner and the Head to head panel of the profile popup', () => {
  const banner = (dialog: Locator): Locator => dialog.getByRole('region', { name: 'Runner', exact: true });
  const panel = (dialog: Locator): Locator => dialog.locator('.rq-runner-h2h-banner');

  test('the banner is equally tall while Head to head loads, fails, has no duels and has a record, and the dialog keeps its height', async ({ page }, testInfo) => {
    const measured: Record<string, { banner: number; dialog: number }> = {};
    for (const headToHead of ['loading', 'error', 'none', 'win'] as const) {
      await openBoard(page, 1280, 768, 3, 3, { headToHead });
      const dialog = await openPopup(page);
      if (headToHead === 'loading') await expect(panel(dialog).getByText('Loading head to head')).toBeAttached();
      if (headToHead === 'error') await expect(panel(dialog).getByText("Couldn't load head to head")).toBeVisible({ timeout: 10_000 });
      if (headToHead === 'none') await expect(panel(dialog).getByText('No duels against Bo yet', { exact: true })).toBeVisible();
      if (headToHead === 'win') await expect(dialog.getByText('Head to head: 2–0–1 to you')).toBeAttached();
      await waitForStylesApplied(page);
      measured[headToHead] = { banner: (await banner(dialog).boundingBox())!.height, dialog: (await dialog.boundingBox())!.height };
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }
    testInfo.annotations.push({ type: 'banner and dialog heights', description: JSON.stringify(measured) });

    const banners = Object.values(measured).map((entry) => entry.banner);
    expect(Math.max(...banners) - Math.min(...banners), `the banner height varies: ${JSON.stringify(measured)}`).toBeLessThanOrEqual(TOLERANCE_PX);
    for (const [state, { dialog }] of Object.entries(measured)) {
      expect(Math.abs(dialog - DIALOG_HEIGHT_PX), `the dialog is ${DIALOG_HEIGHT_PX} px with Head to head ${state}`).toBeLessThanOrEqual(TOLERANCE_PX);
    }
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`the panel does not overlap the name, also a long one, and its labels are at least ${MIN_LABEL_PX} px with ${MIN_LABEL_CONTRAST}:1 in the ${theme} theme at 1024, 1280 and 1440 px`, async ({ page }, testInfo) => {
      const contrasts: Record<string, number[]> = {};
      for (const width of [1024, 1280, 1440]) {
        await openBoard(page, width, 900, 3, 3, { theme });
        const dialog = await openPopup(page);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(dialog.getByText('Head to head: 1–0–1 level')).toBeAttached();

        // Namnet längre än raden rymmer: det ska radbrytas i sin kolumn, inte löpa in under panelen.
        const names = ['Bo Two', 'Bartholomeus Nicklas Maximilian von Elling-Lindblad Lüthje'];
        for (const name of names) {
          await dialog.locator('.rq-runner-hero__name').evaluate((heading, value) => { heading.textContent = value; }, name);
          const boxes = await dialog.evaluate((root) => {
            const rect = (selector: string) => root.querySelector(selector)!.getBoundingClientRect();
            const name = rect('.rq-runner-hero__name');
            const minis = rect('.rq-badge-minis');
            const side = rect('.rq-runner-h2h-banner');
            return { nameRight: name.right, minisRight: minis.right, sideLeft: side.left };
          });
          expect(boxes.nameRight, `the name ends before the panel at ${width} px ("${name}")`).toBeLessThanOrEqual(boxes.sideLeft + TOLERANCE_PX);
          expect(boxes.minisRight, `the badges end before the panel at ${width} px ("${name}")`).toBeLessThanOrEqual(boxes.sideLeft + TOLERANCE_PX);
        }

        const sizes = await dialog.locator('.rq-runner-h2h-banner__head span, .rq-runner-h2h-banner .rq-runner-cell__label').evaluateAll((labels) => labels.map((label) => parseFloat(getComputedStyle(label).fontSize)));
        expect(sizes, 'the heading and the three labels are drawn').toHaveLength(4);
        for (const size of sizes) expect(size, 'label size').toBeGreaterThanOrEqual(MIN_LABEL_PX);
        const ratios = await page.evaluate(contrastOf, { selectors: ['.rq-runner-h2h-banner__head span', '.rq-runner-h2h-banner .rq-runner-cell__label'] });
        contrasts[`${width}px`] = ratios.map((sample) => sample.ratio);
        for (const sample of ratios) expect(sample.ratio, `contrast of "${sample.text}" at ${width} px`).toBeGreaterThanOrEqual(MIN_LABEL_CONTRAST);

        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
      }
      testInfo.annotations.push({ type: `label contrast (${theme})`, description: JSON.stringify(contrasts) });
    });
  }

  test('a screen reader gets Head to head once, as one sentence, and the visible numbers are hidden', async ({ page }) => {
    await openBoard(page, 1280, 900);
    const dialog = await openPopup(page);
    await expect(dialog.getByText('Head to head: 1–0–1 level')).toBeAttached();

    const snapshot = await panel(dialog).ariaSnapshot();
    expect(snapshot.match(/Head to head/g), `one reading in the accessibility tree: ${snapshot}`).toHaveLength(1);
    expect(snapshot).toContain('Head to head: 1–0–1 level');
    expect(snapshot, 'the numbers and labels in the boxes are hidden').not.toMatch(/won|drawn|lost/i);
    await expect(dialog.getByRole('region', { name: 'Head to head' })).toHaveCount(0);
  });

  test('Head to head is not in the Overview panel, so the stats take the whole width', async ({ page }) => {
    await openBoard(page, 1280, 900);
    const dialog = await openPopup(page);
    await expectSectionLoaded(dialog, 'Overview');

    const overview = sectionPanel(dialog);
    await expect(overview.getByText(/head to head/i)).toHaveCount(0);
    const widths = await overview.evaluate((element) => ({ panel: element.clientWidth, stats: (element.querySelector('.rq-runner-overview') as HTMLElement).getBoundingClientRect().width }));
    expect(widths.stats, 'the stat panel fills the Overview panel').toBeGreaterThanOrEqual(widths.panel - SCROLLBAR_ALLOWANCE_PX);
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`the Retry button in the panel has a focus ring drawn inside the panel in the ${theme} theme`, async ({ page }, testInfo) => {
      await openBoard(page, 1280, 900, 3, 0, { headToHead: 'error', theme });
      const dialog = await openPopup(page);
      const retry = panel(dialog).getByRole('button', { name: 'Retry' });
      await expect(retry).toBeVisible({ timeout: 10_000 });

      await retry.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(retry).toBeFocused();
      const ring = await retry.evaluate((button) => {
        const style = getComputedStyle(button);
        const box = button.getBoundingClientRect();
        const side = button.closest('.rq-runner-h2h-banner')!.getBoundingClientRect();
        const reach = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
        const [r = 0, g = 0, b = 0] = (style.outlineColor.match(/[\d.]+/g) ?? []).map(Number);
        const layers: number[][] = [];
        for (let node: Element | null = button; node; node = node.parentElement) {
          const layer = (getComputedStyle(node).backgroundColor.match(/[\d.]+/g) ?? []).map(Number);
          if ((layer[3] ?? 1) > 0 && layer.length >= 3) layers.push(layer);
          if ((layer[3] ?? 1) === 1) break;
        }
        const surface = layers.reduceRight<number[]>((below, [lr = 0, lg = 0, lb = 0, la = 1]) => [lr * la + (below[0] ?? 0) * (1 - la), lg * la + (below[1] ?? 0) * (1 - la), lb * la + (below[2] ?? 0) * (1 - la)], [0, 0, 0]);
        return {
          focusVisible: button.matches(':focus-visible'), style: style.outlineStyle, ringColor: [r, g, b], surface,
          outer: { left: box.left - reach, top: box.top - reach, right: box.right + reach, bottom: box.bottom + reach },
          side: { left: side.left, top: side.top, right: side.right, bottom: side.bottom },
        };
      });
      expect(ring.focusVisible, 'the keyboard focus ring is drawn').toBe(true);
      expect(ring.style).not.toBe('none');
      expect(ring.outer.left, 'ring inside the panel, left').toBeGreaterThanOrEqual(ring.side.left - TOLERANCE_PX);
      expect(ring.outer.top, 'ring inside the panel, top').toBeGreaterThanOrEqual(ring.side.top - TOLERANCE_PX);
      expect(ring.outer.right, 'ring inside the panel, right').toBeLessThanOrEqual(ring.side.right + TOLERANCE_PX);
      expect(ring.outer.bottom, 'ring inside the panel, bottom').toBeLessThanOrEqual(ring.side.bottom + TOLERANCE_PX);
      const luminance = (rgb: number[]) => {
        const channel = (value: number) => { const s = value / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * channel(rgb[0] ?? 0) + 0.7152 * channel(rgb[1] ?? 0) + 0.0722 * channel(rgb[2] ?? 0);
      };
      const [lighter = 0, darker = 0] = [luminance(ring.ringColor), luminance(ring.surface)].sort((a, b) => b - a);
      const contrast = (lighter + 0.05) / (darker + 0.05);
      // Ringens kontrast mot de tonade ytorna i det ljusa temat är en egen story (fokusringen på tonade ytor): värdet loggas här, och kravet gäller bara det mörka temat.
      testInfo.annotations.push({ type: `focus ring contrast (${theme})`, description: `${contrast.toFixed(2)}:1 (ring rgb(${ring.ringColor.join(',')}) on rgb(${ring.surface.map(Math.round).join(',')}))` });
      if (theme === 'dark') expect(contrast, 'the ring has at least 3:1 against the panel').toBeGreaterThanOrEqual(3);
    });
  }
});

// Popupens chunk (RunnerPopup-*.js) hålls tillbaka tills provet släpper den: det kalla läget. Medan den hämtas visar sidan en upptagen dialog över skrimman.
test.describe('the profile popup while its chunk loads', () => {
  async function holdPopupChunk(page: Page): Promise<() => void> {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/assets/RunnerPopup-*.js', async (route) => {
      await gate;
      await route.continue();
    });
    return release;
  }
  // Väntläget heter efter löparen när hen är känd (Board har gruppen i cachen), och skiljs så från den riktiga dialogen ("Runner card: <namn>").
  const pendingDialog = (page: Page): Locator => page.getByRole('dialog', { name: `Loading ${RUNNER.name}'s runner card`, exact: true });

  test('a busy dialog holds focus, Tab and Shift+Tab never reach the page behind, and the real dialog takes over', async ({ page }) => {
    await openBoard(page, 1280, 900);
    const release = await holdPopupChunk(page);
    await runnerRow(page).click();

    const pending = pendingDialog(page);
    await expect(pending).toBeVisible();
    await expect(pending).toHaveAttribute('aria-busy', 'true');
    await expect(pending).toHaveAttribute('aria-modal', 'true');
    await expect(pending).toBeFocused();
    for (const key of ['Tab', 'Tab', 'Shift+Tab', 'Tab']) {
      await page.keyboard.press(key);
      expect(await pending.evaluate((element) => element === document.activeElement), `${key} leaves focus on the dialog`).toBe(true);
    }

    release();
    const dialog = popup(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toHaveAttribute('aria-busy');
    await expect(dialog.getByRole('heading', { level: 2, name: `Runner card: ${RUNNER.name}` })).toBeFocused();
    await expect(pending).toHaveCount(0);
  });

  test('Escape closes the busy dialog and the address goes back to the board', async ({ page }) => {
    await openBoard(page, 1280, 900);
    const release = await holdPopupChunk(page);
    await runnerRow(page).click();
    await expect(pendingDialog(page)).toBeFocused();

    await page.keyboard.press('Escape');

    await expect(pendingDialog(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/board$/);
    release();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a click on the scrim closes the busy dialog and the address goes back to the board', async ({ page }) => {
    await openBoard(page, 1280, 900);
    const release = await holdPopupChunk(page);
    await runnerRow(page).click();
    await expect(pendingDialog(page)).toBeVisible();

    await page.mouse.click(8, 8);

    await expect(pendingDialog(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/board$/);
    release();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('Challenge in the heading row of the profile popup', () => {
  const challengeLink = (dialog: Locator): Locator => dialog.getByRole('link', { name: 'Challenge' });
  const challengeButton = (dialog: Locator): Locator => dialog.getByRole('button', { name: 'Challenge', exact: true });
  const sendSheet = (page: Page): Locator => page.getByRole('dialog', { name: 'Send a challenge' });

  /** Skälen som står bredvid knappen (ur sendBlocker och löparens upptagenhet), för de lägen som stänger av den. */
  const REASONS = {
    'no-tokens': 'You have no tokens to send. You earn them by levelling up.',
    sent: 'Your challenge to Cy is waiting for an answer. Withdraw it or wait for the reply before sending another.',
    incoming: 'A challenge is waiting on you. Answer it before you send one of your own.',
    'runner-busy': 'Bo is in a live duel right now.',
  } as const;
  const OFF_SCENARIOS = Object.keys(REASONS) as Array<keyof typeof REASONS>;

  test('Challenge opens the send flow with the runner selected, and Back goes to the page under the popup: no popup and no send sheet', async ({ page }) => {
    await openBoard(page, 1280, 900);
    const dialog = await openPopup(page);

    await challengeLink(dialog).click();

    await expect(sendSheet(page)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/duels\\?send=1&opponent=${RUNNER.id}$`));
    await expect(sendSheet(page).getByRole('radio', { name: new RegExp(RUNNER.name) })).toHaveAttribute('aria-checked', 'true');
    await expect(popup(page)).toHaveCount(0);

    await page.goBack();

    await expect(page).toHaveURL(/\/board$/);
    await expect(runnerRow(page)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a Ctrl-click leaves the link to the browser: the popup stays where it is and the link opens in a new tab', async ({ page, context }) => {
    await openBoard(page, 1280, 900);
    const dialog = await openPopup(page);

    const [opened] = await Promise.all([context.waitForEvent('page'), challengeLink(dialog).click({ modifiers: ['Control'] })]);
    await opened.close();

    await expect(page).toHaveURL(new RegExp(`/runner/${RUNNER.id}$`));
    await expect(popup(page)).toBeVisible();
    await expect(sendSheet(page)).toHaveCount(0);
  });

  for (const scenario of OFF_SCENARIOS) {
    test(`when ${scenario} is the case the button is aria-disabled and focusable, the reason is visible text that describes it, and Enter does nothing`, async ({ page }) => {
      await openBoard(page, 1280, 900, 3, 0, { challenge: scenario });
      const dialog = await openPopup(page);

      const button = challengeButton(dialog);
      await expect(button).toBeVisible();
      await expect(button).toHaveAttribute('aria-disabled', 'true');
      await expect(button).not.toHaveAttribute('disabled', /.*/);
      await expect(challengeLink(dialog)).toHaveCount(0);
      await expect(dialog.getByText(REASONS[scenario], { exact: true })).toBeVisible();
      await expect(button).toHaveAccessibleDescription(REASONS[scenario]);

      await button.focus();
      await expect(button).toBeFocused();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Space');

      await expect(page).toHaveURL(new RegExp(`/runner/${RUNNER.id}$`));
      await expect(popup(page)).toBeVisible();
    });
  }

  test('while my challenges load the button is off and says nothing; when they fail it is on', async ({ page }) => {
    await openBoard(page, 1280, 900, 3, 0, { challenge: 'loading' });
    const dialog = await openPopup(page);
    const button = challengeButton(dialog);
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).not.toHaveAttribute('aria-describedby', /.*/);
    await expect(dialog.locator('.rq-runner-popup__reason')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await openBoard(page, 1280, 900, 3, 0, { challenge: 'error' });
    const failing = await openPopup(page);
    await expect(challengeLink(failing)).toBeVisible({ timeout: 10_000 });
    await expect(challengeButton(failing)).toHaveCount(0);
  });

  // Stabil höjd: den avstängda knappen och skälet får inte göra rubrikraden eller dialogen högre än med en påslagen knapp.
  for (const [width, height] of [[1440, 900], [1280, 768]] as const) {
    test(`the heading row and the dialog keep their height (${DIALOG_HEIGHT_PX} px) whether Challenge is on, loading, failing or off with any reason, on a ${width}x${height} screen`, async ({ page }, testInfo) => {
      const measured: Record<string, { bar: number; dialog: number }> = {};
      for (const scenario of ['ready', 'loading', 'error', ...OFF_SCENARIOS] as const) {
        await openBoard(page, width, height, 3, 3, { challenge: scenario });
        const dialog = await openPopup(page);
        if (scenario === 'error') await expect(challengeLink(dialog)).toBeVisible({ timeout: 10_000 });
        if (scenario in REASONS) await expect(dialog.getByText(REASONS[scenario as keyof typeof REASONS], { exact: true })).toBeVisible();
        await waitForStylesApplied(page);
        measured[scenario] = { bar: (await dialog.locator('.rq-runner-popup__bar').boundingBox())!.height, dialog: (await dialog.boundingBox())!.height };
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
      }
      testInfo.annotations.push({ type: 'heading row and dialog heights', description: JSON.stringify(measured) });

      const bars = Object.values(measured).map((entry) => entry.bar);
      expect(Math.max(...bars) - Math.min(...bars), `the heading row height varies: ${JSON.stringify(measured)}`).toBeLessThanOrEqual(TOLERANCE_PX);
      for (const [state, { dialog }] of Object.entries(measured)) {
        expect(Math.abs(dialog - DIALOG_HEIGHT_PX), `the dialog is ${DIALOG_HEIGHT_PX} px with Challenge ${state}`).toBeLessThanOrEqual(TOLERANCE_PX);
      }
    });
  }

  // Förnamnet i skälet kommer ur gruppens svar och kan vara långt, och en text som inte ryms på en rad ska radbrytas i sin plats: inte löpa in under rubriken eller ✕, och inte göra raden högre.
  const REASON_CASES: Array<{ name: string; scenario: RunnerChallengeScenario; text?: string; wraps?: boolean }> = [
    { name: 'sent', scenario: 'sent' },
    { name: 'runner-busy with a long first name', scenario: 'runner-busy', text: 'Bartholomeus-Maximilian is in a live duel right now.' },
    {
      name: 'a reason of two lines',
      scenario: 'sent',
      text: 'Your challenge to Bartholomeus-Maximilian Lindblad-Lüthje is waiting for an answer. Withdraw it or wait for the reply before sending another, and then send the next one with a new token.',
      wraps: true,
    },
  ];

  for (const theme of ['dark', 'light'] as const) {
    test(`the reason overlaps neither the heading, the button nor the close button, with a long name too, and is at least ${MIN_LABEL_PX} px with ${MIN_LABEL_CONTRAST}:1 in the ${theme} theme at 1024, 1280 and 1440 px`, async ({ page }, testInfo) => {
      const results: Record<string, { ratio: number; size: number; lines: number }> = {};
      for (const width of [1024, 1280, 1440]) {
        for (const { name, scenario, text, wraps } of REASON_CASES) {
          await openBoard(page, width, 900, 3, 3, { theme, challenge: scenario });
          const dialog = await openPopup(page);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          const reason = dialog.locator('.rq-runner-popup__reason');
          await expect(reason).toBeVisible();

          if (text) await reason.evaluate((element, value) => { element.textContent = value; }, text);
          const boxes = await dialog.evaluate((root) => {
            const rect = (selector: string) => root.querySelector(selector)!.getBoundingClientRect();
            const title = rect('.rq-runner-popup__title');
            const reasonBox = rect('.rq-runner-popup__reason');
            const button = rect('.rq-runner-popup__challenge > button');
            const close = rect('.rq-modal__close');
            const bar = rect('.rq-runner-popup__bar');
            return { dialogHeight: root.getBoundingClientRect().height, titleRight: title.right, reasonLeft: reasonBox.left, reasonRight: reasonBox.right, reasonTop: reasonBox.top, reasonBottom: reasonBox.bottom, buttonLeft: button.left, buttonRight: button.right, closeLeft: close.left, barTop: bar.top, barBottom: bar.bottom };
          });
          const where = `${name} at ${width} px`;
          expect(boxes.titleRight, `the heading ends before the reason (${where})`).toBeLessThanOrEqual(boxes.reasonLeft + TOLERANCE_PX);
          expect(boxes.reasonRight, `the reason ends before the button (${where})`).toBeLessThanOrEqual(boxes.buttonLeft + TOLERANCE_PX);
          expect(boxes.buttonRight, `the button ends before the close button (${where})`).toBeLessThanOrEqual(boxes.closeLeft + TOLERANCE_PX);
          expect(boxes.reasonTop, `the reason stays inside the heading row (${where})`).toBeGreaterThanOrEqual(boxes.barTop - TOLERANCE_PX);
          expect(boxes.reasonBottom, `the reason stays inside the heading row (${where})`).toBeLessThanOrEqual(boxes.barBottom + TOLERANCE_PX);

          const style = await reason.evaluate((element) => {
            const computed = getComputedStyle(element);
            return { size: parseFloat(computed.fontSize), lineHeight: parseFloat(computed.lineHeight), height: element.getBoundingClientRect().height };
          });
          const [sample] = await page.evaluate(contrastOf, { selectors: ['.rq-runner-popup__reason'] });
          const lines = Math.round(style.height / style.lineHeight);
          results[where] = { ratio: sample!.ratio, size: style.size, lines };
          expect(style.size, `the reason size (${where})`).toBeGreaterThanOrEqual(MIN_LABEL_PX);
          expect(sample!.ratio, `the reason contrast (${where})`).toBeGreaterThanOrEqual(MIN_LABEL_CONTRAST);
          expect(lines, `the reason takes at most two lines (${where})`).toBeLessThanOrEqual(2);
          if (wraps) expect(lines, `the long reason wraps to two lines (${where})`).toBe(2);
          expect(Math.abs(boxes.dialogHeight - DIALOG_HEIGHT_PX), `the dialog is ${DIALOG_HEIGHT_PX} px (${where})`).toBeLessThanOrEqual(TOLERANCE_PX);

          await page.keyboard.press('Escape');
          await expect(dialog).toBeHidden();
        }
      }
      testInfo.annotations.push({ type: `reason contrast, size and lines (${theme})`, description: JSON.stringify(results) });
    });
  }
});

/** Tre kategorier (Time of day, Distance, Consistency) cyklas över titlarna: 15 titlar ger fem i varje. Två runner-up-titlar (Consistency och Pace). */
const TITLE_STUB: TitleStub = { titleMetrics: ['earlyRunCount', 'longestRun', 'longestStreak'], runnersUp: 2 };
const titlesList = (dialog: Locator): Locator => sectionPanel(dialog).getByRole('region', { name: 'Title list' });
const titlesFilter = (dialog: Locator): Locator => sectionPanel(dialog).getByRole('group', { name: 'Titles filter', exact: true });
const heldRows = (dialog: Locator): Locator => sectionPanel(dialog).getByRole('list', { name: 'Titles held', exact: true }).getByRole('listitem');

async function openTitlesTab(page: Page, width: number, height: number, titles: number, options: OpenOptions = {}): Promise<Locator> {
  await openBoard(page, width, height, titles, 0, { ...options, titles: { ...TITLE_STUB, ...options.titles } });
  const dialog = await openPopup(page);
  await sectionTab(dialog, 'Titles held').click();
  await expectSectionLoaded(dialog, 'Titles held');
  return dialog;
}

/** Hur många olika vänsterkanter raderna har: en kolumn ger en, två kolumner två. */
const columnsOf = (rows: Locator): Promise<number> =>
  rows.evaluateAll((elements) => new Set(elements.map((element) => Math.round(element.getBoundingClientRect().left))).size);

test.describe('the Titles held tab of the profile popup', () => {
  for (const [width, height] of [[1280, 768], [1440, 900]] as const) {
    test(`with 15 titles on a ${width}x${height} screen the list scrolls in the panel, the filter stays, the dialog is ${DIALOG_HEIGHT_PX} px and nothing in it scrolls sideways`, async ({ page }, testInfo) => {
      const dialog = await openTitlesTab(page, width, height, 15);
      const list = titlesList(dialog);

      expect((await dialog.boundingBox())!.height, 'the dialog height').toBeCloseTo(DIALOG_HEIGHT_PX, 0);
      const sizes = await list.evaluate((element) => ({ scroll: element.scrollHeight, client: element.clientHeight }));
      expect(sizes.scroll, '15 titles are taller than the list').toBeGreaterThan(sizes.client);
      await expect(list, 'a list that scrolls is a tab stop').toHaveAttribute('tabindex', '0');
      expect(await sectionPanel(dialog).evaluate((element) => element.scrollHeight - element.clientHeight), 'the panel does not scroll').toBeLessThanOrEqual(TOLERANCE_PX);

      const filter = titlesFilter(dialog);
      const head = dialog.locator('.rq-runner-titles--popup .rq-runner-head');
      const before = { filter: (await filter.boundingBox())!, head: (await head.boundingBox())! };
      await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      expect(await list.evaluate((element) => element.scrollTop), 'the list scrolled').toBeGreaterThan(0);
      const after = { filter: (await filter.boundingBox())!, head: (await head.boundingBox())! };
      expect(after.filter.y, 'the filter row did not move').toBeCloseTo(before.filter.y, 0);
      expect(after.head.y, 'the heading did not move').toBeCloseTo(before.head.y, 0);
      // Sidan bakom (Board) har ett eget överflöd i sidled som inte hör till popupen; det som prövas är dialogen, dess scrollyta, panelen och listan.
      for (const [label, locator] of [['dialog', dialog], ['content', dialog.locator('.rq-runner-popup__content')], ['panel', sectionPanel(dialog)], ['list', list]] as const) {
        expect(await locator.evaluate((element) => element.scrollWidth - element.clientWidth), `${label} does not scroll sideways`).toBeLessThanOrEqual(0);
      }
      const pageOverflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const onTitles = await pageOverflow();
      await sectionTab(dialog, 'Overview').click();
      await expectSectionLoaded(dialog, 'Overview');
      expect(onTitles, 'the Titles tab adds no sideways overflow to the page compared with Overview').toBe(await pageOverflow());
      testInfo.annotations.push({ type: 'list', description: JSON.stringify({ dialogHeight: (await dialog.boundingBox())!.height, list: sizes, filterTop: before.filter.y, pageOverflow: onTitles }) });
    });
  }

  test('the titles are in two columns at 1024, 1280 and 1440 px, and in one column when the dialog is narrower', async ({ page }, testInfo) => {
    const report: Record<string, number> = {};
    for (const width of [1024, 1280, 1440]) {
      const dialog = await openTitlesTab(page, width, 900, 6);
      const rows = heldRows(dialog);
      report[`${width}: columns`] = await columnsOf(rows);
      report[`${width}: row width`] = Math.round((await rows.first().boundingBox())!.width);
      report[`${width}: list width`] = Math.round((await titlesList(dialog).boundingBox())!.width);
      expect(report[`${width}: columns`], `${width}: two columns`).toBe(2);
    }
    const dialog = await openTitlesTab(page, 1280, 900, 6);
    await dialog.evaluate((element) => { (element as HTMLElement).style.width = '480px'; });
    report['narrow dialog: columns'] = await columnsOf(heldRows(dialog));
    expect(report['narrow dialog: columns'], 'one column when the two do not fit').toBe(1);
    testInfo.annotations.push({ type: 'columns', description: JSON.stringify(report) });
  });

  test('the filter lists the categories of the titles, narrows the list and the count, and a list that fits is no tab stop', async ({ page }) => {
    const dialog = await openTitlesTab(page, 1280, 900, 15);
    const filter = titlesFilter(dialog);

    await expect(filter.getByRole('button')).toHaveText(['All', 'Time of day', 'Distance', 'Pace', 'Consistency']);
    await expect(filter.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByText('15 held')).toBeVisible();

    await filter.getByRole('button', { name: 'Distance' }).click();
    await expect(dialog.getByText('5 held')).toBeVisible();
    await expect(heldRows(dialog)).toHaveCount(5);
    await expect(heldRows(dialog).first().locator('.rq-runner-title__type')).toHaveText('Distance');
    await expect(sectionPanel(dialog).getByRole('heading', { name: /^Runner-up/ })).toHaveCount(0);
    await expect(titlesList(dialog), 'a list that fits is not a tab stop').not.toHaveAttribute('tabindex', /.*/);

    await filter.getByRole('button', { name: 'Pace' }).click();
    await expect(dialog.getByText('0 held')).toBeVisible();
    await expect(sectionPanel(dialog).getByRole('heading', { name: 'Runner-up · 1' })).toBeVisible();

    await filter.getByRole('button', { name: 'All' }).click();
    await expect(heldRows(dialog)).toHaveCount(15);
    await expect(titlesList(dialog)).toHaveAttribute('tabindex', '0');
  });

  test('the filter is back on "All" when the popup is opened again', async ({ page }) => {
    const dialog = await openTitlesTab(page, 1280, 900, 6);
    await titlesFilter(dialog).getByRole('button', { name: 'Distance' }).click();
    await expect(titlesFilter(dialog).getByRole('button', { name: 'Distance' })).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await openPopup(page);
    await sectionTab(popup(page), 'Titles held').click();
    await expectSectionLoaded(popup(page), 'Titles held');
    await expect(titlesFilter(popup(page)).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    await expect(heldRows(popup(page))).toHaveCount(6);
  });

  test('a runner whose titles are all in one category has no filter, and a runner without titles has the invitation text', async ({ page }) => {
    const single = await openTitlesTab(page, 1280, 900, 4, { titles: { titleMetrics: ['longestRun'], runnersUp: 0 } });
    await expect(single.getByText('4 held')).toBeVisible();
    await expect(sectionPanel(single).getByRole('group', { name: 'Titles filter', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await openBoard(page, 1280, 900, 0, 0, { titles: { runnersUp: 0 } });
    const none = await openPopup(page);
    await sectionTab(none, 'Titles held').click();
    await expect(none.getByText('No titles yet — Bo is still chasing the first one.')).toBeVisible();
    await expect(sectionPanel(none).getByRole('group', { name: 'Titles filter', exact: true })).toHaveCount(0);
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`the labels are at least ${MIN_LABEL_PX} px and the text is at least ${MIN_LABEL_CONTRAST}:1 in the ${theme} theme at 1024, 1280 and 1440 px`, async ({ page }, testInfo) => {
      const report: Record<string, Record<string, number>> = {};
      for (const width of [1024, 1280, 1440]) {
        const dialog = await openTitlesTab(page, width, 900, 15, { theme });
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

        const measured: Record<string, number> = {};
        const sample = async (label: string, selector: string) => {
          for (const found of await page.evaluate(contrastOf, { selectors: [selector] })) measured[label] = Math.min(measured[label] ?? Infinity, found.ratio);
        };
        const sizeOf = (selector: string) => dialog.locator(selector).evaluateAll((elements) => elements.map((element) => parseFloat(getComputedStyle(element).fontSize)));

        const held = '.rq-runner-titles--popup .rq-runner-title[data-kind="held"]';
        const runnerUpRow = '.rq-runner-titles--popup .rq-runner-title[data-kind="runner-up"]';
        await sample('filter: resting button', '.rq-runner-titles__filter > .rq-filter[aria-pressed="false"]');
        await sample('filter: pressed button', '.rq-runner-titles__filter > .rq-filter[aria-pressed="true"]');
        await sample('held: name', `${held} .rq-runner-title__name`);
        await sample('held: type', `${held} .rq-runner-title__type`);
        await sample('held: value', `${held} .rq-runner-title__value`);
        await sample('heading: count', '.rq-runner-titles--popup .rq-runner-head__aside');
        await sample('runner-up: heading', '.rq-runner-titles--popup .rq-runner-sub');
        await sample('runner-up: name', `${runnerUpRow} .rq-runner-title__name`);
        await sample('runner-up: held by', `${runnerUpRow} .rq-runner-title__holder`);
        await sample('runner-up: gap or value', `${runnerUpRow} .rq-runner-title__value`);
        for (const selector of ['.rq-runner-titles__filter > .rq-filter', '.rq-runner-title__type', '.rq-runner-title__holder', '.rq-runner-sub', '.rq-runner-head__aside']) {
          for (const size of await sizeOf(selector)) expect(size, `${selector} size at ${width}`).toBeGreaterThanOrEqual(MIN_LABEL_PX);
        }

        report[String(width)] = { ...measured };
        expect(Object.keys(measured).length, 'the samples were found').toBeGreaterThan(8);
        for (const [label, ratio] of Object.entries(measured)) expect(ratio, `${theme} ${width}: ${label}`).toBeGreaterThanOrEqual(MIN_LABEL_CONTRAST);

        // Fokusringen på listan (tangentbordet når den bara när den scrollar): inåtriktad och minst 3:1 mot kortets yta. Ringens färg läggs som textfärg på listan för att mätas som text mot ytan.
        await sectionTab(dialog, 'Titles held').focus();
        await page.keyboard.press('Tab');
        const list = titlesList(dialog);
        await list.focus();
        const ring = await list.evaluate((element) => {
          const style = getComputedStyle(element);
          element.style.color = style.outlineColor;
          return { style: style.outlineStyle, offset: parseFloat(style.outlineOffset) };
        });
        expect(ring.style, 'the focused list draws a ring').not.toBe('none');
        expect(ring.offset, 'the ring is drawn inside the list').toBeLessThan(0);
        const [ringSample] = await page.evaluate(contrastOf, { selectors: ['.rq-runner-titles__scroll'] });
        report[String(width)]!['focus ring of the list'] = ringSample!.ratio;
        expect(ringSample!.ratio, `${theme} ${width}: focus ring of the list`).toBeGreaterThanOrEqual(MIN_RING_CONTRAST);
        await list.evaluate((element) => { element.style.color = ''; });
      }
      testInfo.annotations.push({ type: `contrast ${theme}`, description: JSON.stringify(report) });
    });
  }
});

test.describe('the runner card as a page', () => {
  test('a direct load of /runner/:id renders the page, not the popup, on a 1280 px screen', async ({ page }) => {
    await stubGroup(page, 3);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/runner/${RUNNER.id}`);
    await dismissOverlays(page);

    await expect(page.getByRole('heading', { level: 1, name: RUNNER.name })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Standings' })).toBeVisible();
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
