import type { Page } from '@playwright/test';
import { expect, test } from '../support/test';
import { contrastOf } from '../support/contrast';
import { dismissOverlays } from '../support/overlays';
import { waitForStylesApplied } from '../support/stylesApplied';
import { apiIsStubbed } from '../support/stubApi';
import { targets } from '../support/targets';

/** Några pixlar marginal för subpixelavrundning i mätningarna. */
const TOLERANCE_PX = 1;
/** WCAG AA för text. */
const MIN_TEXT_CONTRAST = 4.5;
const PHONE_HEIGHT = 900;
const PHONE_WIDTHS = [320, 375, 390];
const THEMES = ['dark', 'light'] as const;

const CORS_HEADERS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, OPTIONS' };

// Gruppen läggs över det fejkade API:et i webbläsaren (sidans rutt går före kontextens). Hoppas över mot staging: där vet provet inte vilka löpare som finns.
const SHOWCASE = [
  { series: 'milestoner', tier: 3 },
  { series: 'climber', tier: 5 },
  { series: 'night_owl', tier: 6 },
  { series: 'speedster', tier: 2 },
  { series: 'milestoner', tier: 1 },
  { series: 'climber', tier: 1 },
];

function runner(id: string, name: string, totalXp: number) {
  return { id, name, email: `${id}@example.test`, is_admin: false, total_xp: totalXp, current_level: 12, total_km: 321.5, current_streak: 2, longest_streak: 4, runs: [] };
}

async function answerWith(page: Page, path: string, data: unknown, extra: object = {}): Promise<void> {
  await page.route(`${targets.apiUrl}/**${path}`, (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS_HEADERS })
      : route.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify({ success: true, data, ...extra }) }),
  );
}

interface OpenOptions {
  names: string[];
  /** Antal badges API:et skickar per löpare; kortet visar högst tre. */
  badges?: number;
  width: number;
  height?: number;
  theme?: (typeof THEMES)[number];
}

async function openBoard(page: Page, { names, badges = 0, width, height = PHONE_HEIGHT, theme = 'dark' }: OpenOptions): Promise<void> {
  const group = names.map((name, index) => runner(`podium-names-${index + 1}`, name, 6000 - index * 400));
  await answerWith(page, '/auth/users-with-runs', group);
  await answerWith(
    page,
    '/badges/group',
    { members: group.map((member) => ({ user_id: member.id, showcase: SHOWCASE.slice(0, badges) })), holders: {} },
    { meta: { member_count: group.length } },
  );
  await answerWith(page, '/leaderboard/rank-delta', {
    as_of: '2026-10-12',
    users: group.map((member, index) => ({ user_id: member.id, xp: member.total_xp, rank: index + 1, previous_xp: 0, previous_rank: index + 1, rank_delta: [3, -1, 0][index] ?? null })),
  });
  await page.addInitScript((value) => window.localStorage.setItem('theme', value), theme);
  await page.setViewportSize({ width, height });
  await page.goto('/board');
  await dismissOverlays(page);
  await expect(page.getByTestId('podium-3')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await waitForStylesApplied(page);
  await page.evaluate(() => document.fonts.ready);
}

const NORMAL_NAMES = ['Anna Svensson', 'Berit Johansson', 'Cecil Karlsson', 'Dan Rest', 'Eva Rest', 'Fia Rest'];

test.describe('the podium cards on a phone', () => {
  test.skip(!apiIsStubbed(), 'The group is filled from a stubbed API; run with E2E_STUB_API=1 against a local build.');

  // Plats 3 ska vara lika bred och hög som plats 1 och 2 vid lika många badges. API:et skickar upp till sex; kortet visar tre. Namnen är lika långa i form, så skillnaden kan bara komma av layouten.
  for (const width of PHONE_WIDTHS) {
    for (const theme of THEMES) {
      for (const badges of [0, 1, 3, 6]) {
        test(`gives the third place the same card height and name width as the first two with ${badges} badges from the API on a ${width} px phone in the ${theme} theme`, async ({ page }) => {
          await openBoard(page, { names: NORMAL_NAMES, badges, width, theme });

          const cards = await page.evaluate(() =>
            Array.from(document.querySelectorAll('.rq-board-podium')).map((card) => ({
              rank: card.getAttribute('data-rank'),
              minis: card.querySelectorAll('.rq-badge-minis .rq-badge').length,
              height: card.getBoundingClientRect().height,
              nameWidth: card.querySelector('.rq-board-namebtn')!.getBoundingClientRect().width,
            })),
          );

          expect(cards.map((card) => card.rank)).toEqual(['1', '2', '3']);
          for (const card of cards) expect(card.minis, 'the card shows at most three badges').toBe(Math.min(badges, 3));
          const [first, second, third] = cards;
          test.info().annotations.push({ type: 'measure', description: `${width} px / ${theme} / ${badges} badges: heights ${cards.map((card) => card.height.toFixed(1)).join('/')}, name widths ${cards.map((card) => card.nameWidth.toFixed(1)).join('/')}` });
          expect(Math.abs(third!.height - first!.height), 'place 3 is as tall as place 1').toBeLessThanOrEqual(TOLERANCE_PX);
          expect(Math.abs(third!.height - second!.height), 'place 3 is as tall as place 2').toBeLessThanOrEqual(TOLERANCE_PX);
          expect(Math.abs(third!.nameWidth - first!.nameWidth), 'place 3 has the name width of place 1').toBeLessThanOrEqual(TOLERANCE_PX);
          expect(Math.abs(third!.nameWidth - second!.nameWidth), 'place 3 has the name width of place 2').toBeLessThanOrEqual(TOLERANCE_PX);
        });
      }
    }
  }

  // Förnamn och pil på första raden, efternamnet på en egen rad (högst två rader med ellips), och pilen står aldrig ensam på en rad. Namnen har ett långt förnamn, ett långt efternamn utan mellanslag, tre ord och ett bindestreck.
  const NAME_CASES = [
    { label: 'ordinary two-word names', names: NORMAL_NAMES },
    { label: 'a three-word name and a long first name', names: ['Nicklas von Elling', 'Bartholomew Wolfeschlegelsteinhausenbergerdorff', 'Daniel Lindblad Lüthje', 'Dan Rest', 'Eva Rest', 'Fia Rest'] },
    { label: 'a very long surname without a space and a hyphenated first name', names: ['Ann Pneumonoultramicroscopicsilicovolcanoconiosis', 'Christopher-Alexander Oppenheimer-Featherstonehaugh', 'Anna-Karin Montgomery-Featherstonehaugh', 'Dan Rest', 'Eva Rest', 'Fia Rest'] },
  ];
  for (const { label, names } of NAME_CASES) {
    for (const width of PHONE_WIDTHS) {
      for (const badges of [0, 3]) {
        test(`puts the first name and the arrow on the first line and the surname on its own lines with ${label} and ${badges} badges on a ${width} px phone`, async ({ page }) => {
          await openBoard(page, { names, badges, width });

          const cards = await page.evaluate(() =>
            Array.from(document.querySelectorAll('.rq-board-podium')).map((card) => {
              const rectsOf = (node: Element) => {
                const range = document.createRange();
                range.selectNodeContents(node);
                return Array.from(range.getClientRects()).filter((box) => box.width > 0);
              };
              const box = card.getBoundingClientRect();
              const button = card.querySelector('.rq-board-namebtn')!;
              const given = card.querySelector('.rq-board-podium__given')!;
              const surname = card.querySelector('.rq-board-podium__surname');
              const arrow = card.querySelector('.rq-board-delta')!.getBoundingClientRect();
              const givenRects = rectsOf(given);
              const givenTop = Math.min(...givenRects.map((rect) => rect.top));
              const givenBottom = Math.max(...givenRects.map((rect) => rect.bottom));
              const surnameBox = surname?.getBoundingClientRect();
              const lineHeight = surname ? parseFloat(getComputedStyle(surname).lineHeight) : 0;
              const textBoxes = [...rectsOf(button), ...(surname ? rectsOf(surname) : [])];
              return {
                name: button.textContent ?? '',
                arrowInsideFirstNameRows: arrow.top + arrow.height / 2 >= givenTop - 1 && arrow.top + arrow.height / 2 <= givenBottom + 1,
                arrowAfterGivenName: arrow.left >= Math.max(...givenRects.map((rect) => rect.right)) - 1 || givenRects.length > 1,
                surnameBelow: surnameBox ? surnameBox.top >= givenBottom - 1 : true,
                surnameLines: surnameBox ? Math.round(surnameBox.height / lineHeight) : 0,
                hasSurname: surname !== null,
                textInside: textBoxes.every((rect) => rect.left >= box.left - 1 && rect.right <= box.right + 1),
                pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
              };
            }),
          );

          expect(cards, 'the three podium cards are on the page').toHaveLength(3);
          for (const card of cards) {
            expect(card.arrowInsideFirstNameRows, `the arrow stands on the rows of the first name of ${card.name}`).toBe(true);
            expect(card.arrowAfterGivenName, `the arrow follows the first name of ${card.name}`).toBe(true);
            expect(card.surnameBelow, `the surname of ${card.name} is below the first name`).toBe(true);
            expect(card.surnameLines, `the surname of ${card.name} has at most two lines`).toBeLessThanOrEqual(2);
            expect(card.textInside, `the name ${card.name} stays inside its card`).toBe(true);
            expect(card.pageOverflow, 'the page does not scroll sideways').toBeLessThanOrEqual(0);
          }
          expect(cards.every((card) => card.hasSurname), 'every example name has a surname').toBe(true);
        });
      }
    }
  }

  // Långa efternamn bryter i podiet och i restraderna vid 320 px, utan att sidan blir bredare.
  test('keeps long surnames inside the podium cards and the rest rows on a 320 px phone', async ({ page }) => {
    const names = ['Ann Pneumonoultramicroscopicsilicovolcanoconiosis', 'Bo Wolfeschlegelsteinhausenbergerdorff', 'Cy Lundgren-Featherstonehaugh', 'Dan Montgomery-Featherstonehaugh', 'Eva Rest', 'Fia Rest'];
    await openBoard(page, { names, badges: 3, width: 320 });

    const measured = await page.evaluate(() => {
      const inside = (node: Element, host: Element) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const hostBox = host.getBoundingClientRect();
        return Array.from(range.getClientRects()).every((rect) => rect.left >= hostBox.left - 1 && rect.right <= hostBox.right + 1);
      };
      const podium = Array.from(document.querySelectorAll('.rq-board-podium')).map((card) => inside(card.querySelector('.rq-board-namebtn')!, card));
      const rows = Array.from(document.querySelectorAll('[role="table"][aria-label="Rest of the pack"] [role="row"]')).filter((row) => row.querySelector('button'));
      return { podium, rest: rows.map((row) => inside(row.querySelector('button')!, row)), pageOverflow: document.documentElement.scrollWidth - window.innerWidth };
    });

    expect(measured.podium, 'the names stay inside the three podium cards').toEqual([true, true, true]);
    expect(measured.rest, 'the names stay inside the three rest rows').toEqual([true, true, true]);
    expect(measured.pageOverflow, 'the page does not scroll sideways').toBeLessThanOrEqual(0);
  });

  // Placeringen är läsbar text i rankfärgen (guld, silver, brons) uppe till höger. Texten mäts mot kortets egen yta.
  for (const theme of THEMES) {
    test(`reads the place of each podium card with at least 4.5:1 in the ${theme} theme`, async ({ page }) => {
      await openBoard(page, { names: NORMAL_NAMES, badges: 3, width: 375, theme });

      const places = await page.evaluate(contrastOf, { selectors: ['.rq-board-podium__rank'] });
      expect(places.map((place) => place.text)).toEqual(['#1', '#2', '#3']);
      for (const place of places) {
        test.info().annotations.push({ type: 'measure', description: `${theme} / ${place.text}: ${place.ratio}:1` });
        expect(place.ratio, `${theme} / ${place.text}`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      }
    });
  }

  test('keeps the name button focusable with its runner id and a drawn focus ring', async ({ page }) => {
    await openBoard(page, { names: NORMAL_NAMES, badges: 3, width: 375 });

    const button = page.getByRole('button', { name: 'Anna Svensson', exact: true });
    await expect(button).toHaveAttribute('data-runner-id', 'podium-names-1');
    await page.keyboard.press('Tab');
    await button.focus();
    await expect(button).toBeFocused();
    const ring = await button.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    });
    expect(ring.style, 'a ring is drawn').not.toBe('none');
    expect(ring.width, 'the ring is at least 2 px').toBeGreaterThanOrEqual(2);
  });
});
