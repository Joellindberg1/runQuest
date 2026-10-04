import { useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import type { ChallengeTier } from '@runquest/types';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { useNow } from '@/app-shell/useNow';
import { FeatureTour } from '@/features/onboarding/components/FeatureTour';
import { TOUR_DUELS_V2 } from '@/features/onboarding/featureTourSteps';
import { OPPONENT_PARAM, SEND_PARAM } from '@/paths';
import { useAuth } from '@/providers/authContext';
import { ErrorState } from '@/shared/components/ErrorState';
import { SkeletonRows } from '@/shared/components/loaders/SkeletonRows';
import { useOpenRunner } from '@/shared/hooks/useOpenRunner';
import { useUsersWithRuns } from '@/shared/hooks/useUsersWithRuns';
import { useViewParam } from '@/shared/hooks/useViewParam';
import { firstName } from '../duelsFormat';
import {
  DEFAULT_DUELS_VIEW, DUELS_VIEWS, buildBoosts, buildHistoryRows, buildIncoming, buildLiveCards, buildRecord, buildSent, buildStandings,
  buildTokenGroups, nameMap, summaryText, tokenTotal,
} from '../duelsModel';
import { useChallengeActions } from '../hooks/useChallengeActions';
import { useGroupHistory, useGroupStats, useLiveProgress, useMyChallenges } from '../hooks/useDuelsQueries';
import { buildTierRules, observedStakes, sampleFromHistory, type StakeSample } from '../rulesModel';
import { sendBlocker } from '../sendModel';
import { DuelsLayout, type Notice } from './DuelsLayout';
import { SendSheet } from './SendSheet';

const LOADING_ROWS = 5;
const NO_ITEMS: never[] = [];

const messageOf = (failure: unknown, fallback: string) => (failure instanceof Error && failure.message ? failure.message : fallback);

/**
 * /duels: rubrik, flikar (`?view=` standings · live · rules · history), inkommande/skickad/live-duell, tokens och
 * send-sheeten (`?send=1&opponent=<id>`, ADR 006 beslut 4). All datahämtning och alla handlingar bor här; DuelsLayout ritar.
 */
export function DuelsScreen() {
  const { user } = useAuth();
  const isDesktop = useIsDesktop();
  const now = useNow();
  const openRunner = useOpenRunner();
  const { state } = useLocation();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useViewParam(DUELS_VIEWS, DEFAULT_DUELS_VIEW);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [tierHint, setTierHint] = useState<ChallengeTier | null>(null);
  const [mineOnly, setMineOnly] = useState(false);

  const meId = user?.id ?? '';
  const enabled = !!user;
  const myQuery = useMyChallenges(enabled);
  const statsQuery = useGroupStats(enabled);
  const usersQuery = useUsersWithRuns(enabled);
  const historyQuery = useGroupHistory(enabled && view === 'history');
  const actions = useChallengeActions();

  const my = myQuery.data;
  const stats = statsQuery.data;
  const activeIds = useMemo(() => (my?.group_active ?? NO_ITEMS).map((challenge) => challenge.id), [my]);
  const progress = useLiveProgress(activeIds);

  const names = useMemo(() => nameMap(stats ?? NO_ITEMS), [stats]);
  const tokenGroups = useMemo(() => buildTokenGroups(my?.tokens ?? NO_ITEMS), [my]);
  const incoming = useMemo(() => buildIncoming(my?.received_challenges ?? NO_ITEMS, names, now), [my, names, now]);
  const sent = useMemo(() => buildSent(my?.sent_challenge ?? null, names), [my, names]);
  const live = useMemo(() => buildLiveCards(my?.group_active ?? NO_ITEMS, progress, meId, names, now), [my, progress, meId, names, now]);
  const standings = useMemo(() => buildStandings(stats ?? NO_ITEMS, meId), [stats, meId]);
  const myRuns = usersQuery.data?.find((candidate) => candidate.id === meId)?.runs;
  const boosts = useMemo(
    () => buildBoosts(my?.boosts ?? NO_ITEMS, my?.history ?? NO_ITEMS, meId, names, now, myRuns),
    [my, meId, names, now, myRuns],
  );
  const record = useMemo(() => buildRecord(stats?.find((stat) => stat.user_id === meId)), [stats, meId]);

  const historyItems = useMemo(() => historyQuery.data?.pages.flatMap((page) => page.items) ?? NO_ITEMS, [historyQuery.data]);
  const historyRows = useMemo(() => buildHistoryRows(historyItems, meId, mineOnly), [historyItems, meId, mineOnly]);

  const rules = useMemo(() => {
    // Insatserna är databaskonfiguration: verkliga tokens/utmaningar först, seed-värdena bara där inget exempel finns.
    const samples: StakeSample[] = [
      ...(my?.tokens ?? NO_ITEMS),
      ...(my?.group_active ?? NO_ITEMS),
      ...(my?.received_challenges ?? NO_ITEMS),
      ...(my?.history ?? NO_ITEMS),
      ...historyItems.map(sampleFromHistory),
    ];
    return buildTierRules(observedStakes(samples));
  }, [my, historyItems]);

  if (isDesktop === undefined) return null;
  if (!my || !stats) {
    if (myQuery.isError || statsQuery.isError) {
      return (
        <ErrorState
          title="Couldn't load the duels"
          retrying={myQuery.isFetching || statsQuery.isFetching}
          onRetry={() => {
            void myQuery.refetch();
            void statsQuery.refetch();
          }}
        />
      );
    }
    return <SkeletonRows rows={LOADING_ROWS} label="Loading duels" />;
  }

  const inLiveDuel = my.group_active.some((challenge) => challenge.challenger_id === meId || challenge.opponent_id === meId);
  const blocker = sendBlocker({ tokenCount: tokenTotal(tokenGroups), inLiveDuel, sent, incomingCount: incoming.length });
  const summary = summaryText({ live: my.group_active.length, waitingOnMe: incoming.length, tokens: tokenTotal(tokenGroups) }, isDesktop);

  const sendOpen = params.get(SEND_PARAM) === '1';
  // Öppna med en ny historikpost (back stänger sheeten); stäng med replace så back inte öppnar den igen.
  const openSend = (tier?: ChallengeTier) => {
    setTierHint(tier ?? null);
    setNotice(null);
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set(SEND_PARAM, '1');
        return next;
      },
      { state },
    );
  };
  const closeSend = () =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete(SEND_PARAM);
        next.delete(OPPONENT_PARAM);
        return next;
      },
      { replace: true, state },
    );

  const respond = async (run: () => Promise<unknown>, success: string, failure: string) => {
    setNotice(null);
    try {
      await run();
      setNotice({ tone: 'ok', text: success });
    } catch (error) {
      setNotice({ tone: 'error', text: messageOf(error, failure) });
    }
  };

  const sendChallenge = async (tokenId: string, opponentId: string) => {
    await actions.send.mutateAsync({ tokenId, opponentId });
    const opponent = names[opponentId];
    setNotice({ tone: 'ok', text: `Challenge sent${opponent ? ` to ${firstName(opponent)}` : ''}. It starts when they accept.` });
    closeSend();
  };

  const busyId = actions.accept.isPending
    ? actions.accept.variables
    : actions.decline.isPending
      ? actions.decline.variables
      : actions.withdraw.isPending
        ? actions.withdraw.variables
        : null;

  const historyStatus = historyQuery.data ? 'ready' : historyQuery.isError ? 'error' : 'loading';

  return (
    <>
      <FeatureTour slug="tour_duels_v2" steps={TOUR_DUELS_V2} />
      <DuelsLayout
        isDesktop={isDesktop}
        view={view}
        onViewChange={setView}
        summary={summary}
        notice={notice}
        blocker={blocker}
        inLiveDuel={inLiveDuel}
        onOpenSend={openSend}
        live={live}
        incoming={incoming}
        sent={sent}
        standings={standings}
        history={{
          status: historyStatus,
          rows: historyRows,
          mineOnly,
          onToggleMine: () => setMineOnly((previous) => !previous),
          hasMore: historyQuery.hasNextPage,
          loadingMore: historyQuery.isFetchingNextPage,
          onLoadMore: () => void historyQuery.fetchNextPage(),
          retrying: historyQuery.isFetching,
          onRetry: () => void historyQuery.refetch(),
        }}
        rules={rules}
        tokens={tokenGroups}
        boosts={boosts}
        record={record}
        busyId={busyId ?? null}
        onAccept={(id) => void respond(() => actions.accept.mutateAsync(id), 'Challenge accepted. It starts tomorrow.', 'Could not accept the challenge')}
        onDecline={(id) => void respond(() => actions.decline.mutateAsync(id), 'Challenge declined.', 'Could not decline the challenge')}
        onWithdraw={(id) => void respond(() => actions.withdraw.mutateAsync(id), 'Challenge withdrawn. Your token is back.', 'Could not withdraw the challenge')}
        onOpenRunner={openRunner}
      />
      {sendOpen && (
        <SendSheet
          groups={tokenGroups}
          blocker={blocker}
          members={stats}
          users={usersQuery.data}
          meId={meId}
          initialTier={tierHint}
          initialOpponent={params.get(OPPONENT_PARAM)}
          onClose={closeSend}
          onSend={sendChallenge}
        />
      )}
    </>
  );
}
