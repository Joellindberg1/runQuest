import { expect, type Locator, type Page } from '@playwright/test';
import type { Credentials } from './targets';

const CLEAR_TIMEOUT_MS = 1_000;

/**
 * Skriver ett värde i ett textfält utan att det hamnar i Playwrights egen loggning. `locator.fill('<värde>')` skriver värdet i anropsloggen i varje
 * timeoutfel ("fill("...")"), och spår och rapporter bär det också. Här sätts värdet i sidan med ett evaluate-anrop (inget värde i anropsloggen), på det
 * sätt React ser en inmatning: via den inbyggda value-setters och en input-händelse. Fältet fylls alltså inte tecken för tecken.
 */
async function setSecretValue(field: Locator, value: string, timeout?: number): Promise<void> {
  await field.evaluate((element, secret) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, secret);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value, { timeout });
}

/** Fyller i inloggningsdialogen (som ligger över landningen på /login) och trycker på Sign In. Öppnar inte sidan själv. */
export async function submitSignIn(page: Page, credentials: Credentials): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Sign in' });
  await expect(dialog).toBeVisible();
  await setSecretValue(dialog.getByLabel('Username'), credentials.login);
  const password = dialog.getByLabel('Password', { exact: true });
  await setSecretValue(password, credentials.password);
  await dialog.getByRole('button', { name: 'Sign In', exact: true }).click();
  // Formuläret har redan läst värdet när klicket är klart. Tomt fält direkt efter: ett fel senare i testet skriver en ARIA-ögonblicksbild av sidan till
  // error-context.md (Playwright gör det alltid vid ett misslyckat expect), och fältets värde står i den.
  // Lyckas inloggningen försvinner dialogen och fältet med den: då finns inget att tömma.
  await setSecretValue(password, '', CLEAR_TIMEOUT_MS).catch(() => undefined);
}
