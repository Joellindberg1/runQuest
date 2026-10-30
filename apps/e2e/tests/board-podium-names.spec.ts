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
    users: group.map((member, index) => ({ user_id: member.id, xp: member.total_xp, rank: index + 1, previous_xp: 0, previous_rank: index + 1, rank_delta: [12, -2, 1][index] ?? null })),
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

  // Ett förnamn på 11-12 tecken ska ligga helt bredvid pilen, med och utan badges, och korten ska vara lika höga och lika breda även när namnen är olika långa. Gränsen för var badgegruppen
  // flyttar upp bredvid namnet gäller radens bredd, inte namnets längd; ett namn som bryts mitt i ordet eller ett kort som växer av ett längre namn fäller provet.
  const WORD_NAMES = ['Bartholomew Montgomery', 'Christopher Oppenheimer', 'Maximilianus Sebastiansson', 'Dan Rest', 'Eva Rest', 'Fia Rest'];
  for (const width of PHONE_WIDTHS) {
    for (const badges of [0, 1, 3]) {
      test(`keeps the words of differently long names whole and the cards equally tall with ${badges} badges on a ${width} px phone`, async ({ page }) => {
        await openBoard(page, { names: WORD_NAMES, badges, width });

        const cards = await page.evaluate(() =>
          Array.from(document.querySelectorAll('.rq-board-podium')).map((card) => {
            const splitWords: string[] = [];
            for (const part of Array.from(card.querySelectorAll('.rq-board-podium__given, .rq-board-podium__surname'))) {
              const text = part.firstChild as Text;
              for (const match of text.data.matchAll(/\S+/g)) {
                const range = document.createRange();
                range.setStart(text, match.index!);
                range.setEnd(text, match.index! + match[0].length);
                const lines = new Set(Array.from(range.getClientRects()).filter((box) => box.width > 0).map((box) => Math.round(box.top)));
                if (lines.size > 1) splitWords.push(match[0]);
              }
            }
            return {
              name: card.querySelector('.rq-board-namebtn')!.textContent ?? '',
              splitWords,
              height: card.getBoundingClientRect().height,
              nameWidth: card.querySelector('.rq-board-namebtn')!.getBoundingClientRect().width,
            };
          }),
        );

        expect(cards).toHaveLength(3);
        test.info().annotations.push({ type: 'measure', description: `${width} px / ${badges} badges: heights ${cards.map((card) => card.height.toFixed(1)).join('/')}, name widths ${cards.map((card) => card.nameWidth.toFixed(1)).join('/')}` });
        for (const card of cards) expect(card.splitWords, `${card.name} has no word broken in the middle`).toEqual([]);
        for (const card of cards.slice(1)) {
          expect(Math.abs(card.height - cards[0]!.height), `${card.name} is as tall as ${cards[0]!.name}`).toBeLessThanOrEqual(TOLERANCE_PX);
          expect(Math.abs(card.nameWidth - cards[0]!.nameWidth), `${card.name} has the name width of ${cards[0]!.name}`).toBeLessThanOrEqual(TOLERANCE_PX);
        }
      });
    }
  }

  // Badgepyramiden: tre badges som en överst och två under, två som en rad, en ensam; 28 x 31 px-emblemen oförändrade. Gruppen står bredvid namnblocket, mitt i raden och fri från placeringen,
  // och kortet blir inte högre av den (ett kort utan badges är lika högt som ett med tre) så länge raden är bred nog att rymma namnets längsta ord bredvid den.
  const EMBLEM_WIDTH_PX = 28;
  const EMBLEM_HEIGHT_PX = 31;
  /** Pyramidens mått i prototypen: ca 62 x 60 px för tre emblem. */
  const PYRAMID_SIZE_PX = 62;
  const MAX_GROWTH_PX = 4;
  for (const width of [375, 390, 402, 430]) {
    for (const badges of [1, 2, 3]) {
      test(`draws ${badges} badges as a pyramid beside the name, centred in the row and clear of the place, on a ${width} px phone`, async ({ page }) => {
        await openBoard(page, { names: WORD_NAMES, badges, width });

        const cards = await page.evaluate(() =>
          Array.from(document.querySelectorAll('.rq-board-podium')).map((card) => {
            const box = (node: Element) => node.getBoundingClientRect();
            const emblems = Array.from(card.querySelectorAll('.rq-board-podium__pyramid .rq-badge')).map((emblem) => box(emblem));
            const group = card.querySelector('.rq-board-podium__pyramid .rq-badge-minis')!;
            const range = document.createRange();
            range.selectNodeContents(card.querySelector('.rq-board-namebtn')!);
            const nameRight = Math.max(...Array.from(range.getClientRects()).filter((rect) => rect.width > 0).map((rect) => rect.right));
            const head = box(card.querySelector('.rq-board-podium__head')!);
            const groupBox = box(group);
            const place = box(card.querySelector('.rq-board-podium__rank')!);
            return {
              emblems: emblems.map((rect) => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height })),
              group: { left: groupBox.left, right: groupBox.right, top: groupBox.top, bottom: groupBox.bottom },
              besideName: groupBox.left >= nameRight - 1,
              centredInRow: Math.abs(groupBox.top + groupBox.height / 2 - (head.top + head.height / 2)),
              clearOfPlace: groupBox.right <= place.left + 1 || groupBox.bottom <= place.top + 1,
              insideCard: groupBox.right <= box(card).right,
            };
          }),
        );

        expect(cards).toHaveLength(3);
        for (const card of cards) {
          expect(card.emblems, `${badges} emblems`).toHaveLength(badges);
          for (const emblem of card.emblems) {
            expect(Math.abs(emblem.width - EMBLEM_WIDTH_PX), 'the emblem keeps its 28 px width').toBeLessThanOrEqual(TOLERANCE_PX);
            expect(Math.abs(emblem.height - EMBLEM_HEIGHT_PX), 'the emblem keeps its 31 px height').toBeLessThanOrEqual(TOLERANCE_PX);
          }
          expect(card.besideName, 'the group is beside the name block, not under it').toBe(true);
          expect(card.centredInRow, 'the group is centred in the row').toBeLessThanOrEqual(TOLERANCE_PX + 1);
          expect(card.clearOfPlace, 'the group does not touch the place').toBe(true);
          expect(card.insideCard, 'the group is inside the card').toBe(true);
          const [top, left, right] = card.emblems;
          if (badges === 3) {
            expect(Math.abs((top!.left + top!.right) / 2 - (left!.left + right!.right) / 2), 'the top emblem is centred over the two below').toBeLessThanOrEqual(TOLERANCE_PX);
            expect(Math.abs(left!.top - right!.top), 'the two lower emblems share a row').toBeLessThanOrEqual(TOLERANCE_PX);
            expect(left!.top, 'the two lower emblems are below the top one').toBeGreaterThanOrEqual(top!.top + EMBLEM_HEIGHT_PX - TOLERANCE_PX - 1);
            expect(Math.abs(right!.right - left!.left - PYRAMID_SIZE_PX), 'the pyramid is about 62 px wide').toBeLessThanOrEqual(4);
            expect(Math.abs(Math.max(left!.bottom, right!.bottom) - top!.top - PYRAMID_SIZE_PX), 'the pyramid is about 62 px high').toBeLessThanOrEqual(4);
          } else if (badges === 2) {
            expect(Math.abs(top!.top - left!.top), 'two emblems share a row').toBeLessThanOrEqual(TOLERANCE_PX);
          }
        }

        // The card is no taller with the badges than without them.
        const heights = async (count: number) => {
          const other = await page.context().newPage();
          await openBoard(other, { names: WORD_NAMES, badges: count, width });
          const measured = await other.evaluate(() => Array.from(document.querySelectorAll('.rq-board-podium')).map((card) => card.getBoundingClientRect().height));
          await other.close();
          return measured;
        };
        const without = await heights(0);
        const withBadges = await page.evaluate(() => Array.from(document.querySelectorAll('.rq-board-podium')).map((card) => card.getBoundingClientRect().height));
        test.info().annotations.push({ type: 'measure', description: `${width} px / ${badges} badges: heights ${withBadges.map((value) => value.toFixed(1)).join('/')} against ${without.map((value) => value.toFixed(1)).join('/')} without badges` });
        withBadges.forEach((height, index) => expect(height - without[index]!, `card ${index + 1} grows by the badges`).toBeLessThanOrEqual(MAX_GROWTH_PX));
      });
    }
  }

  // Utan badges finns ingen yta och ingen platshållare, och namnet får raden för sig.
  for (const width of PHONE_WIDTHS) {
    test(`leaves no room and no text for badges when there are none on a ${width} px phone`, async ({ page }) => {
      await openBoard(page, { names: WORD_NAMES, badges: 0, width });

      const cards = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.rq-board-podium')).map((card) => {
          const head = card.querySelector('.rq-board-podium__head')!;
          const id = card.querySelector('.rq-board-podium__id')!.getBoundingClientRect();
          const headBox = head.getBoundingClientRect();
          return {
            pyramids: card.querySelectorAll('.rq-board-podium__pyramid, .rq-badge-minis, .rq-badge').length,
            nameBlockRight: id.right,
            headRight: headBox.right,
            headText: head.textContent ?? '',
          };
        }),
      );

      for (const card of cards) {
        expect(card.pyramids, 'no badge element at all').toBe(0);
        expect(card.headText, 'no placeholder text in the row').not.toMatch(/none|badge/i);
        expect(Math.abs(card.nameBlockRight - card.headRight), 'the name block reaches the right edge of the row').toBeLessThanOrEqual(TOLERANCE_PX);
      }
    });
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
