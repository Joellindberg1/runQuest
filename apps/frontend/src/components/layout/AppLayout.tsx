import React, { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { GlobalSidebarWidget } from '@/components/GlobalSidebarWidget';
import { Bot } from 'lucide-react';
import { sidebarBridge } from '@/features/onboarding/sidebarBridge';

interface AppLayoutProps {
  groupName: string;
  children: React.ReactNode;
  sidebarWidget?: React.ReactNode;
  themeClass?: string;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ groupName, children, sidebarWidget, themeClass }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    sidebarBridge.register(
      () => setSidebarOpen(true),
      () => setSidebarOpen(false),
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`runquest-hybrid flex min-h-screen bg-background${themeClass ? ` ${themeClass}` : ''}`}>
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        groupName={groupName}
        bottomWidget={sidebarWidget ?? <GlobalSidebarWidget />}
      />

      {/* Main area — offset by sidebar width on md+ */}
      <div className="flex flex-col flex-1 min-w-0 md:ml-[15%]">
        <TopBar
          onMenuToggle={() => setSidebarOpen((prev) => !prev)}
          groupName={groupName}
        />

        {/* Separator */}
        <div className="mx-4 md:mx-8">
          <div className=" h-px" style={{ marginBottom: '5px', background: 'linear-gradient(to right, color-mix(in srgb, var(--rq-gold) 40%, transparent), color-mix(in srgb, var(--rq-gold) 8%, transparent) 60%, transparent)' }} />
        </div>

        <main className="flex-1 px-4 md:px-8 pt-0 pb-16 md:pb-3">{children}</main>
      </div>
    </div>
  );
};
