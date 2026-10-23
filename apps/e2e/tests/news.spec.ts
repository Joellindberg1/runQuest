import type { Page } from '@playwright/test';
import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';
import { apiIsStubbed } from '../support/stubApi';

const CHIPS = ['Titles', 'Challenges', 'Ranks', 'Events', 'Levels', 'Badges', 'Streaks'] as const;
/** Oläst rad: knappens namn bär en dold "(unread)"-text, så färgen inte är det enda tecknet. */
const UNREAD_ROW = /\(unread\)/;
/** Rörelsevaktens fönster efter att listan monterats är 150 ms (POINTER_SETTLE_MS); en lugn marginal över det. */
const SETTLE_WAIT_MS = 600;

const isReadRequest = (method: string, url: string) => method === 'POST' && /\/news\/read$/.test(url);

async function openNews(page: Page, search = ''): Promise<void> {
  const feed = page.waitForResponse((response) => response.request().method() === 'GET' && /\/news(\?|$)/.test(response.url()));
  await page.goto(`/news${search}`);
  await feed;
  await dismissOverlays(page);
  await expect(page.getByRole('heading', { name: 'Pack News' })).toBeVisible();
  // Underrubriken ("N unread" eller "All caught up") finns först när flödet är ritat.
  await expect(page.getByText(/^(\d[\d\s,]* unread|All caught up)$/)).toBeVisible();
}

test.describe('Pack News', () => {
  test.skip(apiIsStubbed(), 'Needs the real news feed; the stubbed API has none.');

  test('the filter has seven chips that turn on and off through the address', async ({ page }) => {
    // ?type= gör filterkortet synligt även när kontot inte har några nyhetsrader än.
    await openNews(page, '?type=levels');

    const chips = page.getByRole('group', { name: 'Filter' }).getByRole('button');
    await expect(chips).toHaveCount(CHIPS.length);
    for (const [index, label] of CHIPS.entries()) {
      await expect(chips.nth(index)).toContainText(label);
    }
    await expect(chips.nth(CHIPS.indexOf('Levels'))).toHaveAttribute('aria-pressed', 'true');

    await chips.nth(CHIPS.indexOf('Ranks')).click();
    await expect(page).toHaveURL(/type=ranks%2Clevels|type=ranks,levels/);
    await expect(chips.nth(CHIPS.indexOf('Ranks'))).toHaveAttribute('aria-pressed', 'true');

    await chips.nth(CHIPS.indexOf('Ranks')).click();
    await chips.nth(CHIPS.indexOf('Levels')).click();
    await expect(page).not.toHaveURL(/type=/);
    await expect(chips.nth(CHIPS.indexOf('Levels'))).toHaveAttribute('aria-pressed', 'false');
  });

  test('a row becomes read when a real pointer moves over it, and not when it only has focus', async ({ page }) => {
    await openNews(page);

    const unreadRows = page.getByRole('button', { name: UNREAD_ROW });
    const unreadBefore = await unreadRows.count();
    // Ingen oläst rad är ett fel, inte ett hopp över: ett tyst grönt test vore ett test som slutat bevisa något. Staging fylls på av Lead (docs/e2e.md).
    expect(
      unreadBefore,
      'staging needs new unread Pack News rows for the test account: one is used up on every run. Lead seeds them, see "Fylla på olästa rader" in docs/e2e.md.',
    ).toBeGreaterThan(0);

    const reads: string[] = [];
    page.on('request', (request) => {
      if (isReadRequest(request.method(), request.url())) reads.push(request.url());
    });

    // Fokus ensam markerar inget, hur länge den än ligger kvar.
    const row = unreadRows.first();
    await row.focus();
    await page.waitForTimeout(SETTLE_WAIT_MS);
    await expect(unreadRows).toHaveCount(unreadBefore);
    expect(reads).toEqual([]);

    // En riktig pekare som rör sig in över raden gör den läst, och servern får veta det.
    // Vänta på svaret, inte bara begäran: läsningarna buntas, och en omladdning före svaret kan läsa flödet innan raden sparats.
    const readRequest = page.waitForResponse((response) => isReadRequest(response.request().method(), response.url()));
    await page.mouse.move(1, 1);
    await row.hover();
    await readRequest;
    await expect(unreadRows).toHaveCount(unreadBefore - 1);

    // Det är sparat på servern, inte bara i sidan.
    await page.reload();
    await dismissOverlays(page);
    await expect(page.getByRole('heading', { name: 'Pack News' })).toBeVisible();
    await expect(unreadRows).toHaveCount(unreadBefore - 1);
  });
});
