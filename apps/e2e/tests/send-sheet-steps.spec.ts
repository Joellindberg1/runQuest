import type { Locator, Page } from '@playwright/test';
import type { ChallengeGroupStat, MyChallengesData } from '../../../packages/shared/src/contracts/challenges';
import { LEGENDARY_AUTO_START_DAYS } from '../../../packages/shared/src/rules';
import { expect, test } from '../support/test';
import { contrastOf } from '../support/contrast';
import { dismissOverlays } from '../support/overlays';
import { apiIsStubbed } from '../support/stubApi';
import { waitForStylesApplied } from '../support/stylesApplied';

/** Minsta kontrast för text mot sin bakgrund (WCAG AA, normal text). */
const MIN_TEXT_CONTRAST = 4.5;
/** Ett tomt nivåchip är dämpat med flit (en avstängd kontroll är undantagen i WCAG); temafilen lovar minst 3:1. */
const MIN_EMPTY_CHIP_CONTRAST = 3;
/** Minsta träffyta på mobil (samma värde som --rq-control-hit). */
const MIN_HIT_PX = 44;
/** Några tiondels pixlar marginal för subpixelavrundning. */
const ROUNDING_PX = 0.5;

const VIEWPORTS = [
  { width: 320, height: 700, mobile: true },
  { width: 375, height: 812, mobile: true },
  { width: 1280, height: 800, mobile: false },
  { width: 1440, height: 900, mobile: false },
];
const THEMES = ['dark', 'light'] as const;
// Alla tre nivåerna i scenariot "full": tre minor (två identiska), en major och en legendary.
const FILLED_TIERS = [
  { tier: 'minor', label: 'Minor', count: 3 },
  { tier: 'major', label: 'Major', count: 1 },
  { tier: 'legendary', label: 'Legendary', count: 1 },
] as const;

const CORS_HEADERS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const MINOR_STAKE = { winner_delta: 0.15, winner_duration: 5, winner_type: 'multiplier_days', loser_delta: -0.07, loser_duration: 5, loser_type: 'multiplier_days' };
const MAJOR_STAKE = { winner_delta: 0.25, winner_duration: 10, winner_type: 'multiplier_days', loser_delta: -0.12, loser_duration: 10, loser_type: 'multiplier_days' };
const LEGENDARY_STAKE = { winner_delta: 0.5, winner_duration: 14, winner_type: 'multiplier_days', loser_delta: -0.25, loser_duration: 14, loser_type: 'multiplier_days' };

const minorKmA = { id: 'token-minor-km-a', tier: 'minor', metric: 'km', duration_days: 7, earned_at: '2026-09-01T08:00:00Z', reward_id: 'reward-1', ...MINOR_STAKE } as const;
const minorKmB = { id: 'token-minor-km-b', tier: 'minor', metric: 'km', duration_days: 7, earned_at: '2026-09-02T08:00:00Z', reward_id: 'reward-2', ...MINOR_STAKE } as const;
const minorRuns = { id: 'token-minor-runs', tier: 'minor', metric: 'runs', duration_days: 5, earned_at: '2026-09-03T08:00:00Z', reward_id: 'reward-3', ...MINOR_STAKE } as const;
const major = { id: 'token-major', tier: 'major', metric: 'km', duration_days: 10, earned_at: '2026-09-04T08:00:00Z', reward_id: 'reward-4', ...MAJOR_STAKE } as const;
const legendary = { id: 'token-legendary', tier: 'legendary', metric: 'total_xp', duration_days: 30, earned_at: '2026-09-05T08:00:00Z', reward_id: 'reward-5', ...LEGENDARY_STAKE } as const;
const legendaryNoPenalty = { ...legendary, id: 'token-legendary-free', loser_delta: 0, loser_duration: 0 } as const;

type Scenario = 'full' | 'no-major' | 'lone' | 'blocked';
// Alla tre nivåerna med två identiska Minor, utan Major (en tom nivå), och ett ensamt kort på varje nivå.
const TOKENS: Record<Scenario, MyChallengesData['tokens']> = {
  full: [minorKmA, minorKmB, minorRuns, major, legendary],
  'no-major': [minorKmA, minorKmB, minorRuns, legendaryNoPenalty],
  lone: [minorKmA, major, legendaryNoPenalty],
  blocked: [minorKmA, minorKmB, minorRuns, major, legendary],
};

// Jag väntar på svar på en egen skickad utmaning (stubbanvändaren är challenger), så det går inte att skicka en till.
const SENT_CHALLENGE: MyChallengesData['sent_challenge'] = {
  id: 'challenge-sent', group_id: 'g1', token_id: 'token-sent', tier: 'minor', challenger_id: 'stub-user-1', opponent_id: 'member-1', metric: 'km', duration_days: 7, ...MINOR_STAKE,
  challenger_level: 10, opponent_level: 10, status: 'pending', created_at: '2026-10-27T08:00:00Z',
};

// Jag själv (stubbanvändaren) ligger i gruppen och ska aldrig synas som motståndare. Fyra som går att utmana (med varsitt head to head-tips: 2-0, 0-1, oavgjort, aldrig mötts),
// en i en duell och en som väntar på svar.
const ME = { id: 'stub-user-1', name: 'Stub Runner' };
const GROUP = [
  { id: 'member-1', name: 'Anna Lindqvist', record: { wins: 2, draws: 0, losses: 0, total: 2 }, busy: {} },
  { id: 'member-2', name: 'Erik Svensson', record: { wins: 0, draws: 0, losses: 1, total: 1 }, busy: {} },
  { id: 'member-3', name: 'Maria Johansson', record: { wins: 0, draws: 1, losses: 0, total: 1 }, busy: {} },
  { id: 'member-4', name: 'Oscar Berg', record: { wins: 0, draws: 0, losses: 0, total: 0 }, busy: {} },
  { id: 'member-5', name: 'Karin Holm', record: { wins: 1, draws: 0, losses: 0, total: 1 }, busy: { challenge_active: true } },
  { id: 'member-6', name: 'Per Nilsson', record: { wins: 0, draws: 0, losses: 0, total: 0 }, busy: { has_pending_challenge: true } },
];
const members: ChallengeGroupStat[] = [{ id: ME.id, name: ME.name, busy: {} }, ...GROUP].map(({ id, name, busy }, index) => ({
  user_id: id, name, wins: 1, draws: 0, losses: 0, total: 1, points: 3, challenge_active: false, has_pending_challenge: false, current_level: 10 + index, profile_picture: null, ...busy,
}));
const headToHeadOf = (userId: string) => {
  const member = GROUP.find((entry) => entry.id === userId);
  return { opponent: { id: userId, name: member?.name ?? '' }, record: member?.record ?? { wins: 0, draws: 0, losses: 0, total: 0 }, history: [], active: null };
};

const cardGroup = (sheet: Locator) => sheet.getByRole('radiogroup', { name: /^2 · Pick a challenge/ });
const opponentGroup = (sheet: Locator) => sheet.getByRole('radiogroup', { name: '3 · Pick an opponent' });

// Svaren läggs över det fejkade API:et för just de här anropen (bara det här provet), så arket har tokens att mäta även när kontot saknar dem.
async function stubChallengeApi(page: Page, scenario: Scenario, sentTokenIds: string[] = []): Promise<void> {
  const myChallenges: MyChallengesData = { tokens: TOKENS[scenario], sent_challenge: scenario === 'blocked' ? SENT_CHALLENGE : null, received_challenges: [], boosts: [], history: [], group_active: [] };
  await page.route('**/api/challenges/**', (route) => {
    const url = route.request().url();
    if (route.request().method() === 'POST' && url.endsWith('/challenges/send')) {
      sentTokenIds.push((route.request().postDataJSON() as { token_id: string }).token_id);
      return route.fulfill({ status: 201, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify({ success: true, data: { challenge_id: 'challenge-new' } }) });
    }
    const headToHead = /\/challenges\/head-to-head\/([^/?]+)/.exec(url);
    const data = url.includes('/challenges/my') ? myChallenges : url.includes('/group-stats') ? members : headToHeadOf(headToHead?.[1] ?? '');
    return route.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
  });
}

async function openSheet(page: Page, theme: (typeof THEMES)[number], width: number, height: number, scenario: Scenario): Promise<Locator> {
  await page.addInitScript((value) => window.localStorage.setItem('theme', value), theme);
  await stubChallengeApi(page, scenario);
  await page.setViewportSize({ width, height });
  await page.goto('/duels');
  await dismissOverlays(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.getByRole('region', { name: 'Your tokens' }).getByRole('button', { name: /^Send a minor challenge/ }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Send a challenge' });
  await expect(cardGroup(sheet)).toBeVisible();
  await waitForStylesApplied(page);
  return sheet;
}

interface CardMeasure {
  width: number;
  height: number;
  /** Antal textrader per rad i kortet: [mått och längd, insats]. */
  lineCounts: number[];
  textInsideCard: boolean;
  /** "Selected" överlappar aldrig första radens text. */
  selectedOverlapsText: boolean;
  /** Hela kortet ligger inom sheetens synliga bredd. */
  insideBody: boolean;
}

interface StepsMeasure {
  pageOverflow: number;
  bodyOverflow: number;
  chips: Array<{ label: string; width: number; height: number; pressed: string | null; disabled: string | null }>;
  cards: CardMeasure[];
}

/** Körs i sidan: träffytor, radbrytningar och sidled scroll för steg 1 och 2. */
function measureSteps(): StepsMeasure {
  const lineCount = (node: Element): number => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))).size;
  };
  const textBox = (node: Element): DOMRect => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getBoundingClientRect();
  };
  const sheet = document.querySelector('.rq-duels-sheet')!;
  const body = sheet.querySelector('.rq-duels-sheet__body')!;
  const bodyBox = body.getBoundingClientRect();
  const root = document.documentElement;
  const chips = Array.from(sheet.querySelectorAll('.rq-duels-chip')).map((chip) => {
    const box = chip.getBoundingClientRect();
    return { label: chip.textContent ?? '', width: box.width, height: box.height, pressed: chip.getAttribute('aria-pressed'), disabled: chip.getAttribute('aria-disabled') };
  });
  const cards = Array.from(sheet.querySelectorAll('[role="radiogroup"][aria-labelledby="duels-send-token"] [role="radio"]')).map((radio): CardMeasure => {
    const box = radio.getBoundingClientRect();
    const rows = Array.from(radio.querySelectorAll('.rq-duels-token__text > *'));
    const selected = radio.querySelector('.rq-duels-choice__selected');
    const selectedBox = selected ? selected.getBoundingClientRect() : null;
    const what = radio.querySelector('.rq-duels-token__what');
    const whatBox = what ? textBox(what) : null;
    return {
      width: box.width,
      height: box.height,
      lineCounts: rows.map(lineCount),
      textInsideCard: rows.every((row) => {
        const rect = textBox(row);
        return rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5;
      }),
      selectedOverlapsText: !!(selectedBox && whatBox && whatBox.right > selectedBox.left && whatBox.left < selectedBox.right && whatBox.bottom > selectedBox.top && whatBox.top < selectedBox.bottom),
      insideBody: box.left >= bodyBox.left - 0.5 && box.right <= bodyBox.right + 0.5,
    };
  });
  return { pageOverflow: root.scrollWidth - root.clientWidth, bodyOverflow: body.scrollWidth - body.clientWidth, chips, cards };
}

interface FocusMeasure {
  outlineStyle: string;
  outlineWidth: number;
  outlineOffset: number;
  /** Ringen ligger helt innanför kortets kant (förskjutningen är minst lika negativ som ringen är bred) och klipps därför inte av sheetens scroll. */
  insideRadio: boolean;
}

function measureFocusedCard(): FocusMeasure {
  const style = getComputedStyle(document.activeElement as HTMLElement);
  const offset = parseFloat(style.outlineOffset);
  const width = parseFloat(style.outlineWidth);
  return { outlineStyle: style.outlineStyle, outlineWidth: width, outlineOffset: offset, insideRadio: offset + width <= 0 };
}

test.describe('the send-a-challenge sheet: tier chips and one card per token', () => {
  test.skip(!apiIsStubbed(), 'The sheet is filled from a stubbed challenges API; run with E2E_STUB_API=1 against a local build.');

  for (const { width, height, mobile } of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`the cards and chips keep their contrast, hit area and layout in the ${theme} theme at ${width} px`, async ({ page }) => {
        const sheet = await openSheet(page, theme, width, height, 'full');

        for (const { tier, label, count } of FILLED_TIERS) {
          await sheet.getByRole('button', { name: `${label} ×${count}` }).click();
          const cards = cardGroup(sheet).getByRole('radio');
          await expect(cards).toHaveCount(count);
          // Ett kort är valt (det ensamma är förvalt på legendary; på minor väljs det första), så "Selected" mäts i samma körning.
          if (tier === 'minor') await cards.first().click();
          await waitForStylesApplied(page);

          const where = `${tier} / ${theme} / ${width} px`;
          const measured = await page.evaluate(measureSteps);
          test.info().annotations.push({ type: 'measure', description: `${where}: ${JSON.stringify(measured)}` });

          expect(measured.pageOverflow, `${where}: the page scrolls sideways`).toBeLessThanOrEqual(0);
          expect(measured.bodyOverflow, `${where}: the sheet scrolls sideways`).toBeLessThanOrEqual(0);
          for (const card of measured.cards) {
            expect(card.lineCounts, `${where}: each of the card's two rows fits on one line`).toEqual([1, 1]);
            expect(card.textInsideCard, `${where}: the text stays inside the card`).toBe(true);
            expect(card.insideBody, `${where}: the card stays inside the sheet`).toBe(true);
            expect(card.selectedOverlapsText, `${where}: "Selected" does not overlap the first row`).toBe(false);
            if (mobile) expect(card.height, `${where}: a card is at least ${MIN_HIT_PX} px tall`).toBeGreaterThanOrEqual(MIN_HIT_PX - ROUNDING_PX);
          }
          if (mobile) {
            for (const chip of measured.chips) {
              expect(chip.height, `${where}: the chip "${chip.label}" is at least ${MIN_HIT_PX} px tall`).toBeGreaterThanOrEqual(MIN_HIT_PX - ROUNDING_PX);
              expect(chip.width, `${where}: the chip "${chip.label}" is at least ${MIN_HIT_PX} px wide`).toBeGreaterThanOrEqual(MIN_HIT_PX - ROUNDING_PX);
            }
          }

          // Kontrasten mäts mot den sammansatta bakgrunden: kortets tint (valt) eller neutrala yta (vilande), chipets tint (valt) eller bara sheetens yta.
          const samples = await page.evaluate(contrastOf, {
            selectors: [
              '.rq-duels-sheet .rq-duels-chip:not([aria-disabled="true"])',
              '.rq-duels-sheet [role="radio"] .rq-duels-token__what',
              '.rq-duels-sheet [role="radio"] .rq-duels-token__stake',
              '.rq-duels-sheet .rq-duels-choice__selected',
            ],
          });
          // Kantlinjerna (kort och chip mot ytan utanför) är bara uppmätta: ett valt kort skiljs av bocken och "Selected", inte av kanten.
          const edges = await page.evaluate(contrastOf, { selectors: ['.rq-duels-sheet [role="radio"] .rq-duels-token', '.rq-duels-sheet .rq-duels-chip'], edge: true });
          test.info().annotations.push({ type: 'edge', description: `${where}: ${JSON.stringify(edges.map((sample) => `${sample.selector.split(' ').pop()}#${sample.index} ${sample.ratio}`))}` });
          test.info().annotations.push({ type: 'contrast', description: `${where}: ${JSON.stringify(samples.map((sample) => `${sample.selector.split(' ').pop()}#${sample.index} ${sample.ratio}`))}` });
          expect(samples.filter((sample) => sample.selector.endsWith('__selected')), `${where}: the chosen card carries its Selected text`).toHaveLength(1);
          for (const sample of samples) {
            expect(sample.ratio, `${where}: "${sample.text}" (${sample.selector.split(' ').pop()}) contrast`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
          }
        }
      });

      test(`an empty tier is dimmed but readable, explains itself and leaves the cards in place in the ${theme} theme at ${width} px`, async ({ page }) => {
        const sheet = await openSheet(page, theme, width, height, 'no-major');
        const empty = sheet.getByRole('button', { name: 'Major ×0' });
        await expect(empty).toHaveAttribute('aria-disabled', 'true');
        // Playwright räknar aria-disabled som ej aktiverbart; chipet ska ändå gå att trycka på (det förklarar sig), så klicket tvingas.
        await empty.click({ force: true });
        const status = sheet.getByRole('status');
        await expect(status).toHaveText('No Major tokens right now');
        await expect(cardGroup(sheet).getByRole('radio')).toHaveCount(3);
        await waitForStylesApplied(page);

        const [chip] = await page.evaluate(contrastOf, { selectors: ['.rq-duels-sheet .rq-duels-chip[aria-disabled="true"]'] });
        const [note] = await page.evaluate(contrastOf, { selectors: ['.rq-duels-sheet [role="status"] .rq-duels-note'] });
        test.info().annotations.push({ type: 'contrast', description: `empty / ${theme} / ${width} px: chip ${chip?.ratio}, status text ${note?.ratio}` });
        expect(chip?.ratio, 'the empty chip is dimmed but still readable').toBeGreaterThanOrEqual(MIN_EMPTY_CHIP_CONTRAST);
        expect(note?.ratio, 'the explanation is readable').toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
        const measured = await page.evaluate(measureSteps);
        expect(measured.pageOverflow, 'the page scrolls sideways').toBeLessThanOrEqual(0);
        expect(measured.bodyOverflow, 'the sheet scrolls sideways').toBeLessThanOrEqual(0);
      });
    }
  }

  test('Tab enters the cards once, arrows move the choice, and the focus ring is drawn inside the card', async ({ page }) => {
    const sheet = await openSheet(page, 'dark', 1280, 800, 'full');
    const cards = cardGroup(sheet).getByRole('radio');
    await expect(cards).toHaveCount(3);
    // Byte av nivå och tillbaka nollställer valet, så inget kort är valt och första kortet är tabbstoppet.
    await sheet.getByRole('button', { name: 'Major ×1' }).click();
    await sheet.getByRole('button', { name: 'Minor ×3' }).click();
    await expect(cardGroup(sheet).getByRole('radio', { checked: true })).toHaveCount(0);

    await sheet.getByRole('button', { name: 'Legendary ×1' }).focus();
    await page.keyboard.press('Tab');
    await expect(cards.nth(0)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cards.nth(0)).not.toBeFocused();
    await expect(cards.nth(1)).not.toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(cards.nth(0)).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await expect(cards.nth(1)).toBeFocused();
    await expect(cards.nth(1)).toHaveAttribute('aria-checked', 'true');
    await expect(cards.nth(0)).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('End');
    await expect(cards.nth(2)).toHaveAttribute('aria-checked', 'true');

    const focus = await page.evaluate(measureFocusedCard);
    test.info().annotations.push({ type: 'measure', description: `focus ring: ${JSON.stringify(focus)}` });
    expect(focus.outlineStyle, 'the focused card shows a ring').not.toBe('none');
    expect(focus.outlineWidth, 'the ring has a width').toBeGreaterThan(0);
    expect(focus.outlineOffset, 'the ring is drawn inward').toBeLessThanOrEqual(0);
    expect(focus.insideRadio, 'the ring stays inside the card').toBe(true);
  });

  test('Send on a token card preselects its tier and card, a tier change clears the choice, and a lone card is preselected', async ({ page }) => {
    const sheet = await openSheet(page, 'dark', 375, 812, 'lone');
    await expect(sheet.getByRole('button', { name: 'Minor ×1' })).toHaveAttribute('aria-pressed', 'true');
    await expect(cardGroup(sheet).getByRole('radio', { checked: true })).toHaveCount(1);
    await expect(sheet.getByText('Selected')).toBeVisible();

    await sheet.getByRole('button', { name: 'Legendary ×1' }).click();
    await expect(cardGroup(sheet).getByRole('radio', { checked: true })).toHaveCount(1);
    await expect(cardGroup(sheet).getByRole('radio', { checked: true })).toContainText('No penalty');
  });

  test('Send on one of several cards preselects exactly that card, and changing tier clears the choice', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('theme', 'dark'));
    await stubChallengeApi(page, 'full');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/duels');
    await dismissOverlays(page);
    await page.getByRole('button', { name: 'Send a minor challenge: Most runs, 5 days' }).click();
    const sheet = page.getByRole('dialog', { name: 'Send a challenge' });
    await expect(cardGroup(sheet).getByRole('radio', { checked: true })).toHaveCount(1);
    await expect(cardGroup(sheet).getByRole('radio', { checked: true })).toContainText('Most runs · 5 days');

    await sheet.getByRole('button', { name: 'Major ×1' }).click();
    await expect(cardGroup(sheet).getByRole('radio')).toHaveCount(1);
    await expect(cardGroup(sheet).getByRole('radio', { checked: true })).toHaveCount(1);
    await sheet.getByRole('button', { name: 'Minor ×3' }).click();
    await expect(cardGroup(sheet).getByRole('radio', { checked: true })).toHaveCount(0);
  });

  // Två identiska kort (samma mått, längd och insats) är två tokens: SEND på kort N förväljer exakt kort N, och POST bär just det kortets token_id.
  for (const [position, tokenId] of [[0, 'token-minor-km-a'], [1, 'token-minor-km-b']] as const) {
    test(`Send on identical card ${position + 1} of 2 preselects exactly that card and posts that token's own id`, async ({ page }) => {
      const sent: string[] = [];
      await page.addInitScript(() => window.localStorage.setItem('theme', 'dark'));
      await stubChallengeApi(page, 'full', sent);
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/duels');
      await dismissOverlays(page);
      const panel = page.getByRole('region', { name: 'Your tokens' });
      await panel.getByRole('button', { name: 'Send a minor challenge: Most km, 7 days' }).nth(position).click();

      const sheet = page.getByRole('dialog', { name: 'Send a challenge' });
      const cards = cardGroup(sheet).getByRole('radio');
      await expect(cards).toHaveCount(3);
      for (const index of [0, 1, 2]) await expect(cards.nth(index)).toHaveAttribute('aria-checked', index === position ? 'true' : 'false');

      await opponentGroup(sheet).getByRole('radio', { name: /Anna Lindqvist/ }).click();
      await sheet.getByRole('button', { name: 'Send challenge' }).click();
      await expect.poll(() => sent).toEqual([tokenId]);
    });
  }

  // Förvalet hör till posten som öppnade arket: Back stänger arket utan att något stängs-anrop körs, och nästa ingång (New, rubrikens knapp, Forward) ska börja blankt.
  test('after Send on a card and browser Back, New > Send a challenge opens a blank sheet on a phone (390 px)', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('theme', 'dark'));
    await stubChallengeApi(page, 'full');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/duels');
    await dismissOverlays(page);
    const panel = page.getByRole('region', { name: 'Your tokens' });
    await panel.getByRole('button', { name: 'Major ×1' }).click();
    await panel.getByRole('button', { name: /^Send a major challenge/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Send a challenge' });
    await expect(cardGroup(sheet).getByRole('radio', { checked: true })).toHaveCount(1);

    await page.goBack();
    await expect(sheet).toHaveCount(0);
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByRole('button', { name: /Send a challenge/ }).click();
    await expect(cardGroup(sheet)).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Minor ×3' })).toHaveAttribute('aria-pressed', 'true');
    await expect(cardGroup(sheet).getByRole('radio', { checked: true })).toHaveCount(0);
  });

  test('after Send on a card and browser Back, the header button and Forward open a blank sheet on desktop (1280 px)', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('theme', 'dark'));
    await stubChallengeApi(page, 'full');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/duels?view=standings');
    await dismissOverlays(page);
    const panel = page.getByRole('region', { name: 'Your tokens' });
    await panel.getByRole('button', { name: 'Major ×1' }).click();
    await panel.getByRole('button', { name: /^Send a major challenge/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Send a challenge' });
    await expect(cardGroup(sheet).getByRole('radio', { checked: true })).toHaveCount(1);

    await page.goBack();
    await expect(sheet).toHaveCount(0);
    await page.goForward();
    await expect(cardGroup(sheet)).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Minor ×3' })).toHaveAttribute('aria-pressed', 'true');
    await expect(cardGroup(sheet).getByRole('radio', { checked: true })).toHaveCount(0);

    await page.goBack();
    await expect(sheet).toHaveCount(0);
    await page.getByRole('button', { name: 'Send a challenge', exact: true }).click();
    await expect(sheet.getByRole('button', { name: 'Minor ×3' })).toHaveAttribute('aria-pressed', 'true');
    await expect(cardGroup(sheet).getByRole('radio', { checked: true })).toHaveCount(0);
  });

  test('a deep link has no opener: Esc puts the focus on the header Send button, not on the body', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('theme', 'dark'));
    await stubChallengeApi(page, 'full');
    await page.setViewportSize({ width: 1280, height: 800 });
    // dismissOverlays trycker Escape, som skulle stänga arket: överlagren tas bort på /duels först, sedan laddas djuplänken om.
    await page.goto('/duels');
    await dismissOverlays(page);
    await page.goto('/duels?send=1');
    await expect(page.getByRole('dialog', { name: 'Send a challenge' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Send a challenge' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send a challenge', exact: true })).toBeFocused();
  });

  test('with a challenge already sent, every SEND is disabled, the reason is visible, and the sheet shows only the reason', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('theme', 'dark'));
    await stubChallengeApi(page, 'blocked');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/duels');
    await dismissOverlays(page);
    const panel = page.getByRole('region', { name: 'Your tokens' });
    const sends = panel.getByRole('button', { name: /^Send a / });
    await expect(sends).toHaveCount(3);
    for (const index of [0, 1, 2]) await expect(sends.nth(index)).toBeDisabled();
    await expect(panel.getByText(/Your challenge to Anna is waiting for an answer/)).toBeVisible();

    await page.getByRole('button', { name: 'Send a challenge', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Send a challenge' });
    await expect(sheet.getByRole('status')).toContainText('Your challenge to Anna is waiting for an answer');
    await expect(sheet.getByRole('radiogroup')).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: 'Send challenge' })).toHaveCount(0);
  });

  for (const [how, close] of [
    ['Escape', (page: Page) => page.keyboard.press('Escape')],
    ['the close button', (page: Page) => page.getByRole('dialog', { name: 'Send a challenge' }).getByRole('button', { name: 'Close' }).click()],
    ['Cancel', (page: Page) => page.getByRole('dialog', { name: 'Send a challenge' }).getByRole('button', { name: 'Cancel' }).click()],
  ] as const) {
    test(`closing the sheet with ${how} puts the focus back on the SEND button that opened it`, async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem('theme', 'dark'));
      await stubChallengeApi(page, 'full');
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/duels');
      await dismissOverlays(page);
      const opener = page.getByRole('region', { name: 'Your tokens' }).getByRole('button', { name: 'Send a minor challenge: Most runs, 5 days' });
      await opener.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog', { name: 'Send a challenge' })).toBeVisible();
      await close(page);
      await expect(page.getByRole('dialog', { name: 'Send a challenge' })).toHaveCount(0);
      await expect(opener).toBeFocused();
    });
  }
});

interface OpponentsMeasure {
  pageOverflow: number;
  bodyOverflow: number;
  rows: Array<{ name: string; height: number; textInsideRow: boolean; hintOverlapsName: boolean; disabled: boolean }>;
}

/** Körs i sidan: träffytor, radbrytningar och sidled scroll för steg 3. */
function measureOpponents(): OpponentsMeasure {
  const textBox = (node: Element): DOMRect => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getBoundingClientRect();
  };
  const overlap = (a: DOMRect, b: DOMRect) => a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
  const sheet = document.querySelector('.rq-duels-sheet')!;
  const body = sheet.querySelector('.rq-duels-sheet__body')!;
  const root = document.documentElement;
  const rows = Array.from(sheet.querySelectorAll('[role="radiogroup"][aria-labelledby="duels-send-opponent"] [role="radio"]')).map((radio) => {
    const box = radio.getBoundingClientRect();
    const name = radio.querySelector('.rq-name')!;
    const hint = radio.querySelector('.rq-duels-option__h2h');
    const texts = Array.from(radio.querySelectorAll('.rq-name, .rq-duels-option__note, .rq-duels-option__h2h'));
    return {
      name: name.textContent ?? '',
      height: box.height,
      textInsideRow: texts.every((text) => {
        const rect = textBox(text);
        return rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5;
      }),
      hintOverlapsName: !!hint && overlap(textBox(hint), textBox(name)),
      disabled: radio.getAttribute('aria-disabled') === 'true',
    };
  });
  return { pageOverflow: root.scrollWidth - root.clientWidth, bodyOverflow: body.scrollWidth - body.clientWidth, rows };
}

const betOf = (sheet: Locator) => sheet.getByRole('region', { name: 'The bet' });
const startsOf = (sheet: Locator) => betOf(sheet).locator('dl > div', { hasText: 'Starts' }).locator('dd');

test.describe('the send-a-challenge sheet: opponents, the bet and Cancel', () => {
  test.skip(!apiIsStubbed(), 'The sheet is filled from a stubbed challenges API; run with E2E_STUB_API=1 against a local build.');

  for (const { width, height, mobile } of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`the opponents and the bet keep their contrast, hit area and layout in the ${theme} theme at ${width} px`, async ({ page }) => {
        const sheet = await openSheet(page, theme, width, height, 'full');
        await cardGroup(sheet).getByRole('radio').first().click();
        await opponentGroup(sheet).getByRole('radio', { name: /Anna Lindqvist/ }).click();
        await expect(opponentGroup(sheet).getByText('2–0 to you')).toBeVisible();
        await waitForStylesApplied(page);

        const where = `${theme} / ${width} px`;
        const measured = await page.evaluate(measureOpponents);
        test.info().annotations.push({ type: 'measure', description: `${where}: ${JSON.stringify(measured)}` });
        expect(measured.rows.map((row) => row.name), `${where}: everyone but me is listed, the ones who can be challenged first`).toEqual(['Anna Lindqvist', 'Erik Svensson', 'Maria Johansson', 'Oscar Berg', 'Karin Holm', 'Per Nilsson']);
        expect(measured.pageOverflow, `${where}: the page scrolls sideways`).toBeLessThanOrEqual(0);
        expect(measured.bodyOverflow, `${where}: the sheet scrolls sideways`).toBeLessThanOrEqual(0);
        for (const row of measured.rows) {
          expect(row.textInsideRow, `${where}: the text of ${row.name} stays inside its row`).toBe(true);
          expect(row.hintOverlapsName, `${where}: the hint of ${row.name} does not overlap the name`).toBe(false);
          if (mobile) expect(row.height, `${where}: the row of ${row.name} is at least ${MIN_HIT_PX} px tall`).toBeGreaterThanOrEqual(MIN_HIT_PX - ROUNDING_PX);
        }

        const samples = await page.evaluate(contrastOf, {
          selectors: [
            '.rq-duels-sheet .rq-duels-option:not([aria-disabled="true"]) .rq-name',
            '.rq-duels-sheet .rq-duels-option__note:not(.rq-duels-option__reason)',
            '.rq-duels-sheet .rq-duels-option__reason',
            '.rq-duels-sheet .rq-duels-option__h2h',
            '.rq-duels-sheet .rq-duels-bet__label',
            '.rq-duels-sheet .rq-duels-bet__summary',
            '.rq-duels-sheet .rq-duels-bet__stakes dt',
            '.rq-duels-sheet .rq-duels-bet__stakes dd',
          ],
        });
        // En avstängd rads namn är dämpat med flit (en avstängd kontroll är undantagen i WCAG); värdet läggs som anteckning, orsaken bredvid mäts mot 4,5:1.
        const dimmed = await page.evaluate(contrastOf, { selectors: ['.rq-duels-sheet .rq-duels-option[aria-disabled="true"] .rq-name'] });
        test.info().annotations.push({ type: 'contrast', description: `${where}: ${JSON.stringify(samples.map((sample) => `${sample.selector.split(' ').pop()}#${sample.index} ${sample.ratio}`))}` });
        test.info().annotations.push({ type: 'contrast-disabled-name', description: `${where}: ${JSON.stringify(dimmed.map((sample) => sample.ratio))}` });
        expect(samples.length, `${where}: there is text to measure`).toBeGreaterThan(10);
        for (const sample of samples) {
          expect(sample.ratio, `${where}: "${sample.text}" (${sample.selector.split(' ').pop()}) contrast`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
        }
      });
    }
  }

  test('the opponents are a radiogroup: Tab enters once, arrows skip those who cannot be challenged, and the focus ring is drawn inside the row', async ({ page }) => {
    const sheet = await openSheet(page, 'dark', 1280, 800, 'full');
    const radios = opponentGroup(sheet).getByRole('radio');
    await expect(radios).toHaveCount(GROUP.length);
    await expect(opponentGroup(sheet).getByRole('radio', { name: new RegExp(ME.name) })).toHaveCount(0);
    await expect(opponentGroup(sheet).getByRole('radio', { checked: true })).toHaveCount(0);

    await cardGroup(sheet).getByRole('radio').first().focus();
    await page.keyboard.press('Tab');
    await expect(radios.nth(0)).toBeFocused();
    await page.keyboard.press('Tab');
    for (let index = 0; index < GROUP.length; index += 1) await expect(radios.nth(index)).not.toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(radios.nth(0)).toBeFocused();

    // Fyra går att utmana, de två sista (i en duell, väntar på svar) hoppas över, också vid omslag och med Home och End.
    await page.keyboard.press('ArrowDown');
    await expect(radios.nth(1)).toBeFocused();
    await expect(radios.nth(1)).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('End');
    await expect(radios.nth(3)).toBeFocused();
    await expect(radios.nth(3)).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(radios.nth(0)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(radios.nth(3)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(radios.nth(0)).toBeFocused();
    await expect(opponentGroup(sheet).getByRole('radio', { checked: true })).toHaveCount(1);

    const focus = await page.evaluate(measureFocusedCard);
    test.info().annotations.push({ type: 'measure', description: `opponent focus ring: ${JSON.stringify(focus)}` });
    expect(focus.outlineStyle, 'the focused row shows a ring').not.toBe('none');
    expect(focus.outlineOffset, 'the ring is drawn inward').toBeLessThanOrEqual(0);
    expect(focus.insideRadio, 'the ring stays inside the row').toBe(true);
  });

  test('someone in a duel or waiting on a reply is disabled with the reason in plain sight, and the hints read to you, the name, drawn and never met', async ({ page }) => {
    const sheet = await openSheet(page, 'dark', 375, 812, 'full');
    const group = opponentGroup(sheet);
    const inDuel = group.getByRole('radio', { name: /Karin Holm/ });
    const waiting = group.getByRole('radio', { name: /Per Nilsson/ });
    await expect(inDuel).toHaveAttribute('aria-disabled', 'true');
    await expect(waiting).toHaveAttribute('aria-disabled', 'true');
    await expect(inDuel.getByText('In a duel')).toBeVisible();
    await expect(waiting.getByText('Waiting on a reply')).toBeVisible();
    // aria-disabled ger ingen klickbar knapp för Playwright: klicket tvingas, och raden ska ändå inte väljas.
    await inDuel.click({ force: true });
    await waiting.click({ force: true });
    await expect(group.getByRole('radio', { checked: true })).toHaveCount(0);

    await expect(group.getByText('2–0 to you')).toBeVisible();
    await expect(group.getByText('0–1 to Erik')).toBeVisible();
    await expect(group.getByText('drawn 1')).toBeVisible();
    // Oscar och Per har aldrig mött mig. Per väntar på svar men behåller sitt tips bredvid orsaken.
    await expect(group.getByText('never met')).toHaveCount(2);
    await expect(group.getByText('never met').first()).toBeVisible();
    expect(await group.textContent()).not.toMatch(/\b(him|her)\b/i);
  });

  test('?opponent= preselects someone who can be challenged, and nobody when it is me or someone busy', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('theme', 'dark'));
    await stubChallengeApi(page, 'full');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/duels');
    await dismissOverlays(page);
    const sheet = page.getByRole('dialog', { name: 'Send a challenge' });

    await page.goto('/duels?send=1&opponent=member-2');
    await expect(opponentGroup(sheet).getByRole('radio', { name: /Erik Svensson/ })).toHaveAttribute('aria-checked', 'true');
    await expect(opponentGroup(sheet).getByRole('radio', { checked: true })).toHaveCount(1);

    for (const unavailable of ['member-5', 'member-6', ME.id, 'nobody']) {
      await page.goto(`/duels?send=1&opponent=${unavailable}`);
      await expect(opponentGroup(sheet)).toBeVisible();
      await expect(opponentGroup(sheet).getByRole('radio', { checked: true }), `?opponent=${unavailable}`).toHaveCount(0);
    }
  });

  test('the bet is a polite live region with If you win, If you lose and the real start rule, and it changes once per change', async ({ page }) => {
    const sheet = await openSheet(page, 'dark', 375, 812, 'full');
    const bet = betOf(sheet);
    await expect(bet).toHaveAttribute('aria-live', 'polite');
    await expect(bet.getByText('Pick an opponent')).toBeVisible();

    // Starts: minor och major börjar vid midnatten efter accepten, legendary startar också av sig själv efter N dagar utan svar. Aldrig "when accepted".
    await expect(startsOf(sheet)).toHaveText('Midnight after it is accepted');
    await cardGroup(sheet).getByRole('radio').first().click();
    await opponentGroup(sheet).getByRole('radio', { name: /Anna Lindqvist/ }).click();
    await expect(bet.getByText('MOST KM VS ANNA · 7 DAYS')).toBeVisible();
    await expect(bet.locator('dl > div', { hasText: 'If you win' }).locator('dd')).toHaveText('+0.15× for 5 days');
    await expect(bet.locator('dl > div', { hasText: 'If you lose' }).locator('dd')).toHaveText('−0.07× for 5 days');
    await sheet.getByRole('button', { name: 'Major ×1' }).click();
    await expect(startsOf(sheet)).toHaveText('Midnight after it is accepted');
    await sheet.getByRole('button', { name: 'Legendary ×1' }).click();
    await expect(startsOf(sheet)).toHaveText(`Midnight after it is accepted, or after ${LEGENDARY_AUTO_START_DAYS} d unanswered`);
    await expect(bet).not.toContainText(/when accepted/i);

    // En uppdatering per ändring: räknar hur många gånger regionens innehåll ändras (varje ändring läses upp en gång, hela regionen på en gång).
    await sheet.getByRole('button', { name: 'Minor ×3' }).click();
    await cardGroup(sheet).getByRole('radio').first().click();
    await page.evaluate(() => {
      const region = document.querySelector('.rq-duels-bet')!;
      const counter = { changes: 0 };
      new MutationObserver(() => { counter.changes += 1; }).observe(region, { childList: true, characterData: true, subtree: true, attributes: true });
      (window as unknown as { __betChanges: typeof counter }).__betChanges = counter;
    });
    const changes = () => page.evaluate(() => (window as unknown as { __betChanges: { changes: number } }).__betChanges.changes);
    const opponents = opponentGroup(sheet).getByRole('radio');
    await opponents.nth(1).click();
    await expect.poll(changes).toBe(1);
    await opponents.nth(1).click();
    await cardGroup(sheet).getByRole('radio').nth(2).click();
    await opponents.nth(0).click();
    await expect.poll(changes).toBe(3);
    await opponents.nth(0).click();
    await expect.poll(changes).toBe(3);
  });

  for (const { width, height, mobile } of VIEWPORTS) {
   for (const theme of THEMES) {
    test(`Cancel is visible and readable in the ${theme} theme at ${width} px, closes the flow without sending, and the focus goes back to the SEND button that opened it`, async ({ page }) => {
      const sent: string[] = [];
      await page.addInitScript((value) => window.localStorage.setItem('theme', value), theme);
      await stubChallengeApi(page, 'full', sent);
      await page.setViewportSize({ width, height });
      await page.goto('/duels');
      await dismissOverlays(page);
      const opener = page.getByRole('region', { name: 'Your tokens' }).getByRole('button', { name: 'Send a minor challenge: Most runs, 5 days' });
      await opener.focus();
      await page.keyboard.press('Enter');
      const sheet = page.getByRole('dialog', { name: 'Send a challenge' });
      await opponentGroup(sheet).getByRole('radio', { name: /Anna Lindqvist/ }).click();
      await waitForStylesApplied(page);

      const cancel = sheet.getByRole('button', { name: 'Cancel' });
      await expect(cancel).toBeVisible();
      const box = (await cancel.boundingBox())!;
      const sheetBox = (await sheet.boundingBox())!;
      test.info().annotations.push({ type: 'measure', description: `Cancel at ${width} px: ${JSON.stringify(box)} in the sheet ${JSON.stringify(sheetBox)}` });
      expect(box.y + box.height, 'Cancel is inside the sheet').toBeLessThanOrEqual(sheetBox.y + sheetBox.height + ROUNDING_PX);
      expect(box.y, 'Cancel is inside the window').toBeGreaterThanOrEqual(0);
      if (mobile) expect(box.height, `Cancel is at least ${MIN_HIT_PX} px tall`).toBeGreaterThanOrEqual(MIN_HIT_PX - ROUNDING_PX);
      const [ratio] = await page.evaluate(contrastOf, { selectors: ['.rq-duels-sheet__actions .rq-btn--ghost'] });
      test.info().annotations.push({ type: 'contrast', description: `Cancel text in the ${theme} theme at ${width} px: ${ratio?.ratio}` });
      expect(ratio?.ratio, `Cancel is readable in the ${theme} theme`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);

      await cancel.click();
      await expect(sheet).toHaveCount(0);
      expect(sent, 'nothing was sent').toEqual([]);
      await expect(opener).toBeFocused();
      expect(new URL(page.url()).pathname).toBe('/duels');
    });
   }
  }

  test('Send challenge waits for tier, token and opponent, shows Sending… on its way, and the confirmation gets the focus afterwards', async ({ page }) => {
    const sent: string[] = [];
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => { release = resolve; });
    await page.addInitScript(() => window.localStorage.setItem('theme', 'dark'));
    await stubChallengeApi(page, 'full', sent);
    // Svaret på skicket hålls tills provet släpper det, så att "Sending…" går att se; resten av API:et svarar som förut.
    await page.route('**/api/challenges/send', async (route) => {
      sent.push((route.request().postDataJSON() as { token_id: string }).token_id);
      await released;
      await route.fulfill({ status: 201, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify({ success: true, data: { challenge_id: 'challenge-new' } }) });
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/duels');
    await dismissOverlays(page);
    await page.getByRole('region', { name: 'Your tokens' }).getByRole('button', { name: 'Send a minor challenge: Most runs, 5 days' }).click();
    const sheet = page.getByRole('dialog', { name: 'Send a challenge' });
    const submit = sheet.getByRole('button', { name: 'Send challenge' });
    await expect(submit).toBeDisabled();
    await opponentGroup(sheet).getByRole('radio', { name: /Oscar Berg/ }).click();
    await expect(submit).toBeEnabled();

    await submit.click();
    await expect(sheet.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    release();
    const confirmation = page.getByText('Challenge sent to Oscar. It starts at midnight after they accept.');
    await expect(confirmation).toBeVisible();
    await expect(sheet).toHaveCount(0);
    await expect(confirmation).toBeFocused();
    expect(sent).toEqual(['token-minor-runs']);
    expect(new URL(page.url()).pathname).toBe('/duels');
  });

  test('a refused send keeps the sheet, shows the message in an alert and lets me try again', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('theme', 'dark'));
    await stubChallengeApi(page, 'full');
    await page.route('**/api/challenges/send', (route) =>
      route.fulfill({ status: 400, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Opponent already has an active or pending challenge' }) }));
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/duels');
    await dismissOverlays(page);
    await page.getByRole('region', { name: 'Your tokens' }).getByRole('button', { name: 'Send a minor challenge: Most runs, 5 days' }).click();
    const sheet = page.getByRole('dialog', { name: 'Send a challenge' });
    await opponentGroup(sheet).getByRole('radio', { name: /Oscar Berg/ }).click();
    await sheet.getByRole('button', { name: 'Send challenge' }).click();
    await expect(sheet.getByRole('alert')).toHaveText('Opponent already has an active or pending challenge');
    await expect(sheet.getByRole('button', { name: 'Send challenge' })).toBeEnabled();
    // Send var avstängd under "Sending…" och tappade fokus; när den är påslagen igen får den det tillbaka, så fokus aldrig ligger på body medan arket är öppet.
    await expect(sheet.getByRole('button', { name: 'Send challenge' })).toBeFocused();
    await expect(sheet).toBeVisible();
  });
});
