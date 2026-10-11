import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { BADGE_QUERY_KEYS } from '@/features/badges/hooks/useBadgeQueries';
import { NEWS_QUERY_KEYS } from '@/features/news/hooks/useNewsQueries';
import { invalidateAfterRunChange } from './runEffects';

// En ändrad runda räknar om badges i samma skrivväg som totalerna (ADR 009 beslut 2: evaluateBadges anropas av calculateUserTotals,
// synkront), så samlingen, popupen och Board-raderna ska hämtas om direkt — inte vänta på staleTime.

let queryClient: QueryClient;
const invalidated = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;

beforeEach(() => {
  vi.useFakeTimers();
  queryClient = new QueryClient();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('invalidateAfterRunChange — badges', () => {
  it('invaliderar min och andras samlingar samt gruppens badges', async () => {
    queryClient.setQueryData(BADGE_QUERY_KEYS.user('u-me'), { items: [], showcase: [] });
    queryClient.setQueryData(BADGE_QUERY_KEYS.user('u-other'), { items: [], showcase: [] });
    queryClient.setQueryData(BADGE_QUERY_KEYS.group, { members: [], holders: {}, member_count: 1 });

    await invalidateAfterRunChange(queryClient);

    expect(invalidated(BADGE_QUERY_KEYS.user('u-me'))).toBe(true);
    expect(invalidated(BADGE_QUERY_KEYS.user('u-other'))).toBe(true);
    expect(invalidated(BADGE_QUERY_KEYS.group)).toBe(true);
  });

  it('rör inte okända nycklar och behåller den befintliga kedjan (Pack News invalideras fortfarande)', async () => {
    queryClient.setQueryData(['unrelated'], 1);
    queryClient.setQueryData(NEWS_QUERY_KEYS.feed(undefined), { items: [], meta: {} });

    await invalidateAfterRunChange(queryClient);

    expect(invalidated(['unrelated'])).toBe(false);
    expect(invalidated(NEWS_QUERY_KEYS.feed(undefined))).toBe(true);
  });
});
