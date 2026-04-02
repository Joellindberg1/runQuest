import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/providers/AuthProvider';
import { backendApi } from '@/shared/services/backendApi';
import { SidebarActivityWidget } from './SidebarActivityWidget';
import { ActiveChallengeWidget } from '@/features/challenges/components/ActiveChallengeWidget';
import { EventWidget } from './EventWidget';
import type { Challenge } from '@runquest/types';

/**
 * Self-contained sidebar widget that shows active challenge + active events.
 * Included directly in AppLayout so all pages get it automatically.
 */
export const GlobalSidebarWidget: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  // ── Challenge ──────────────────────────────────────────────────────────────

  const { data: challengeData } = useQuery({
    queryKey: ['challenges', 'my'],
    queryFn: async () => {
      const res = await backendApi.getMyChallenges();
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    enabled: !!user,
    staleTime: 0,
    refetchInterval: 60 * 1000,
  });

  const myActiveChallenge = useMemo((): Challenge | null => {
    if (!user || !challengeData) return null;
    const found = (challengeData.group_active ?? []).find(
      (c: Challenge) => c.challenger_id === user.id || c.opponent_id === user.id
    );
    if (!found) return null;
    return {
      ...found,
      challenger_name: found.challenger_name ?? 'Unknown',
      opponent_name: found.opponent_name ?? 'Unknown',
    };
  }, [challengeData, user]);

  const { data: progressData } = useQuery({
    queryKey: ['challenges', 'progress', myActiveChallenge?.id],
    queryFn: async () => {
      const res = await backendApi.getChallengeProgress(myActiveChallenge!.id);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    enabled: !!myActiveChallenge?.id,
    staleTime: 2 * 60 * 1000,
  });

  const challengeWidget = myActiveChallenge ? (
    <ActiveChallengeWidget
      challenge={myActiveChallenge}
      progress={progressData?.progress ?? []}
      currentUserId={user?.id ?? ''}
      onClick={() => navigate('/challenges')}
    />
  ) : null;

  // ── Events ─────────────────────────────────────────────────────────────────

  const { data: eventsData } = useQuery({
    queryKey: ['events'],
    queryFn: async () => {
      const res = await backendApi.getEvents();
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    enabled: !!user,
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });

  const eventWidgets = useMemo(() => {
    const events = eventsData?.events ?? [];
    return events
      .filter(e => e.status === 'active' || e.status === 'scheduled')
      .map(e => {
        const scheduled = e.status === 'scheduled';

        if (e.type === 'participation') {
          return (
            <EventWidget
              key={e.id}
              data={{
                kind: 'participation',
                title: e.template.name,
                startsAt: e.startsAt,
                endsAt: e.endsAt,
                rewardXp: e.template.rewardXp,
                done: !!e.myEntry?.qualified,
                scheduled,
              }}
            />
          );
        }

        // competition — visa bara om användaren deltar
        const myEntry = e.myEntry;
        if (!myEntry) return null;

        const myLiveEntry = e.leaderboard?.find(l => l.isMe);
        return (
          <EventWidget
            key={e.id}
            data={{
              kind: 'competition',
              title: e.template.name,
              startsAt: e.startsAt,
              endsAt: e.endsAt,
              myRank: myLiveEntry?.rank ?? myEntry.rank ?? 0,
              myValue: myLiveEntry?.totalValue ?? myEntry.totalValue ?? 0,
              metric: e.metric === 'km' ? 'km' : 'elevation',
              scheduled,
            }}
          />
        );
      })
      .filter(Boolean);
  }, [eventsData]);

  return (
    <SidebarActivityWidget
      items={[challengeWidget, ...eventWidgets]}
    />
  );
};
