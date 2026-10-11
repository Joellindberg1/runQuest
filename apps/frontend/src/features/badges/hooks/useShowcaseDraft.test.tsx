import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BADGE_SERIES, MAX_SHOWCASE, MAX_TIER } from '@runquest/shared';
import type { BadgeUserItem, BadgeUserResponse } from '@runquest/shared';
import { buildCollection, type BadgeRow } from '../badgeModel';
import { useUserBadges } from './useBadgeQueries';
import { useShowcaseDraft } from './useShowcaseDraft';

// Utkastet för visade badges (spec F9.7): `picked` null = följ det sparade, max MAX_SHOWCASE, valordning, dirty mot sparat, städning av ej ägda, spara via useSaveShowcase.
// Serienycklarna och namnen kommer ur shared — inga serienamn skrivs som strängar här.

const api = vi.hoisted(() => ({ getUserBadges: vi.fn(), getGroupBadges: vi.fn(), saveShowcase: vi.fn(), markSeen: vi.fn() }));
vi.mock('../api', () => ({ badgesApi: api }));

const ME = 'u-me';
const [s1, s2, s3, s4, s5, s6] = BADGE_SERIES;
const item = (series: string, tier: number): BadgeUserItem => ({ series, tier, earned_at: '2026-10-01T12:00:00Z', seen_tier: tier });
// Fem ägda (s1..s5), en låst (s6).
const OWNED = [item(s1.key, 3), item(s2.key, 2), item(s3.key, 1), item(s4.key, MAX_TIER), item(s5.key, 4)];
const viewer = { viewerId: ME, ownerId: ME };
const rowsOf = (showcase: string[], items: BadgeUserItem[] = OWNED): BadgeRow[] => buildCollection({ items, showcase }, undefined, viewer);

let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  for (const fn of Object.values(api)) fn.mockReset();
  api.saveShowcase.mockImplementation(async (series: string[]) => ({ showcase: series }));
});

/** Hooken med statiska rader (utan cache): räcker för allt utom spara-flödet. */
function renderDraft(showcase: string[], items: BadgeUserItem[] = OWNED) {
  return renderHook(({ rows }: { rows: BadgeRow[] }) => useShowcaseDraft(rows, ME), { wrapper, initialProps: { rows: rowsOf(showcase, items) } });
}

/**
 * Hooken ovanpå den riktiga cachen: rader ur useUserBadges, så en lyckad spara syns i `saved` (som i sidan). `server` är en minimal fakeserver:
 * ett lyckat PUT ändrar vad nästa GET (hookens invalidering) svarar, som det riktiga backend gör.
 */
function renderLive(initial: string[]) {
  const server = { showcase: [...initial] };
  api.getUserBadges.mockImplementation(async (): Promise<BadgeUserResponse> => ({ items: OWNED, showcase: [...server.showcase] }));
  api.saveShowcase.mockImplementation(async (series: string[]) => {
    server.showcase = [...series];
    return { showcase: series };
  });
  const hook = renderHook(
    () => {
      const user = useUserBadges(ME);
      const rows = buildCollection(user.data, undefined, viewer);
      return { ...useShowcaseDraft(rows, ME), rows };
    },
    { wrapper },
  );
  return { ...hook, server };
}

describe('useShowcaseDraft — följ det sparade (picked = null)', () => {
  it('utan ändring är utkastet det sparade valet i sparad ordning (inte serieordning), och ingenting är osparat', () => {
    const { result } = renderDraft([s4.key, s1.key]);
    expect(result.current.saved).toEqual([s4.key, s1.key]);
    expect(result.current.draft).toEqual([s4.key, s1.key]);
    expect(result.current.dirty).toBe(false);
    expect(result.current.full).toBe(false);
    expect(result.current.status).toBe('idle');
    expect(result.current.saving).toBe(false);
    expect(result.current.announcement).toBe('');
  });

  it('platsen är 1-baserad ur utkastet, null för de som inte är valda', () => {
    const { result } = renderDraft([s4.key, s1.key]);
    expect(result.current.positionOf(s4.key)).toBe(1);
    expect(result.current.positionOf(s1.key)).toBe(2);
    expect(result.current.positionOf(s2.key)).toBeNull();
    expect(result.current.positionOf('unknown-series')).toBeNull();
  });

  it('inget sparat val: tomt utkast', () => {
    const { result } = renderDraft([]);
    expect(result.current.draft).toEqual([]);
    expect(result.current.saved).toEqual([]);
    expect(result.current.dirty).toBe(false);
  });

  it('utan att något har ändrats följer utkastet en ny sparad ordning (omhämtning)', () => {
    const { result, rerender } = renderDraft([s1.key]);
    rerender({ rows: rowsOf([s2.key, s1.key]) });
    expect(result.current.draft).toEqual([s2.key, s1.key]);
    expect(result.current.dirty).toBe(false);
  });
});

describe('useShowcaseDraft — växling (toggle)', () => {
  it('en vald serie läggs sist: ordningen är valordningen, ingen omsortering', () => {
    const { result } = renderDraft([s4.key]);
    act(() => result.current.toggle(s1.key));
    act(() => result.current.toggle(s3.key));
    expect(result.current.draft).toEqual([s4.key, s1.key, s3.key]);
    expect(result.current.positionOf(s3.key)).toBe(3);
  });

  it('en vald serie tas bort vid nästa växling, de övriga behåller sin inbördes ordning och rycker upp', () => {
    const { result } = renderDraft([s4.key, s1.key, s3.key]);
    act(() => result.current.toggle(s4.key));
    expect(result.current.draft).toEqual([s1.key, s3.key]);
    expect(result.current.positionOf(s1.key)).toBe(1);
    act(() => result.current.toggle(s4.key));
    expect(result.current.draft).toEqual([s1.key, s3.key, s4.key]);
  });

  it(`högst ${MAX_SHOWCASE}: en fjärde ignoreras och utkastet är fullt`, () => {
    const { result } = renderDraft([s1.key, s2.key]);
    act(() => result.current.toggle(s3.key));
    expect(result.current.full).toBe(true);
    act(() => result.current.toggle(s4.key));
    expect(result.current.draft).toEqual([s1.key, s2.key, s3.key]);
    expect(result.current.draft).toHaveLength(MAX_SHOWCASE);
  });

  it('en ignorerad växling (fullt) ändrar varken utkastet eller bekräftelsen', () => {
    const { result } = renderDraft([s1.key, s2.key, s3.key]);
    act(() => result.current.toggle(s2.key));
    act(() => result.current.toggle(s2.key));
    expect(result.current.announcement).toBe(`${s2.name} added to display, position 3.`);
    act(() => result.current.toggle(s4.key));
    expect(result.current.announcement).toBe(`${s2.name} added to display, position 3.`);
    expect(result.current.draft).toEqual([s1.key, s3.key, s2.key]);
  });

  it('bara ägda serier kan väljas: en låst eller okänd serie ignoreras', () => {
    const { result } = renderDraft([s1.key]);
    act(() => result.current.toggle(s6.key));
    act(() => result.current.toggle('unknown-series'));
    expect(result.current.draft).toEqual([s1.key]);
    expect(result.current.dirty).toBe(false);
  });

  it('osparat (dirty) när utkastet skiljer sig från sparat; rent igen när det är tillbaka', () => {
    const { result } = renderDraft([s1.key]);
    act(() => result.current.toggle(s2.key));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.toggle(s2.key));
    expect(result.current.draft).toEqual([s1.key]);
    expect(result.current.dirty).toBe(false);
  });

  it('samma serier i annan ordning är osparat (ordningen är platsen på Board-kortet)', () => {
    const { result } = renderDraft([s1.key, s2.key]);
    act(() => result.current.toggle(s1.key));
    act(() => result.current.toggle(s1.key));
    expect(result.current.draft).toEqual([s2.key, s1.key]);
    expect(result.current.dirty).toBe(true);
  });

  it('bekräftelsen: "{Serie} added to display, position N." och "{Serie} removed from display."', () => {
    const { result } = renderDraft([s1.key]);
    act(() => result.current.toggle(s3.key));
    expect(result.current.announcement).toBe(`${s3.name} added to display, position 2.`);
    act(() => result.current.toggle(s1.key));
    expect(result.current.announcement).toBe(`${s1.name} removed from display.`);
  });
});

describe('useShowcaseDraft — snabba klick', () => {
  it('flera växlingar i samma tick bygger på varandra: ingen går förlorad', () => {
    const { result } = renderDraft([]);
    act(() => {
      result.current.toggle(s1.key);
      result.current.toggle(s2.key);
      result.current.toggle(s3.key);
    });
    expect(result.current.draft).toEqual([s1.key, s2.key, s3.key]);
  });

  it('dubbelklick på samma serie i samma tick ger av/på, aldrig en dubblett', () => {
    const { result } = renderDraft([]);
    act(() => {
      result.current.toggle(s1.key);
      result.current.toggle(s1.key);
      result.current.toggle(s1.key);
    });
    expect(result.current.draft).toEqual([s1.key]);
    act(() => {
      result.current.toggle(s1.key);
      result.current.toggle(s1.key);
    });
    expect(result.current.draft).toEqual([s1.key]);
  });

  it('fem snabba klick på fem olika serier ger högst tre, de tre första', () => {
    const { result } = renderDraft([]);
    act(() => {
      for (const series of [s1, s2, s3, s4, s5]) result.current.toggle(series.key);
    });
    expect(result.current.draft).toEqual([s1.key, s2.key, s3.key]);
    expect(new Set(result.current.draft).size).toBe(result.current.draft.length);
  });

  it('en växling i samma tick som SAVE ignoreras: det som sparas är det som visades vid klicket', async () => {
    const pending = deferred<{ showcase: string[] }>();
    api.saveShowcase.mockReturnValue(pending.promise);
    const { result } = renderDraft([s1.key]);
    act(() => result.current.toggle(s2.key));
    act(() => {
      void result.current.save();
      result.current.toggle(s3.key);
    });
    // onMutate i useSaveShowcase är asynkron (avbryter omhämtningar först): anropet till api:t kommer en mikrotask senare.
    await waitFor(() => expect(api.saveShowcase).toHaveBeenCalledWith([s1.key, s2.key]));
    expect(result.current.draft).toEqual([s1.key, s2.key]);
    await act(async () => { pending.resolve({ showcase: [s1.key, s2.key] }); });
  });
});

describe('useShowcaseDraft — städning av ej ägda', () => {
  it('en serie som försvinner ur det jag äger (nedgradering) syns varken i utkastet eller skickas', async () => {
    const { result, rerender } = renderDraft([s1.key]);
    act(() => result.current.toggle(s2.key));
    expect(result.current.draft).toEqual([s1.key, s2.key]);
    rerender({ rows: rowsOf([s1.key], OWNED.filter((owned) => owned.series !== s2.key)) });
    expect(result.current.draft).toEqual([s1.key]);
    expect(result.current.dirty).toBe(false);
    act(() => result.current.toggle(s3.key));
    await act(async () => { await result.current.save(); });
    expect(api.saveShowcase).toHaveBeenCalledWith([s1.key, s3.key]);
  });

  it('en sparad serie jag inte längre äger städas också ur det följda utkastet', () => {
    const { result } = renderDraft([s1.key, s2.key], OWNED.filter((owned) => owned.series !== s2.key));
    expect(result.current.draft).toEqual([s1.key]);
  });
});

describe('useShowcaseDraft — omhämtning mitt i ett utkast', () => {
  it('utkastet ligger kvar när sparat ändras bakom ryggen; dirty räknas om mot det nya sparade', () => {
    const { result, rerender } = renderDraft([s1.key]);
    act(() => result.current.toggle(s2.key));
    expect(result.current.dirty).toBe(true);
    rerender({ rows: rowsOf([s3.key]) });
    expect(result.current.draft).toEqual([s1.key, s2.key]);
    expect(result.current.saved).toEqual([s3.key]);
    expect(result.current.dirty).toBe(true);
  });

  it('når omhämtningen ger samma val som utkastet är det inte längre osparat', () => {
    const { result, rerender } = renderDraft([s1.key]);
    act(() => result.current.toggle(s2.key));
    rerender({ rows: rowsOf([s1.key, s2.key]) });
    expect(result.current.draft).toEqual([s1.key, s2.key]);
    expect(result.current.dirty).toBe(false);
  });

  it('en ny rad-array med samma innehåll (ny referens) rör inte utkastet', () => {
    const { result, rerender } = renderDraft([s1.key]);
    act(() => result.current.toggle(s2.key));
    rerender({ rows: rowsOf([s1.key]) });
    expect(result.current.draft).toEqual([s1.key, s2.key]);
    expect(result.current.status).toBe('idle');
  });
});

describe('useShowcaseDraft — spara', () => {
  it('skickar utkastet i valordning, medan sparandet pågår är saving sant, och efteråt följer utkastet det sparade (picked = null)', async () => {
    const pending = deferred<void>();
    const { result, server } = renderLive([s1.key]);
    const saveNow = api.saveShowcase.getMockImplementation() as (series: string[]) => Promise<{ showcase: string[] }>;
    api.saveShowcase.mockImplementation(async (series: string[]) => { await pending.promise; return saveNow(series); });
    await waitFor(() => expect(result.current.saved).toEqual([s1.key]));

    act(() => result.current.toggle(s4.key));
    act(() => result.current.toggle(s2.key));
    let saving!: Promise<void>;
    act(() => { saving = result.current.save(); });

    await waitFor(() => expect(api.saveShowcase).toHaveBeenCalledWith([s1.key, s4.key, s2.key]));
    expect(result.current.saving).toBe(true);
    expect(result.current.status).toBe('saving');
    expect(server.showcase).toEqual([s1.key]);

    await act(async () => { pending.resolve(); await saving; });

    expect(result.current.status).toBe('saved');
    expect(result.current.saving).toBe(false);
    expect(result.current.saved).toEqual([s1.key, s4.key, s2.key]);
    expect(result.current.draft).toEqual([s1.key, s4.key, s2.key]);
    expect(result.current.dirty).toBe(false);
  });

  it('serverns värde vinner: sparar servern något annat följer utkastet det', async () => {
    const { result, server } = renderLive([]);
    api.saveShowcase.mockImplementation(async () => {
      server.showcase = [s2.key];
      return { showcase: [s2.key] };
    });
    await waitFor(() => expect(result.current.rows.some((row) => row.earned)).toBe(true));
    act(() => result.current.toggle(s1.key));
    await act(async () => { await result.current.save(); });
    expect(result.current.draft).toEqual([s2.key]);
    expect(result.current.dirty).toBe(false);
  });

  it('bekräftelsen (saved) försvinner vid nästa ändring', async () => {
    const { result } = renderLive([]);
    await waitFor(() => expect(result.current.rows.some((row) => row.earned)).toBe(true));
    act(() => result.current.toggle(s1.key));
    await act(async () => { await result.current.save(); });
    expect(result.current.status).toBe('saved');
    act(() => result.current.toggle(s2.key));
    expect(result.current.status).toBe('idle');
    expect(result.current.dirty).toBe(true);
  });

  it('inget osparat: save gör ingenting (inget anrop, ingen statusändring)', async () => {
    const { result } = renderDraft([s1.key]);
    await act(async () => { await result.current.save(); });
    expect(api.saveShowcase).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('dubbelklick på SAVE sparar en gång', async () => {
    const pending = deferred<{ showcase: string[] }>();
    api.saveShowcase.mockReturnValue(pending.promise);
    const { result } = renderDraft([s1.key]);
    act(() => result.current.toggle(s2.key));
    await act(async () => {
      void result.current.save();
      void result.current.save();
    });
    expect(api.saveShowcase).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve({ showcase: [s1.key, s2.key] }); });
  });

  it('växlingar medan sparandet pågår ignoreras (valet kan inte ändras under spara)', async () => {
    const pending = deferred<void>();
    const { result } = renderLive([s1.key]);
    const saveNow = api.saveShowcase.getMockImplementation() as (series: string[]) => Promise<{ showcase: string[] }>;
    api.saveShowcase.mockImplementation(async (series: string[]) => { await pending.promise; return saveNow(series); });
    await waitFor(() => expect(result.current.saved).toEqual([s1.key]));
    act(() => result.current.toggle(s2.key));
    let saving!: Promise<void>;
    act(() => { saving = result.current.save(); });
    act(() => result.current.toggle(s3.key));
    expect(result.current.draft).toEqual([s1.key, s2.key]);
    await act(async () => { pending.resolve(); await saving; });
    act(() => result.current.toggle(s3.key));
    expect(result.current.draft).toEqual([s1.key, s2.key, s3.key]);
  });

  it('fel vid spara: status "error", utkastet och osparat-flaggan ligger kvar, save() avvisas inte', async () => {
    const { result } = renderLive([s1.key]);
    api.saveShowcase.mockRejectedValue(new Error('Server error'));
    await waitFor(() => expect(result.current.saved).toEqual([s1.key]));
    act(() => result.current.toggle(s2.key));

    await act(async () => { await expect(result.current.save()).resolves.toBeUndefined(); });

    expect(result.current.status).toBe('error');
    expect(result.current.saving).toBe(false);
    expect(result.current.draft).toEqual([s1.key, s2.key]);
    expect(result.current.saved).toEqual([s1.key]);
    expect(result.current.dirty).toBe(true);
  });

  it('förlorat svar: PUT lyckades men svaret kom aldrig — refetchen ger sparat = utkast, så felet försvinner och RETRY gör inget nätverksanrop', async () => {
    const { result, server } = renderLive([s1.key]);
    await waitFor(() => expect(result.current.saved).toEqual([s1.key]));
    // Servern tar emot valet, men klienten får ett fel (nätverket föll innan svaret).
    api.saveShowcase.mockImplementation(async (series: string[]) => {
      server.showcase = [...series];
      throw new Error('Network error');
    });
    act(() => result.current.toggle(s2.key));
    await act(async () => { await result.current.save(); });

    // Refetchen (onSettled) läser serverns värde: saved = utkast, alltså inte längre osparat, och ingen felbanner.
    await waitFor(() => expect(result.current.saved).toEqual([s1.key, s2.key]));
    expect(result.current.dirty).toBe(false);
    expect(result.current.status).toBe('idle');

    // RETRY (save) gör inget anrop men rensar felet för gott.
    await act(async () => { await result.current.save(); });
    expect(api.saveShowcase).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('idle');
    expect(result.current.draft).toEqual([s1.key, s2.key]);
  });

  it('felet kommer inte tillbaka om sparat senare ändras bakom ryggen (rensat vid RETRY)', async () => {
    api.saveShowcase.mockRejectedValue(new Error('Network error'));
    const { result, rerender } = renderDraft([s1.key]);
    act(() => result.current.toggle(s2.key));
    await act(async () => { await result.current.save(); });
    expect(result.current.status).toBe('error');
    rerender({ rows: rowsOf([s1.key, s2.key]) });
    expect(result.current.status).toBe('idle');
    await act(async () => { await result.current.save(); });
    rerender({ rows: rowsOf([s3.key]) });
    expect(result.current.dirty).toBe(true);
    expect(result.current.status).toBe('idle');
  });

  it('nytt försök efter fel (RETRY) sparar samma utkast', async () => {
    const { result } = renderLive([s1.key]);
    api.saveShowcase.mockRejectedValueOnce(new Error('Server error'));
    await waitFor(() => expect(result.current.saved).toEqual([s1.key]));
    act(() => result.current.toggle(s2.key));
    await act(async () => { await result.current.save(); });
    expect(result.current.status).toBe('error');

    await act(async () => { await result.current.save(); });
    expect(api.saveShowcase).toHaveBeenCalledTimes(2);
    expect(api.saveShowcase).toHaveBeenLastCalledWith([s1.key, s2.key]);
    expect(result.current.status).toBe('saved');
    expect(result.current.dirty).toBe(false);
  });

  it('en ändring efter ett fel tar bort felet (status tillbaka till idle) men behåller utkastet', async () => {
    api.saveShowcase.mockRejectedValue(new Error('Server error'));
    const { result } = renderDraft([s1.key]);
    act(() => result.current.toggle(s2.key));
    await act(async () => { await result.current.save(); });
    expect(result.current.status).toBe('error');
    act(() => result.current.toggle(s3.key));
    expect(result.current.status).toBe('idle');
    expect(result.current.draft).toEqual([s1.key, s2.key, s3.key]);
  });

  it('utan användar-id kan inget sparas: status "error", utkastet kvar', async () => {
    const { result } = renderHook(() => useShowcaseDraft(rowsOf([s1.key]), undefined), { wrapper });
    act(() => result.current.toggle(s2.key));
    await act(async () => { await result.current.save(); });
    expect(api.saveShowcase).not.toHaveBeenCalled();
    expect(result.current.status).toBe('error');
    expect(result.current.draft).toEqual([s1.key, s2.key]);
  });
});
