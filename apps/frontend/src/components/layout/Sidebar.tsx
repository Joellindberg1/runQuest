import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useStravaData, formatLastSync, formatNextSync } from '@/features/settings/hooks/useStravaData';
import { formatConnectionDate } from '@/shared/utils/formatters';
import { StravaIcon } from '@/shared/components/StravaIcon';
import { RunQuestLogo } from '@/shared/components/RunQuestLogo';
import { Trophy, Award, User, Plus, Info, HelpCircle, Bug, Gamepad2, X, CheckCircle } from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

const NavItem: React.FC<NavItemProps> = ({ icon, label, active, disabled, onClick }) => (
  <button
    onClick={!disabled ? onClick : undefined}
    disabled={disabled}
    className={cn(
      'w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm font-medium transition-colors text-left',
      active && 'bg-sidebar-primary text-sidebar-primary-foreground',
      !active && !disabled && 'hover:bg-sidebar-accent text-sidebar-foreground cursor-pointer',
      disabled && 'text-sidebar-foreground cursor-not-allowed opacity-40'
    )}
  >
    <span className="shrink-0">{icon}</span>
    <span className="truncate">{label}</span>
  </button>
);

const NavSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="mb-4">
    <p className="px-2 mb-1 text-sm font-semibold uppercase tracking-wider text-sidebar-foreground/60">
      {title}
    </p>
    <div className="space-y-0.5">{children}</div>
  </div>
);

function useActiveTab() {
  const location = useLocation();
  if (location.pathname === '/features') return 'features';
  if (location.pathname === '/settings') return 'settings';
  const params = new URLSearchParams(location.search);
  return params.get('tab') || 'leaderboard';
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const { stravaStatus, syncInfo } = useStravaData();
  const navigate = useNavigate();
  const activeTab = useActiveTab();

  const handleNav = (tab: string) => {
    if (tab === 'features') {
      navigate('/features');
    } else {
      navigate(tab === 'leaderboard' ? '/' : `/?tab=${tab}`);
    }
    onClose();
  };

  return (
    <>
      {/* Mobile overlay — near-solid so sidebar is unmistakably visible */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/92 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-40 h-full flex flex-col',
          // The only divider: a clear right border separating sidebar from content
          'bg-sidebar/95 backdrop-blur-sm border-r-2 border-foreground/15',
          'transition-transform duration-300 ease-in-out',
          // Mobile: 60% wide with strong shadow so it reads as a distinct panel
          // Desktop: 10% wide
          'w-[60vw] md:w-[15%]',
          isOpen
            ? 'translate-x-0 shadow-2xl'
            : '-translate-x-full md:translate-x-0'
        )}
      >
        {/* Logo — no bottom divider */}
        <div className="flex items-center justify-between px-3 pt-5 pb-4">
          <RunQuestLogo className="h-8 w-auto max-w-full text-sidebar-foreground mr-2" />
          <button
            onClick={onClose}
            className="md:hidden shrink-0 ml-2 p-1 rounded-md hover:bg-sidebar-accent text-sidebar-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 pb-4">
          <NavSection title="Game">
            <NavItem
              icon={<Trophy className="w-3.5 h-3.5" />}
              label="Leaderboard"
              active={activeTab === 'leaderboard'}
              onClick={() => handleNav('leaderboard')}
            />
            <NavItem
              icon={<Award className="w-3.5 h-3.5" />}
              label="Titles"
              active={activeTab === 'titles'}
              onClick={() => handleNav('titles')}
            />
            <NavItem
              icon={<Gamepad2 className="w-3.5 h-3.5" />}
              label="Challenges"
              disabled
            />
          </NavSection>

          <NavSection title="You">
            <NavItem
              icon={<User className="w-3.5 h-3.5" />}
              label="Profile"
              active={activeTab === 'profile'}
              onClick={() => handleNav('profile')}
            />
            <NavItem
              icon={<Plus className="w-3.5 h-3.5" />}
              label="Log Run"
              active={activeTab === 'log-run'}
              onClick={() => handleNav('log-run')}
            />
          </NavSection>

          <NavSection title="RunQuest">
            <NavItem
              icon={<Info className="w-3.5 h-3.5" />}
              label="Feature & Version"
              active={activeTab === 'features'}
              onClick={() => handleNav('features')}
            />
            <NavItem
              icon={<HelpCircle className="w-3.5 h-3.5" />}
              label="FAQ"
              disabled
            />
            <NavItem
              icon={<Bug className="w-3.5 h-3.5" />}
              label="Bug Report"
              disabled
            />
          </NavSection>
        </nav>

        {/* Strava sync — pinned to bottom */}
        <div className="px-3 py-3">
          {stravaStatus.connected && (
            <div className="rounded-lg bg-sidebar-accent border border-foreground/10 p-3 text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <StravaIcon size={16} />
                <span className="flex items-center gap-1 text-xs font-semibold text-green-500">
                  <CheckCircle className="w-3 h-3" /> Connected
                </span>
              </div>
              <div className="space-y-0.5 text-xs text-sidebar-foreground/60">
                <div>Since: {formatConnectionDate(stravaStatus.connection_date)}</div>
                <div>Last sync: {formatLastSync(syncInfo)}</div>
                <div>Next sync: {formatNextSync(syncInfo)}</div>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
