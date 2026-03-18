
import React, { useState } from 'react';
import { TabsContent } from '@/shared/components/ui/tabs';
import { PageTabs } from '@/shared/components/PageTabs';
import { Trophy, BookOpen, Crown, ChevronDown, ChevronRight } from 'lucide-react';
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
  keywords: string[];
}

const CATEGORIES: Category[] = [
  { id: 'time',        label: '⏰ Tid på dagen',   keywords: ['batman', 'rooster', 'lunch breaker'] },
  { id: 'performance', label: '🏃 Distans & Tempo', keywords: ['half marathoner', 'marathoner', 'park runner', 'kipchoge', 'ultra man'] },
  { id: 'volume',      label: '📈 Volym',           keywords: ['monthly monster', 'double trouble', 'weekend destroyer'] },
  { id: 'elevation',   label: '🏔️ Höjd',            keywords: ['mountain goat', 'vertical runner'] },
  { id: 'consistency', label: '🔄 Konsistens',      keywords: ['commuter', 'goggings', 'hamster', 'finisher', 'consistent'] },
  { id: 'comeback',    label: '🌟 Comeback',        keywords: ['ghost', 'phoenix'] },
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
  titles: Title[];
}

const CategorySection: React.FC<CategorySectionProps> = ({ label, titles }) => {
  const [open, setOpen] = useState(true);

  if (titles.length === 0) return null;

  return (
    <div className="mb-4">
      <button
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors mb-2"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-sm font-semibold">{label}</span>
        <span className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{titles.length} titlar</span>
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
        {categorized.map(cat => (
          <CategorySection key={cat.id} label={cat.label} titles={cat.titles} />
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
