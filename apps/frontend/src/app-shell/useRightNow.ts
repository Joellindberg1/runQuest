import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/providers/authContext';
import { backendApi } from '@/shared/services/backendApi';
import { useUsersWithRuns } from '@/shared/hooks/useUsersWithRuns';
import { buildRightNow, type RightNowItem, type ShellDuel, type ShellEvent } from './rightNowItems';
import { useNow } from './useNow';
import type { Challenge } from '@runquest/types';

const STALE_MS = 60_000;

export interface RightNowState {
  items: RightNowItem[];
  /** Minst ett event är öppet just nu — prick på kalenderikonen. */
  hasOpenEvent: boolean;
}

// Datakällorna är desamma som de gamla sidebar-widgetarna läste (events, mina utmaningar,
// Strava-sync, användare med rundor); queryKeys delas så ingen sida hämtar dubbelt.
export function useRightNow(): RightNowState {
  const { user } = useAuth();
  const enabled = !!user;
  const now = useNow();

  const users = useUsersWithRuns(enabled);

  const events = useQuery({
    queryKey: ['events'],
    queryFn: async () => {
      const res = await backendApi.getEvents();
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    enabled,
    staleTime: STALE_MS,
    refetchInterval: 2 * STALE_MS,
  });

  const challenges = useQuery({
    queryKey: ['challenges', 'my'],
    queryFn: async () => {
      const res = await backendApi.getMyChallenges();
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    enabled,
    staleTime: 0,
    refetchInterval: STALE_MS,
  });

  const stravaStatus = useQuery({
    queryKey: ['strava', 'status'],
    queryFn: async () => {
      const res = await backendApi.getStravaStatus();
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    enabled,
    staleTime: 5 * STALE_MS,
  });

  const stravaSync = useQuery({
    queryKey: ['strava', 'last-sync'],
    queryFn: async () => {
      const res = await backendApi.getStravaLastSync();
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    enabled,
    staleTime: STALE_MS,
    refetchInterval: 5 * STALE_MS,
  });

  const shellEvents = useMemo<ShellEvent[]>(() => {
    const list = events.data?.events ?? [];
    return list.flatMap((e): ShellEvent[] => {
      // Tävlingar visas bara för den som deltar (som gamla EventWidget).
      if (e.type === 'competition' && !e.myEntry) return [];
      const liveRank = e.leaderboard?.find((l) => l.isMe)?.rank;
      return [{
        id: e.id,
        kind: e.type,
        name: e.template.name,
        status: e.status,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        rewardXp: e.template.rewardXp,
        done: !!e.myEntry?.qualified && e.type === 'participation',
        rank: liveRank ?? e.myEntry?.rank ?? null,
      }];
    });
  }, [events.data]);

  const duel = useMemo<ShellDuel | null>(() => {
    if (!user) return null;
    const found = (challenges.data?.group_active ?? []).find(
      (c: Challenge) => c.challenger_id === user.id || c.opponent_id === user.id,
    );
    if (!found) return null;
    const iAmChallenger = found.challenger_id === user.id;
    return {
      id: found.id,
      opponentName: (iAmChallenger ? found.opponent_name : found.challenger_name) ?? 'Unknown',
      metric: found.metric,
      startDate: found.start_date,
      endDate: found.end_date,
    };
  }, [challenges.data, user]);

  const streak = useMemo(() => {
    const me = users.data?.find((u) => u.id === user?.id);
    if (!me) return null;
    const lastRunDate = (me.runs ?? []).reduce<string | null>(
      (latest, run) => (!latest || run.date > latest ? run.date : latest),
      null,
    );
    return { current: me.current_streak, lastRunDate };
  }, [users.data, user?.id]);

  const items = useMemo(
    () =>
      buildRightNow({
        now,
        streak,
        events: shellEvents,
        duel,
        strava: stravaStatus.data
          ? { connected: stravaStatus.data.connected, nextSyncAt: stravaSync.data?.next_sync_estimated ?? null }
          : null,
      }),
    [now, streak, shellEvents, duel, stravaStatus.data, stravaSync.data],
  );

  const hasOpenEvent = shellEvents.some((e) => e.status === 'active');

  return { items, hasOpenEvent };
}
