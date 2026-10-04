import { useMemo } from 'react';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { useNow } from '@/app-shell/useNow';
import { paths } from '@/paths';
import { useAuth } from '@/providers/authContext';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { SkeletonRows } from '@/shared/components/loaders/SkeletonRows';
import { FeatureTour } from '@/features/onboarding/components/FeatureTour';
import { TOUR_PROFILE_V2 } from '@/features/onboarding/featureTourSteps';
import { useTitleLeaderboard } from '@/shared/hooks/useTitleQueries';
import { useUsersWithRuns } from '@/shared/hooks/useUsersWithRuns';
import { todayOf } from '@/features/log/logModel';
import { useRunnerTitles } from '@/features/runner/hooks/useRunnerQueries';
import { buildHero, buildStatCells } from '../profileModel';
import '../profile.css';
import { JourneyCard } from './JourneyCard';
import { ProfileHero } from './ProfileHero';
import { RunHistory } from './RunHistory';
import { StatsPanel } from './StatsPanel';
import { TitlesPanel } from './TitlesPanel';

const LOADING_ROWS = 6;

/**
 * /profile: hjältekort · Frodo's journey · statflikar (`?view=`) · mina titlar · rundhistorik med redigera/radera.
 * All datahämtning bor här; panelerna är presentation. Mobil = App Prototypens profil (allt i en kolumn), desktop = Web
 * Prototypens (hjälte · Frodo · statflikar | titlar + rundhistorik på 340 px). Allt härleds ur `users-with-runs` (samma
 * cache som skalet, Board och Runner card) plus titlarna — ingen egen endpoint.
 */
export function ProfileScreen() {
  const { user } = useAuth();
  const isDesktop = useIsDesktop();
  const now = useNow();
  const usersQuery = useUsersWithRuns(!!user);
  const me = usersQuery.data?.find((candidate) => candidate.id === user?.id);
  const titlesQuery = useRunnerTitles(user?.id ?? '');
  const boardQuery = useTitleLeaderboard();

  const hero = useMemo(() => (me ? buildHero(me, usersQuery.data ?? []) : null), [me, usersQuery.data]);
  const heldTitles = titlesQuery.data ? titlesQuery.data.filter((title) => title.is_current_holder).length : null;
  const cells = useMemo(() => (me ? buildStatCells(me, heldTitles) : []), [me, heldTitles]);

  if (isDesktop === undefined) return null;
  if (usersQuery.isError) {
    return (
      <ErrorState
        title="Couldn't load your profile"
        message="Your runs are safe — we just could not reach the server. Try again in a moment."
        retrying={usersQuery.isFetching}
        onRetry={() => void usersQuery.refetch()}
      />
    );
  }
  if (!usersQuery.data) return <SkeletonRows rows={LOADING_ROWS} label="Loading your profile" />;
  if (!me || !hero) {
    return <EmptyState title="User not found" text="We could not load your runner data." actionLabel="Back to the board" actionTo={paths.board} />;
  }

  return (
    <div className="rq-profile rq-rise">
      <FeatureTour slug="tour_profile_v2" steps={TOUR_PROFILE_V2} />
      <div className="rq-profile__split">
        <div className="rq-profile__main">
          <ProfileHero user={me} hero={hero} cells={cells} isDesktop={isDesktop} />
          <JourneyCard totalKm={me.total_km} isDesktop={isDesktop} />
          <StatsPanel user={me} now={now} isDesktop={isDesktop} />
        </div>
        <div className="rq-profile__side">
          <TitlesPanel user={me} titles={titlesQuery} board={boardQuery} isDesktop={isDesktop} />
          <RunHistory runs={me.runs ?? []} today={todayOf(now)} />
        </div>
      </div>
    </div>
  );
}
