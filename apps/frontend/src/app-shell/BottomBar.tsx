import { Link, useLocation } from 'react-router-dom';
import { RQIcon, type RQIconName } from '@/shared/components/icons';
import { activeTabFor, TAB_TARGETS, type BottomTab } from './activeNav';

const ICON_TAB = 18;
const ICON_NEW = 20;

interface TabSpec {
  key: BottomTab;
  label: string;
  icon: RQIconName;
  tourAnchor: string;
}

// Fem kolumner: Ranks · Titles · +New (mitten) · Duels · You — som prototypens tabs().
const LEFT_TABS: TabSpec[] = [
  { key: 'ranks', label: 'Ranks', icon: 'trophy', tourAnchor: 'nav-ranks' },
  { key: 'titles', label: 'Titles', icon: 'crown', tourAnchor: 'nav-titles' },
];
const RIGHT_TABS: TabSpec[] = [
  { key: 'duels', label: 'Duels', icon: 'swords', tourAnchor: 'nav-duels' },
  { key: 'you', label: 'You', icon: 'user', tourAnchor: 'nav-you' },
];

interface BottomBarProps {
  newOpen: boolean;
  onNewClick: () => void;
}

export function BottomBar({ newOpen, onNewClick }: BottomBarProps) {
  const { pathname } = useLocation();
  const active = activeTabFor(pathname);

  const renderTab = (tab: TabSpec) => (
    <Link
      key={tab.key}
      to={TAB_TARGETS[tab.key]}
      className="rq-tabbar__item"
      aria-current={active === tab.key ? 'page' : undefined}
      data-tour={tab.tourAnchor}
    >
      <RQIcon name={tab.icon} size={ICON_TAB} />
      <span>{tab.label}</span>
    </Link>
  );

  return (
    <nav className="rq-tabbar" aria-label="Primary">
      {LEFT_TABS.map(renderTab)}
      <button
        type="button"
        className="rq-tabbar__item rq-tabbar__item--new"
        aria-haspopup="dialog"
        aria-expanded={newOpen}
        onClick={onNewClick}
        data-tour="nav-new"
      >
        <RQIcon name="plus" size={ICON_NEW} />
        <span>New</span>
      </button>
      {RIGHT_TABS.map(renderTab)}
    </nav>
  );
}
