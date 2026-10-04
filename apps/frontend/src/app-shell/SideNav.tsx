import { Link, useLocation } from 'react-router-dom';
import { paths } from '@/paths';
import { RQIcon, RQLogo, type RQIconName } from '@/shared/components/icons';
import { activeSideNavItemFor, type NavDestination } from './activeNav';
import { RightNowPanel } from './RightNow';
import type { RightNowItem } from './rightNowItems';

const ICON_NAV = 15;

interface NavSpec {
  label: string;
  icon: RQIconName;
  destination?: NavDestination;
  to?: string;
  tourAnchor?: string;
  disabled?: boolean;
}

interface SectionSpec {
  title: string;
  items: NavSpec[];
}

// Web Prototype: Game · You · RunQuest. FAQ/Bug Report finns i designen men saknar sida (avstängda).
const SECTIONS: SectionSpec[] = [
  {
    title: 'Game',
    items: [
      { label: 'Leaderboard', icon: 'trophy', destination: 'board', to: paths.board, tourAnchor: 'nav-ranks' },
      { label: 'Titles', icon: 'crown', destination: 'titles', to: paths.titles, tourAnchor: 'nav-titles' },
      { label: 'Challenges', icon: 'swords', destination: 'duels', to: paths.duels, tourAnchor: 'nav-duels' },
      { label: 'Events', icon: 'calendar', destination: 'events', to: paths.events, tourAnchor: 'nav-events' },
    ],
  },
  {
    title: 'You',
    items: [
      { label: 'Profile', icon: 'user', destination: 'profile', to: paths.profile, tourAnchor: 'nav-you' },
      { label: 'Log Runs', icon: 'plus', destination: 'log', to: paths.log, tourAnchor: 'nav-new' },
    ],
  },
  {
    title: 'RunQuest',
    items: [
      { label: 'Playbook', icon: 'book', destination: 'playbook', to: paths.playbook },
      { label: 'Feature & Version', icon: 'sparkles', destination: 'features', to: paths.features },
      { label: 'FAQ', icon: 'help', disabled: true },
      { label: 'Bug Report', icon: 'bug', disabled: true },
    ],
  },
];

interface SideNavProps {
  rightNow: RightNowItem[];
}

export function SideNav({ rightNow }: SideNavProps) {
  const location = useLocation();
  // Med Runner card som overlay ligger bakgrundssidan kvar i navigeringen.
  const background = (location.state as { background?: { pathname: string } } | null)?.background;
  const active = activeSideNavItemFor(background?.pathname ?? location.pathname);

  return (
    <aside className="rq-sidenav">
      <div className="rq-sidenav__logo">
        <RQLogo />
      </div>
      <nav aria-label="Primary">
        {SECTIONS.map((section, index) => (
          <div key={section.title}>
            {index > 0 && <div className="rq-sidenav__rule" />}
            <div className="rq-sidenav__eyebrow">{section.title}</div>
            {section.items.map((item) =>
              item.disabled || !item.to ? (
                <span key={item.label} className="rq-navitem" aria-disabled="true">
                  <RQIcon name={item.icon} size={ICON_NAV} />
                  <span>{item.label}</span>
                </span>
              ) : (
                <Link
                  key={item.label}
                  to={item.to}
                  className="rq-navitem"
                  aria-current={active === item.destination ? 'page' : undefined}
                  {...(item.tourAnchor ? { 'data-tour': item.tourAnchor } : {})}
                >
                  <RQIcon name={item.icon} size={ICON_NAV} />
                  <span>{item.label}</span>
                </Link>
              ),
            )}
          </div>
        ))}
      </nav>
      <div className="rq-sidenav__spacer" />
      <RightNowPanel items={rightNow} />
    </aside>
  );
}
