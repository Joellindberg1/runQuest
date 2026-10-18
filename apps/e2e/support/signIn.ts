import { expect, type Page } from '@playwright/test';
import type { Credentials } from './targets';

/** Fyller i inloggningsdialogen (som ligger över landningen på /login) och trycker på Sign In. Öppnar inte sidan själv. */
export async function submitSignIn(page: Page, credentials: Credentials): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Sign in' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Username').fill(credentials.login);
  await dialog.getByLabel('Password', { exact: true }).fill(credentials.password);
  await dialog.getByRole('button', { name: 'Sign In', exact: true }).click();
}
