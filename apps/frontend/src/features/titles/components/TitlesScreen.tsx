import { useMemo, useState } from 'react';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { FeatureTour } from '@/features/onboarding/components/FeatureTour';
import { TOUR_TITLES_V2 } from '@/features/onboarding/featureTourSteps';
import { paths } from '@/paths';
import { useAuth } from '@/providers/authContext';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { SkeletonRows } from '@/shared/components/loaders/SkeletonRows';
import { ViewTabs, type ViewTab } from '@/shared/components/ViewTabs';
import { panelId, tabId } from '@/shared/components/viewTabIds';
import { useUsersWithRuns } from '@/shared/hooks/useUsersWithRuns';
import { useViewParam } from '@/shared/hooks/useViewParam';
import { useDisplaySelection } from '../hooks/useDisplaySelection';
import { useGroupEligibility, useTitleBoard } from '../hooks/useTitlesQueries';
import {
  MAX_DISPLAYED, TITLE_FILTERS, TITLE_FILTER_PARAM, buildChases, buildDisplayedRows, buildTitlesView, heldTitleIds, summaryText,
  type TitleFilter,
} from '../titlesModel';
import '../titles.css';
import { ChasePanel } from './ChasePanel';
import { DisplayPanel } from './DisplayPanel';
import { TitleGroupSection } from './TitleGroupSection';

const LOADING_ROWS = 6;
const ID_PREFIX = 'titles';
const NO_ELIGIBILITY: never[] = [];

const FILTER_TABS_MOBILE: readonly ViewTab<TitleFilter>[] = [
  { key: 'all', label: 'All' },
  { key: 'mine', label: 'Mine' },
  { key: 'unclaimed', label: 'Unclaimed' },
];
const FILTER_TABS_DESKTOP: readonly ViewTab<TitleFilter>[] = [
  { key: 'all', label: 'All titles' },
  { key: 'mine', label: 'Mine' },
  { key: 'unclaimed', label: 'Unclaimed' },
];

const EMPTY_FILTER_COPY: Record<Exclude<TitleFilter, 'all'>, { title: string; text: string }> = {
  mine: { title: 'No titles held yet', text: "Beat a holder's number to take a title — the Closest chase shows where you are closest." },
  unclaimed: { title: 'Every title has a holder', text: 'Nothing is up for grabs right now — but holders can be overtaken.' },
};

/**
 * /titles: räknarrad, filter (All/Mine/Unclaimed över `?filter=`), kategorigrupper som dragspel och — på desktop — "On display"
 * + "Closest chase" i en sidokolumn (Web-prototypen). Titlar och regler kommer ur databasen; kategorin ur metric_key.
 */
export function TitlesScreen() {
  const { user } = useAuth();
  const isDesktop = useIsDesktop();
  const [filter, setFilter] = useViewParam(TITLE_FILTERS, 'all', TITLE_FILTER_PARAM);
  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>({});

  const boardQuery = useTitleBoard(!!user);
  // Bästa försöket på olåsta titlar är en bonus: laddar den inte ritas korten ändå (utan "Best so far").
  const eligibilityQuery = useGroupEligibility(!!user);
  const usersQuery = useUsersWithRuns(!!user);

  const meId = user?.id ?? null;
  const board = boardQuery.data;
  const eligibility = eligibilityQuery.data ?? NO_ELIGIBILITY;

  const view = useMemo(() => (board ? buildTitlesView(board, eligibility, meId, filter) : null), [board, eligibility, meId, filter]);
  const heldIds = useMemo(() => (board ? heldTitleIds(board, meId) : []), [board, meId]);
  const me = usersQuery.data?.find((candidate) => candidate.id === meId);
  const savedIds = me?.displayed_title_ids ?? [];
  const selection = useDisplaySelection(savedIds, heldIds);
  const chases = useMemo(() => (board && isDesktop ? buildChases(board, eligibility, meId) : []), [board, eligibility, meId, isDesktop]);
  const displayPositions = useMemo(() => new Map(selection.selected.map((id, index) => [id, index + 1])), [selection.selected]);

  if (isDesktop === undefined) return null;
  if (boardQuery.isError) {
    return <ErrorState title="Couldn't load the titles" retrying={boardQuery.isFetching} onRetry={() => void boardQuery.refetch()} />;
  }
  if (!view) return <SkeletonRows rows={LOADING_ROWS} label="Loading titles" />;
  if (view.inPlay === 0) {
    return <EmptyState title="No titles yet" text="Titles appear once the group starts running." actionLabel="Log a run" actionTo={paths.log} />;
  }

  // Ett filter visar få titlar — då är grupperna öppna; annars bara den första (designen öppnar "Time of day").
  const isOpen = (id: string, index: number) => openOverride[id] ?? (filter !== 'all' || index === 0);
  const toggleGroup = (id: string, index: number) => setOpenOverride((previous) => ({ ...previous, [id]: !isOpen(id, index) }));

  const displayedRows = buildDisplayedRows(selection.selected, view.rows);
  const selectionReady = !!me;

  const tabs = (
    <div data-tour="titles-filter">
      <ViewTabs
        label="Title filter"
        tabs={isDesktop ? FILTER_TABS_DESKTOP : FILTER_TABS_MOBILE}
        value={filter}
        onChange={setFilter}
        idPrefix={ID_PREFIX}
        className="rq-titles__tabs"
      />
    </div>
  );

  const emptyFilter = filter === 'all' ? null : EMPTY_FILTER_COPY[filter];
  const groups =
    view.groups.length === 0 && emptyFilter ? (
      <EmptyState title={emptyFilter.title} text={emptyFilter.text} actionLabel="Show all titles" actionTo={paths.titles} headingLevel="h2" />
    ) : (
      <div className="rq-titles__groups">
        {view.groups.map((group, index) => (
          <TitleGroupSection
            key={group.id}
            group={group}
            open={isOpen(group.id, index)}
            onToggle={() => toggleGroup(group.id, index)}
            showChevron={isDesktop}
            displayPositions={displayPositions}
            canPick={selectionReady}
            selectionFull={selection.selected.length >= MAX_DISPLAYED}
            onTogglePick={selection.toggle}
          />
        ))}
      </div>
    );

  const display = (
    <DisplayPanel
      ready={selectionReady}
      rows={displayedRows}
      totalHeld={heldIds.length}
      dirty={selection.dirty}
      saving={selection.saving}
      status={selection.status}
      onRemove={selection.toggle}
      onSave={() => void selection.save()}
    />
  );

  return (
    <div className="rq-titles">
      <FeatureTour slug="tour_titles_v2" steps={TOUR_TITLES_V2} />

      <header className="rq-titles__head">
        <div>
          <h1 className="rq-display rq-titles__title">Titles</h1>
          <p className="rq-titles__sub">{summaryText(view, isDesktop ? displayedRows.length : null)}</p>
        </div>
        {isDesktop && tabs}
      </header>
      {!isDesktop && tabs}

      <div className={isDesktop ? 'rq-titles__split' : 'rq-titles__stack'}>
        <div key={filter} role="tabpanel" id={panelId(ID_PREFIX)} aria-labelledby={tabId(ID_PREFIX, filter)} className="rq-titles__panel rq-rise">
          {groups}
        </div>
        {isDesktop ? (
          <div className="rq-titles__side">
            {display}
            <ChasePanel chases={chases} />
          </div>
        ) : (
          display
        )}
      </div>
    </div>
  );
}
