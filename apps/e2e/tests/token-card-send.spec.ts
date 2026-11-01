import type { Page } from '@playwright/test';
import type { ChallengeGroupStat, MyChallengesData } from '../../../packages/shared/src/contracts/challenges';
import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';
import { apiIsStubbed } from '../support/stubApi';
import { waitForStylesApplied } from '../support/stylesApplied';

/** Minsta kontrast för text mot sin bakgrund (WCAG AA, normal text). */
const MIN_TEXT_CONTRAST = 4.5;
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
const TIERS = [
  { tier: 'minor', label: 'Minor', count: 3 },
  { tier: 'major', label: 'Major', count: 1 },
  { tier: 'legendary', label: 'Legendary', count: 1 },
] as const;

const CORS_HEADERS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const MINOR_STAKE = { winner_delta: 0.15, winner_duration: 5, winner_type: 'multiplier_days', loser_delta: -0.07, loser_duration: 5, loser_type: 'multiplier_days' };
const MAJOR_STAKE = { winner_delta: 0.25, winner_duration: 10, winner_type: 'multiplier_days', loser_delta: -0.12, loser_duration: 10, loser_type: 'multiplier_days' };
const LEGENDARY_STAKE = { winner_delta: 0.5, winner_duration: 14, winner_type: 'multiplier_days', loser_delta: -0.25, loser_duration: 14, loser_type: 'multiplier_days' };

// Tre minor (två av dem identiska), en major och en legendary. Svaren läggs över det fejkade API:et för just de här anropen, så sidan har tokens att mäta även när kontot saknar dem.
const myChallenges: MyChallengesData = {
  tokens: [
    { id: 'token-minor-a', tier: 'minor', metric: 'km', duration_days: 7, earned_at: '2026-09-01T08:00:00Z', reward_id: 'reward-1', ...MINOR_STAKE },
    { id: 'token-minor-b', tier: 'minor', metric: 'km', duration_days: 7, earned_at: '2026-09-02T08:00:00Z', reward_id: 'reward-2', ...MINOR_STAKE },
    { id: 'token-minor-c', tier: 'minor', metric: 'total_xp', duration_days: 3, earned_at: '2026-09-03T08:00:00Z', reward_id: 'reward-3', ...MINOR_STAKE },
    { id: 'token-major', tier: 'major', metric: 'runs', duration_days: 10, earned_at: '2026-09-04T08:00:00Z', reward_id: 'reward-4', ...MAJOR_STAKE },
    { id: 'token-legendary', tier: 'legendary', metric: 'total_xp', duration_days: 30, earned_at: '2026-09-05T08:00:00Z', reward_id: 'reward-5', ...LEGENDARY_STAKE },
  ],
  sent_challenge: null,
  received_challenges: [],
  boosts: [],
  history: [],
  group_active: [],
};
const members: ChallengeGroupStat[] = ['Anna Lindqvist', 'Erik Svensson'].map((name, index) => ({
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

interface CardMeasure {
  /** Antal textrader per rad i kortet: [mått och längd, insats]. */
  lineCounts: number[];
  /** Kortets båda textrader ligger innanför kortets kant. */
  textInsideCard: boolean;
  send: { width: number; height: number; contrast: number; insideCard: boolean; fill: SendFill };
}

/** SEND ska aldrig vara fylld: knappens egen bakgrundsfärg är helt genomskinlig (alfa 0) och den har ingen bakgrundsbild (gradient). */
interface SendFill {
  backgroundAlpha: number;
  backgroundImage: string;
}

interface PanelMeasure {
  pageOverflow: number;
  cards: CardMeasure[];
}

interface SendStateMeasure {
  fill: SendFill;
  text: number;
  border: number;
  borderAlpha: number;
  outlineStyle: string;
  outlineWidth: number;
  outlineContrast: number;
}

/**
 * Körs i sidan (hjälparna delas av båda måtten, eftersom en funktion som skickas till webbläsaren inte kan se något utanför sig själv).
 * 'panel': korten i listan under chipraden, SEND-knappens träffyta, fyllning och kontrast. 'state': SEND-knappen som har fokus eller hover just nu.
 * Kontrasten mäts mot knappens sammansatta bakgrund (dess egen bakgrund ovanpå kortets och sidans), så en fylld knapp syns i måttet. Alla lager komponeras över sidans botten.
 */
function measureInPage(mode: string): PanelMeasure | SendStateMeasure {
  type Rgba = { r: number; g: number; b: number; a: number };
  const parse = (value: string): Rgba => {
    const m = value.match(/(?:rgba?|color\(srgb)\s*\(?([^)]+)\)/);
    if (!m || !m[1]) return { r: 0, g: 0, b: 0, a: 0 };
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    const scale = value.startsWith('color(') ? 255 : 1;
    return { r: (p[0] ?? 0) * scale, g: (p[1] ?? 0) * scale, b: (p[2] ?? 0) * scale, a: p[3] ?? 1 };
  };
  const over = (top: Rgba, bottom: Rgba): Rgba => {
    const a = top.a + bottom.a * (1 - top.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const mix = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / a;
    return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
  };
  const backgroundOf = (element: Element): Rgba => {
    const layers: Rgba[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) layers.push(parse(getComputedStyle(node).backgroundColor));
    let acc: Rgba = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i -= 1) acc = over(layers[i] ?? { r: 0, g: 0, b: 0, a: 0 }, acc);
    return acc;
  };
  const luminance = ({ r, g, b }: Rgba) => {
    const channel = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const ratio = (a: Rgba, b: Rgba) => Number(((Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)).toFixed(2));
  const textContrast = (element: Element, behind: Element) => {
    const background = backgroundOf(behind);
    return ratio(over(parse(getComputedStyle(element).color), background), background);
  };
  const fillOf = (element: Element): SendFill => {
    const style = getComputedStyle(element);
    return { backgroundAlpha: parse(style.backgroundColor).a, backgroundImage: style.backgroundImage };
  };
  const lineCount = (node: Element): number => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))).size;
  };

  if (mode === 'state') {
    const active = document.activeElement;
    const send = active instanceof HTMLButtonElement && active.classList.contains('rq-duels-send') ? active : document.querySelector('.rq-duels-send:hover')!;
    const style = getComputedStyle(send);
    const background = backgroundOf(send);
    const border = parse(style.borderTopColor);
    return {
      fill: fillOf(send),
      text: textContrast(send, send),
      border: ratio(over(border, background), background),
      borderAlpha: border.a,
      outlineStyle: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth),
      outlineContrast: ratio(over(parse(style.outlineColor), background), background),
    };
  }

  const cards = Array.from(document.querySelectorAll('.rq-duels-tokens__list > li')).map((item): CardMeasure => {
    const card = item.querySelector('.rq-duels-token')!;
    const cardBox = card.getBoundingClientRect();
    const send = card.querySelector('button')!;
    const sendBox = send.getBoundingClientRect();
    const lines = Array.from(card.querySelectorAll('.rq-duels-token__text > *'));
    const inside = (box: DOMRect) => box.left >= cardBox.left - 0.5 && box.right <= cardBox.right + 0.5;
    return {
      lineCounts: lines.map(lineCount),
      textInsideCard: lines.every((line) => {
        const range = document.createRange();
        range.selectNodeContents(line);
        return inside(range.getBoundingClientRect());
      }),
      send: { width: sendBox.width, height: sendBox.height, contrast: textContrast(send, send), insideCard: inside(sendBox), fill: fillOf(send) },
    };
  });
  const root = document.documentElement;
  return { pageOverflow: root.scrollWidth - root.clientWidth, cards };
}

test.describe('Your tokens: token cards and the Send button', () => {
  test.skip(!apiIsStubbed(), 'The panel is filled from a stubbed challenges API; run with E2E_STUB_API=1 against a local build.');

  for (const { width, height, mobile } of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`token cards read as two lines and Send keeps its contrast and hit area in the ${theme} theme at ${width} px`, async ({ page }) => {
        await page.addInitScript((value) => window.localStorage.setItem('theme', value), theme);
        await stubChallengeApi(page);
        await page.setViewportSize({ width, height });
        await page.goto('/duels');
        await dismissOverlays(page);
        const panel = page.getByRole('region', { name: 'Your tokens' });
        await expect(panel).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

        for (const { tier, label, count } of TIERS) {
          await panel.getByRole('button', { name: `${label} ×${count}` }).click();
          await expect(panel.getByRole('list', { name: `${label} tokens` }).getByRole('listitem')).toHaveCount(count);
          await waitForStylesApplied(page);

          const measured = (await page.evaluate(measureInPage, 'panel')) as PanelMeasure;
          const where = `${tier} / ${theme} / ${width} px`;
          test.info().annotations.push({ type: 'measure', description: `${where}: ${JSON.stringify(measured)}` });

          expect(measured.pageOverflow, `${where}: the page scrolls sideways`).toBeLessThanOrEqual(0);
          expect(measured.cards, `${where}: one card per token`).toHaveLength(count);
          for (const card of measured.cards) {
            expect(card.lineCounts, `${where}: each of the card's two lines fits on one line`).toEqual([1, 1]);
            expect(card.textInsideCard, `${where}: the text stays inside the card`).toBe(true);
            expect(card.send.insideCard, `${where}: Send stays inside the card`).toBe(true);
            expect(card.send.fill, `${where}: Send is never filled (transparent background, no gradient)`).toEqual({ backgroundAlpha: 0, backgroundImage: 'none' });
            expect(card.send.contrast, `${where}: Send text contrast against its own composite background`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
            if (mobile) {
              expect(card.send.width, `${where}: Send is at least ${MIN_HIT_PX} px wide`).toBeGreaterThanOrEqual(MIN_HIT_PX - ROUNDING_PX);
              expect(card.send.height, `${where}: Send is at least ${MIN_HIT_PX} px tall`).toBeGreaterThanOrEqual(MIN_HIT_PX - ROUNDING_PX);
            }
          }

          // Hover: kanten blir heltäckande i nivåns färg och texten är fortfarande läsbar.
          const send = panel.getByRole('button', { name: new RegExp(`^Send a ${tier} challenge`) }).first();
          if (!mobile) {
            await send.hover();
            const hovered = (await page.evaluate(measureInPage, 'state')) as SendStateMeasure;
            test.info().annotations.push({ type: 'measure', description: `${where} hover: ${JSON.stringify(hovered)}` });
            expect(hovered.borderAlpha, `${where}: the hover edge is solid`).toBe(1);
            expect(hovered.fill, `${where}: Send is not filled on hover, only its edge is solid`).toEqual({ backgroundAlpha: 0, backgroundImage: 'none' });
            expect(hovered.text, `${where}: Send text contrast on hover`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
          }

          // Fokus med tangentbordet: ringen finns (den globala ringens kontrast är en egen sak, bara uppmätt här).
          await page.mouse.move(0, 0);
          await page.keyboard.press('Tab');
          await send.focus();
          const focused = (await page.evaluate(measureInPage, 'state')) as SendStateMeasure;
          test.info().annotations.push({ type: 'measure', description: `${where} focus: ${JSON.stringify(focused)}` });
          expect(focused.fill, `${where}: Send is not filled with focus`).toEqual({ backgroundAlpha: 0, backgroundImage: 'none' });
          expect(focused.outlineStyle, `${where}: Send shows a focus ring`).not.toBe('none');
          expect(focused.outlineWidth, `${where}: the focus ring has a width`).toBeGreaterThan(0);
          expect(focused.text, `${where}: Send text contrast with focus`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
        }
      });
    }
  }
});
