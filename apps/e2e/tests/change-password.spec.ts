import { expect, test } from '../support/test';
import { dismissOverlays } from '../support/overlays';

// Ett fel nuvarande lösenord är ett 401 som inte avslutar sessionen (ADR 007 Addendum 2026-10-20 punkt 7: bara `unauthorized` och `token_invalid` gör det; backendens svar
// har koden `current_password_incorrect`). Förut loggade varje 401 ut användaren, så ett felskrivet lösenord i Settings kastade hen till inloggningen. Provet ändrar
// inget: det skickar ett fel nuvarande lösenord, så inget lösenord byts, varken mot staging eller mot det fejkade API:et (E2E_STUB_API=1, där stubben svarar med samma kod).
// Värdena nedan är påhittade och inget riktigt lösenord; specen slår ändå av spår och bilder, eftersom de ifyllda fälten annars hamnar i dem.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

const WRONG_CURRENT_PASSWORD = 'not-the-current-password-of-this-account';
const NEW_PASSWORD = 'a-brand-new-made-up-password';

test.describe('changing the password in Settings', () => {
  test('a wrong current password shows the error, keeps the form on the page and does not log the user out', async ({ page }) => {
    await page.goto('/settings');
    await dismissOverlays(page);

    const card = page.getByRole('form', { name: 'Password' });
    await expect(card).toBeVisible();
    await card.getByLabel('Current password').fill(WRONG_CURRENT_PASSWORD);
    await card.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
    await card.getByLabel('Repeat new password').fill(NEW_PASSWORD);

    const answer = page.waitForResponse((response) => response.url().endsWith('/auth/change-password') && response.request().method() === 'POST');
    await card.getByRole('button', { name: 'Change password' }).click();

    // Servern svarar 401 med koden current_password_incorrect, och just den koden avslutar inte sessionen.
    const reply = await answer;
    expect(reply.status()).toBe(401);
    expect(((await reply.json()) as { code?: string }).code).toBe('current_password_incorrect');

    await expect(card.getByRole('alert', { name: 'Password error' })).toContainText(/current password is incorrect/i);
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { name: 'Password' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('runquest_token'))).not.toBeNull();

    // Sidan är fortfarande inloggad: en omladdning leder inte till /login.
    await page.reload();
    await expect(page).toHaveURL(/\/settings$/);
  });
});
