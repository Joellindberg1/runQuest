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
/** Så länge väntar popupen in gruppen (held-by); sedan visas den utan held-by hellre än inte alls. */
export const GROUP_WAIT_MS = 2000;

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

/** True medan gruppen laddas, men högst GROUP_WAIT_MS: ett segt eller hängande svar får inte hålla tillbaka popupen. */
function useWaitsForGroup(loading: boolean): boolean {
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setGaveUp(true), GROUP_WAIT_MS);
    return () => clearTimeout(timer);
  }, [loading]);
  return loading && !gaveUp;
}

interface UpgradeSessionProps {
  items: readonly BadgeUserItem[];
  userId: string;
  /** Avfärdade `serie:tier` i den här appsessionen — ägs av värden, så de överlever att sessionen avslutas (se UserUpgrades). */
  dismissed: ReadonlySet<string>;
  onDismissed: (keys: readonly string[]) => void;
}

/**
 * En session = från att kön får poster till att den är tom. De avfärdade serierna hålls borta direkt, så "1 of 3" inte hoppar medan den
 * optimistiska cachen hinner ikapp. Räknarna gäller bara sessionen: den avslutas (avmonteras) när kön är tom och nästa börjar från noll.
 */
function UpgradeSession({ items, userId, dismissed, onDismissed }: UpgradeSessionProps) {
  const { markSeen } = useMarkBadgesSeen(userId);
  const waiting = useWaitsForOnboarding();
  // Held-by kommer ur gruppen: popupen väntar in första svaret (högst GROUP_WAIT_MS) så texten inte dyker upp efter öppningen. Ett fel utelämnar held-by (modellen).
  const group = useGroupBadges();
  const waitingForGroup = useWaitsForGroup(group.isLoading);

  const pending = buildPopupQueue(items, group.data).filter((entry) => !dismissed.has(entryKey(entry)));
  // "1 of 3" = antalet vid öppning (README): växer bara om en ny serie tillkommer mitt i kön, krymper aldrig medan kön töms.
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(pending.length);
  const reached = done + pending.length;
  if (reached > total) setTotal(reached);

  const current = pending[0];
  if (!current || waiting || waitingForGroup) return null;

  return (
    <BadgeUpgradeDialog
      entry={current}
      position={done + 1}
      total={Math.max(total, reached)}
      onDismiss={() => {
        onDismissed([entryKey(current)]);
        setDone((count) => count + 1);
        markSeen(dismissSeries(current));
      }}
      onSkipAll={() => {
        onDismissed(pending.map(entryKey));
        setDone((count) => count + pending.length);
        markSeen(skipAllSeries(pending));
      }}
    />
  );
}

/**
 * Per användare (key): kön ur min samling och mängden avfärdade serier. Mängden ligger HÄR och inte i sessionen: när sista posten avfärdas töms kön
 * optimistiskt och sessionen avslutas, och felar sedan POST /badges/seen (5xx) återställs cachen och kön kommer tillbaka. En avfärdad serie visas
 * ändå inte igen i samma appsession (den kommer tillbaka nästa gång appen öppnas, då servern inte fick veta att den var sedd).
 */
function UserUpgrades({ userId }: { userId: string }) {
  const { data } = useUserBadges(userId);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  // Värden är globalt monterad: ett oväntat svar (utan items) får aldrig krascha skalet.
  const items = data?.items ?? [];
  if (!Array.isArray(items)) return null;
  if (buildPopupQueue(items).every((entry) => dismissed.has(entryKey(entry)))) return null;
  return (
    <UpgradeSession
      items={items}
      userId={userId}
      dismissed={dismissed}
      onDismissed={(keys) => setDismissed((known) => new Set([...known, ...keys]))}
    />
  );
}

/**
 * Uppgraderingspopupen i det inloggade skalet (ADR 009 beslut 5, spec F6): drivs av `tier > seen_tier` ur min samling, en popup per serie, kö vid flera.
 * Monteras i AppShell (aldrig på /, /login eller landningen). Utan poster i kön renderas ingenting och varken gruppen eller onboarding-statusen hämtas här.
 */
export function BadgeUpgradeHost() {
  const { user } = useAuth();
  if (!user) return null;
  return <UserUpgrades key={user.id} userId={user.id} />;
}
