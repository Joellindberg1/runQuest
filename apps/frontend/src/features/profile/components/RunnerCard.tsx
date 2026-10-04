import React, { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar';
import { StatsTab } from '@/features/profile/components/StatsTab';
import { UserTitlesList } from '@/features/profile/components/UserTitlesList';
import { getInitials } from '@/shared/utils/formatters';
import { getLevelFromXP } from '@/shared/services/levelService';
import { leaderboardUtils } from '@/shared/utils/leaderboardUtils';
import type { User } from '@runquest/types';

// Innehållet från den gamla UserProfileModal, nu utan egen dialog: RunnerPage
// placerar det som sida (mobil) eller overlay (desktop). Ritas om i inkrement 3.

const TABS = [
  { value: 'stats',  label: 'Stats' },
  { value: 'titles', label: 'Titles' },
] as const;

type TabValue = typeof TABS[number]['value'];

interface RunnerCardProps {
  user: User;
  allUsers: User[];
}

export const RunnerCard: React.FC<RunnerCardProps> = ({ user, allUsers }) => {
  const [activeTab, setActiveTab] = useState<TabValue>('stats');

  const level = getLevelFromXP(user.total_xp);
  const sortedUsers = leaderboardUtils.filterAndSortUsers(allUsers);
  const position = leaderboardUtils.getUserPosition(user, sortedUsers);

  return (
    <div className="flex flex-col min-h-0 flex-1">
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
          <h1 className="font-bold text-base leading-tight truncate">{user.name}</h1>
          <div className="text-xs text-muted-foreground">
            Level {level}
            {position && <> · #{position} in group</>}
          </div>
        </div>
      </div>

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
                style={{ fontFamily: 'var(--rq-font-ui)', fontSize: '0.9rem', letterSpacing: '0.08em', fontWeight: 600, textTransform: 'uppercase' }}
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="flex-1 overflow-y-auto pb-4">
          <TabsContent value="stats" className="mt-0 px-5 pt-4">
            <StatsTab user={user} allUsers={allUsers} />
          </TabsContent>
          <TabsContent value="titles" className="mt-0 px-5 pt-4 pb-4">
            <UserTitlesList userId={user.id} userGender={user.gender} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
};
