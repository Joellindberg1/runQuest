import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useStravaData, formatLastSync, formatNextSync } from '@/features/settings/hooks/useStravaData';
import { formatConnectionDate } from '@/shared/utils/formatters';
import { StravaIcon } from '@/shared/components/StravaIcon';
import { ThemeToggle } from '@/shared/components/ThemeToggle';
import { Button } from '@/shared/components/ui/button';
import { ProfileMenu } from '@/features/profile/components/ProfileMenu';
import { Trophy, Award, User, Plus, Info, HelpCircle, Bug, Swords, BookOpen, CalendarDays, X, CheckCircle, Bell } from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  groupName?: string;
  bottomWidget?: React.ReactNode;
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
      'w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-all duration-150',
      active && 'nav-item-active',
      !active && !disabled && 'nav-item-hover text-sidebar-foreground/70 hover:text-sidebar-foreground cursor-pointer',
      disabled && 'text-sidebar-foreground/25 cursor-not-allowed'
    )}
    style={active ? {
      borderLeft: '2px solid var(--rq-gold)',
      background: 'linear-gradient(to right, var(--rq-gold-mid), color-mix(in srgb, var(--rq-gold) 4%, transparent) 65%, transparent)',
      position: 'relative',
      color: 'var(--rq-gold)',
    } : { borderLeft: '2px solid transparent' }}
  >
    <span className="shrink-0" style={{ color: active ? 'var(--rq-gold)' : 'inherit', opacity: disabled ? 0.4 : 1 }}>{icon}</span>
    <span
      className="truncate uppercase tracking-wide"
      style={{
        fontFamily: 'Barlow Condensed, sans-serif',
        fontSize: active ? '1rem' : '0.9rem',
        fontWeight: active ? 700 : 500,
        letterSpacing: '0.08em',
      }}
    >
      {label}
    </span>
  </button>
);

const NavSection: React.FC<{ title: string; children: React.ReactNode; separator?: boolean }> = ({ title, children, separator }) => (
  <div className="mb-3">
    {separator && (
      <div className="px-3 mb-2">
        <div className="h-px" style={{ background: 'linear-gradient(to right, color-mix(in srgb, var(--rq-gold) 40%, transparent), color-mix(in srgb, var(--rq-gold) 8%, transparent) 60%, transparent)' }} />
      </div>
    )}
    <p
      className="px-3 mb-1 uppercase text-sidebar-foreground/55"
      style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '0.75rem', letterSpacing: '0.2em' }}
    >
      {title}
    </p>
    <div className="space-y-0.5">{children}</div>
  </div>
);

function useActiveTab() {
  const location = useLocation();
  if (location.pathname === '/features') return 'features';
  if (location.pathname === '/settings') return 'settings';
  if (location.pathname === '/challenges') return 'challenges';
  if (location.pathname === '/playbook') return 'playbook';
  if (location.pathname === '/events') return 'events';
  const params = new URLSearchParams(location.search);
  return params.get('tab') || 'leaderboard';
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose, groupName, bottomWidget }) => {
  const { stravaStatus, syncInfo } = useStravaData();
  const navigate = useNavigate();
  const activeTab = useActiveTab();

  const handleNav = (tab: string) => {
    if (tab === 'features') {
      navigate('/features');
    } else if (tab === 'challenges') {
      navigate('/challenges');
    } else if (tab === 'playbook') {
      navigate('/playbook');
    } else if (tab === 'events') {
      navigate('/events');
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
          'bg-sidebar border-r-2 border-foreground/15 overflow-x-visible',
          'transition-transform duration-300 ease-in-out',
          // Mobile: 60% wide with strong shadow so it reads as a distinct panel
          // Desktop: 15% wide
          'w-[60vw] md:w-[15%]',
          isOpen
            ? 'translate-x-0 shadow-2xl'
            : '-translate-x-full md:translate-x-0'
        )}
      >
        {/* Group name */}
        <div className="px-3 pt-5 pb-4">
          <div className="flex items-center justify-between">
            {groupName ? (
              <p
                className="leading-tight"
                style={{
                  fontFamily: 'Bebas Neue, sans-serif',
                  fontSize: '1.6rem',
                  letterSpacing: '0.04em',
                  color: 'hsl(var(--sidebar-foreground))',
                }}
              >
                {groupName}
              </p>
            ) : (
              <div />
            )}
            <button
              onClick={onClose}
              className="md:hidden shrink-0 ml-2 p-1 rounded-md hover:bg-sidebar-accent text-sidebar-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Navigation — scrollable so bottom bar always stays visible */}
        <nav className="flex-1 overflow-y-auto pl-2 pr-0 pb-2">
          <NavSection title="Game">
            <div data-tour="sidebar-leaderboard">
              <NavItem
                icon={<Trophy className="w-3.5 h-3.5" />}
                label="Leaderboard"
                active={activeTab === 'leaderboard'}
                onClick={() => handleNav('leaderboard')}
              />
            </div>
            <NavItem
              icon={<Award className="w-3.5 h-3.5" />}
              label="Titles"
              active={activeTab === 'titles'}
              onClick={() => handleNav('titles')}
            />
            <div data-tour="sidebar-challenges">
              <NavItem
                icon={<Swords className="w-3.5 h-3.5" />}
                label="Challenges"
                active={activeTab === 'challenges'}
                onClick={() => handleNav('challenges')}
              />
            </div>
            <div data-tour="sidebar-events">
              <NavItem
                icon={<CalendarDays className="w-3.5 h-3.5" />}
                label="Events"
                active={activeTab === 'events'}
                onClick={() => handleNav('events')}
              />
            </div>
          </NavSection>

          <NavSection title="You" separator>
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

          <NavSection title="RunQuest" separator>
            <NavItem
              icon={<BookOpen className="w-3.5 h-3.5" />}
              label="Playbook"
              active={activeTab === 'playbook'}
              onClick={() => handleNav('playbook')}
            />
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

        {/* Bottom — pinned, never scrolls */}
        <div className="shrink-0 border-t border-foreground/10 px-3 pt-3 pb-3 space-y-2">
          {/* Active challenge widget */}
          {bottomWidget && (
            <div className="w-full">{bottomWidget}</div>
          )}

          {/* Theme / Bell / Profile — mobile only (desktop: TopBar) */}
          <div className="md:hidden flex items-center justify-center gap-3">
            <ThemeToggle iconClass="text-sidebar-foreground/60" />
            <Button
              variant="ghost"
              size="icon"
              className="text-sidebar-foreground/60 w-8 h-8"
              disabled
              title="Notifications — coming soon"
            >
              <Bell className="w-4 h-4" />
            </Button>
            <ProfileMenu />
          </div>

          {/* Strava sync — full card on desktop, compact indicator on mobile */}
          {stravaStatus.connected && (
            <div data-tour="sidebar-strava">
              <div className="hidden md:block rounded-lg bg-sidebar-accent border border-foreground/50 p-3 text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <StravaIcon size={16} />
                  <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--rq-success)' }}>
                    <CheckCircle className="w-3 h-3" /> Connected
                  </span>
                </div>
                <div className="space-y-0.5 text-xs text-sidebar-foreground/60">
                  <div>Since: {formatConnectionDate(stravaStatus.connection_date)}</div>
                  <div>Last sync: {formatLastSync(syncInfo)}</div>
                  <div>Next sync: {formatNextSync(syncInfo)}</div>
                </div>
              </div>
              <div className="md:hidden flex items-center justify-center gap-1.5 py-0.5">
                <StravaIcon size={14} />
                <CheckCircle className="w-3.5 h-3.5" style={{ color: 'var(--rq-success)' }} />
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
