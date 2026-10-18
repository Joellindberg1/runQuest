import type { Page } from '@playwright/test';
import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';

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
    test.skip(
      unreadBefore === 0,
      'The test account has no unread Pack News rows. The staging seed must leave at least one (a row from another runner, created after the account), see docs/e2e.md.',
    );

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
    const readRequest = page.waitForRequest((request) => isReadRequest(request.method(), request.url()));
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
