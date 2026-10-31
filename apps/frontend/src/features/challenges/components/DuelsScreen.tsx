import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { DUELS_TOUR_SLUG } from '@runquest/shared';
import { useIsDesktop } from '@/app-shell/useIsDesktop';
import { useNow } from '@/app-shell/useNow';
import { FeatureTour } from '@/features/onboarding/components/FeatureTour';
import { TOUR_DUELS_V2 } from '@/features/onboarding/featureTourSteps';
import { OPPONENT_PARAM, SEND_PARAM } from '@/paths';
import { useAuth } from '@/providers/authContext';
import { ErrorState } from '@/shared/components/ErrorState';
import { SkeletonRows } from '@/shared/components/loaders/SkeletonRows';
import { readSendOrigin, withoutSendOrigin, type FocusRunnerState } from '@/shared/hooks/routeState';
import { useOpenRunner } from '@/shared/hooks/useOpenRunner';
import { useUsersWithRuns } from '@/shared/hooks/useUsersWithRuns';
import { useViewParam } from '@/shared/hooks/useViewParam';
import { historyIdx } from '@/shared/utils/historyIdx';
import { requestRunnerFocus } from '@/shared/utils/runnerFocusIntent';
import { firstName } from '@/shared/utils/format';
import {
  DEFAULT_DUELS_VIEW, DUELS_VIEWS, buildBoosts, buildHistoryRows, buildIncoming, buildLiveCards, buildRecord, buildSent, buildStandings,
  buildTokenGroups, nameMap, summaryText, tokenTotal,
} from '../duelsModel';
import { useChallengeActions } from '../hooks/useChallengeActions';
import { useGroupHistory, useGroupStats, useLiveProgress, useMyChallenges } from '../hooks/useDuelsQueries';
import { buildTierRules, observedStakes, sampleFromHistory, type StakeSample } from '../rulesModel';
import { sendBlocker, startRuleSentence, type SendPreselection } from '../sendModel';
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
  const navigate = useNavigate();
  const { state } = useLocation();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useViewParam(DUELS_VIEWS, DEFAULT_DUELS_VIEW);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [preselection, setPreselection] = useState<SendPreselection | null>(null);
  const [mineOnly, setMineOnly] = useState(false);

  const meId = user?.id ?? '';
  const enabled = !!user;
  const myQuery = useMyChallenges(enabled);
  const statsQuery = useGroupStats(enabled);
  const usersQuery = useUsersWithRuns(enabled);
  const historyQuery = useGroupHistory(enabled && view === 'history');
  const actions = useChallengeActions();

  const sendOpen = params.get(SEND_PARAM) === '1';
  // Identiteten på send-arket som är öppet just nu (null: inget öppet, eller skärmen är borta). Ett skick som är på väg när webbläsarens Back stänger arket (eller tar användaren
  // från skärmen) får sitt svar efteråt, och då får det varken stänga ett ark som inte längre är dess eget eller navigera: en ny `setParams` på en avmonterad skärm skulle annars
  // föra användaren tillbaka till /duels.
  const openSheet = useRef<symbol | null>(null);
  useEffect(() => {
    if (!sendOpen) return;
    openSheet.current = Symbol('send sheet');
    return () => { openSheet.current = null; };
  }, [sendOpen]);

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

  // Förvalet gäller bara medan sheeten som det öppnades för är öppen. Webbläsarens Back stänger sheeten utan att closeSend körs, och en senare ingång som bara byter
  // adress (?send=1, popupens Challenge, Forward) ska inte ärva det: därför nollställs det så fort sheeten inte är öppen (set-state-under-render, React-mönstret för härlett tillstånd).
  if (!sendOpen && preselection !== null) setPreselection(null);
  // Ursprunget (sidan under löparens popup) gäller bara flödet som popupens Challenge öppnade. Det får inte ligga kvar efter ett skick (`closeSend` tömmer det):
  // annars skulle ett senare Cancel hoppa till en gammal bakgrundssida.
  const origin = readSendOrigin(state);
  const stateWithoutOrigin = withoutSendOrigin(state);
  // Öppna med en ny historikpost (back stänger sheeten); stäng med replace så back inte öppnar den igen.
  const openSend = (next?: SendPreselection) => {
    setPreselection(next ?? null);
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
  // Stängning utan att gå till en annan sida: efter ett skick och för flöden utan ursprung.
  const closeSend = () => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete(SEND_PARAM);
        next.delete(OPPONENT_PARAM);
        return next;
      },
      { replace: true, state: stateWithoutOrigin },
    );
  };
  // Avbrutet (Cancel, ✕, Esc, skrim, Close i det blockerade läget). Med ursprung går vi tillbaka till sidan under popupen och skalet fokuserar löparens rad.
  // Ligger den en post bakåt (indexet som popupen skickade stämmer med var vi är) går vi ett steg bakåt: historiken får ingen ny post, och fokusavsikten bärs i minnet eftersom
  // `navigate(-1)` inte kan bära route-state. Går det inte att avgöra (djuplänk, ny flik, historiken ändrad) ersätter vi send-flödets post med sidan, och avsikten bärs av route-state.
  const cancelSend = () => {
    if (!origin) {
      closeSend();
      return;
    }
    if (origin.returnIdx !== undefined && historyIdx() === origin.returnIdx + 1) {
      requestRunnerFocus(origin.runnerId);
      navigate(-1);
      return;
    }
    navigate(origin.returnTo, { replace: true, state: { focusRunnerId: origin.runnerId } satisfies FocusRunnerState });
  };

  const respond = async (run: () => Promise<unknown>, success: string, failure: string) => {
    setNotice(null);
    try {
      await run();
      setNotice({ tone: 'ok', text: success });
    } catch (error) {
      setNotice({ tone: 'error', text: messageOf(error, failure) });
    }
  };

  // Avgörs skicket medan arket det skickades från fortfarande är öppet visar arket felet och `closeSend` stänger det efter ett lyckat skick. Har Back stängt arket under tiden finns ingen
  // yta för utfallet utom sidan: skärmen visar då utfallet som bekräftelse eller fel, och stänger inget. Är skärmen borta (Back lämnade /duels) syns inget, och omhämtningen som
  // mutationen själv gör (`useChallengeActions`) visar en skapad utmaning på nästa besök. Inget andra skick och ingen andra bekräftelse: svaret hanteras en gång, här.
  const sendChallenge = async (tokenKey: string, opponentId: string) => {
    const sheet = openSheet.current;
    const sheetIsOpen = () => sheet !== null && openSheet.current === sheet;
    try {
      await actions.send.mutateAsync({ tokenId: tokenKey, opponentId });
    } catch (error) {
      if (!sheetIsOpen()) setNotice({ tone: 'error', text: messageOf(error, 'Could not send the challenge') });
      throw error;
    }
    const opponent = names[opponentId];
    // Nivån läses ur tokengrupperna från före skicket (tokenet är borta efter omhämtningen); bekräftelsen säger samma startregel som "The bet".
    const tier = tokenGroups.find((group) => group.cards.some((card) => card.tokenKey === tokenKey))?.tier ?? 'minor';
    setNotice({ tone: 'ok', text: `Challenge sent${opponent ? ` to ${firstName(opponent)}` : ''}. ${startRuleSentence(tier)}` });
    if (sheetIsOpen()) closeSend();
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
      <FeatureTour slug={DUELS_TOUR_SLUG} steps={TOUR_DUELS_V2} />
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
          preselection={preselection}
          initialOpponent={params.get(OPPONENT_PARAM)}
          cancelFocus={origin ? 'page' : 'opener'}
          originRunnerId={origin?.runnerId}
          onClose={cancelSend}
          onSend={sendChallenge}
        />
      )}
    </>
  );
}
