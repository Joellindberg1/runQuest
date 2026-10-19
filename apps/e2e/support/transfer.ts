import type { Page } from '@playwright/test';

/**
 * Summan av överförda stilmallsbytes (svarshuvuden inräknade, som Lighthouse och Chromes `encodedDataLength`) för en kall laddning av `path`: cachen är av och
 * mätningen väntar in nätverket. Bara filer med resurstypen Stylesheet räknas, så den lata inloggningsdialogens CSS ingår först när dialogen öppnats.
 * Chromium-specifikt (CDP).
 */
export async function stylesheetTransferBytes(page: Page, path: string): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const types = new Map<string, string>();
  const sizes = new Map<string, number>();
  cdp.on('Network.responseReceived', (event) => types.set(event.requestId, event.type));
  cdp.on('Network.loadingFinished', (event) => sizes.set(event.requestId, event.encodedDataLength));
  await page.goto(path, { waitUntil: 'networkidle' });
  let total = 0;
  for (const [id, size] of sizes) if (types.get(id) === 'Stylesheet') total += size;
  await cdp.detach();
  return total;
}
