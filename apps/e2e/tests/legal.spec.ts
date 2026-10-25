import { DATA_POLICY_VERSION, WAITLIST_CONSENT_LINK_TEXT } from '../../../packages/shared/src/legal/dataPolicy';
import { describeViolation } from '../support/cspViolations';
import { expect, test } from '../support/test';

// /legal och landningen är publika: provet kör utan session, så det går att köra mot staging utan testkontots uppgifter och bara läser (inget skrivs). Versionen och länktexten
// kommer ur den delade källan (packages/shared/src/legal/dataPolicy.ts), samma som sidan själv läser, så provet följer en ny version av integritetstexten utan att ändras.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('the legal page', () => {
  test('shows the privacy policy version and the legal basis for statistics and error reports', async ({ page }) => {
    await page.goto('/legal');

    await expect(page.getByRole('heading', { level: 1, name: 'Privacy & Terms' })).toBeVisible();
    await expect(page.getByText(`Version ${DATA_POLICY_VERSION}`, { exact: true })).toBeVisible();
    // Rättslig grund för Umami och Sentry (berättigat intresse) står i flera avsnitt; ett räcker för att visa att texten kommit med.
    await expect(page.getByText('legitimate interest').first()).toBeVisible();
  });

  test('breaks no Content-Security-Policy rule', async ({ page, cspGuard }) => {
    await page.goto('/legal');
    await expect(page.getByText(`Version ${DATA_POLICY_VERSION}`, { exact: true })).toBeVisible();
    // Sidan och dess bibliotek ska ha laddat färdigt innan överträdelserna räknas: också en överträdelse som bara rapporteras (Report-Only) räknas här.
    await page.waitForLoadState('load');

    expect(cspGuard.all().map(describeViolation), 'the legal page broke its Content-Security-Policy').toEqual([]);
  });
});

test.describe('the waitlist on the landing page', () => {
  test('links its consent text to the legal page', async ({ page }) => {
    await page.goto('/');

    const policyLink = page.locator('section#waitlist').getByRole('link', { name: WAITLIST_CONSENT_LINK_TEXT });
    await expect(policyLink).toBeVisible();
    await policyLink.click();

    await expect(page).toHaveURL((url) => url.pathname === '/legal');
    await expect(page.getByText(`Version ${DATA_POLICY_VERSION}`, { exact: true })).toBeVisible();
  });
});
