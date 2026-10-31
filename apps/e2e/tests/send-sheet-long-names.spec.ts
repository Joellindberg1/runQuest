import type { Page } from '@playwright/test';
import type { ChallengeGroupStat, MyChallengesData } from '../../../packages/shared/src/contracts/challenges';
import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';
import { apiIsStubbed } from '../support/stubApi';
import { waitForStylesApplied } from '../support/stylesApplied';

/** Några pixlar marginal för subpixelavrundning i mätningarna. */
const TOLERANCE_PX = 1;

const SCREENS = [
  { width: 320, height: 640 },
  { width: 375, height: 812 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];
const THEMES = ['dark', 'light'] as const;

// Tre namn på 35-45 tecken utan en enda brytpunkt (inga mellanslag eller bindestreck): ett fritt val, en motståndare som väntar på svar och en som redan är i en duell.
const FREE_NAME = 'Wolfeschlegelsteinhausenbergerdorff';
const PENDING_NAME = 'Llanfairpwllgwyngyllgogerychwyrndrobwll';
const BUSY_NAME = 'Pneumonoultramicroscopicsilicovolcanoconiosis';
const NORMAL_NAME = 'Maria Johansson';

const CORS_HEADERS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const STAKE = { winner_delta: 0.5, winner_duration: 14, winner_type: 'multiplier_days', loser_delta: -0.25, loser_duration: 14, loser_type: 'multiplier_days' };

// Arket fylls av API-svar som läggs över det fejkade API:et (som i send-sheet-bet): en token och fyra möjliga motståndare, tre av dem med långa namn.
const myChallenges: MyChallengesData = {
  tokens: [{ id: 'token-legendary', tier: 'legendary', metric: 'km', duration_days: 14, earned_at: '2026-09-02T08:00:00Z', reward_id: 'reward-1', ...STAKE }],
  sent_challenge: null,
  received_challenges: [],
  boosts: [],
  history: [],
  group_active: [],
};
const MEMBER_STATE = [
  { name: FREE_NAME, challenge_active: false, has_pending_challenge: false },
  { name: NORMAL_NAME, challenge_active: false, has_pending_challenge: false },
  { name: PENDING_NAME, challenge_active: false, has_pending_challenge: true },
  { name: BUSY_NAME, challenge_active: true, has_pending_challenge: false },
];
const members: ChallengeGroupStat[] = MEMBER_STATE.map((member, index) => ({
  user_id: `member-${index + 1}`, ...member, wins: 1, draws: 0, losses: 0, total: 1, points: 3, current_level: 10 + index, profile_picture: null,
}));
// Rekordet är förlust, så att varje rad som går att välja visar "0-1 to <förnamn>": ett förnamn utan brytpunkt hamnar också i radens högra text.
const headToHead = { opponent: { id: 'member-1', name: FREE_NAME }, record: { wins: 0, draws: 0, losses: 1, total: 1 }, history: [], active: null };

async function stubChallengeApi(page: Page): Promise<void> {
  await page.route('**/api/challenges/**', (route) => {
    const url = route.request().url();
    const data = url.includes('/challenges/my') ? myChallenges : url.includes('/group-stats') ? members : headToHead;
    return route.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
  });
}

test.describe('the send-a-challenge sheet with long opponent names', () => {
  test.skip(!apiIsStubbed(), 'The sheet is filled from a stubbed challenges API; run with E2E_STUB_API=1 against a local build.');

  for (const theme of THEMES) {
    for (const { width, height } of SCREENS) {
      test(`long names stay inside the sheet and its reasons stay readable on a ${width} px screen in the ${theme} theme`, async ({ page }) => {
        await stubChallengeApi(page);
        await page.addInitScript((value) => window.localStorage.setItem('theme', value), theme);
        await page.setViewportSize({ width, height });
        await page.goto('/duels');
        await dismissOverlays(page);
        await page.getByRole('button', { name: /^send/i }).first().click();
        const sheet = page.getByRole('dialog', { name: 'Send a challenge' });
        const opponents = sheet.getByRole('group', { name: /Pick an opponent/ });
        await expect(opponents.getByRole('button', { name: new RegExp(BUSY_NAME) })).toBeVisible();
        await waitForStylesApplied(page);
        await expect(page.locator('html'), 'the requested theme is the one that is applied').toHaveAttribute('data-theme', theme);

        // En valbar rad träffas av ett klick (Playwright klickar bara om raden är det som ligger under pekaren), och valet fyller i "The bet" med förnamnet.
        const free = opponents.getByRole('button', { name: new RegExp(FREE_NAME) });
        await free.click();
        await expect(free).toHaveAttribute('aria-pressed', 'true');
        await expect(sheet.locator('.rq-duels-bet__summary')).toContainText(FREE_NAME);

        const measured = await sheet.evaluate((root, { names, tolerance }) => {
          const textRect = (node: Element) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            return range.getBoundingClientRect();
          };
          const body = root.querySelector('.rq-duels-sheet__body')!;
          const frame = root.getBoundingClientRect();
          const summary = textRect(root.querySelector('.rq-duels-bet__summary')!);
          const rows = Array.from(root.querySelectorAll('.rq-duels-option--opponent')).map((row) => {
            const rowBox = row.getBoundingClientRect();
            const nameNode = row.querySelector('.rq-name')!;
            const name = textRect(nameNode);
            // Texten till höger på raden: skälet när motståndaren är upptagen, annars head-to-head-tipset.
            const asideNode = row.querySelector('.rq-duels-option__h2h');
            const aside = asideNode ? textRect(asideNode) : null;
            return {
              label: names.find((candidate) => nameNode.textContent === candidate) ?? 'unknown',
              asideText: asideNode?.textContent ?? '',
              nameOutsideRow: Math.max(rowBox.left - name.left, name.right - rowBox.right),
              nameOutsideSheet: Math.max(frame.left - name.left, name.right - frame.right),
              asideOutsideRow: aside ? Math.max(rowBox.left - aside.left, aside.right - rowBox.right) : 0,
              asideOutsideSheet: aside ? Math.max(frame.left - aside.left, aside.right - frame.right) : 0,
              asideOverlapsName: aside ? Math.min(name.right, aside.right) - Math.max(name.left, aside.left) > tolerance && Math.min(name.bottom, aside.bottom) - Math.max(name.top, aside.top) > tolerance : false,
              rowOutsideSheet: Math.max(frame.left - rowBox.left, rowBox.right - frame.right),
            };
          });
          return {
            bodyOverflow: body.scrollWidth - body.clientWidth,
            sheetOverflow: root.scrollWidth - root.clientWidth,
            pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            summaryOutsideSheet: Math.max(frame.left - summary.left, summary.right - frame.right),
            rows,
          };
        }, { names: [FREE_NAME, PENDING_NAME, BUSY_NAME, NORMAL_NAME], tolerance: TOLERANCE_PX });

        expect(measured.bodyOverflow, 'the sheet body does not scroll sideways').toBeLessThanOrEqual(TOLERANCE_PX);
        expect(measured.sheetOverflow, 'the sheet does not clip anything sideways').toBeLessThanOrEqual(TOLERANCE_PX);
        expect(measured.pageOverflow, 'the page does not scroll sideways').toBeLessThanOrEqual(TOLERANCE_PX);
        expect(measured.summaryOutsideSheet, 'the bet summary with the long first name stays inside the sheet').toBeLessThanOrEqual(TOLERANCE_PX);
        expect(measured.rows.map((row) => row.label).sort(), 'all four opponents are listed').toEqual([FREE_NAME, PENDING_NAME, BUSY_NAME, NORMAL_NAME].sort());
        for (const row of measured.rows) {
          expect(row.rowOutsideSheet, `the row for ${row.label} stays inside the sheet`).toBeLessThanOrEqual(TOLERANCE_PX);
          expect(row.nameOutsideRow, `${row.label} stays inside its own row`).toBeLessThanOrEqual(TOLERANCE_PX);
          expect(row.nameOutsideSheet, `${row.label} stays inside the sheet`).toBeLessThanOrEqual(TOLERANCE_PX);
          expect(row.asideOutsideRow, `the text beside ${row.label} stays inside its row`).toBeLessThanOrEqual(TOLERANCE_PX);
          expect(row.asideOutsideSheet, `the text beside ${row.label} stays inside the sheet`).toBeLessThanOrEqual(TOLERANCE_PX);
          expect(row.asideOverlapsName, `the text beside ${row.label} does not overlap the name`).toBe(false);
        }
        const asides = Object.fromEntries(measured.rows.map((row) => [row.label, row.asideText]));
        expect(asides[PENDING_NAME], 'the opponent with a pending challenge says so').toBe('Waiting on a reply');
        expect(asides[BUSY_NAME], 'the opponent in a duel says so').toBe('In a duel');
        expect(asides[FREE_NAME], 'a free opponent shows the head-to-head hint with the long first name').toBe(`0–1 to ${FREE_NAME}`);

        // Avstängda rader förblir avstängda med skälet läsbart.
        await expect(opponents.getByRole('button', { name: new RegExp(PENDING_NAME) })).toBeDisabled();
        await expect(opponents.getByRole('button', { name: new RegExp(BUSY_NAME) })).toBeDisabled();
        await expect(opponents.getByText('Waiting on a reply')).toBeVisible();
        await expect(opponents.getByText('In a duel')).toBeVisible();
      });
    }
  }
});
