/**
 * Skriptet scripts/reprocessTitles.ts räknar om alla gruppers titlar utan Pack News (som admin /titles/reprocess-all) och ger en
 * exit-kod ≠ 0 när något misslyckades. Logiken ligger i reprocessAllTitles så att den går att pröva utan nätverk.
 */
import { describe, it, expect, vi } from 'vitest';
import { reprocessAllTitles } from '../reprocessTitlesRun.js';

function setup(outcome: { total: number; processed: number; failed: number } | Error) {
  const processAllGroupsTitles = vi.fn(async (_options?: { emitNews?: boolean }) => {
    if (outcome instanceof Error) throw outcome;
    return outcome;
  });
  const out = { log: vi.fn(), error: vi.fn() };
  return { service: { processAllGroupsTitles }, processAllGroupsTitles, out };
}

describe('reprocessAllTitles', () => {
  it('räknar om alla grupper utan titelnyheter och ger exit-kod 0 när allt gick bra', async () => {
    const { service, processAllGroupsTitles, out } = setup({ total: 6, processed: 6, failed: 0 });
    await expect(reprocessAllTitles(service, out)).resolves.toBe(0);
    expect(processAllGroupsTitles).toHaveBeenCalledWith({ emitNews: false });
  });

  it('ger exit-kod 1 och skriver räknarna när några användare misslyckades', async () => {
    const { service, out } = setup({ total: 6, processed: 4, failed: 2 });
    await expect(reprocessAllTitles(service, out)).resolves.toBe(1);
    expect(out.error.mock.calls.flat().join(' ')).toMatch(/2.*6/);
  });

  it('ger exit-kod 1 när omräkningen kastar, och skriver bara felets kod', async () => {
    const { service, out } = setup(Object.assign(new Error('LEAKMARKER jane@example.com'), { code: '57014' }));
    await expect(reprocessAllTitles(service, out)).resolves.toBe(1);
    const written = JSON.stringify([...out.log.mock.calls, ...out.error.mock.calls]);
    expect(written).toContain('57014');
    expect(written).not.toContain('LEAKMARKER');
  });
});
