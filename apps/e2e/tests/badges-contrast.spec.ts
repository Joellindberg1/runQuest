import type { Page } from '@playwright/test';
import type { BadgeUserApiResponse } from '../../../packages/shared/src/contracts/badges';
import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';
import { apiIsStubbed } from '../support/stubApi';
import { waitForStylesApplied } from '../support/stylesApplied';

/** WCAG AA för normal text. Nivåchippets text är 11-12 px, alltså aldrig "stor text". */
const MIN_CONTRAST = 4.5;

const VIEWPORTS = [{ width: 390, height: 844 }, { width: 1280, height: 800 }];

// Sex ägda serier med varsin nivå (Common till Legendary, där Legendary är toppnivån) och två låsta: alla lägen chippet kan ha på ett samlingskort. Nycklarna är serienycklarna i
// packages/shared/src/badges.ts (BADGE_SERIES); en omdöpt serie ger ett kort mindre och fäller provet på antalet chips nedan.
const EARNED_SERIES = ['milestoner', 'earth_trotter', 'climber', 'streak_keeper', 'early_bird', 'night_owl'];
const EXPECTED_CHIP_TEXTS = ['COMMON', 'UNCOMMON', 'RARE', 'HEROIC', 'EPIC', 'LEGENDARY', 'LOCKED', 'LOCKED'];

const CORS_HEADERS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

// `seen_tier` är lika med nivån, så ingen uppgraderingsdialog öppnas över sidan.
const USER_BADGES: BadgeUserApiResponse = {
  success: true,
  data: {
    items: EARNED_SERIES.map((series, index) => ({ series, tier: index + 1, earned_at: '2026-10-01T08:00:00.000Z', seen_tier: index + 1 })),
    showcase: [],
  },
};

async function stubUserBadges(page: Page): Promise<void> {
  await page.route('**/api/badges/user/**', (route) =>
    route.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify(USER_BADGES) }),
  );
}

interface MeasuredChip {
  text: string;
  tier: string | null;
  ratio: number;
  textColor: string;
  background: [number, number, number];
  dimmedBy: string[];
  hiddenBy: string[];
}

/**
 * Mäter varje chip på samlingskorten i den ritade sidan: textens beräknade färg mot den färg som faktiskt ligger bakom den, alla halvgenomskinliga lager (chippets egen tint,
 * kortets rad-yta, panelen, skalet) sammansatta uppifrån och ned, alfa inräknat. Opacitet på ett lager och bakgrundsbilder skulle göra måttet osäkert, så de rapporteras och fäller provet.
 */
async function measureChips(page: Page): Promise<MeasuredChip[]> {
  return page.evaluate(() => {
    type Rgb = [number, number, number];
    interface Rgba { rgb: Rgb; alpha: number }

    // Chrome serialiserar beräknade färger som rgb()/rgba() eller, för color-mix(), som color(srgb r g b [/ a]).
    const parse = (value: string): Rgba => {
      const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(value);
      if (rgb) return { rgb: [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])], alpha: rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] ? 100 : 1) };
      const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)(%?))?\s*\)$/.exec(value);
      if (srgb) return { rgb: [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255], alpha: srgb[4] === undefined ? 1 : Number(srgb[4]) / (srgb[5] ? 100 : 1) };
      throw new Error(`Unrecognised computed color: ${value}`);
    };
    const over = ({ rgb, alpha }: Rgba, backdrop: Rgb): Rgb => [0, 1, 2].map((i) => rgb[i]! * alpha + backdrop[i]! * (1 - alpha)) as Rgb;
    const channel = (value: number) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const luminance = ([r, g, b]: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const contrast = (a: Rgb, b: Rgb) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]; return (hi + 0.05) / (lo + 0.05); };
    const describe = (element: Element) => `${element.tagName.toLowerCase()}${element.className && typeof element.className === 'string' ? `.${element.className.split(/\s+/).join('.')}` : ''}`;

    return Array.from(document.querySelectorAll<HTMLElement>('.rq-badge-card .rq-chip')).map((chip) => {
      const chain: Element[] = [];
      for (let element: Element | null = chip; element; element = element.parentElement) chain.unshift(element);
      // Webbläsarens eget underlag är vitt; skalet lägger sin opaka yta ovanpå.
      let backdrop: Rgb = [255, 255, 255];
      const dimmedBy: string[] = [];
      const hiddenBy: string[] = [];
      for (const element of chain) {
        const style = getComputedStyle(element);
        if (Number(style.opacity) < 1) dimmedBy.push(describe(element));
        if (style.backgroundImage !== 'none') hiddenBy.push(describe(element));
        backdrop = over(parse(style.backgroundColor), backdrop);
      }
      const textColor = getComputedStyle(chip).color;
      const text = over(parse(textColor), backdrop);
      return {
        text: (chip.textContent ?? '').trim().toUpperCase(),
        tier: chip.getAttribute('data-tier'),
        ratio: Math.round(contrast(text, backdrop) * 100) / 100,
        textColor,
        background: backdrop.map((value) => Math.round(value)) as Rgb,
        dimmedBy,
        hiddenBy,
      };
    });
  });
}

// Samlingskortens nivåchip på Badges-sidan i ljust tema. Chippets text ligger i nivåfärgen; i ljust tema är de ljusa nivåfärgerna (Legendary guld, Common grå) för svaga mot kortet.
// Provet mäter den ritade sidan, inte tokenvärden: sidan fylls av det fejkade API:et och temat sätts som användaren gör det (next-themes sparar valet i localStorage).
test.describe('the tier chips on the Badges page in the light theme', () => {
  test.skip(!apiIsStubbed(), 'The collection is filled from a stubbed API; run with E2E_STUB_API=1 against a local build.');

  for (const { width, height } of VIEWPORTS) {
    test(`every tier chip text has at least 4.5:1 contrast on a ${width} px wide screen`, async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('theme', 'light'));
      await stubUserBadges(page);
      await page.setViewportSize({ width, height });
      await page.goto('/badges');
      await dismissOverlays(page);
      await expect(page.locator('.rq-badge-card')).toHaveCount(8);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await waitForStylesApplied(page);

      const chips = await measureChips(page);
      expect(chips.map((chip) => chip.text), 'every mode of the chip is on the page: six earned tiers (the last is the top tier) and two locked series').toEqual(EXPECTED_CHIP_TEXTS);
      for (const chip of chips) {
        expect(chip.dimmedBy, `${chip.text}: the chip is not dimmed by an opacity`).toEqual([]);
        expect(chip.hiddenBy, `${chip.text}: no background image sits behind the chip`).toEqual([]);
      }
      const tooLow = chips.filter((chip) => chip.ratio < MIN_CONTRAST).map(({ text, tier, ratio, textColor, background }) => ({ text, tier, ratio, textColor, background }));
      expect(tooLow, `chips below ${MIN_CONTRAST}:1`).toEqual([]);
    });
  }
});
