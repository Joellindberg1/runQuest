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
}

/**
 * Reusable styled tab switcher for page-level navigation.
 * Renders a full-width TabsList with primary-color active state,
 * then renders children (TabsContent blocks) inside.
 */
export const PageTabs: React.FC<PageTabsProps> = ({ value, onValueChange, tabs, children }) => {
  return (
    <Tabs value={value} onValueChange={onValueChange} className="w-full">
      <div className="px-4 py-4">
        <TabsList
          className="grid w-full p-0 bg-sidebar border-2 border-foreground/15"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
        >
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="flex items-center gap-2 font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none"
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
