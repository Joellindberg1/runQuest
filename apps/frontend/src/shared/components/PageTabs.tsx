import React from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';

interface Tab {
  value: string;
  label: string;
  icon?: React.ReactNode;
  tourAnchor?: string;
}

interface PageTabsProps {
  value: string;
  onValueChange: (value: string) => void;
  tabs: Tab[];
  children: React.ReactNode;
  /** Override the grid template class (bypasses auto inline style). Useful for responsive layouts e.g. "grid-cols-2 md:grid-cols-4" */
  tabsGridClass?: string;
}

/**
 * Reusable styled tab switcher for page-level navigation.
 * Renders a full-width TabsList with primary-color active state,
 * then renders children (TabsContent blocks) inside.
 */
export const PageTabs: React.FC<PageTabsProps> = ({ value, onValueChange, tabs, children, tabsGridClass }) => {
  return (
    <Tabs value={value} onValueChange={onValueChange} className="w-full">
      <div className="px-4 py-4">
        <TabsList
          className={`grid w-full p-0 bg-transparent border-b border-foreground/10 ${tabsGridClass ? `${tabsGridClass} !h-auto` : ''}`}
          style={tabsGridClass ? undefined : { gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
        >
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              data-tour={tab.tourAnchor}
              className="rounded-none flex items-center gap-1.5 py-2.5 border-b-2 border-transparent bg-transparent text-foreground/40 transition-all
                data-[state=active]:border-[var(--rq-gold)] data-[state=active]:text-[var(--rq-gold)] data-[state=active]:bg-transparent data-[state=active]:shadow-none
                hover:text-foreground/70"
              style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '0.9rem', letterSpacing: '0.08em', fontWeight: 600, textTransform: 'uppercase' }}
            >
              {tab.icon}
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {children}
    </Tabs>
  );
};
