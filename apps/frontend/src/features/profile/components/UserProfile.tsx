import React, { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/components/ui/tabs';
import { Medal } from 'lucide-react';
import { UserRunHistory } from './UserRunHistory';
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
  { value: 'stats',  label: 'Stats' },
  { value: 'titles', label: 'Titles' },
  { value: 'badges', label: 'Badges', disabled: true },
] as const;

type TabValue = typeof TABS[number]['value'];

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
    <div className="flex gap-4 h-auto md:h-[calc(100vh-5.5rem)] flex-col md:flex-row">

      {/* Left: tab area */}
      <div className="flex-1 min-w-0 flex flex-col bg-sidebar border-2 border-foreground/15 rounded-xl overflow-hidden">

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
          {/* Tab list */}
          <div className="px-4 pt-3 pb-0 border-b border-foreground/10 shrink-0">
            <TabsList
              className="grid w-full p-0 bg-transparent border-0"
              style={{ gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))` }}
            >
              {TABS.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  disabled={'disabled' in tab && tab.disabled}
                  className="rounded-none py-2.5 border-b-2 border-transparent bg-transparent text-foreground/40 transition-all
                    data-[state=active]:border-[var(--rq-gold)] data-[state=active]:text-[var(--rq-gold)] data-[state=active]:bg-transparent data-[state=active]:shadow-none
                    hover:text-foreground/70 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-foreground/40"
                  style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '0.9rem', letterSpacing: '0.08em', fontWeight: 600, textTransform: 'uppercase' }}
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* Tab content — scrollable */}
          <div className="flex-1 overflow-y-auto px-4 pt-4 min-h-0">
            <TabsContent value="stats"  className="mt-0">
              <StatsTab user={user} allUsers={allUsers} />
            </TabsContent>
            <TabsContent value="titles" className="mt-0">
              <UserTitlesList userId={user.id} userGender={user.gender} />
            </TabsContent>
            <TabsContent value="badges" className="mt-0">
              <BadgesTab />
            </TabsContent>
          </div>
        </Tabs>
      </div>

      {/* Right: Run History — always visible */}
      <div className="w-full md:w-96 shrink-0 md:h-full">
        <UserRunHistory runs={user.runs || []} onRunUpdated={onRunUpdated} />
      </div>
    </div>
  );
};
