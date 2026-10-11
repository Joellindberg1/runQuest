import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BadgeUserResponse } from '@runquest/shared';
import { badgesApi } from '../api';
import { applySeen, applyShowcase } from '../badgeModel';

const STALE_MS = 60_000;
// Ett snabbt omförsök, sedan felkortet (som Pack News) — standardens tre försök med backoff håller skelettet kvar i ~7 s.
const RETRIES = 1;

export const BADGE_QUERY_KEYS = {
  /** Allt som rör badges — det en ändrad runda invaliderar (badges räknas om i samma skrivväg som totalerna). */
  root: ['badges'] as const,
  /** Alla samlingar (en per användare). */
  userRoot: ['badges', 'user'] as const,
  /** En användares samling. Egen och andras ligger under var sin nyckel, så de blandas aldrig. */
  user: (userId: string) => ['badges', 'user', userId] as const,
  /** Gruppens val + holders: en delad hämtning för Board-raderna och "Held by X of N". */
  group: ['badges', 'group'] as const,
};

const messageOf = (error: unknown, fallback: string): string => (error instanceof Error ? error.message : fallback);

/**
 * En användares samling (GET /badges/user/:userId). Den ENDA query-definitionen för resursen: Profile (egen), Runner card (andras),
 * popupen och väljaren delar nyckel och form. `seen_tier` finns bara på min egen. Utan `userId` (ännu inte inloggad) hämtas inget.
 */
export function useUserBadges(userId: string | undefined, enabled = true) {
  const query = useQuery({
    queryKey: BADGE_QUERY_KEYS.user(userId ?? ''),
    queryFn: () => badgesApi.getUserBadges(userId as string),
    enabled: enabled && !!userId,
    staleTime: STALE_MS,
    retry: RETRIES,
  });
  return { data: query.data, isLoading: query.isPending && query.fetchStatus !== 'idle', isError: query.isError, error: query.error, isFetching: query.isFetching, refetch: query.refetch };
}

/** Gruppens badges (GET /badges/group): Board-raderna (showcase per medlem) och `holders` till held-by. Den ENDA definitionen. */
export function useGroupBadges(enabled = true) {
  const query = useQuery({
    queryKey: BADGE_QUERY_KEYS.group,
    queryFn: () => badgesApi.getGroupBadges(),
    enabled,
    staleTime: STALE_MS,
    retry: RETRIES,
  });
  return { data: query.data, isLoading: query.isPending && query.fetchStatus !== 'idle', isError: query.isError, error: query.error, isFetching: query.isFetching, refetch: query.refetch };
}

/**
 * Sparar de valda badges (PUT /badges/showcase). Optimistisk: valet syns direkt i min samling och återställs vid fel (400: max 3, ej ägd).
 * Serverns sparade val skriver över det optimistiska; min samling och gruppen (Board-raderna) invalideras efteråt.
 * `save` avvisas vid fel (anroparen visar sparläget); `error` är samma text som `save` avvisade med.
 */
export function useSaveShowcase(userId: string | undefined) {
  const queryClient = useQueryClient();
  const mine = userId ? BADGE_QUERY_KEYS.user(userId) : null;

  const mutation = useMutation({
    mutationFn: async (series: readonly string[]) => {
      if (!userId) throw new Error('Not signed in');
      return badgesApi.saveShowcase(series);
    },
    onMutate: async (series) => {
      if (!mine) return { previous: undefined };
      await queryClient.cancelQueries({ queryKey: mine });
      const previous = queryClient.getQueryData<BadgeUserResponse>(mine);
      queryClient.setQueryData<BadgeUserResponse>(mine, (data) => (data ? applyShowcase(data, series) : data));
      return { previous };
    },
    onError: (_error, _series, context) => {
      if (mine && context?.previous) queryClient.setQueryData(mine, context.previous);
    },
    onSuccess: (saved) => {
      if (mine) queryClient.setQueryData<BadgeUserResponse>(mine, (data) => (data ? applyShowcase(data, saved.showcase) : data));
    },
    onSettled: () => {
      if (mine) void queryClient.invalidateQueries({ queryKey: mine });
      void queryClient.invalidateQueries({ queryKey: BADGE_QUERY_KEYS.group });
    },
  });

  return {
    save: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.isError ? messageOf(mutation.error, 'Could not save your display') : null,
    reset: mutation.reset,
  };
}

/**
 * Markerar badges som sedda (POST /badges/seen) — popupens "Got it" skickar den enda serien, "Skip all" alla i kön, utan argument = alla.
 * Optimistisk så att kön (tier > seen_tier) töms direkt och popupen inte återkommer under väntan; ett fel återställer. Min samling
 * invalideras efteråt (andras samlingar och gruppen berörs inte).
 */
export function useMarkBadgesSeen(userId: string | undefined) {
  const queryClient = useQueryClient();
  const mine = userId ? BADGE_QUERY_KEYS.user(userId) : null;

  const mutation = useMutation({
    mutationFn: async (series?: readonly string[]) => {
      if (!userId) throw new Error('Not signed in');
      return badgesApi.markSeen(series);
    },
    onMutate: async (series) => {
      if (!mine) return { previous: undefined };
      await queryClient.cancelQueries({ queryKey: mine });
      const previous = queryClient.getQueryData<BadgeUserResponse>(mine);
      queryClient.setQueryData<BadgeUserResponse>(mine, (data) => (data ? applySeen(data, series) : data));
      return { previous };
    },
    onError: (_error, _series, context) => {
      if (mine && context?.previous) queryClient.setQueryData(mine, context.previous);
    },
    onSettled: () => {
      if (mine) void queryClient.invalidateQueries({ queryKey: mine });
    },
  });

  const { mutate } = mutation;
  const markSeen = useCallback((series?: readonly string[]) => mutate(series), [mutate]);

  return {
    markSeen,
    isPending: mutation.isPending,
    error: mutation.isError ? messageOf(mutation.error, 'Could not mark the badges as seen') : null,
    reset: mutation.reset,
  };
}
