
import React, { useState } from 'react';
import { TabsContent } from '@/shared/components/ui/tabs';
import { PageTabs } from '@/shared/components/PageTabs';
import { Trophy, BookOpen, Crown } from 'lucide-react';
import { TitleCard } from './title/TitleCard';
import { TitleRequirements } from './title/TitleRequirements';
import { MyTitlesTab } from './MyTitlesTab';
import { useTitleSystemData } from '../hooks/useTitleSystemData';
import type { User } from '@runquest/types';

interface TitleSystemProps {
  currentUser: User;
  onRefresh?: () => void;
}

const TABS = [
  { value: 'leaderboard', label: 'Leaderboard', icon: <Trophy className="w-4 h-4" /> },
  { value: 'titles',      label: 'Titles',       icon: <BookOpen className="w-4 h-4" /> },
  { value: 'my-titles',   label: 'My Titles',    icon: <Crown className="w-4 h-4" /> },
];

export const TitleSystem: React.FC<TitleSystemProps> = ({ currentUser, onRefresh }) => {
  const [tab, setTab] = useState('leaderboard');
  const { titles, loading } = useTitleSystemData();

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
        <div className="text-sm text-muted-foreground">Loading titles...</div>
      </div>
    );
  }

  return (
    <PageTabs value={tab} onValueChange={setTab} tabs={TABS}>
      <TabsContent value="leaderboard" className="px-4 pb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {titles.map(title => (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            <TitleCard key={title.id} title={title as any} />
          ))}
        </div>
      </TabsContent>

      <TabsContent value="titles" className="px-4 pb-4">
        <TitleRequirements />
      </TabsContent>

      <TabsContent value="my-titles" className="px-4 pb-4">
        <MyTitlesTab
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          titles={titles as any}
          currentUser={currentUser}
          onRefresh={onRefresh}
        />
      </TabsContent>
    </PageTabs>
  );
};
