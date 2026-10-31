import type { Page } from '@playwright/test';
import type { ChallengeGroupStat, ChallengeHistoryItem, ChallengeRow, MyChallengesData } from '../../../packages/shared/src/contracts/challenges';
import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';
import { apiIsStubbed } from '../support/stubApi';
import { waitForStylesApplied } from '../support/stylesApplied';

/** Några pixlar marginal för subpixelavrundning i mätningarna. */
const TOLERANCE_PX = 1;
/** Minsta tryckyta på mobil (WCAG 2.5.5, och appens egen regel för knappar). */
const MIN_TAP_PX = 44;
const MOBILE_MAX_WIDTH = 1023;

// Bredderna där raderna förut gick sönder (320 och 1024-1100) och de vanliga runt dem.
const WIDTHS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 1024, height: 768 },
  { width: 1100, height: 800 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];
const THEMES = ['dark', 'light'] as const;
const VIEWS = ['standings', 'live', 'history'] as const;

const CORS_HEADERS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const STAKE = { winner_delta: 0.5, winner_duration: 14, winner_type: 'multiplier_days', loser_delta: -0.25, loser_duration: 14, loser_type: 'multiplier_days' };

// Ett namn utan brytpunkt (45 tecken) och ett långt namn av flera ord, som proven för Board. Mitt eget namn är långt, så min rad (guldtonen) också prövas.
const UNBROKEN_NAME = 'Pneumonoultramicroscopicsilicovolcanoconiosis';
const PHRASE_NAME = 'Maximilian Featherstonehaugh Lindqvist';
const NAMES: Record<string, string> = {
  'member-1': 'Anna Lindqvist',
  'member-2': UNBROKEN_NAME,
  'stub-user-1': PHRASE_NAME,
  'member-4': 'Erik Svensson',
  'member-5': 'Montgomery-Featherstonehaugh Longname',
  'member-6': 'Olof',
};
const MEMBER_IDS = Object.keys(NAMES);

// Vanliga namn av ett eller två ord, för proven av var raderna bryts: under 360 px ska bara mellanslag ge en radbrytning.
const ORDINARY_NAMES: Record<string, string> = {
  'member-1': 'Maria Johansson',
  'member-2': 'Olof Bergstrom',
  'stub-user-1': 'Stub Runner',
  'member-4': 'Erik Svensson',
  'member-5': 'Anna Lindqvist',
  // De bredaste vanliga orden i listan (Christopher 88 px, Gustafsson 83 px) sätter gränsen för namnkolumnen vid 320 px.
  'member-6': 'Christopher Gustafsson',
};

// Två siffror i W, D och L: den bredaste cellen är "12", och procenten når 100.
function standingsFor(names: Record<string, string>, wide = false): ChallengeGroupStat[] {
  return MEMBER_IDS.map((id, index) => ({
    user_id: id,
    name: names[id]!,
    // Med `wide` har första raden tre siffror i W och L (en grupp som spelat länge), de bredaste siffrorna som finns.
    wins: wide && index === 0 ? 888 : 12 - index,
    draws: index % 2 === 0 ? 10 : 0,
    losses: wide && index === 0 ? 777 : 11 - index,
    total: 30,
    points: 99 - index * 7,
    challenge_active: false,
    has_pending_challenge: false,
    current_level: 20 - index,
    profile_picture: null,
  }));
}
const standings = standingsFor(NAMES);

function challenge(id: string, challengerId: string, opponentId: string, status: ChallengeRow['status'] = 'active'): ChallengeRow {
  return {
    id, group_id: 'g1', token_id: null, tier: 'major', challenger_id: challengerId, challenger_name: NAMES[challengerId], opponent_id: opponentId, opponent_name: NAMES[opponentId],
    metric: 'km', duration_days: 14, ...STAKE, challenger_level: 10, opponent_level: 9, start_date: status === 'active' ? '2026-10-20' : null, end_date: status === 'active' ? '2026-11-03' : null, determine_at: null, status, created_at: '2026-10-19T08:00:00Z',
  };
}
const myChallenges: MyChallengesData = {
  tokens: [],
  sent_challenge: challenge('offer-out', 'stub-user-1', 'member-2', 'pending'),
  received_challenges: [challenge('offer-in', 'member-2', 'stub-user-1', 'pending')],
  boosts: [],
  history: [],
  group_active: [challenge('live-1', 'member-2', 'stub-user-1'), challenge('live-2', 'member-5', 'member-1'), challenge('live-3', 'member-4', 'member-6')],
};

const PAIRS: Array<[string, string]> = [['member-2', 'stub-user-1'], ['member-5', 'member-1'], ['stub-user-1', 'member-5'], ['member-4', 'member-2'], ['member-6', 'member-1'], ['member-1', 'member-4']];
const history: ChallengeHistoryItem[] = PAIRS.map(([challengerId, opponentId], index) => ({
  id: `history-${index}`,
  tier: index % 3 === 0 ? 'legendary' : index % 3 === 1 ? 'major' : 'minor',
  metric: index % 2 === 0 ? 'total_xp' : 'km',
  duration_days: 14,
  start_date: '2026-10-01',
  end_date: '2026-10-15',
  ended_at: '2026-10-15T22:00:00Z',
  outcome: index % 3 === 2 ? 'draw' : index % 2 === 0 ? 'challenger_wins' : 'opponent_wins',
  winner_id: index % 3 === 2 ? null : index % 2 === 0 ? challengerId : opponentId,
  challenger: { id: challengerId, name: NAMES[challengerId]!, profile_picture: null, level: 18 },
  opponent: { id: opponentId, name: NAMES[opponentId]!, profile_picture: null, level: 17 },
  challenger_value: 1234.5,
  opponent_value: 1198.25,
  winner_boost: { type: 'multiplier_days', delta: 0.5, duration: 14 },
  loser_boost: { type: 'multiplier_days', delta: -0.25, duration: 14 },
}));

// Svaren sätts i webbläsaren och ersätter det fejkade API:ets svar för just de här anropen, så skärmen har innehåll att mäta.
async function stubDuelsApi(page: Page, groupStats: ChallengeGroupStat[] = standings): Promise<void> {
  await page.route('**/api/challenges/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const reply = (data: unknown, extra: object = {}) =>
      route.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify({ success: true, data, ...extra }) });
    if (path === '/challenges/my') return reply(myChallenges);
    if (path === '/challenges/group-stats') return reply(groupStats);
    if (path === '/challenges/group-history') return reply({ items: history }, { meta: { total: history.length, limit: 20, offset: 0, has_more: false } });
    const progress = path.match(/^\/challenges\/(.+)\/progress$/);
    if (progress) return reply({ challenge_id: progress[1], metric: 'km', start_date: '2026-10-20', end_date: '2026-11-03', progress: [{ user_id: 'member-2', value: 41.5 }, { user_id: 'stub-user-1', value: 38.25 }] });
    return route.fulfill({ status: 404, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'not stubbed' }) });
  });
}

interface RowMeasure {
  rows: number;
  /** Två texter i samma rad vars synliga rektanglar skär varandra. */
  overlaps: string[];
  /** En text som sticker ut ur sin egen ruta eller ur raden. */
  escapes: string[];
  /** Namn där ett musklick mitt på första textraden inte träffar namnknappen. */
  misclicks: string[];
}

// En rad mäts på det användaren ser: texten (ett `Range`) eller, för ett element som klipper (ellips), elementets egen ruta.
async function measureRows(page: Page, rowSelector: string, nameSelector: string): Promise<RowMeasure> {
  return page.evaluate(
    ({ rowSelector, nameSelector, tolerance }) => {
      // Två rader text som ligger tätt över varandra har teckenrutor som skär några pixlar utan att något ritas över något: som överlapp räknas bara en delad textrad (mer än en tredjedel av den lägre).
      const intersects = (a: DOMRect, b: DOMRect) =>
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > tolerance && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > Math.min(a.height, b.height) / 3;
      const textRect = (el: Element) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range.getBoundingClientRect();
      };
      const visibleRect = (el: Element) => (getComputedStyle(el).overflowX === 'visible' ? textRect(el) : el.getBoundingClientRect());
      const label = (el: Element) => `${el.getAttribute('class') ?? el.tagName}:"${(el.textContent ?? '').trim().slice(0, 20)}"`;
      const rows = Array.from(document.querySelectorAll<HTMLElement>(rowSelector));
      const overlaps: string[] = [];
      const escapes: string[] = [];
      for (const row of rows) {
        const rowBox = row.getBoundingClientRect();
        const leaves = Array.from(row.querySelectorAll<HTMLElement>('*')).filter((el) => el.children.length === 0 && (el.textContent ?? '').trim() !== '');
        for (const leaf of leaves) {
          const text = visibleRect(leaf);
          const own = leaf.getBoundingClientRect();
          if (text.left < own.left - tolerance || text.right > own.right + tolerance) escapes.push(`${label(leaf)} leaves its own box by ${Math.round(Math.max(own.left - text.left, text.right - own.right))}px`);
          if (text.left < rowBox.left - tolerance || text.right > rowBox.right + tolerance) escapes.push(`${label(leaf)} leaves its row`);
        }
        for (let first = 0; first < leaves.length; first += 1) {
          for (let second = first + 1; second < leaves.length; second += 1) {
            if (intersects(visibleRect(leaves[first]!), visibleRect(leaves[second]!))) overlaps.push(`${label(leaves[first]!)} x ${label(leaves[second]!)}`);
          }
        }
      }
      const misclicks: string[] = [];
      for (const name of Array.from(document.querySelectorAll<HTMLElement>(nameSelector))) {
        name.scrollIntoView({ block: 'center' });
        const range = document.createRange();
        range.selectNodeContents(name);
        const text = range.getClientRects()[0]!;
        // En text som klipps med ellips ritas bara inom knappens ruta: klicket tas mitt på den synliga delen.
        const box = name.getBoundingClientRect();
        const clipped = getComputedStyle(name).overflowX !== 'visible';
        const left = clipped ? Math.max(text.left, box.left) : text.left;
        const right = clipped ? Math.min(text.right, box.right) : text.right;
        const hit = document.elementFromPoint((left + right) / 2, text.top + text.height / 2);
        if (!hit || !name.contains(hit)) misclicks.push(`${label(name)} hit ${hit ? label(hit) : 'nothing'}`);
      }
      return { rows: rows.length, overlaps, escapes, misclicks };
    },
    { rowSelector, nameSelector, tolerance: TOLERANCE_PX },
  );
}

const VIEW_ROWS: Record<(typeof VIEWS)[number], { row: string; name: string }> = {
  standings: { row: '.rq-duels-standing.rq-row', name: '.rq-duels-standing__name' },
  live: { row: '.rq-duels-live, .rq-duels-offer', name: '.rq-duels-side__name, .rq-duels-namebtn' },
  history: { row: '.rq-duels-match', name: '.rq-duels-match__name' },
};

async function openDuels(page: Page, theme: string, size: { width: number; height: number }, groupStats: ChallengeGroupStat[] = standings): Promise<void> {
  await stubDuelsApi(page, groupStats);
  await page.addInitScript((value) => window.localStorage.setItem('theme', value), theme);
  await page.setViewportSize(size);
  await page.goto('/duels?view=standings');
  await dismissOverlays(page);
  await waitForStylesApplied(page);
}

interface TabsMeasure {
  tabsOnOneRow: boolean;
  selectedInside: boolean;
  overlapsSend: boolean;
  minTabHeight: number;
}

async function measureTabs(page: Page): Promise<TabsMeasure> {
  return page.getByRole('tablist', { name: 'Duels view' }).evaluate((list, tolerance) => {
    const listBox = list.getBoundingClientRect();
    const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]')).map((tab) => ({ box: tab.getBoundingClientRect(), selected: tab.getAttribute('aria-selected') === 'true' }));
    const selected = tabs.find((tab) => tab.selected)!;
    const send = document.querySelector<HTMLElement>('.rq-duels__send')!.getBoundingClientRect();
    return {
      tabsOnOneRow: new Set(tabs.map((tab) => Math.round(tab.box.top / tolerance))).size === 1,
      selectedInside: selected.box.left >= listBox.left - tolerance && selected.box.right <= listBox.right + tolerance,
      overlapsSend: listBox.right > send.left + tolerance && listBox.left < send.right - tolerance && listBox.bottom > send.top + tolerance && listBox.top < send.bottom - tolerance,
      minTabHeight: Math.min(...tabs.map((tab) => tab.box.height)),
    };
  }, TOLERANCE_PX);
}

const TAB_NAMES: Record<(typeof VIEWS)[number], string> = { standings: 'Standings', live: 'Live', history: 'History' };

// Bredderna under 360 px (de smalaste telefonerna) och bredderna där Live-kortet är smalast bredvid sidokolumnen.
const NARROW_WIDTHS = [320, 340];
const LIVE_TIME_WIDTHS = [1024, 1050, 1100];
const STAKE_WIDTHS = [1024, 1050];

/** Ord i ett namn som ligger på mer än en rad: en radbrytning som inte är ett mellanslag. */
async function measureBrokenWords(page: Page, nameSelector: string): Promise<string[]> {
  return page.evaluate((selector) => {
    const broken: string[] = [];
    for (const name of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      const node = name.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) continue;
      const text = node.textContent ?? '';
      for (const word of text.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, word.index!);
        range.setEnd(node, word.index! + word[0].length);
        const lines = new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top)));
        if (lines.size > 1) broken.push(`"${word[0]}" in "${text}" is split over ${lines.size} lines`);
      }
    }
    return broken;
  }, nameSelector);
}

test.describe('the Duels screen with long names', () => {
  test.skip(!apiIsStubbed(), 'The screen is filled from a stubbed challenges API; run with E2E_STUB_API=1 against a local build.');

  // En sida per bredd och tema som går igenom flikarna med klick (som en besökare), så att sidan laddas och överlägg avvaktas en gång.
  for (const theme of THEMES) {
    for (const size of WIDTHS) {
      test(`standings, live and history have no overlapping text, no sideways scroll and a one-line tab row at ${size.width} px in the ${theme} theme`, async ({ page }) => {
        await openDuels(page, theme, size);

        for (const view of VIEWS) {
          if (view !== 'standings') await page.getByRole('tab', { name: TAB_NAMES[view] }).click();
          const { row, name } = VIEW_ROWS[view];
          await expect(page.locator(row).first()).toBeVisible();
          await waitForStylesApplied(page);

          const measured = await measureRows(page, row, name);
          const tabs = await measureTabs(page);
          const scroll = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));

          expect(measured.rows, `${view}: the rows are on the screen`).toBeGreaterThanOrEqual(3);
          expect.soft(measured.overlaps, `${view}: no two texts in a row overlap`).toEqual([]);
          expect.soft(measured.escapes, `${view}: every text stays inside its own box and its row`).toEqual([]);
          expect.soft(measured.misclicks, `${view}: a click in the middle of a name hits the name button`).toEqual([]);
          expect.soft(scroll.scrollWidth, `${view}: the page does not scroll sideways`).toBeLessThanOrEqual(scroll.clientWidth);
          expect.soft(tabs.tabsOnOneRow, `${view}: all four tabs share one row`).toBe(true);
          expect.soft(tabs.selectedInside, `${view}: the selected tab is fully inside the tab row`).toBe(true);
          expect.soft(tabs.overlapsSend, `${view}: the tab row does not run into the Send button`).toBe(false);
          if (size.width <= MOBILE_MAX_WIDTH) expect.soft(tabs.minTabHeight, `${view}: tabs are tall enough to tap`).toBeGreaterThanOrEqual(MIN_TAP_PX);
        }
      });
    }
  }

  // Under 360 px är Standings namnkolumn smal, men ett vanligt namn ska bara brytas vid mellanslag: ett ord bryts aldrig mitt i. (Långa ord utan brytpunkt bryts fortfarande var som helst, se ovan.)
  for (const theme of THEMES) {
    for (const width of NARROW_WIDTHS) {
      test(`standings with ordinary names breaks a name only at spaces at ${width} px in the ${theme} theme`, async ({ page }) => {
        await openDuels(page, theme, { width, height: 700 }, standingsFor(ORDINARY_NAMES, true));
        await expect(page.locator('.rq-duels-standing.rq-row').first()).toBeVisible();
        await waitForStylesApplied(page);

        const measured = await measureRows(page, VIEW_ROWS.standings.row, VIEW_ROWS.standings.name);
        const brokenWords = await measureBrokenWords(page, VIEW_ROWS.standings.name);
        const scroll = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));

        expect(measured.rows, 'the rows are on the screen').toBeGreaterThanOrEqual(3);
        expect.soft(brokenWords, 'every word of a name stays on one line').toEqual([]);
        expect.soft(measured.overlaps, 'no two texts in a row overlap').toEqual([]);
        expect.soft(measured.escapes, 'every text, also three digits in W and L, stays inside its own box and its row').toEqual([]);
        expect.soft(measured.misclicks, 'a click in the middle of a name hits the name button').toEqual([]);
        expect.soft(scroll.scrollWidth, 'the page does not scroll sideways').toBeLessThanOrEqual(scroll.clientWidth);
      });
    }
  }

  // Längden i insatsraden ("+0.5× / 14 d") är en enhet: raden bryts före snedstrecket, aldrig mellan "14" och "d".
  for (const width of STAKE_WIDTHS) {
    test(`the duration in a stake line of a live card is not split over two lines at ${width} px`, async ({ page }) => {
      await openDuels(page, 'dark', { width, height: 800 }, standingsFor(ORDINARY_NAMES));
      await page.getByRole('tab', { name: TAB_NAMES.live }).click();
      await expect(page.locator('.rq-duels-live').first()).toBeVisible();
      await waitForStylesApplied(page);

      const durations = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('.rq-duels-live .rq-duels-stakes dd')).flatMap((cell) => {
          const node = cell.firstChild;
          const match = node?.textContent?.match(/\d+\s(?:d|runs?)$/);
          if (!node || !match) return [];
          const range = document.createRange();
          range.setStart(node, match.index!);
          range.setEnd(node, match.index! + match[0].length);
          return [{ text: cell.textContent ?? '', lines: new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))).size }];
        }),
      );
      const scroll = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));

      expect(durations.length, 'the live cards show a stake with a duration').toBeGreaterThanOrEqual(6);
      expect.soft(durations.filter((duration) => duration.lines !== 1), 'every duration is on one line').toEqual([]);
      expect.soft(scroll.scrollWidth, 'the page does not scroll sideways').toBeLessThanOrEqual(scroll.clientWidth);
    });
  }

  // Längden ("· 7 d") och tiden ("5 d left") i ett Live-kort är var sin enhet: de får inte brytas till flera rader när kortet är smalt (1024-1100 px).
  for (const width of LIVE_TIME_WIDTHS) {
    test(`the duration and the time in a live card each stay on one line at ${width} px`, async ({ page }) => {
      await openDuels(page, 'dark', { width, height: 800 }, standingsFor(ORDINARY_NAMES));
      await page.getByRole('tab', { name: TAB_NAMES.live }).click();
      await expect(page.locator('.rq-duels-live').first()).toBeVisible();
      await waitForStylesApplied(page);

      const lineCounts = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('.rq-duels-live__len, .rq-duels-live__time')).map((time) => {
          const range = document.createRange();
          range.selectNodeContents(time);
          return { text: (time.textContent ?? '').trim(), lines: new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))).size };
        }),
      );
      const scroll = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));

      expect(lineCounts.length, 'the live cards show a duration and a time').toBeGreaterThanOrEqual(6);
      expect.soft(lineCounts.filter((time) => time.lines !== 1), 'every duration and time is on one line').toEqual([]);
      expect.soft(scroll.scrollWidth, 'the page does not scroll sideways').toBeLessThanOrEqual(scroll.clientWidth);
    });
  }
});
