import type { Page } from '@playwright/test';
import type { ChallengeGroupStat, MyChallengesData } from '../../../packages/shared/src/contracts/challenges';
import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';
import { apiIsStubbed } from '../support/stubApi';
import { waitForStylesApplied } from '../support/stylesApplied';

/** Några pixlar marginal för subpixelavrundning i mätningarna. */
const TOLERANCE_PX = 1;

const WIDTHS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 800 },
];

const CORS_HEADERS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const STAKE = { winner_delta: 0.5, winner_duration: 14, winner_type: 'multiplier_days', loser_delta: -0.25, loser_duration: 14, loser_type: 'multiplier_days' };

// Utmaningsarket öppnas med två tokens och tre möjliga motståndare. Svaren läggs över det fejkade API:et för just de här anropen (bara det här provet), så arket har
// innehåll att mäta även när kontot saknar tokens. Mot staging körs provet inte: stubben är det som ger arket sitt innehåll.
const myChallenges: MyChallengesData = {
  tokens: [
    { id: 'token-minor', tier: 'minor', metric: 'km', duration_days: 7, earned_at: '2026-09-01T08:00:00Z', reward_id: 'reward-1', ...STAKE, winner_delta: 0.15, winner_duration: 5, loser_delta: -0.07, loser_duration: 5 },
    { id: 'token-legendary', tier: 'legendary', metric: 'km', duration_days: 14, earned_at: '2026-09-02T08:00:00Z', reward_id: 'reward-2', ...STAKE },
  ],
  sent_challenge: null,
  received_challenges: [],
  boosts: [],
  history: [],
  group_active: [],
};
const members: ChallengeGroupStat[] = ['Anna Lindqvist', 'Erik Svensson', 'Maria Johansson'].map((name, index) => ({
  user_id: `member-${index + 1}`, name, wins: 1, draws: 0, losses: 0, total: 1, points: 3, challenge_active: false, has_pending_challenge: false, current_level: 10 + index, profile_picture: null,
}));
const headToHead = { opponent: { id: 'member-1', name: 'Anna Lindqvist' }, record: { wins: 1, draws: 0, losses: 0, total: 1 }, history: [], active: null };

async function stubChallengeApi(page: Page): Promise<void> {
  await page.route('**/api/challenges/**', (route) => {
    const url = route.request().url();
    const data = url.includes('/challenges/my') ? myChallenges : url.includes('/group-stats') ? members : headToHead;
    return route.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
  });
}

test.describe('the send-a-challenge sheet', () => {
  test.skip(!apiIsStubbed(), 'The sheet is filled from a stubbed challenges API; run with E2E_STUB_API=1 against a local build.');

  for (const { name, width, height } of WIDTHS) {
    test(`the bet card lines up with the other cards on a ${name} (${width} px)`, async ({ page }) => {
      await stubChallengeApi(page);
      await page.setViewportSize({ width, height });
      await page.goto('/duels');
      await dismissOverlays(page);
      await page.getByRole('button', { name: /^send/i }).first().click();
      const sheet = page.getByRole('dialog', { name: 'Send a challenge' });
      await expect(sheet.getByRole('region', { name: 'The bet' })).toBeVisible();
      await waitForStylesApplied(page);

      const measured = await sheet.evaluate((root) => {
        const textLeft = (node: Element) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          return range.getBoundingClientRect().left;
        };
        const inner = (card: Element) => {
          const style = getComputedStyle(card);
          return { top: parseFloat(style.paddingTop), left: parseFloat(style.paddingLeft), right: parseFloat(style.paddingRight), bottom: parseFloat(style.paddingBottom) };
        };
        const bet = root.querySelector('section[aria-labelledby="duels-send-bet"]')!;
        const tokens = root.querySelector('[role="group"][aria-labelledby="duels-send-token"]')!;
        const option = tokens.querySelector('button')!;
        const betBox = bet.getBoundingClientRect();
        const tokensBox = tokens.getBoundingClientRect();
        const label = bet.querySelector('h3')!;
        const columns = Array.from(bet.querySelectorAll('dl > div')).map((column) => ({
          term: column.querySelector('dt')!.textContent ?? '',
          offsetOfTerm: textLeft(column.querySelector('dt')!) - column.getBoundingClientRect().left,
          offsetOfValue: textLeft(column.querySelector('dd')!) - column.getBoundingClientRect().left,
        }));
        return {
          leftEdge: betBox.left - tokensBox.left,
          rightEdge: betBox.right - tokensBox.right,
          betPadding: inner(bet),
          optionPadding: inner(option),
          labelOffset: textLeft(label) - betBox.left,
          firstTermOffset: textLeft(bet.querySelector('dl > div dt')!) - betBox.left,
          columns,
        };
      });

      expect(Math.abs(measured.leftEdge), 'the bet card starts at the same left edge as the token cards').toBeLessThanOrEqual(TOLERANCE_PX);
      expect(Math.abs(measured.rightEdge), 'the bet card ends at the same right edge as the token cards').toBeLessThanOrEqual(TOLERANCE_PX);
      expect(measured.betPadding, 'the bet card has the same inner padding as the other cards').toEqual(measured.optionPadding);
      expect(Math.abs(measured.firstTermOffset - measured.labelOffset), 'the stakes start at the same left edge as the card heading').toBeLessThanOrEqual(TOLERANCE_PX);
      for (const column of measured.columns) {
        expect(column.offsetOfTerm, `"${column.term}" is left-aligned in its column`).toBeLessThanOrEqual(TOLERANCE_PX);
        expect(column.offsetOfValue, `the value under "${column.term}" is left-aligned in its column`).toBeLessThanOrEqual(TOLERANCE_PX);
      }
    });
  }
});
