import React from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';

interface Tab {
  value: string;
  label: string;
  icon?: React.ReactNode;
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
          className={`grid w-full p-0 overflow-hidden bg-sidebar border-2 border-foreground/15 ${tabsGridClass ? `${tabsGridClass} !h-auto` : ''}`}
          style={tabsGridClass ? undefined : { gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
        >
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="h-full rounded-none flex items-center gap-1.5 font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none"
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
