// 🏆 Challenge Routes
import { logger } from '../utils/logger.js';
import express from 'express';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';
import {
  getProgressForChallenge,
  settleChallenge,
} from '../services/challengeService.js';
import { challengeScore, compareChallengeStandings, groupNextMidnight } from '@runquest/shared';
import { buildPageMeta, fetchOffsetPage, parseOffsetPage } from '../utils/pagination.js';
import { groupIdOrRespondEmpty, tokenGroupId } from '../utils/groupScope.js';
import { recordChallengeAccepted, recordChallengeReceived, retractChallengeReceived } from '../services/activityLog.js';
import {
  CHALLENGE_HISTORY_COLUMNS,
  computeRecord,
  toChallengeHistoryItem,
  type UserSummary,
} from '../services/challengeHistory.js';
import type {
  ChallengeGroupHistoryApiResponse, ChallengeGroupStatsResponse, ChallengeProgressResponse, HeadToHeadApiResponse, MyChallengesResponse,
  RespondChallengeResponse, SendChallengeResponse, WithdrawChallengeResponse,
} from '@runquest/shared';
import { activatePendingChallenge } from '../services/challengeActivation.js';
import { BUSY_CHALLENGE_STATUSES, isRunnerBusy } from '../services/challengeBusy.js';
import { errorCode } from '../utils/errorCode.js';
import { isUuid } from '../utils/uuid.js';
import { fail, ok, okWithLegacy } from '../utils/respond.js';

const router = express.Router();

/**
 * Decline/withdraw: återställ token och spelarnas challenge_active innan utmaningen raderas (FK-ordning).
 * Returnerar första felet (supabase-js kastar inte på {error}) eller null. Båda skrivningarna är idempotenta.
 */
async function restoreAfterDecline(
  supabase: ReturnType<typeof getSupabaseClient>,
  challengeId: string,
  challengerId: string,
  opponentId: string,
): Promise<{ message: string } | null> {
  const [tokenRes, usersRes] = await Promise.all([
    supabase
      .from('user_challenge_tokens')
      .update({ sent_at: null, challenge_id: null })
      .eq('challenge_id', challengeId),
    supabase
      .from('users')
      .update({ challenge_active: false })
      .in('id', [challengerId, opponentId]),
  ]);
  return tokenRes.error ?? usersRes.error ?? null;
}

// ─── GET /api/challenges/my ──────────────────────────────────────────────────
// Returns: tokens, sent_challenge, received_challenges, boosts, history, group_active
router.get('/my', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const userId = req.user!.user_id;
    // Anroparens egna marker, utmaningar och boostar visas även utan grupp; bara gruppens pågående utmaningar kräver en.
    const groupId = tokenGroupId(req);
    const supabase = getSupabaseClient();

    const [tokensRes, activeChallengeRes, receivedRes, historyRes, boostsRes, groupActiveRes] = await Promise.all([
      // Unsent tokens — join reward for winner/loser delta display
      supabase
        .from('user_challenge_tokens')
        .select('id, tier, metric, duration_days, earned_at, reward_id, challenge_rewards(winner_delta, winner_duration, winner_type, loser_delta, loser_duration, loser_type)')
        .eq('user_id', userId)
        .is('sent_at', null)
        .order('earned_at', { ascending: false }),

      // Pending challenge where user is challenger (active ones are in group_active/Ongoing)
      supabase
        .from('challenges')
        .select('*')
        .eq('challenger_id', userId)
        .eq('status', 'pending')
        .maybeSingle(),

      // Pending challenges where user is opponent (received)
      supabase
        .from('challenges')
        .select('*')
        .eq('opponent_id', userId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),

      // Completed history (both sides)
      supabase
        .from('challenges')
        .select('*')
        .or(`challenger_id.eq.${userId},opponent_id.eq.${userId}`)
        .in('status', ['completed'])
        .order('created_at', { ascending: false })
        .limit(20),

      // Active boosts
      supabase
        .from('user_boosts')
        .select('id, challenge_id, outcome, type, delta, remaining, expires_at, created_at, start_date, end_date')
        .eq('user_id', userId),

      // All active challenges in the group (for Ongoing tab)
      groupId
        ? supabase.from('challenges').select('*').eq('group_id', groupId).eq('status', 'active')
        : Promise.resolve({ data: [] }),
    ]);

    // Flatten reward data into token objects
    const tokens = (tokensRes.data ?? []).map((t: any) => {
      const r = t.challenge_rewards ?? {};
      return {
        id: t.id,
        tier: t.tier,
        metric: t.metric,
        duration_days: t.duration_days,
        earned_at: t.earned_at,
        reward_id: t.reward_id,
        winner_delta: parseFloat(r.winner_delta ?? 0),
        winner_duration: r.winner_duration ?? 0,
        winner_type: r.winner_type ?? '',
        loser_delta: parseFloat(r.loser_delta ?? 0),
        loser_duration: r.loser_duration ?? 0,
        loser_type: r.loser_type ?? '',
      };
    });

    // Berika group_active med challenger_name och opponent_name via users-tabellen
    const rawGroupActive: any[] = groupActiveRes.data ?? [];
    let group_active = rawGroupActive;
    if (rawGroupActive.length > 0) {
      const userIds = [...new Set([
        ...rawGroupActive.map(c => c.challenger_id),
        ...rawGroupActive.map(c => c.opponent_id),
      ])];
      const { data: nameRows } = await supabase
        .from('users')
        .select('id, name')
        .in('id', userIds);
      const nameMap = new Map((nameRows ?? []).map((u: any) => [u.id, u.name]));
      group_active = rawGroupActive.map(c => ({
        ...c,
        challenger_name: nameMap.get(c.challenger_id) ?? 'Unknown',
        opponent_name: nameMap.get(c.opponent_id) ?? 'Unknown',
      }));
    }

    ok<MyChallengesResponse>(res, {
      tokens,
      sent_challenge: activeChallengeRes.data ?? null,
      received_challenges: receivedRes.data ?? [],
      boosts: boostsRes.data ?? [],
      history: historyRes.data ?? [],
      group_active,
    });
  } catch (err) {
    logger.error(`❌ Error fetching challenges (${errorCode(err)})`);
    fail(res, 500, 'Internal server error');
  }
});

// ─── POST /api/challenges/send ───────────────────────────────────────────────
// Body: { token_id, opponent_id }
router.post('/send', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const userId = req.user!.user_id;
    const groupId = tokenGroupId(req);
    const { token_id, opponent_id } = req.body;

    if (!token_id || !opponent_id) {
      fail(res, 400, 'token_id and opponent_id are required'); return;
    }
    // Före första databasfrågan: opponent_id kommer ur request-body och når aldrig ett filter som icke-uuid.
    if (!isUuid(opponent_id)) {
      fail(res, 400, 'opponent_id must be a valid uuid'); return;
    }
    if (opponent_id === userId) {
      fail(res, 400, 'You cannot challenge yourself'); return;
    }

    const supabase = getSupabaseClient();

    // Fetch token, challenger, and opponent in parallel
    const [tokenRes, challengerRes, opponentRes] = await Promise.all([
      supabase
        .from('user_challenge_tokens')
        .select('id, user_id, tier, metric, duration_days, metric_id, duration_id, reward_id, sent_at')
        .eq('id', token_id)
        .single(),
      supabase
        .from('users')
        .select('id, current_level, group_id')
        .eq('id', userId)
        .single(),
      supabase
        .from('users')
        .select('id, current_level, group_id')
        .eq('id', opponent_id)
        .single(),
    ]);

    const token = tokenRes.data;
    const challenger = challengerRes.data;
    const opponent = opponentRes.data;

    if (!token || token.user_id !== userId) {
      fail(res, 403, 'Token not found or does not belong to you'); return;
    }
    if (token.sent_at !== null) {
      fail(res, 400, 'Token has already been sent'); return;
    }
    if (!challenger) {
      fail(res, 404, 'Challenger not found'); return;
    }
    if (!opponent) {
      fail(res, 404, 'Opponent not found'); return;
    }
    // isUuid släpper igenom versaler och databasen jämför uuid skiftlägesokänsligt: kontrollera även mot det riktiga id:t.
    if (opponent.id === userId) {
      fail(res, 400, 'You cannot challenge yourself'); return;
    }
    // Fail-closed (ADR 007 A6): en token utan group_id får inte utmana någon över gruppgränsen.
    if (!groupId || opponent.group_id !== groupId) {
      fail(res, 400, 'Opponent is not in your group'); return;
    }

    // Check for existing pending or active challenges for either party
    const { data: existingChallenges } = await supabase
      .from('challenges')
      .select('id, challenger_id, opponent_id')
      .in('status', BUSY_CHALLENGE_STATUSES)
      .or(`challenger_id.eq.${userId},opponent_id.eq.${userId},challenger_id.eq.${opponent.id},opponent_id.eq.${opponent.id}`);

    const userBusy = isRunnerBusy(userId, existingChallenges);
    const opponentBusy = isRunnerBusy(opponent.id, existingChallenges);

    if (userBusy) {
      fail(res, 400, 'You already have an active or pending challenge'); return;
    }
    if (opponentBusy) {
      fail(res, 400, 'Opponent already has an active or pending challenge'); return;
    }

    // Fetch reward details
    const { data: reward } = await supabase
      .from('challenge_rewards')
      .select('winner_type, winner_delta, winner_duration, loser_type, loser_delta, loser_duration')
      .eq('id', token.reward_id)
      .single();

    if (!reward) {
      fail(res, 500, 'Failed to fetch reward config'); return;
    }

    const sentAt = new Date().toISOString();
    const legendarySentAt = token.tier === 'legendary' ? sentAt : null;

    // Create challenge
    const { data: challenge, error: challengeError } = await supabase
      .from('challenges')
      .insert({
        group_id: groupId,
        tier: token.tier,
        challenger_id: userId,
        opponent_id: opponent.id,
        metric: token.metric,
        duration_days: token.duration_days,
        winner_type: reward.winner_type,
        winner_delta: reward.winner_delta,
        winner_duration: reward.winner_duration,
        loser_type: reward.loser_type,
        loser_delta: reward.loser_delta,
        loser_duration: reward.loser_duration,
        challenger_level: challenger.current_level,
        opponent_level: opponent.current_level,
        legendary_sent_at: legendarySentAt,
      })
      .select('id')
      .single();

    if (challengeError || !challenge) {
      logger.error(`❌ Failed to create challenge (${errorCode(challengeError)})`);
      fail(res, 500, 'Failed to create challenge'); return;
    }

    // Mark token as sent + link to challenge
    const { error: tokenError } = await supabase
      .from('user_challenge_tokens')
      .update({ sent_at: sentAt, challenge_id: challenge.id })
      .eq('id', token_id);

    if (tokenError) {
      // Utmaningen utan markerad token är ett halvt utskick (token kan skickas igen): ta bort den nyss skapade raden.
      logger.error(`❌ Failed to mark token as sent (${errorCode(tokenError)})`);
      const { error: rollbackError } = await supabase.from('challenges').delete().eq('id', challenge.id);
      if (rollbackError) logger.error(`❌ Could not roll back challenge ${challenge.id} after failed token update (${errorCode(rollbackError)})`);
      fail(res, 500, 'Failed to send challenge'); return;
    }

    // Pack News (ADR 008): loggas efter insert + token-markering; icke-kastande, påverkar inte svaret.
    await recordChallengeReceived(
      {
        id: challenge.id,
        group_id: groupId,
        tier: token.tier,
        metric: token.metric,
        duration_days: token.duration_days,
        challenger_id: userId,
        opponent_id: opponent.id,
      },
      sentAt,
    );

    logger.info(`⚔️ Challenge sent: ${userId} → ${opponent.id} (${token.tier} / ${token.metric})`);

    res.status(201);
    ok<SendChallengeResponse>(res, { challenge_id: challenge.id });
  } catch (err) {
    logger.error(`❌ Error sending challenge (${errorCode(err)})`);
    fail(res, 500, 'Internal server error');
  }
});

// ─── PUT /api/challenges/:id/respond ────────────────────────────────────────
// Body: { action: 'accept' | 'decline' }
router.put('/:id/respond', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const userId = req.user!.user_id;
    const { id } = req.params;
    const { action } = req.body;

    if (!['accept', 'decline'].includes(action)) {
      fail(res, 400, 'action must be "accept" or "decline"'); return;
    }

    const supabase = getSupabaseClient();

    const { data: challenge, error } = await supabase
      .from('challenges')
      .select('*')
      .eq('id', id)
      .eq('opponent_id', userId)
      .eq('status', 'pending')
      .single();

    if (error || !challenge) {
      fail(res, 404, 'Challenge not found or already responded'); return;
    }

    if (action === 'decline') {
      if (challenge.tier === 'legendary') {
        fail(res, 400, 'Legendary challenges cannot be declined'); return;
      }

      // Restore token and reset challenge_active before deleting (FK order)
      const restoreError = await restoreAfterDecline(supabase, id, challenge.challenger_id, challenge.opponent_id);
      if (restoreError) {
        // Utmaningen raderas inte med en token som fortfarande pekar på den; båda stegen är idempotenta, så klienten kan försöka igen.
        logger.error(`❌ Failed to restore token/challenge_active for declined challenge ${id} (${errorCode(restoreError)})`);
        fail(res, 500, 'Failed to decline challenge'); return;
      }
      const { error: deleteError } = await supabase.from('challenges').delete().eq('id', id);
      // Raden i flödet tas bara bort om utmaningen faktiskt raderades — annars visar flödet en utmaning som finns.
      if (deleteError) logger.error(`❌ Failed to delete declined challenge ${id} (${errorCode(deleteError)})`);
      else await retractChallengeReceived(id);

      logger.info(`❌ Challenge ${id} declined by ${userId} — token restored to challenger`);
      okWithLegacy<RespondChallengeResponse>(res, null, { message: 'Challenge declined' }); return;
    }

    // Accept: aktivera utmaningen. Den startar vid gruppens nästa midnatt (Stockholm tills tidszon per grupp finns, RUN-21) och
    // aldrig i samma ögonblick som den accepteras; rundor från acceptansdagen räknas därför aldrig (ägarens regel 2026-10-19).
    const { day: startDate } = groupNextMidnight(new Date());
    const activation = await activatePendingChallenge(supabase, challenge, startDate);
    if (activation.outcome === 'failed') {
      const what = activation.stage === 'activate' ? 'activate challenge' : 'set challenge_active for challenge';
      logger.error(`❌ Failed to ${what} ${id} (${errorCode(activation.error)})`);
      fail(res, 500, 'Failed to accept challenge'); return;
    }
    if (activation.outcome === 'not_pending') {
      fail(res, 404, 'Challenge not found or already responded'); return;
    }
    const { endDate } = activation;

    // Efter lyckad aktivering + flagga (aldrig på revert-grenen). Icke-kastande: ett loggfel fäller aldrig accepten.
    await recordChallengeAccepted(challenge, startDate);

    logger.info(`✅ Challenge ${id} accepted. Runs ${startDate} → ${endDate}`);

    okWithLegacy<RespondChallengeResponse>(res, { start_date: startDate, end_date: endDate }, { message: 'Challenge accepted' });
  } catch (err) {
    logger.error(`❌ Error responding to challenge (${errorCode(err)})`);
    fail(res, 500, 'Internal server error');
  }
});

// ─── PUT /api/challenges/:id/withdraw ───────────────────────────────────────
// Challenger withdraws a pending challenge — restores token, resets both users
router.put('/:id/withdraw', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const userId = req.user!.user_id;
    const { id } = req.params;
    const supabase = getSupabaseClient();

    const { data: challenge, error } = await supabase
      .from('challenges')
      .select('id, tier, challenger_id, opponent_id, status')
      .eq('id', id)
      .eq('challenger_id', userId)
      .eq('status', 'pending')
      .single();

    if (error || !challenge) {
      fail(res, 404, 'Challenge not found or cannot be withdrawn'); return;
    }

    if (challenge.tier === 'legendary') {
      fail(res, 400, 'Legendary challenges cannot be withdrawn'); return;
    }

    const restoreError = await restoreAfterDecline(supabase, id, challenge.challenger_id, challenge.opponent_id);
    if (restoreError) {
      logger.error(`❌ Failed to restore token/challenge_active for withdrawn challenge ${id} (${errorCode(restoreError)})`);
      fail(res, 500, 'Failed to withdraw challenge'); return;
    }
    const { error: deleteError } = await supabase.from('challenges').delete().eq('id', id);
    if (deleteError) logger.error(`❌ Failed to delete withdrawn challenge ${id} (${errorCode(deleteError)})`);
    else await retractChallengeReceived(id);

    logger.info(`↩️ Challenge ${id} withdrawn by challenger ${userId} — token restored`);
    okWithLegacy<WithdrawChallengeResponse>(res, null, { message: 'Challenge withdrawn' });
  } catch (err) {
    logger.error(`❌ Error withdrawing challenge (${errorCode(err)})`);
    fail(res, 500, 'Internal server error');
  }
});

// ─── GET /api/challenges/group-history[?limit=&offset=] ──────────────────────
// Gruppens avslutade utmaningar, nyast först (ADR 007 B5). determine_at är avslutstiden; id är unik tie-breaker.
const GROUP_HISTORY_PAGE = { defaultLimit: 20, maxLimit: 50 };

async function fetchUserSummaries(ids: string[]): Promise<Map<string, UserSummary>> {
  const map = new Map<string, UserSummary>();
  if (ids.length === 0) return map;
  const { data, error } = await getSupabaseClient()
    .from('users')
    .select('id, name, profile_picture')
    .in('id', ids);
  if (error) throw error;
  for (const u of data ?? []) map.set(u.id, { name: u.name, profile_picture: u.profile_picture ?? null });
  return map;
}

router.get('/group-history', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const page = parseOffsetPage(req.query, GROUP_HISTORY_PAGE);
    if (!page.ok) { fail(res, 400, page.error); return; }
    const { limit, offset } = page;

    const groupId = groupIdOrRespondEmpty(req, res, { success: true, data: { items: [] }, meta: buildPageMeta(0, limit, offset) } satisfies ChallengeGroupHistoryApiResponse);
    if (!groupId) return;

    const supabase = getSupabaseClient();
    const { rows, total } = await fetchOffsetPage(
      (head) => supabase
        .from('challenges')
        .select(CHALLENGE_HISTORY_COLUMNS, { count: 'exact', head })
        .eq('group_id', groupId)
        .eq('status', 'completed')
        .order('determine_at', { ascending: false })
        .order('id', { ascending: false }),
      limit,
      offset,
    );

    const userIds = [...new Set(rows.flatMap((c: any) => [c.challenger_id, c.opponent_id]))];
    const users = await fetchUserSummaries(userIds);

    ok<ChallengeGroupHistoryApiResponse>(res, { items: rows.map((c: any) => toChallengeHistoryItem(c, users)) }, buildPageMeta(total, limit, offset));
  } catch (err) {
    logger.error(`❌ Error fetching challenge group history (${errorCode(err)})`);
    fail(res, 500, 'Internal server error');
  }
});

// ─── GET /api/challenges/head-to-head/:userId[?limit=] ───────────────────────
// Anroparens uppgörelser mot en annan gruppmedlem (ADR 007 B6).
const HEAD_TO_HEAD_MAX_LIMIT = 20;

router.get('/head-to-head/:userId', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const me = req.user!.user_id;
    const otherId = req.params.userId;

    if (!isUuid(otherId)) { fail(res, 400, 'userId must be a valid uuid'); return; }
    if (otherId === me) { fail(res, 400, 'Cannot compare with yourself'); return; }

    const page = parseOffsetPage({ limit: req.query.limit }, { defaultLimit: 5, maxLimit: HEAD_TO_HEAD_MAX_LIMIT });
    if (!page.ok) { fail(res, 400, page.error); return; }

    // Samma svar för "finns inte" och "annan grupp" — läcker inte existens.
    const notFound = () => fail(res, 404, 'User not found');
    const groupId = tokenGroupId(req);
    if (!groupId) { notFound(); return; }

    const supabase = getSupabaseClient();
    const { data: members, error: membersError } = await supabase
      .from('users')
      .select('id, name, profile_picture')
      .eq('group_id', groupId)
      .in('id', [me, otherId]);
    if (membersError) throw membersError;

    const summaries = new Map<string, UserSummary>((members ?? []).map((u: any) => [u.id, { name: u.name, profile_picture: u.profile_picture ?? null }]));
    if (!summaries.has(otherId) || !summaries.has(me)) { notFound(); return; }

    // challenger ≠ opponent, så "båda i paret" på båda kolumnerna ger exakt de två orienteringarna.
    // Ett par har få uppgörelser; hela listan hämtas så att record täcker alla (ingen 1000-radersrisk i praktiken).
    const [completedResult, openResult] = await Promise.all([
      supabase
        .from('challenges')
        .select(CHALLENGE_HISTORY_COLUMNS)
        .eq('group_id', groupId)
        .eq('status', 'completed')
        .in('challenger_id', [me, otherId])
        .in('opponent_id', [me, otherId])
        .order('determine_at', { ascending: false })
        .order('id', { ascending: false }),
      supabase
        .from('challenges')
        .select('id, status, challenger_id')
        .eq('group_id', groupId)
        .in('status', ['pending', 'active'])
        .in('challenger_id', [me, otherId])
        .in('opponent_id', [me, otherId])
        .limit(1),
    ]);
    if (completedResult.error) throw completedResult.error;
    if (openResult.error) throw openResult.error;

    const completed: any[] = completedResult.data ?? [];
    const open = openResult.data?.[0] ?? null;
    const other = summaries.get(otherId)!;

    ok<HeadToHeadApiResponse>(res, {
      opponent: { id: otherId, name: other.name, profile_picture: other.profile_picture },
      record: computeRecord(completed, me),
      history: completed.slice(0, page.limit).map((c) => toChallengeHistoryItem(c, summaries)),
      active: open ? { id: open.id, status: open.status, challenger_id: open.challenger_id } : null,
    });
  } catch (err) {
    logger.error(`❌ Error fetching head-to-head (${errorCode(err)})`);
    fail(res, 500, 'Internal server error');
  }
});

// ─── GET /api/challenges/:id/progress ───────────────────────────────────────
router.get('/:id/progress', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const supabase = getSupabaseClient();

    // Verify user is part of this challenge
    const { data: challenge } = await supabase
      .from('challenges')
      .select('challenger_id, opponent_id, status, metric, start_date, end_date, determine_at')
      .eq('id', id)
      .single();

    if (!challenge) {
      fail(res, 404, 'Challenge not found'); return;
    }

    // Auto-settle if past determine_at
    if (
      challenge.status === 'active' &&
      challenge.determine_at &&
      new Date(challenge.determine_at) <= new Date()
    ) {
      // Avgörandet är schedulerns jobb i första hand; ett fel här (loggat av settleChallenge) fäller inte läsningen —
      // utmaningen är kvar som active och tas om vid nästa körning.
      try {
        await settleChallenge(id);
      } catch (settleError) {
        logger.error(`❌ Auto-settle of challenge ${id} failed (${errorCode(settleError)})`);
      }
    }

    const progress = await getProgressForChallenge(id);

    ok<ChallengeProgressResponse>(res, {
      challenge_id: id,
      metric: challenge.metric,
      start_date: challenge.start_date,
      end_date: challenge.end_date,
      progress: progress ?? [],
    });
  } catch (err) {
    logger.error(`❌ Error fetching challenge progress (${errorCode(err)})`);
    fail(res, 500, 'Internal server error');
  }
});

// ─── GET /api/challenges/group-stats ────────────────────────────────────────
// W/D/L leaderboard for all users in the group
router.get('/group-stats', authenticateJWT, async (req, res): Promise<void> => {
  try {
    // Saknad group_id ger tom data, aldrig alla grupper (ADR 007 A6)
    const groupId = groupIdOrRespondEmpty(req, res);
    if (!groupId) return;

    const supabase = getSupabaseClient();

    const [{ data: users, error }, { data: pendingChallenges }] = await Promise.all([
      supabase
        .from('users')
        .select('id, name, wins, draws, losses, challenge_active, current_level, profile_picture')
        .eq('group_id', groupId),
      supabase
        .from('challenges')
        .select('challenger_id, opponent_id')
        .eq('group_id', groupId)
        .eq('status', 'pending'),
    ]);

    if (error) {
      logger.error(`❌ Error fetching group stats (${errorCode(error)})`);
      fail(res, 500, 'Failed to fetch group stats'); return;
    }

    // Samma komparator som rank_passed (ADR 011 beslut 6, Ö8): tabellen och notiserna kan aldrig skilja sig åt. Sorteringen sker på
    // råa W/D/L (oavrundade poäng); den avrundade `points` i svaret är bara visning.
    const ordered = [...(users ?? [])].sort((a: any, b: any) =>
      compareChallengeStandings(
        { id: a.id, name: a.name, wins: a.wins, draws: a.draws, losses: a.losses },
        { id: b.id, name: b.name, wins: b.wins, draws: b.draws, losses: b.losses },
      ));

    const stats = ordered.map((u: any) => {
      const total = u.wins + u.draws + u.losses;
      return {
        user_id: u.id,
        name: u.name,
        wins: u.wins,
        draws: u.draws,
        losses: u.losses,
        total,
        points: Math.round(challengeScore(u.wins, u.draws, u.losses) * 1000) / 1000,
        challenge_active: u.challenge_active,
        // Samma regel som POST /send avvisar på. Aktiva dueller flaggas redan av challenge_active, som en accept och legendary-autostarten sätter för båda sidor.
        has_pending_challenge: isRunnerBusy(u.id, pendingChallenges),
        current_level: u.current_level,
        profile_picture: u.profile_picture ?? null,
      };
    });

    ok<ChallengeGroupStatsResponse>(res, stats);
  } catch (err) {
    logger.error(`❌ Error fetching group stats (${errorCode(err)})`);
    fail(res, 500, 'Internal server error');
  }
});

export default router;
