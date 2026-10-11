import { useEffect, useState } from 'react';
import type { BadgeUserItem } from '@runquest/shared';
import { useAuth } from '@/providers/authContext';
import { useOnboardingQueue } from '@/features/onboarding/hooks/useOnboardingQueue';
import { buildPopupQueue, dismissSeries, skipAllSeries, type BadgePopupEntry } from '../badgeModel';
import { useGroupBadges, useMarkBadgesSeen, useUserBadges } from '../hooks/useBadgeQueries';
import { BadgeUpgradeDialog } from './BadgeUpgradeDialog';

/** Sidtourerna (`tour_*`) hör till respektive sida; bara onboarding_v1 och "What's new" blockerar globalt (samma regel som FeatureTour). */
const PAGE_TOUR_PREFIX = 'tour_';
/** driver.js sätter klassen på <body> så länge en tour (första inloggningen eller en sidtour) körs. */
const TOUR_RUNNING_CLASS = 'driver-active';

const entryKey = (entry: Pick<BadgePopupEntry, 'series' | 'tier'>): string => `${entry.series}:${entry.tier}`;

/** True medan en driver.js-tour är igång. Läser <body>-klassen, så den fångar även sidtourer som startar efter en fördröjning. */
function useTourRunning(): boolean {
  const [running, setRunning] = useState(() => document.body.classList.contains(TOUR_RUNNING_CLASS));
  useEffect(() => {
    const sync = () => setRunning(document.body.classList.contains(TOUR_RUNNING_CLASS));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return running;
}

/**
 * Popupen väntar (Council 22) medan onboarding-touren eller "What's new"-popupen återstår — första objektet i OnboardingOrchestrators kö som inte
 * är en sidtour, eller en status som ännu laddas — och medan en tour körs. Går onboarding-statusen inte att hämta blockeras ingenting.
 */
function useWaitsForOnboarding(): boolean {
  const { currentItem, isLoading } = useOnboardingQueue();
  const tourRunning = useTourRunning();
  const globalPending = currentItem !== null && !currentItem.startsWith(PAGE_TOUR_PREFIX);
  return isLoading || globalPending || tourRunning;
}

interface UpgradeSessionProps {
  items: readonly BadgeUserItem[];
  userId: string;
}

/**
 * En session = från att kön får poster till att den är tom. Serierna som avfärdats hålls borta lokalt (nyckel serie+tier) direkt, så "1 of 3" inte
 * hoppar medan den optimistiska cachen hinner ikapp, och så en serie aldrig visas två gånger — även om en omhämtning landar mitt i kön.
 */
function UpgradeSession({ items, userId }: UpgradeSessionProps) {
  const { markSeen } = useMarkBadgesSeen(userId);
  const waiting = useWaitsForOnboarding();
  // Held-by kommer ur gruppen: popupen väntar in första svaret så texten inte dyker upp efter öppningen. Ett fel utelämnar held-by (modellen).
  const group = useGroupBadges();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  const pending = buildPopupQueue(items, group.data).filter((entry) => !dismissed.has(entryKey(entry)));
  // "1 of 3" = antalet vid öppning (README): växer bara om en ny serie tillkommer mitt i kön, krymper aldrig medan kön töms. Räknarna gäller en kö i
  // taget: när den är tom börjar nästa från noll (`dismissed` lever kvar och skyddar mot en gammal omhämtning).
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const reached = done + pending.length;
  if (pending.length === 0 && (done !== 0 || total !== 0)) {
    setDone(0);
    setTotal(0);
  } else if (reached > total) {
    setTotal(reached);
  }

  const current = pending[0];
  if (!current || waiting || group.isLoading) return null;

  return (
    <BadgeUpgradeDialog
      entry={current}
      position={done + 1}
      total={Math.max(total, reached)}
      onDismiss={() => {
        setDismissed((known) => new Set(known).add(entryKey(current)));
        setDone((count) => count + 1);
        markSeen(dismissSeries(current));
      }}
      onSkipAll={() => {
        setDismissed((known) => new Set([...known, ...pending.map(entryKey)]));
        setDone((count) => count + pending.length);
        markSeen(skipAllSeries(pending));
      }}
    />
  );
}

/**
 * Uppgraderingspopupen i det inloggade skalet (ADR 009 beslut 5, spec F6): drivs av `tier > seen_tier` ur min samling, en popup per serie, kö vid flera.
 * Monteras i AppShell (aldrig på /, /login eller landningen). Utan poster i kön renderas ingenting och varken gruppen eller onboarding-statusen hämtas här.
 */
export function BadgeUpgradeHost() {
  const { user } = useAuth();
  const { data } = useUserBadges(user?.id);
  if (!user || !data || buildPopupQueue(data.items).length === 0) return null;
  return <UpgradeSession items={data.items} userId={user.id} />;
}
