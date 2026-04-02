import React, { useState } from 'react';
import { TabsContent } from '@/shared/components/ui/tabs';
import { Medal } from 'lucide-react';
import { PageTabs } from '@/shared/components/PageTabs';
import { UserTitlesList } from './UserTitlesList';
import { StatsTab } from './StatsTab';
import type { User as UserType } from '@runquest/types';

// ─── Badges tab (placeholder) ─────────────────────────────────────────────────

const BadgesTab: React.FC = () => (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    <Medal className="w-12 h-12 text-foreground/20 mb-3" />
    <p className="text-muted-foreground font-medium">Badges coming soon</p>
    <p className="text-xs text-muted-foreground/60 mt-1">This feature is under construction</p>
  </div>
);

// ─── Tab config ───────────────────────────────────────────────────────────────

const TABS = [
  { value: 'stats',   label: 'Stats' },
  { value: 'titles',  label: 'Titles', tourAnchor: 'profile-titles-tab' },
  { value: 'badges',  label: 'Badges', disabled: true },
];

type TabValue = 'stats' | 'titles' | 'badges';

// ─── Props ────────────────────────────────────────────────────────────────────

interface UserProfileProps {
  user: UserType;
  allUsers: UserType[];
  onRunUpdated: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const UserProfile: React.FC<UserProfileProps> = ({ user, allUsers, onRunUpdated }) => {
  const [activeTab, setActiveTab] = useState<TabValue>('stats');

  return (
    <PageTabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)} tabs={TABS}>
      <TabsContent value="stats" className="px-4 pb-4" data-tour="profile-stats">
        <StatsTab user={user} allUsers={allUsers} onRunUpdated={onRunUpdated} />
      </TabsContent>
      <TabsContent value="titles" className="px-4 pb-4">
        <UserTitlesList userId={user.id} userGender={user.gender} />
      </TabsContent>
      <TabsContent value="badges" className="px-4 pb-4">
        <BadgesTab />
      </TabsContent>
    </PageTabs>
  );
};
