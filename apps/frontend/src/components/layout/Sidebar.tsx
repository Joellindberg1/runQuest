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
      'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left',
      active && 'bg-sidebar-primary text-sidebar-primary-foreground',
      !active && !disabled && 'hover:bg-sidebar-accent text-sidebar-foreground cursor-pointer',
      disabled && 'text-muted-foreground cursor-not-allowed opacity-50'
    )}
  >
    <span className="shrink-0">{icon}</span>
    <span>{label}</span>
    {disabled && (
      <span className="ml-auto text-[10px] font-normal opacity-60">snart</span>
    )}
  </button>
);

const NavSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="mb-5">
    <p className="px-3 mb-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
      {title}
    </p>
    <div className="space-y-0.5">{children}</div>
  </div>
);

/** Resolves the active tab from the current URL */
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
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-40 h-full flex flex-col',
          'bg-sidebar-background border-r border-sidebar-border',
          'transition-transform duration-300 ease-in-out',
          'w-[50vw] md:w-[20%]',
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-sidebar-border">
          <RunQuestLogo className="h-7 w-auto text-sidebar-foreground" />
          <button
            onClick={onClose}
            className="md:hidden p-1 rounded-md hover:bg-sidebar-accent text-sidebar-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <NavSection title="Game">
            <NavItem
              icon={<Trophy className="w-4 h-4" />}
              label="Leaderboard"
              active={activeTab === 'leaderboard'}
              onClick={() => handleNav('leaderboard')}
            />
            <NavItem
              icon={<Award className="w-4 h-4" />}
              label="Titles"
              active={activeTab === 'titles'}
              onClick={() => handleNav('titles')}
            />
            <NavItem
              icon={<Gamepad2 className="w-4 h-4" />}
              label="Challenges"
              disabled
            />
          </NavSection>

          <NavSection title="You">
            <NavItem
              icon={<User className="w-4 h-4" />}
              label="Profile"
              active={activeTab === 'profile'}
              onClick={() => handleNav('profile')}
            />
            <NavItem
              icon={<Plus className="w-4 h-4" />}
              label="Log Run"
              active={activeTab === 'log-run'}
              onClick={() => handleNav('log-run')}
            />
          </NavSection>

          <NavSection title="RunQuest">
            <NavItem
              icon={<Info className="w-4 h-4" />}
              label="Feature & Version"
              active={activeTab === 'features'}
              onClick={() => handleNav('features')}
            />
            <NavItem
              icon={<HelpCircle className="w-4 h-4" />}
              label="FAQ"
              disabled
            />
            <NavItem
              icon={<Bug className="w-4 h-4" />}
              label="Bug Report"
              disabled
            />
          </NavSection>
        </nav>

        {/* Strava sync — always at the bottom */}
        <div className="px-4 py-4 border-t border-sidebar-border min-h-[56px] flex items-center">
          {stravaStatus.connected && (
            <div className="flex items-center gap-2">
              <StravaIcon size={20} />
              <span className="text-xs text-muted-foreground leading-tight">
                You are synced with Strava
              </span>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
