import type { Page } from '@playwright/test';
import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';
import { waitForStylesApplied } from '../support/stylesApplied';
import { targets } from '../support/targets';

/** Några pixlar marginal för subpixelavrundning i mätningarna. */
const TOLERANCE_PX = 1;

const PHONE_WIDTHS = [320, 360, 375];
const PHONE_HEIGHT = 812;

// Ett enda ord utan brytpunkt (30 tecken) som är bredare än mittkolumnen på 320 px. Orden i ett vanligt namn bryts vid mellanslag som förut; bara ett ord som inte ryms bryts mitt i.
const LONG_WORD = 'Montgomery-Featherstonehaugh';
const LONG_NAME = `${LONG_WORD} 1`;
const NORMAL_NAME = 'Sam Rest';
const OTHER_NORMAL_NAME = 'Kim Rest';

function runner(id: string, name: string, totalXp: number) {
  return {
    id,
    name,
    email: `${id}@example.test`,
    is_admin: false,
    total_xp: totalXp,
    current_level: 4,
    total_km: 40,
    current_streak: 3,
    longest_streak: 5,
    runs: [],
  };
}

// Podiet tar plats 1-3, så namnen på plats 4-6 ritas som rest-rader ("Rest of the pack"): ett långt, och två vanliga som visar att radhöjden för vanliga namn inte ändras.
const GROUP = [
  runner('board-1', 'Ada One', 3000),
  runner('board-2', 'Bo Two', 2800),
  runner('board-3', 'Cy Three', 2600),
  runner('board-4', LONG_NAME, 2400),
  runner('board-5', NORMAL_NAME, 2200),
  runner('board-6', OTHER_NORMAL_NAME, 2000),
];

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

// Svaret sätts i webbläsaren och ersätter svaret från det riktiga eller fejkade API:et (sidans rutt går före kontextens), så proven gäller lika mot staging och mot stubben, och ingen
// förfrågan om gruppen når ett riktigt API.
async function answerWith(page: Page, path: string, data: unknown, extra: object = {}): Promise<void> {
  await page.route(`${targets.apiUrl}/**${path}`, (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS_HEADERS })
      : route.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify({ success: true, data, ...extra }) }),
  );
}

test.describe('the rest of the pack with a very long name', () => {
  for (const width of PHONE_WIDTHS) {
    test(`a name with a very long word stays inside its row and the page does not scroll sideways on a ${width} px phone`, async ({ page }) => {
      await answerWith(page, '/auth/users-with-runs', GROUP);
      await page.setViewportSize({ width, height: PHONE_HEIGHT });
      await page.goto('/board');
      await dismissOverlays(page);
      const table = page.getByRole('table', { name: 'Rest of the pack' });
      await expect(table.getByRole('button', { name: LONG_NAME, exact: true })).toBeVisible();
      await waitForStylesApplied(page);

      const measured = await table.evaluate((element, longName) => {
        const frame = element.getBoundingClientRect();
        const rows = Array.from(element.querySelectorAll('[role="row"]')).filter((row) => row.querySelector('[role="cell"]'));
        const textRect = (node: Element) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          return range.getBoundingClientRect();
        };
        return {
          rows: rows.map((row) => {
            const box = row.getBoundingClientRect();
            const name = row.querySelector('button')!;
            const text = textRect(name);
            return {
              name: name.textContent ?? '',
              isLong: name.textContent === longName,
              height: box.height,
              rowLeft: box.left - frame.left,
              rowRight: frame.right - box.right,
              textLeft: text.left - box.left,
              textRight: box.right - text.right,
            };
          }),
          pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      }, LONG_NAME);

      expect(measured.rows.length, 'the long name and the two ordinary names are in the rest rows').toBe(3);
      for (const row of measured.rows) {
        expect(row.rowLeft, `the row of "${row.name}" starts inside the frame`).toBeGreaterThanOrEqual(-TOLERANCE_PX);
        expect(row.rowRight, `the row of "${row.name}" ends inside the frame`).toBeGreaterThanOrEqual(-TOLERANCE_PX);
        expect(row.textLeft, `"${row.name}" starts inside its row`).toBeGreaterThanOrEqual(-TOLERANCE_PX);
        expect(row.textRight, `"${row.name}" ends inside its row`).toBeGreaterThanOrEqual(-TOLERANCE_PX);
      }
      expect(measured.pageOverflow, 'the page does not scroll sideways').toBeLessThanOrEqual(TOLERANCE_PX);

      // Raderna med vanliga namn har samma uppbyggnad och därmed samma höjd: det långa namnet får bara sin egen rad att växa.
      const ordinary = measured.rows.filter((row) => !row.isLong).map((row) => row.height);
      expect(Math.max(...ordinary) - Math.min(...ordinary), 'rows with ordinary names have the same height').toBeLessThanOrEqual(TOLERANCE_PX);
    });
  }
});

// Podiekortens namnkolumn är bara ~92-95 px, så regeln som låter ett för långt ord brytas gäller raderna, inte podiet: ett vanligt namn bryts där det alltid brutits (vid mellanslag) och kortet
// behåller sin höjd. Basen mäts i samma sida: samma kort med `overflow-wrap: normal` på namnen, alltså som det ritades innan reglen fanns. Badge-minis finns med, de smalnar av namnkolumnen.
const PODIUM_NAMES = ['Bartholomew Montgomery', 'Alexandersson Karlsson', 'Christopher Oppenheimer'];
const PODIUM_GROUP = [
  ...PODIUM_NAMES.map((name, index) => runner(`podium-${index + 1}`, name, 3000 - index * 200)),
  runner('podium-4', NORMAL_NAME, 2200),
];

test.describe('the podium with ordinary names', () => {
  for (const { width, height } of [{ width: 320, height: PHONE_HEIGHT }, { width: 375, height: PHONE_HEIGHT }, { width: 1280, height: 900 }]) {
    test(`the cards keep their height and their name lines as without the break rule on a ${width} px screen`, async ({ page }) => {
      await answerWith(page, '/auth/users-with-runs', PODIUM_GROUP);
      await answerWith(
        page,
        '/badges/group',
        { members: PODIUM_GROUP.map((member) => ({ user_id: member.id, showcase: [{ series: 'milestoner', tier: 1 }, { series: 'milestoner', tier: 2 }] })), holders: {} },
        { meta: { member_count: PODIUM_GROUP.length } },
      );
      await page.setViewportSize({ width, height });
      await page.goto('/board');
      await dismissOverlays(page);
      for (const name of PODIUM_NAMES) await expect(page.getByRole('button', { name, exact: true }).first()).toBeVisible();
      await waitForStylesApplied(page);

      const measured = await page.evaluate(async (names) => {
        const cards = Array.from(document.querySelectorAll('.rq-board-podium'));
        const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const measure = () =>
          cards.map((card) => {
            const name = Array.from(card.querySelectorAll('.rq-board-namebtn')).find((button) => names.includes(button.textContent ?? ''));
            const range = document.createRange();
            range.selectNodeContents(name!);
            return {
              name: name!.textContent ?? '',
              cardHeight: Math.round(card.getBoundingClientRect().height * 10) / 10,
              nameLines: new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))).size,
            };
          });
        const withRule = measure();
        const buttons = Array.from(document.querySelectorAll<HTMLElement>('.rq-board-namebtn'));
        buttons.forEach((button) => button.style.setProperty('overflow-wrap', 'normal'));
        await nextFrame();
        const base = measure();
        buttons.forEach((button) => button.style.removeProperty('overflow-wrap'));
        return { withRule, base };
      }, PODIUM_NAMES);

      expect(measured.base.length, 'the three podium cards are on the page').toBe(PODIUM_NAMES.length);
      expect(measured.withRule).toEqual(measured.base);
    });
  }
});

// Namn har ingen längdgräns: ett ord på 45 tecken på plats 3 ska inte ligga utanför kortet eller göra sidan bredare, med och utan badge-minis (som bryter till en egen rad när de inte ryms).
const VERY_LONG_WORD = 'Pneumonoultramicroscopicsilicovolcanoconiosis';
const PODIUM_LONG_NAME = `Ann ${VERY_LONG_WORD}`;
const PODIUM_LONG_GROUP = [
  runner('long-1', 'Bo Ek', 3000),
  runner('long-2', 'Cy Lund', 2800),
  runner('long-3', PODIUM_LONG_NAME, 2600),
  runner('long-4', NORMAL_NAME, 2400),
];

test.describe('the podium with a very long word in a name', () => {
  for (const { width, height } of [{ width: 320, height: PHONE_HEIGHT }, { width: 375, height: PHONE_HEIGHT }, { width: 1280, height: 900 }]) {
    for (const withBadges of [false, true]) {
      test(`the name stays inside its card and the page does not scroll sideways on a ${width} px screen ${withBadges ? 'with' : 'without'} badges`, async ({ page }) => {
        await answerWith(page, '/auth/users-with-runs', PODIUM_LONG_GROUP);
        const showcase = withBadges ? [{ series: 'milestoner', tier: 1 }, { series: 'milestoner', tier: 2 }, { series: 'milestoner', tier: 3 }] : [];
        await answerWith(
          page,
          '/badges/group',
          { members: PODIUM_LONG_GROUP.map((member) => ({ user_id: member.id, showcase })), holders: {} },
          { meta: { member_count: PODIUM_LONG_GROUP.length } },
        );
        await page.setViewportSize({ width, height });
        await page.goto('/board');
        await dismissOverlays(page);
        await expect(page.getByRole('button', { name: PODIUM_LONG_NAME, exact: true })).toBeVisible();
        await waitForStylesApplied(page);

        const measured = await page.evaluate((longName) => {
          const card = document.querySelector('[data-testid="podium-3"]')!;
          const name = Array.from(card.querySelectorAll('.rq-board-namebtn')).find((button) => button.textContent === longName)!;
          const range = document.createRange();
          range.selectNodeContents(name);
          const text = range.getBoundingClientRect();
          const box = card.getBoundingClientRect();
          const minis = card.querySelector('.rq-badge-minis')?.getBoundingClientRect();
          return {
            textLeft: text.left - box.left,
            textRight: box.right - text.right,
            minisInside: minis ? minis.left >= box.left - 1 && minis.right <= box.right + 1 : true,
            pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
          };
        }, PODIUM_LONG_NAME);

        expect(measured.textLeft, 'the name starts inside the card').toBeGreaterThanOrEqual(-TOLERANCE_PX);
        expect(measured.textRight, 'the name ends inside the card').toBeGreaterThanOrEqual(-TOLERANCE_PX);
        expect(measured.minisInside, 'the badges stay inside the card').toBe(true);
        expect(measured.pageOverflow, 'the page does not scroll sideways').toBeLessThanOrEqual(TOLERANCE_PX);
      });
    }
  }
});
