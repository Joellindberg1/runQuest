import type { User } from '@runquest/types';
import { StatsContent } from '@/features/profile/components/StatsContent';
import type { StatView } from '@/features/profile/statsModel';
import { SegmentedControl, type SegmentedOption } from '@/shared/components/SegmentedControl';
import { buildChallengeRecordRow } from '../overviewModel';
import type { StatCell } from '../runnerModel';

// Activity är profilens Consistency-karta (samma vy, annat namn i popupen). Ordningen är Activity först.
const OVERVIEW_OPTIONS: readonly SegmentedOption<StatView>[] = [
  { value: 'consistency', label: 'Activity' },
  { value: 'distance', label: 'Distance' },
  { value: 'streak', label: 'Streak' },
  { value: 'fun', label: 'Fun facts' },
];

interface OverviewPanelProps {
  user: User;
  now: Date;
  /** Statcellerna ur `useRunnerPanelData`: utmaningsrekordet i Fun facts läses ur samma cell som sidans hjältekort. */
  cells: readonly StatCell[];
  /** Vald vy. Popupen äger den (och nollställer den vid varje öppning); panelen läser aldrig adressen. */
  view: StatView;
  onChange: (view: StatView) => void;
}

/**
 * Popupens Overview-flik (ADR 006 addendum 2026-10-26, punkt 3): en segmentstyrd växling (`SegmentedControl`, `aria-pressed`) över profilens statistikinnehåll (`StatsContent`),
 * för den visade löparens `User`. Växlingen byter innehåll men inte panel, så den har varken tablist eller egen tabpanel: panelen är popupens (`PopupSections`).
 * Streak-trappan hämtas bara när Streak visas. Utmaningsrekordet är en extra rad sist i Fun facts och finns inte i profilens modell.
 */
export function OverviewPanel({ user, now, cells, view, onChange }: OverviewPanelProps) {
  const challengeRecord = buildChallengeRecordRow(cells);

  return (
    <div className="rq-runner-overview">
      <SegmentedControl label="Overview" options={OVERVIEW_OPTIONS} value={view} onChange={onChange} className="rq-runner-overview__switch" />
      <div className="rq-card rq-runner-overview__content">
        <StatsContent user={user} now={now} isDesktop view={view} extraFunRows={challengeRecord ? [challengeRecord] : undefined} />
      </div>
    </div>
  );
}
