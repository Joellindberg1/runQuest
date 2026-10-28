import { useMemo } from 'react';
import { PROFILE_TOUR_SLUG, zoneDay } from '@runquest/shared';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { useNow } from '@/app-shell/useNow';
import { paths } from '@/paths';
import { useAuth } from '@/providers/authContext';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { SkeletonRows } from '@/shared/components/loaders/SkeletonRows';
import { buildCollection, buildRunnerBadges } from '@/features/badges/badgeModel';
import { BadgeSummary } from '@/features/badges/components/BadgeSummary';
import { useGroupBadges, useUserBadges } from '@/features/badges/hooks/useBadgeQueries';
import { FeatureTour } from '@/features/onboarding/components/FeatureTour';
import { TOUR_PROFILE_V2 } from '@/features/onboarding/featureTourSteps';
import { useTitleLeaderboard } from '@/shared/hooks/useTitleQueries';
import { useUsersWithRuns } from '@/shared/hooks/useUsersWithRuns';
import { useViewParam } from '@/shared/hooks/useViewParam';
import { useRunnerTitles } from '@/features/runner/hooks/useRunnerQueries';
import { buildHero, buildStatCells } from '../profileModel';
import { DEFAULT_STAT_VIEW, showPositionTab, statViewsFor } from '../statsModel';
import '../profile.css';
import { JourneyCard } from './JourneyCard';
import { ProfileHero } from './ProfileHero';
import { RunHistory } from './RunHistory';
import { StatsPanel } from './StatsPanel';
import { TitlesPanel } from './TitlesPanel';

const LOADING_ROWS = 6;

/**
 * /profile: hjältekort · Frodo's journey · statflikar (`?view=`) · mina titlar · badge-sammanfattning · rundhistorik med redigera/radera.
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
  // Position-fliken finns bara i en grupp på minst två, och det vet vi redan ur users-with-runs (ingen hämtning av positionssvaret för att kunna dölja fliken, ADR 007 addendum 2026-10-26).
  // Dold flik = `?view=position` är ett okänt värde och faller tillbaka på standardfliken som vilket annat ogiltigt värde som helst.
  const memberCount = usersQuery.data?.length ?? 0;
  const showPosition = showPositionTab(memberCount);
  // Statflikarna ligger över `?view=` (ADR 006 beslut 3): adressen bor här, panelen är kontrollerad.
  const [statView, setStatView] = useViewParam(statViewsFor(memberCount), DEFAULT_STAT_VIEW);

  // Badges är ett tillägg: egna queries, och ett badgefel stannar i sammanfattningen (resten av profilen berörs inte). Gruppens holders ger held-by;
  // felar den utelämnas raden (data är då undefined) utan platshållare.
  const userBadges = useUserBadges(user?.id);
  const groupBadges = useGroupBadges(!!user);
  const badges = useMemo(() => {
    const viewer = { viewerId: user?.id ?? null, ownerId: user?.id ?? '' };
    return { rows: buildCollection(userBadges.data, groupBadges.data, viewer), showcase: buildRunnerBadges(userBadges.data, groupBadges.data, viewer).showcase };
  }, [userBadges.data, groupBadges.data, user?.id]);
  // Felkort med Retry bara när det inte finns något att visa: en misslyckad bakgrundsomhämtning låter den gamla samlingen stå kvar.
  const badgeError = userBadges.isError && !userBadges.data ? { retrying: userBadges.isFetching, onRetry: () => void userBadges.refetch() } : undefined;

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

  // En plats åt gången (F10.1): desktop sist i huvudkolumnen (efter statflikarna), mobil i sidokolumnen mellan MY TITLES och RUN HISTORY (mobilens kolumn staplar main → side).
  const summary = <BadgeSummary rows={badges.rows} loading={userBadges.isLoading} error={badgeError} isDesktop={isDesktop} />;

  return (
    <div className="rq-profile rq-rise">
      <FeatureTour slug={PROFILE_TOUR_SLUG} steps={TOUR_PROFILE_V2} />
      <div className="rq-profile__split">
        <div className="rq-profile__main">
          <ProfileHero user={me} hero={hero} cells={cells} isDesktop={isDesktop} showcase={isDesktop ? badges.showcase : undefined} />
          <JourneyCard totalKm={me.total_km} isDesktop={isDesktop} />
          <StatsPanel user={me} now={now} isDesktop={isDesktop} view={statView} onChange={setStatView} label="Your stats" dataTour="profile-stats" showPosition={showPosition} />
          {isDesktop && summary}
        </div>
        <div className="rq-profile__side">
          <TitlesPanel user={me} titles={titlesQuery} board={boardQuery} isDesktop={isDesktop} />
          {!isDesktop && summary}
          <RunHistory runs={me.runs ?? []} today={zoneDay(now)} />
        </div>
      </div>
    </div>
  );
}
