import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useStravaData } from '@/features/settings/hooks/useStravaData';
import { StravaIcon } from '@/shared/components/StravaIcon';
import { RunQuestLogo } from '@/shared/components/RunQuestLogo';
import { Trophy, Award, User, Plus, Info, HelpCircle, Bug, Gamepad2, X } from 'lucide-react';

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
      'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs font-medium transition-colors text-left',
      active && 'bg-sidebar-primary text-sidebar-primary-foreground',
      !active && !disabled && 'hover:bg-sidebar-accent text-sidebar-foreground cursor-pointer',
      disabled && 'text-muted-foreground cursor-not-allowed opacity-40'
    )}
  >
    <span className="shrink-0">{icon}</span>
    <span className="truncate">{label}</span>
  </button>
);

const NavSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="mb-4">
    <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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
  const { stravaStatus } = useStravaData();
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
          className="fixed inset-0 z-30 bg-black/85 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-40 h-full flex flex-col',
          // The only divider: a clear right border separating sidebar from content
          'bg-sidebar-background border-r-2 border-foreground/15',
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
          <RunQuestLogo className="h-6 w-auto max-w-full text-sidebar-foreground" />
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

        {/* Strava sync — pinned to bottom, no top divider */}
        <div className="px-3 py-4 min-h-[52px] flex items-center">
          {stravaStatus.connected && (
            <div className="flex items-center gap-2">
              <StravaIcon size={18} />
              <span className="text-[10px] text-muted-foreground leading-tight truncate">
                Synced with Strava
              </span>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
