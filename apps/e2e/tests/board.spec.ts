import { expect, test } from '../support/test';
import { fetchRunners, readSession } from '../support/api';
import { dismissOverlays } from '../support/overlays';

const PODIUM_SIZE = 3;

test.describe('the standings', () => {
  test('the board lists the whole group in the order the server ranks it', async ({ page }) => {
    // Servern rankar efter XP (nivån följer XP), Board visar samma ordning: podiet (topp 3) och sedan tabellen "Rest of the pack". "admin" visas inte.
    const names = (await fetchRunners(readSession())).map((runner) => runner.name).filter((name) => name.toLowerCase() !== 'admin');
    expect(names.length, 'the staging group needs at least one runner').toBeGreaterThan(0);

    await page.goto('/board');
    await dismissOverlays(page);
    await expect(page.getByRole('heading', { name: 'The standings' })).toBeVisible();
    await expect(page.getByText(new RegExp(`Week \\d+ · ${names.length} runners`))).toBeVisible();

    // Podiet har ingen egen roll och lika XP ger lika placering, så topp 3 kontrolleras som namn på sidan; ordningen bevisas av tabellen under.
    for (const name of names.slice(0, PODIUM_SIZE)) {
      await expect(page.getByRole('button', { name, exact: true }).first()).toBeVisible();
    }

    const rest = names.slice(PODIUM_SIZE);
    if (rest.length > 0) {
      const rows = page.getByRole('table', { name: 'Rest of the pack' }).getByRole('row');
      await expect(rows).toHaveCount(rest.length + 1); // + rubrikraden
      for (const [index, name] of rest.entries()) {
        await expect(rows.nth(index + 1).getByRole('button', { name, exact: true })).toBeVisible();
      }
    }
  });

  test('the week and streaks views open from the tabs', async ({ page }) => {
    await page.goto('/board');
    await dismissOverlays(page);

    await page.getByRole('tab', { name: 'Week' }).click();
    await expect(page).toHaveURL(/view=week/);
    await expect(page.getByRole('tab', { name: 'Week' })).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('tab', { name: 'Streaks' }).click();
    await expect(page).toHaveURL(/view=streaks/);
    await expect(page.getByRole('tab', { name: 'Streaks' })).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('tab', { name: 'All-time' }).click();
    await expect(page.getByRole('tab', { name: 'All-time' })).toHaveAttribute('aria-selected', 'true');
  });
});
