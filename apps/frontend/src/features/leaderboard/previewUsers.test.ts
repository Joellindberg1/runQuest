import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

// PREVIEW_USERS byggs när modulen laddas, så klockan sätts före importen.
async function loadAt(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
  vi.resetModules();
  return (await import('./previewUsers')).PREVIEW_USERS;
}

describe('PREVIEW_USERS datum', () => {
  it('"idag" är Stockholm-dagen: 23:30 UTC den 31 okt är redan 1 nov', async () => {
    const users = await loadAt('2026-10-31T23:30:00Z');
    const anna = users.find(u => u.id === 'u1')!;
    expect(anna.runs?.map(r => r.date)).toEqual(['2026-11-01', '2026-10-31', '2026-10-29']);
  });

  it('dagar bakåt räknas som kalender över månadsskiftet', async () => {
    const users = await loadAt('2026-03-02T12:00:00Z');
    const johan = users.find(u => u.id === 'u4')!;
    expect(johan.runs?.map(r => r.date)).toEqual(['2026-02-25', '2026-02-21']);
  });
});
