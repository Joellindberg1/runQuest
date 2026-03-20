
import React, { useState } from 'react';
import { TabsContent } from '@/shared/components/ui/tabs';
import { PageTabs } from '@/shared/components/PageTabs';
import { Trophy, BookOpen, Crown, ChevronDown, ChevronRight, Clock, Route, Zap, TrendingUp, Mountain, RefreshCw, Flame } from 'lucide-react';
import { TitleCard } from './title/TitleCard';
import { TitleRequirements } from './title/TitleRequirements';
import { MyTitlesTab } from './MyTitlesTab';
import { useTitleSystemData } from '../hooks/useTitleSystemData';
import type { User } from '@runquest/types';
import type { Title } from './title/titleSystemUtils';

interface TitleSystemProps {
  currentUser: User;
  onRefresh?: () => void;
}

const TABS = [
  { value: 'leaderboard', label: 'Leaderboard', icon: <Trophy className="w-4 h-4" /> },
  { value: 'titles',      label: 'Titles',       icon: <BookOpen className="w-4 h-4" /> },
  { value: 'my-titles',   label: 'My Titles',    icon: <Crown className="w-4 h-4" /> },
];

interface Category {
  id: string;
  label: string;
  icon: React.ReactNode;
  keywords: string[];
}

const CATEGORIES: Category[] = [
  { id: 'time',        label: 'Time of Day',  icon: <Clock className="w-3.5 h-3.5" />,      keywords: ['batman', 'rooster', 'lunch breaker'] },
  { id: 'distance',    label: 'Distance',     icon: <Route className="w-3.5 h-3.5" />,      keywords: ['ultra man', 'kipchoge', 'monthly monster', 'double trouble', 'weekend destroyer'] },
  { id: 'pace',        label: 'Pace',         icon: <Zap className="w-3.5 h-3.5" />,        keywords: ['half marathoner', 'marathoner', 'park runner', 'consistent'] },
  { id: 'volume',      label: 'Volume',       icon: <TrendingUp className="w-3.5 h-3.5" />, keywords: ['hamster', 'finisher', 'commuter'] },
  { id: 'altitude',    label: 'Altitude',     icon: <Mountain className="w-3.5 h-3.5" />,   keywords: ['mountain goat', 'vertical runner'] },
  { id: 'consistency', label: 'Consistency',  icon: <RefreshCw className="w-3.5 h-3.5" />,  keywords: ['goggings'] },
  { id: 'comeback',    label: 'Comeback',     icon: <Flame className="w-3.5 h-3.5" />,      keywords: ['ghost', 'phoenix'] },
];

function getCategoryId(title: Title): string {
  const n = title.name.toLowerCase();
  for (const cat of CATEGORIES) {
    if (cat.keywords.some(k => n.includes(k))) return cat.id;
  }
  return 'consistency';
}

interface CategorySectionProps {
  label: string;
  icon: React.ReactNode;
  titles: Title[];
}

const CategorySection: React.FC<CategorySectionProps & { defaultOpen?: boolean }> = ({ label, icon, titles, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);

  if (titles.length === 0) return null;

  return (
    <div className="mb-4">
      <button
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-sidebar border border-foreground/15 hover:bg-accent transition-colors mb-2"
        onClick={() => setOpen(o => !o)}
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span style={{ color: 'var(--rq-gold)' }}>{icon}</span>
          {label}
        </span>
        <span className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{titles.length} {titles.length === 1 ? 'title' : 'titles'}</span>
          {open
            ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
            : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </span>
      </button>
      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {titles.map(title => (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            <TitleCard key={title.id} title={title as any} />
          ))}
        </div>
      )}
    </div>
  );
};

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

  const categorized = CATEGORIES.map(cat => ({
    ...cat,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    titles: titles.filter(t => getCategoryId(t as any) === cat.id) as any[],
  }));

  return (
    <PageTabs value={tab} onValueChange={setTab} tabs={TABS}>
      <TabsContent value="leaderboard" className="px-4 pb-4">
        {categorized.map((cat, i) => (
          <CategorySection key={cat.id} label={cat.label} icon={cat.icon} titles={cat.titles} defaultOpen={i === 0} />
        ))}
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
