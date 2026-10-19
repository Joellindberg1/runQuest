import { expect, test as setup } from '../support/test';
import { AUTH_FILE } from '../support/paths';
import { submitSignIn } from '../support/signIn';
import { userCredentials } from '../support/targets';

// Ett spår bär de ifyllda värdena, så inloggningen spelas aldrig in.
setup.use({ trace: 'off', screenshot: 'off', video: 'off' });

setup('sign in as the staging test account and save the session', async ({ page }) => {
  await page.goto('/login');
  await submitSignIn(page, userCredentials());
  await expect(page).toHaveURL(/\/board$/);
  await page.context().storageState({ path: AUTH_FILE });
});
