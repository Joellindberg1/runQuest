import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { handlers, resetFakeBackend } from '@/test/fakeBackend';
import { RUN_SAVED_RECALCULATING } from '@/features/runs/runEffects';
import { useLogForm } from './useLogForm';

vi.mock('@/shared/services/backendApi', async () => (await import('@/test/fakeBackend')).backendApiModule);

const NOW = new Date('2026-10-12T10:00:00+02:00');

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useLogForm(NOW), { wrapper });
}

beforeEach(() => {
  resetFakeBackend();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useLogForm — datumet kommer från skärmens klocka, inte systemklockan', () => {
  // Före och efter skärmens dag: testet får inte bero på vilket datum det körs.
  it.each(['2026-01-05T12:00:00+01:00', '2030-06-01T12:00:00+02:00'])('systemklockan %s: formuläret föreslår skärmens dag och går att skicka', async (systemTime) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(systemTime));
    const createRun = vi.fn(async (..._args: unknown[]) => ({ success: true, data: { id: 'new', xp_gained: 44, multiplier: 1.1, streak_day: 5, distance: 8 } }));
    handlers.createRun = createRun;
    const { result } = setup();
    expect(result.current.form.date).toBe('2026-10-12');
    act(() => result.current.setDistance('8'));

    await act(async () => { await result.current.submit(); });

    expect(createRun).toHaveBeenCalledTimes(1);
    expect(createRun.mock.calls[0][0]).toBe('2026-10-12');
    expect(result.current.form.date).toBe('2026-10-12'); // återställningen efter lyckad runda följer också skärmens klocka
  });
});

describe('useLogForm — servern skrev rundan men XP-omräkningen föll', () => {
  it('formuläret återställs och "Saved — XP is recalculating" visas i stället för ett fel', async () => {
    const createRun = vi.fn(async () => ({ success: false, error: 'Run was created but XP recalculation failed', written: true }));
    handlers.createRun = createRun;
    const { result } = setup();
    act(() => result.current.setDistance('8'));

    await act(async () => { await result.current.submit(); });

    expect(createRun).toHaveBeenCalledTimes(1);
    expect(result.current.notice).toBe(RUN_SAVED_RECALCULATING);
    expect(result.current.serverError).toBeNull();
    expect(result.current.form.distance).toBe('');
  });

  it('ett vanligt serverfel lämnar formuläret orört och visar felet som förut', async () => {
    handlers.createRun = async () => ({ success: false, error: 'Distance must be at least 1.0 km' });
    const { result } = setup();
    act(() => result.current.setDistance('8'));

    await act(async () => { await result.current.submit(); });

    expect(result.current.notice).toBeNull();
    expect(result.current.serverError).toBe('Distance must be at least 1.0 km');
    expect(result.current.form.distance).toBe('8');
  });
});

describe('useLogForm — idempotensnyckel per inskick', () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const okRun = { success: true, data: { id: 'new', xp_gained: 44, multiplier: 1.1, streak_day: 5, distance: 8 } };
  const networkFailure = { success: false, error: 'Failed to fetch' };
  const keyOf = (createRun: ReturnType<typeof vi.fn>, call: number) => createRun.mock.calls[call][3] as string;

  it('skickar en uuid v4 som fjärde argument till createRun', async () => {
    const createRun = vi.fn(async () => okRun);
    handlers.createRun = createRun;
    const { result } = setup();
    act(() => result.current.setDistance('8'));

    await act(async () => { await result.current.submit(); });

    expect(createRun).toHaveBeenCalledTimes(1);
    expect(keyOf(createRun, 0)).toMatch(UUID_V4);
  });

  it('ett omförsök efter nätfel av SAMMA inskick återanvänder nyckeln', async () => {
    const createRun = vi.fn(async () => networkFailure);
    handlers.createRun = createRun;
    const { result } = setup();
    act(() => result.current.setDistance('8'));

    await act(async () => { await result.current.submit(); });
    await act(async () => { await result.current.submit(); });

    expect(createRun).toHaveBeenCalledTimes(2);
    expect(keyOf(createRun, 1)).toBe(keyOf(createRun, 0));
  });

  it('omförsöket lyckas med samma nyckel och formuläret nollställs', async () => {
    let attempt = 0;
    const createRun = vi.fn(async () => (++attempt === 1 ? networkFailure : okRun));
    handlers.createRun = createRun;
    const { result } = setup();
    act(() => result.current.setDistance('8'));

    await act(async () => { await result.current.submit(); });
    expect(result.current.serverError).toBe('Failed to fetch');
    await act(async () => { await result.current.submit(); });

    expect(keyOf(createRun, 1)).toBe(keyOf(createRun, 0));
    expect(result.current.serverError).toBeNull();
    expect(result.current.form.distance).toBe('');
  });

  it('nästa inskick efter ett lyckat svar får en ny nyckel', async () => {
    const createRun = vi.fn(async () => okRun);
    handlers.createRun = createRun;
    const { result } = setup();
    act(() => result.current.setDistance('8'));
    await act(async () => { await result.current.submit(); });
    act(() => result.current.setDistance('8'));
    await act(async () => { await result.current.submit(); });

    expect(createRun).toHaveBeenCalledTimes(2);
    expect(keyOf(createRun, 1)).toMatch(UUID_V4);
    expect(keyOf(createRun, 1)).not.toBe(keyOf(createRun, 0));
  });

  it('ändrade formulärvärden efter ett misslyckat försök ger en ny nyckel; oförändrade behåller den', async () => {
    const createRun = vi.fn(async () => networkFailure);
    handlers.createRun = createRun;
    const { result } = setup();
    act(() => result.current.setDistance('8'));
    await act(async () => { await result.current.submit(); });

    act(() => result.current.setDistance('8')); // samma värde = samma inskick
    await act(async () => { await result.current.submit(); });
    act(() => result.current.setDistance('9')); // ändrat värde = ett annat inskick
    await act(async () => { await result.current.submit(); });

    expect(keyOf(createRun, 1)).toBe(keyOf(createRun, 0));
    expect(keyOf(createRun, 2)).not.toBe(keyOf(createRun, 0));
  });

  it('efter "written" (rundan finns) får nästa inskick en ny nyckel', async () => {
    const createRun = vi.fn(async () => ({ success: false, error: 'Run was created but XP recalculation failed', written: true }));
    handlers.createRun = createRun;
    const { result } = setup();
    act(() => result.current.setDistance('8'));
    await act(async () => { await result.current.submit(); });
    act(() => result.current.setDistance('8'));
    await act(async () => { await result.current.submit(); });

    expect(keyOf(createRun, 1)).not.toBe(keyOf(createRun, 0));
  });

  it('ett valideringsfel skickar ingenting', async () => {
    const createRun = vi.fn(async () => okRun);
    handlers.createRun = createRun;
    const { result } = setup();

    await act(async () => { await result.current.submit(); }); // tomt distansfält

    expect(createRun).not.toHaveBeenCalled();
  });

  it('in-flight-guard: ett andra submit medan ett pågår gör ingenting (dubbelklick = ett anrop)', async () => {
    let finish: (value: unknown) => void = () => {};
    const createRun = vi.fn(() => new Promise((done) => { finish = done; }));
    handlers.createRun = createRun;
    const { result } = setup();
    act(() => result.current.setDistance('8'));

    let first: Promise<unknown> = Promise.resolve();
    let second: unknown;
    await act(async () => {
      first = result.current.submit();
      second = await result.current.submit();
    });
    expect(second).toBeNull();
    expect(createRun).toHaveBeenCalledTimes(1);

    await act(async () => { finish(okRun); await first; });
    expect(createRun).toHaveBeenCalledTimes(1);
  });

  it('in-flight-guarden släpper efter ett fel, så att omförsöket går att göra', async () => {
    const createRun = vi.fn(async () => networkFailure);
    handlers.createRun = createRun;
    const { result } = setup();
    act(() => result.current.setDistance('8'));

    await act(async () => { await result.current.submit(); });
    await act(async () => { await result.current.submit(); });

    expect(createRun).toHaveBeenCalledTimes(2);
  });
});
