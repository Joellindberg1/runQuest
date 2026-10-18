import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';
import { frontendIsLocal } from '../support/targets';

test.describe('access', () => {
  test('a regular account that opens the admin page is sent to the standings', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/board$/);
    await dismissOverlays(page);
    await expect(page.getByRole('heading', { name: 'The standings' })).toBeVisible();
  });

  test('the staging build announces itself on every page', async ({ page }) => {
    test.skip(frontendIsLocal, 'A local dev server is not a staging build, so it has no banner.');
    await page.goto('/board');
    await expect(page.getByRole('complementary', { name: 'Staging environment' })).toContainText('STAGING');
  });
});
