import { useMemo, useRef, useState } from 'react';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { useNow } from '@/app-shell/useNow';
import { paths } from '@/paths';
import { useAuth } from '@/providers/authContext';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { SkeletonRows } from '@/shared/components/loaders/SkeletonRows';
import { buildCollection, buildRunnerBadges } from '@/features/badges/badgeModel';
import { BadgeCollection } from '@/features/badges/components/BadgeCollection';
import { ShowcasePicker } from '@/features/badges/components/ShowcasePicker';
import { useGroupBadges, useUserBadges } from '@/features/badges/hooks/useBadgeQueries';
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

  // Badges är ett tillägg: egna queries, och ett badgefel stannar i badgekortet (resten av profilen berörs inte). Gruppens holders ger held-by;
  // felar den utelämnas raden (data är då undefined) utan platshållare.
  const userBadges = useUserBadges(user?.id);
  const groupBadges = useGroupBadges(!!user);
  const badges = useMemo(() => {
    const viewer = { viewerId: user?.id ?? null, ownerId: user?.id ?? '' };
    return { rows: buildCollection(userBadges.data, groupBadges.data, viewer), showcase: buildRunnerBadges(userBadges.data, groupBadges.data, viewer).showcase };
  }, [userBadges.data, groupBadges.data, user?.id]);
  // Felkort med Retry bara när det inte finns något att visa: en misslyckad bakgrundsomhämtning låter den gamla samlingen stå kvar.
  const badgeError = userBadges.isError && !userBadges.data ? { retrying: userBadges.isFetching, onRetry: () => void userBadges.refetch() } : undefined;

  // Väljaren för visade badges (RUN-129): öppnas från Edit i ON DISPLAY-remsan, ritas på ETT ställe åt gången (se layouten) och fokus går tillbaka till Edit.
  const [pickerOpen, setPickerOpen] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const closePicker = () => {
    setPickerOpen(false);
    editRef.current?.focus();
  };

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

  // Samma panel på mobil och desktop: desktop i den 340 px breda sidokolumnen ovanför TITLES (Council 16), mobil direkt ovanför BADGES-kortet (där Edit-knappen sitter, så panelen öppnas där man tittar — under kortet låg den bakom åtta samlingskort).
  const picker = pickerOpen ? <ShowcasePicker rows={badges.rows} userId={user?.id} onClose={closePicker} /> : null;

  return (
    <div className="rq-profile rq-rise">
      <FeatureTour slug="tour_profile_v2" steps={TOUR_PROFILE_V2} />
      <div className="rq-profile__split">
        <div className="rq-profile__main">
          <ProfileHero user={me} hero={hero} cells={cells} isDesktop={isDesktop} showcase={badges.showcase} />
          {!isDesktop && picker}
          <BadgeCollection
            rows={badges.rows}
            loading={userBadges.isLoading}
            error={badgeError}
            isDesktop={isDesktop}
            onEdit={() => (pickerOpen ? closePicker() : setPickerOpen(true))}
            editing={pickerOpen}
            editButtonRef={editRef}
          />
          <JourneyCard totalKm={me.total_km} isDesktop={isDesktop} />
          <StatsPanel user={me} now={now} isDesktop={isDesktop} />
        </div>
        <div className="rq-profile__side">
          {isDesktop && picker}
          <TitlesPanel user={me} titles={titlesQuery} board={boardQuery} isDesktop={isDesktop} />
          <RunHistory runs={me.runs ?? []} today={todayOf(now)} />
        </div>
      </div>
    </div>
  );
}
