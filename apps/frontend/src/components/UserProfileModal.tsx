import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogTitle } from '@/shared/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar';
import { StatsTab } from '@/features/profile/components/StatsTab';
import { UserTitlesList } from '@/features/profile/components/UserTitlesList';
import { backendApi } from '@/shared/services/backendApi';
import { getInitials } from '@/shared/utils/formatters';
import { getLevelFromXP } from '@/shared/services/levelService';
import { leaderboardUtils } from '@/shared/utils/leaderboardUtils';
import type { User } from '@runquest/types';

// ─── Data ─────────────────────────────────────────────────────────────────────

function mapUser(u: any): User {
  return {
    id: u.id,
    name: u.name,
    total_xp: u.total_xp || 0,
    current_level: u.current_level || 1,
    total_km: parseFloat(u.total_km?.toString() || '0'),
    current_streak: u.current_streak || 0,
    longest_streak: u.longest_streak || 0,
    profile_picture: u.profile_picture || undefined,
    wins: u.wins ?? 0,
    draws: u.draws ?? 0,
    losses: u.losses ?? 0,
    challenge_active: u.challenge_active ?? false,
    challenge_counts: u.challenge_counts ?? {},
    displayed_title_ids: u.displayed_title_ids ?? [],
    gender: u.gender ?? null,
    runs: u.runs?.map((r: any) => ({
      id: r.id,
      user_id: r.user_id,
      date: r.date,
      distance: parseFloat(r.distance.toString()),
      xp_gained: r.xp_gained,
      multiplier: parseFloat(r.multiplier.toString()),
      streak_day: r.streak_day,
      base_xp: r.base_xp,
      km_xp: r.km_xp,
      distance_bonus: r.distance_bonus,
      streak_bonus: r.streak_bonus,
      is_treadmill: r.is_treadmill ?? null,
    })) ?? [],
  };
}

function useAllUsers(enabled: boolean) {
  return useQuery({
    queryKey: ['users-with-runs'],
    queryFn: async () => {
      const res = await backendApi.getUsersWithRuns();
      if (!res.success) throw new Error(res.error || 'Failed to fetch users');
      return (res.data as any[]).map(mapUser);
    },
    staleTime: 2 * 60 * 1000,
    enabled,
  });
}

// ─── Tab config ───────────────────────────────────────────────────────────────

const TABS = [
  { value: 'stats',  label: 'Stats' },
  { value: 'titles', label: 'Titles' },
] as const;

type TabValue = typeof TABS[number]['value'];

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  userId: string | null;
  onClose: () => void;
}

export const UserProfileModal: React.FC<Props> = ({ userId, onClose }) => {
  const [activeTab, setActiveTab] = useState<TabValue>('stats');
  const { data: allUsers = [], isLoading } = useAllUsers(!!userId);

  const user = userId ? allUsers.find(u => u.id === userId) : null;
  const level = user ? getLevelFromXP(user.total_xp) : 1;
  const sortedUsers = leaderboardUtils.filterAndSortUsers(allUsers);
  const position = user ? leaderboardUtils.getUserPosition(user, sortedUsers) : null;

  return (
    <Dialog
      open={!!userId}
      onOpenChange={(open) => { if (!open) onClose(); }}
    >
      <DialogContent
        className="p-0 gap-0 overflow-hidden flex flex-col border-foreground/20"
        style={{ maxWidth: 'min(42rem, 95vw)', maxHeight: '88vh', width: '95vw' }}
      >
        {/* Visually hidden title for accessibility */}
        <DialogTitle className="sr-only">
          {user?.name ?? 'User profile'}
        </DialogTitle>

        {isLoading || !user ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
            Loading…
          </div>
        ) : (
          <>
            {/* Header */}
            <div
              className="flex items-center gap-3 px-5 py-4 shrink-0 border-b border-foreground/10"
              style={{ background: 'color-mix(in srgb, var(--rq-gold) 4%, var(--background))' }}
            >
              <Avatar
                className="h-11 w-11 shrink-0"
                style={{ boxShadow: '0 0 0 2px color-mix(in srgb, var(--rq-gold) 40%, transparent)' }}
              >
                <AvatarImage src={user.profile_picture || ''} />
                <AvatarFallback className="font-bold">{getInitials(user.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="font-bold text-base leading-tight truncate">{user.name}</div>
                <div className="text-xs text-muted-foreground">
                  Level {level}
                  {position && <> · #{position} in group</>}
                </div>
              </div>
            </div>

            {/* Tabs + scrollable content */}
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as TabValue)}
              className="flex flex-col flex-1 min-h-0"
            >
              <div className="px-5 border-b border-foreground/10 shrink-0">
                <TabsList
                  className="grid p-0 bg-transparent border-0"
                  style={{ gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))` }}
                >
                  {TABS.map((tab) => (
                    <TabsTrigger
                      key={tab.value}
                      value={tab.value}
                      className="rounded-none py-2.5 border-b-2 border-transparent bg-transparent text-foreground/40 transition-all
                        data-[state=active]:border-[var(--rq-gold)] data-[state=active]:text-[var(--rq-gold)] data-[state=active]:bg-transparent data-[state=active]:shadow-none
                        hover:text-foreground/70"
                      style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '0.9rem', letterSpacing: '0.08em', fontWeight: 600, textTransform: 'uppercase' }}
                    >
                      {tab.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>

              <div className="flex-1 overflow-y-auto">
                <TabsContent value="stats" className="mt-0 px-5 pt-4">
                  <StatsTab user={user} allUsers={allUsers} />
                </TabsContent>
                <TabsContent value="titles" className="mt-0 px-5 pt-4 pb-4">
                  <UserTitlesList userId={user.id} userGender={user.gender} />
                </TabsContent>
              </div>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
