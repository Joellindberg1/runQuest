import type { Page } from '@playwright/test';
import type { ChallengeRow, MyChallengesData } from '../../../packages/shared/src/contracts/challenges';
import type { EventItem } from '../../../packages/shared/src/contracts/events';
import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';
import { STUB_USER, apiIsStubbed } from '../support/stubApi';
import { waitForStylesApplied } from '../support/stylesApplied';
import { targets } from '../support/targets';

/** Några pixlar marginal för subpixelavrundning i mätningarna. */
const TOLERANCE_PX = 1;

// Right now-panelen i sidnavet finns bara på datorbredd. 1024 px är den smalaste, där panelen är som trängst.
const SCREENS = [1024, 1280, 1440];
const SCREEN_HEIGHT = 900;
const THEMES = ['dark', 'light'] as const;

// Ett enda ord utan brytpunkt, 45 tecken: namn har ingen längdgräns. Eventnamnet är ett ord på 34 tecken, ändå bredare än panelens textkolumn.
const LONG_OPPONENT = 'Pneumonoultramicroscopicsilicovolcanoconiosis';
const LONG_EVENT = 'Supercalifragilisticexpialidocious Dash';
const ORDINARY_OPPONENT = 'Anna Lindqvist';
const ORDINARY_EVENT = 'Sunday Sprint';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

/** Datum som YYYY-MM-DD, `days` dagar från nu (UTC). Panelens nedräkning är i hela dagar, så bredden ändras inte under en körning. */
function dayFromNow(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function instantFromNow(days: number, hours = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}

function duelAgainst(opponentName: string, pending: boolean): ChallengeRow {
  return {
    id: 'duel-1',
    group_id: 'group-1',
    tier: 'minor',
    challenger_id: STUB_USER.id,
    challenger_name: STUB_USER.name,
    opponent_id: 'opponent-1',
    opponent_name: opponentName,
    metric: 'km',
    duration_days: 7,
    winner_delta: 0.15,
    winner_duration: 5,
    winner_type: 'multiplier_days',
    loser_delta: -0.07,
    loser_duration: 5,
    loser_type: 'multiplier_days',
    challenger_level: 4,
    opponent_level: 5,
    start_date: pending ? dayFromNow(3) : dayFromNow(-1),
    end_date: pending ? dayFromNow(10) : dayFromNow(5),
    status: 'active',
    created_at: instantFromNow(-2),
  };
}

function eventNamed(name: string): EventItem {
  return {
    id: 'event-1',
    type: 'participation',
    metric: 'km',
    status: 'active',
    startsAt: instantFromNow(0, -1),
    endsAt: instantFromNow(3),
    template: { name, icon: 'bolt', description: 'Run before it ends', minKm: 2, rewardXp: 50, rewardXp1st: 0, rewardXp2nd: 0, rewardXp3rd: 0 },
    myEntry: null,
    leaderboard: null,
    participantCount: 2,
    memberCount: 6,
  };
}

// Svaret sätts i webbläsaren och ersätter svaret från det fejkade API:et (sidans rutt går före kontextens), så ett riktigt API aldrig får en förfrågan om duellen.
async function answerWith(page: Page, path: string, data: unknown, extra: object = {}): Promise<void> {
  await page.route(`${targets.apiUrl}/**${path}`, (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS_HEADERS })
      : route.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify({ success: true, data, ...extra }) }),
  );
}

async function openBoardWithRightNow(page: Page, options: { width: number; theme: (typeof THEMES)[number]; opponent: string; event: string; pending?: boolean }): Promise<void> {
  const myChallenges: MyChallengesData = {
    tokens: [],
    sent_challenge: null,
    received_challenges: [],
    boosts: [],
    history: [],
    group_active: [duelAgainst(options.opponent, options.pending ?? false)],
  };
  const events = [eventNamed(options.event)];
  await answerWith(page, '/challenges/my', myChallenges);
  await answerWith(page, '/events', { events }, { events });
  await page.addInitScript((theme) => window.localStorage.setItem('theme', theme), options.theme);
  await page.setViewportSize({ width: options.width, height: SCREEN_HEIGHT });
  await page.goto('/board');
  await dismissOverlays(page);
  const panel = page.getByRole('region', { name: 'Right now' });
  await expect(panel.getByRole('link', { name: new RegExp(`vs ${options.opponent}`) })).toBeVisible();
  await expect(panel.getByRole('link', { name: new RegExp(options.event.split(' ')[0] ?? options.event) })).toBeVisible();
  await waitForStylesApplied(page);
}

interface MeasuredRow {
  /** Radens rubrik (etikett), för felmeddelandet. */
  title: string;
  rowLeft: number;
  rowRight: number;
  /** Avstånd från panelens kant in till textens kant (negativt = utanför rutan), per textdel. */
  labelLeft: number;
  labelRight: number;
  noteLeft: number;
  noteRight: number;
  valueLeft: number;
  valueRight: number;
  /** Luften mellan textkolumnens högra kant och värdet: negativt = texten går in i värdet. */
  noteToValue: number;
  labelToValue: number;
  box: { top: number; height: number; left: number; width: number };
  labelBox: { top: number; height: number; left: number; width: number };
  noteBox: { top: number; height: number; left: number; width: number };
  valueBox: { top: number; height: number; left: number; width: number };
}

interface MeasuredPanel {
  panelBox: { top: number; height: number; left: number; width: number };
  rows: MeasuredRow[];
  sidenavOverflow: number;
  pageOverflow: number;
}

// Måttet tas i webbläsaren: textens rektangel (`Range`) mot panelens ram, så att text som ligger utanför rutan syns även när elementet självt är klippt eller bara sticker ut.
async function measurePanel(page: Page, loosenRules = false): Promise<MeasuredPanel> {
  return page.evaluate((loosen) => {
    const panel = document.querySelector('.rq-rightnow')!;
    // Basen: samma panel utan brytreglerna (som den ritades före fixen). Textkolumnen är radens andra barn, så provet behöver inte veta vad klassen heter.
    if (loosen) {
      panel.querySelectorAll<HTMLElement>('.rq-rightnow__row > :nth-child(2)').forEach((column) => {
        column.style.setProperty('min-width', 'auto');
        column.style.setProperty('overflow-wrap', 'normal');
      });
    }
    const textRect = (node: Element) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect();
    };
    const boxOf = (node: Element) => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, height: rect.height, left: rect.left, width: rect.width };
    };
    const frame = panel.getBoundingClientRect();
    const rows = Array.from(panel.querySelectorAll('.rq-rightnow__row')).map((row): MeasuredRow => {
      const label = row.querySelector('.rq-rightnow__label')!;
      const note = row.querySelector('.rq-rightnow__note')!;
      const value = row.querySelector('.rq-rightnow__value')!;
      const rowBox = row.getBoundingClientRect();
      const labelText = textRect(label);
      const noteText = textRect(note);
      const valueText = textRect(value);
      return {
        title: label.textContent ?? '',
        rowLeft: rowBox.left - frame.left,
        rowRight: frame.right - rowBox.right,
        labelLeft: labelText.left - frame.left,
        labelRight: frame.right - labelText.right,
        noteLeft: noteText.left - frame.left,
        noteRight: frame.right - noteText.right,
        valueLeft: valueText.left - frame.left,
        valueRight: frame.right - valueText.right,
        noteToValue: valueText.left - noteText.right,
        labelToValue: valueText.left - labelText.right,
        box: boxOf(row),
        labelBox: boxOf(label),
        noteBox: boxOf(note),
        valueBox: boxOf(value),
      };
    });
    const sidenav = document.querySelector('.rq-sidenav')!;
    return {
      panelBox: boxOf(panel),
      rows,
      sidenavOverflow: sidenav.scrollWidth - sidenav.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  }, loosenRules);
}

test.describe('the Right now widget in the side navigation', () => {
  test.skip(!apiIsStubbed(), 'The duel and the event come from API answers laid over the stubbed API; run with E2E_STUB_API=1 against a local build.');

  for (const width of SCREENS) {
    for (const theme of THEMES) {
      for (const pending of [false, true]) {
        test(`a very long word in the opponent and event names stays inside the widget with a ${pending ? 'pending' : 'live'} duel at ${width} px in the ${theme} theme`, async ({ page }) => {
          await openBoardWithRightNow(page, { width, theme, opponent: `Ann ${LONG_OPPONENT}`, event: LONG_EVENT, pending });
          const measured = await measurePanel(page);

          expect(measured.rows.length, 'the event and the duel are in the widget').toBe(2);
          for (const row of measured.rows) {
            expect(row.rowLeft, `the row "${row.title}" starts inside the widget`).toBeGreaterThanOrEqual(-TOLERANCE_PX);
            expect(row.rowRight, `the row "${row.title}" ends inside the widget`).toBeGreaterThanOrEqual(-TOLERANCE_PX);
            for (const [part, left, right] of [
              ['label', row.labelLeft, row.labelRight],
              ['note', row.noteLeft, row.noteRight],
              ['value', row.valueLeft, row.valueRight],
            ] as const) {
              expect(left, `the ${part} of "${row.title}" starts inside the widget`).toBeGreaterThanOrEqual(-TOLERANCE_PX);
              expect(right, `the ${part} of "${row.title}" ends inside the widget`).toBeGreaterThanOrEqual(-TOLERANCE_PX);
            }
            expect(row.noteToValue, `the note of "${row.title}" does not run into its value`).toBeGreaterThanOrEqual(-TOLERANCE_PX);
            expect(row.labelToValue, `the label of "${row.title}" does not run into its value`).toBeGreaterThanOrEqual(-TOLERANCE_PX);
          }
          expect(measured.sidenavOverflow, 'the side navigation does not scroll sideways').toBeLessThanOrEqual(TOLERANCE_PX);
          expect(measured.pageOverflow, 'the page does not scroll sideways').toBeLessThanOrEqual(TOLERANCE_PX);
        });
      }
    }

    for (const theme of THEMES) {
      test(`ordinary names keep every box of the widget as without the break rules at ${width} px in the ${theme} theme`, async ({ page }) => {
        await openBoardWithRightNow(page, { width, theme, opponent: ORDINARY_OPPONENT, event: ORDINARY_EVENT });
        const withRules = await measurePanel(page);
        const withoutRules = await measurePanel(page, true);

        expect(withRules.rows.length, 'the event and the duel are in the widget').toBe(2);
        expect(withRules).toEqual(withoutRules);
      });
    }
  }
});
