import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BadgeUserResponse } from '@runquest/shared';
import type { GroupBadges } from '../api';
import { BADGE_QUERY_KEYS, useGroupBadges, useMarkBadgesSeen, useSaveShowcase, useUserBadges } from './useBadgeQueries';

const api = vi.hoisted(() => ({ getUserBadges: vi.fn(), getGroupBadges: vi.fn(), saveShowcase: vi.fn(), markSeen: vi.fn() }));
vi.mock('../api', () => ({ badgesApi: api }));

const ME = 'u-me';
const OTHER = 'u-other';

const mine = (): BadgeUserResponse => ({
  items: [
    { series: 'milestoner', tier: 3, earned_at: '2026-10-01T00:00:00Z', seen_tier: 1 },
    { series: 'climber', tier: 2, earned_at: '2026-10-02T00:00:00Z', seen_tier: 2 },
  ],
  showcase: ['milestoner'],
});
const theirs = (): BadgeUserResponse => ({ items: [{ series: 'milestoner', tier: 1, earned_at: '2026-10-01T00:00:00Z' }], showcase: [] });
const groupData: GroupBadges = { members: [], holders: { milestoner: { '1': 2 } }, member_count: 6 };

let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
const cachedMine = () => queryClient.getQueryData<BadgeUserResponse>(BADGE_QUERY_KEYS.user(ME));
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity }, mutations: { retry: false } } });
  for (const fn of Object.values(api)) fn.mockReset();
});

describe('BADGE_QUERY_KEYS', () => {
  it('rötter och nycklar: user-nycklarna ligger under user-roten, båda under badges-roten', () => {
    expect(BADGE_QUERY_KEYS.root).toEqual(['badges']);
    expect(BADGE_QUERY_KEYS.userRoot).toEqual(['badges', 'user']);
    expect(BADGE_QUERY_KEYS.user('u-1')).toEqual(['badges', 'user', 'u-1']);
    expect(BADGE_QUERY_KEYS.group).toEqual(['badges', 'group']);
  });

  it('olika användare får olika nycklar (egen och andras samling blandas aldrig i cachen)', () => {
    expect(BADGE_QUERY_KEYS.user(ME)).not.toEqual(BADGE_QUERY_KEYS.user(OTHER));
  });
});

describe('useUserBadges / useGroupBadges', () => {
  it('useUserBadges hämtar användarens samling och lägger den under sin nyckel', async () => {
    api.getUserBadges.mockResolvedValue(mine());
    const { result } = renderHook(() => useUserBadges(ME), { wrapper });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.data).toEqual(mine()));
    expect(api.getUserBadges).toHaveBeenCalledWith(ME);
    expect(cachedMine()).toEqual(mine());
  });

  it('utan användar-id (ännu inte inloggad) eller enabled=false hämtas ingenting', async () => {
    renderHook(() => useUserBadges(undefined), { wrapper });
    renderHook(() => useUserBadges(ME, false), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.getUserBadges).not.toHaveBeenCalled();
  });

  it('ett fel blir isError med serverns text (t.ex. 404 för en annan grupp)', async () => {
    api.getUserBadges.mockRejectedValue(new Error('User not found'));
    const { result } = renderHook(() => useUserBadges(OTHER), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('User not found');
  });

  it('useGroupBadges hämtar gruppen en gång under group-nyckeln, delad mellan observers', async () => {
    api.getGroupBadges.mockResolvedValue(groupData);
    const first = renderHook(() => useGroupBadges(), { wrapper });
    const second = renderHook(() => useGroupBadges(), { wrapper });

    await waitFor(() => expect(first.result.current.data).toEqual(groupData));
    await waitFor(() => expect(second.result.current.data).toEqual(groupData));
    expect(api.getGroupBadges).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(BADGE_QUERY_KEYS.group)).toEqual(groupData);
  });

  it('useGroupBadges(false) hämtar inte (Board utanför Season-vyn)', async () => {
    renderHook(() => useGroupBadges(false), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.getGroupBadges).not.toHaveBeenCalled();
  });
});

describe('useSaveShowcase — optimistisk med återställning', () => {
  async function seeded() {
    queryClient.setQueryData(BADGE_QUERY_KEYS.user(ME), mine());
    queryClient.setQueryData(BADGE_QUERY_KEYS.user(OTHER), theirs());
    queryClient.setQueryData(BADGE_QUERY_KEYS.group, groupData);
    const hook = renderHook(() => useSaveShowcase(ME), { wrapper });
    return hook;
  }

  it('visar det nya valet direkt, innan servern svarat, och skickar det till servern', async () => {
    const pending = deferred<{ showcase: string[] }>();
    api.saveShowcase.mockReturnValue(pending.promise);
    const { result } = await seeded();

    let saving!: Promise<unknown>;
    act(() => { saving = result.current.save(['climber', 'milestoner']); });

    await waitFor(() => expect(cachedMine()?.showcase).toEqual(['climber', 'milestoner']));
    expect(api.saveShowcase).toHaveBeenCalledWith(['climber', 'milestoner']);
    expect(result.current.isPending).toBe(true);

    await act(async () => { pending.resolve({ showcase: ['climber', 'milestoner'] }); await saving; });
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });

  it('vid fel återställs det tidigare valet, felet exponeras som text och save() avvisas', async () => {
    api.saveShowcase.mockRejectedValue(new Error('You can display at most 3 badges'));
    const { result } = await seeded();

    await act(async () => { await expect(result.current.save(['climber'])).rejects.toThrow('You can display at most 3 badges'); });

    expect(cachedMine()).toEqual(mine());
    await waitFor(() => expect(result.current.error).toBe('You can display at most 3 badges'));
    act(() => result.current.reset());
    await waitFor(() => expect(result.current.error).toBeNull());
  });

  it('serverns sparade val vinner över det optimistiska', async () => {
    api.saveShowcase.mockResolvedValue({ showcase: ['milestoner'] });
    api.getUserBadges.mockResolvedValue(mine());
    const { result } = await seeded();

    await act(async () => { await result.current.save(['climber', 'milestoner']); });

    expect(cachedMine()?.showcase).toEqual(['milestoner']);
  });

  it('rör inte någon annans samling, och invaliderar min samling och gruppen (Board-raderna) efteråt', async () => {
    api.saveShowcase.mockResolvedValue({ showcase: ['climber'] });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = await seeded();

    await act(async () => { await result.current.save(['climber']); });

    expect(queryClient.getQueryData(BADGE_QUERY_KEYS.user(OTHER))).toEqual(theirs());
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toContainEqual(BADGE_QUERY_KEYS.user(ME));
    expect(keys).toContainEqual(BADGE_QUERY_KEYS.group);
  });

  it('invaliderar också efter ett fel (cachen ska läka mot servern)', async () => {
    api.saveShowcase.mockRejectedValue(new Error('boom'));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = await seeded();

    await act(async () => { await result.current.save(['climber']).catch(() => undefined); });

    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toContainEqual(BADGE_QUERY_KEYS.user(ME));
  });

  it('en pågående omhämtning av min samling avbryts så att den inte skriver över det optimistiska valet', async () => {
    api.saveShowcase.mockReturnValue(deferred().promise);
    const cancel = vi.spyOn(queryClient, 'cancelQueries');
    const { result } = await seeded();

    act(() => { void result.current.save(['climber']); });
    await waitFor(() => expect(cancel).toHaveBeenCalledWith({ queryKey: BADGE_QUERY_KEYS.user(ME) }));
  });

  it('utan cachad samling (inte hämtad ännu) kraschar inte onMutate och ingenting uppfinns i cachen', async () => {
    api.saveShowcase.mockResolvedValue({ showcase: ['climber'] });
    const { result } = renderHook(() => useSaveShowcase(ME), { wrapper });

    await act(async () => { await result.current.save(['climber']); });

    expect(cachedMine()).toBeUndefined();
  });

  it('utan användar-id anropas inte servern (save avvisas)', async () => {
    const { result } = renderHook(() => useSaveShowcase(undefined), { wrapper });
    await act(async () => { await expect(result.current.save(['climber'])).rejects.toThrow(); });
    expect(api.saveShowcase).not.toHaveBeenCalled();
  });
});

describe('useMarkBadgesSeen', () => {
  function seeded() {
    queryClient.setQueryData(BADGE_QUERY_KEYS.user(ME), mine());
    queryClient.setQueryData(BADGE_QUERY_KEYS.user(OTHER), theirs());
    return renderHook(() => useMarkBadgesSeen(ME), { wrapper });
  }

  it('skickar bara de angivna serierna och markerar dem sedda direkt (popupen kommer inte tillbaka under väntan)', async () => {
    const pending = deferred<{ updated: string[] }>();
    api.markSeen.mockReturnValue(pending.promise);
    const { result } = seeded();

    act(() => result.current.markSeen(['milestoner']));

    await waitFor(() => expect(cachedMine()?.items.find((entry) => entry.series === 'milestoner')?.seen_tier).toBe(3));
    expect(api.markSeen).toHaveBeenCalledWith(['milestoner']);
    await act(async () => { pending.resolve({ updated: ['milestoner'] }); });
  });

  it('utan serier = alla (markSeen anropas utan argument)', async () => {
    api.markSeen.mockResolvedValue({ updated: [] });
    const { result } = seeded();

    await act(async () => { result.current.markSeen(); });

    await waitFor(() => expect(api.markSeen).toHaveBeenCalledTimes(1));
    expect(api.markSeen.mock.calls[0]).toEqual([undefined]);
  });

  it('invaliderar den EGNA user-queryn efteråt, inte andras eller gruppen', async () => {
    api.markSeen.mockResolvedValue({ updated: ['milestoner'] });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = seeded();

    await act(async () => { result.current.markSeen(['milestoner']); });

    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toContainEqual(BADGE_QUERY_KEYS.user(ME));
    expect(keys).not.toContainEqual(BADGE_QUERY_KEYS.user(OTHER));
    expect(keys).not.toContainEqual(BADGE_QUERY_KEYS.group);
    expect(queryClient.getQueryData(BADGE_QUERY_KEYS.user(OTHER))).toEqual(theirs());
  });

  it('vid fel återställs seen_tier (popupen visas igen) och felet exponeras', async () => {
    api.markSeen.mockRejectedValue(new Error('Network error'));
    const { result } = seeded();

    await act(async () => { result.current.markSeen(['milestoner']); });

    await waitFor(() => expect(result.current.error).toBe('Network error'));
    expect(cachedMine()).toEqual(mine());
  });

  it('utan användar-id anropas inte servern', async () => {
    const { result } = renderHook(() => useMarkBadgesSeen(undefined), { wrapper });
    await act(async () => { result.current.markSeen(['milestoner']); });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.markSeen).not.toHaveBeenCalled();
  });
});
