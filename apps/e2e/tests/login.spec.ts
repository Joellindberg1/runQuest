import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';
import { submitSignIn } from '../support/signIn';
import { targets, userCredentials } from '../support/targets';

// Inloggningsspecerna skriver in lösenordet och startar utloggade: ingen sparad session, och inget spår som bär de ifyllda värdena.
test.use({ storageState: { cookies: [], origins: [] }, trace: 'off', screenshot: 'off', video: 'off' });

const WRONG_PASSWORD = 'not-the-password-for-this-account';

test.describe('signing in', () => {
  test('a wrong password keeps the dialog open and says so', async ({ page }) => {
    await page.goto('/login');
    await submitSignIn(page, { login: userCredentials().login, password: WRONG_PASSWORD });

    await expect(page.getByRole('alert', { name: 'Sign in error' })).toContainText(/invalid|failed/i);
    await expect(page.getByRole('dialog', { name: 'Sign in' })).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a signed-out visitor to a protected page signs in and lands on that page', async ({ page }) => {
    await page.goto('/log');
    await expect(page).toHaveURL(/\/login\?next=%2Flog$/);

    const loginRequest = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/auth/login'));
    await submitSignIn(page, userCredentials());

    // Frontenden talar med stagingbackenden, inte med något annat.
    expect(new URL((await loginRequest).url()).origin).toBe(targets.apiUrl);
    await expect(page).toHaveURL(/\/log$/);
    await dismissOverlays(page);
    await expect(page.getByRole('heading', { name: 'Log runs' })).toBeVisible();
  });

  test('the session survives a reload, and logging out returns to the landing page', async ({ page }) => {
    await page.goto('/login');
    await submitSignIn(page, userCredentials());
    await expect(page).toHaveURL(/\/board$/);
    await dismissOverlays(page);

    await page.reload();
    await expect(page).toHaveURL(/\/board$/);
    await expect(page.getByRole('heading', { name: 'The standings' })).toBeVisible();

    await page.getByRole('button', { name: /^Account menu for / }).click();
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(`${targets.baseUrl}/`);
    expect(await page.evaluate(() => localStorage.getItem('runquest_token'))).toBeNull();

    await page.goto('/board');
    await expect(page).toHaveURL(/\/login\?next=%2Fboard$/);
  });
});
