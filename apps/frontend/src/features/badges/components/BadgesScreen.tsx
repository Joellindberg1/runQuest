import { useId, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { BADGE_SERIES, MAX_TIER } from '@runquest/shared';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { paths } from '@/paths';
import { useAuth } from '@/providers/authContext';
import { ErrorState } from '@/shared/components/ErrorState';
import { buildCollection } from '../badgeModel';
import { useGroupBadges, useUserBadges } from '../hooks/useBadgeQueries';
import { useShowcaseDraft } from '../hooks/useShowcaseDraft';
import { BadgeDisplayStrip } from './BadgeDisplayStrip';
import { BadgeSeriesCard } from './BadgeSeriesCard';
import '../badges.css';

const SKELETON_CARDS = 3;
const SKELETON_LINES = 3;
// Tal som ord i copyn ("Eight series, six tiers"), räknade ur shared så texten inte driftar när en serie eller nivå tillkommer.
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const numberWord = (n: number) => NUMBER_WORDS[n] ?? String(n);
const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function LoadingGrid() {
  return (
    <div role="status">
      <span className="sr-only">Loading badges</span>
      <div className="rq-badge-page-grid" aria-hidden="true">
        {Array.from({ length: SKELETON_CARDS }, (_, card) => (
          <div key={card} className="rq-badge-skel">
            <div className="rq-badge-skel__shape" />
            <div className="rq-badge-skel__lines">
              {Array.from({ length: SKELETON_LINES }, (_, line) => <div key={line} className="rq-badge-skel__bar" />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Inga badges än (ett lyckat, tomt svar): streckad ruta i stället för remsan; de åtta låsta korten ritas under den. */
function EmptyBox() {
  return (
    <div className="rq-badge-empty">
      <h2 className="rq-badge-empty__title">No badges yet</h2>
      <p className="rq-badge-empty__text">Log a run to start collecting.</p>
    </div>
  );
}

/**
 * /badges (spec F9): sidhuvud, ON DISPLAY-remsan med SAVE DISPLAY och ett liggande kort per serie med Show / On display-knapp. Det enda stället där man väljer
 * vilka badges som visas (O3). All datahämtning bor här: min samling + gruppen (held-by); ett gruppfel utelämnar bara held-by-raden på korten.
 *
 * Utkastet och sparandet ligger i `useShowcaseDraft`; remsan och korten läser samma utkast. Tillstånd (F9.8): laddar → skelett; fel → ErrorState med Retry;
 * inga intjänade → streckad ruta + åtta låsta kort (ingen remsa, ingen SAVE DISPLAY); annars remsa + rutnät.
 * Mobil/desktop följer skalets brytpunkt (`useIsDesktop`); innan den är läst ritas ingen text som beror på den (ingen tillbaka-länk).
 */
export function BadgesScreen() {
  const { user } = useAuth();
  const isDesktop = useIsDesktop();
  const limitId = useId();
  const userBadges = useUserBadges(user?.id);
  const groupBadges = useGroupBadges(!!user);
  const rows = useMemo(
    () => buildCollection(userBadges.data, groupBadges.data, { viewerId: user?.id ?? null, ownerId: user?.id ?? '' }),
    [userBadges.data, groupBadges.data, user?.id],
  );
  const display = useShowcaseDraft(rows, user?.id);

  const loading = userBadges.isLoading;
  // Felkort bara när det inte finns något att visa: en misslyckad bakgrundsomhämtning låter de gamla raderna stå kvar.
  const failed = !loading && userBadges.isError && !userBadges.data;
  const earned = rows.filter((row) => row.earned).length;
  const unlockedText = `${earned} of ${rows.length} series unlocked`;
  const showCount = !loading && !failed;

  let body;
  if (loading) body = <LoadingGrid />;
  else if (failed) {
    body = <ErrorState title="Couldn't load your badges" message="Your runs are safe." retrying={userBadges.isFetching} onRetry={() => void userBadges.refetch()} />;
  } else {
    body = (
      <>
        {earned === 0 ? <EmptyBox /> : <BadgeDisplayStrip rows={rows} display={display} limitId={limitId} isDesktop={isDesktop} />}
        {/* Mellanrubrik så hierarkin är h1 → h2 → h3 även i normalläget (tomläget har "No badges yet" som h2). */}
        {earned > 0 && <h2 className="sr-only">Your badges</h2>}
        <ul className="rq-badge-page-grid" aria-label="Badge series">
          {rows.map((row) => (
            <BadgeSeriesCard
              key={row.series}
              row={row}
              layout="landscape"
              toggle={{ position: display.positionOf(row.series), full: display.full, saving: display.saving, limitId, onToggle: () => display.toggle(row.series) }}
            />
          ))}
        </ul>
      </>
    );
  }

  return (
    <div className="rq-badges">
      <header className="rq-badges__head">
        {isDesktop === false && (
          <Link to={paths.profile} className="rq-back rq-badges__back" aria-label="Back to profile">
            <span aria-hidden="true">‹</span>
          </Link>
        )}
        <div className="rq-badges__titles">
          <h1 className="rq-display rq-badges__title">Badges</h1>
          {isDesktop === true && (
            <p className="rq-badges__lead">
              {capitalised(numberWord(BADGE_SERIES.length))} series, {numberWord(MAX_TIER)} tiers. Anyone can hold a badge — you see your best tier per series.
            </p>
          )}
          {isDesktop === false && showCount && <p className="rq-badges__count">{unlockedText}</p>}
        </div>
        {isDesktop === true && showCount && <span className="rq-badges__count rq-badges__count--aside">{unlockedText}</span>}
      </header>
      {body}
    </div>
  );
}
