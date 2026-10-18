// 🏆 Challenge Routes
import { logger } from '../utils/logger.js';
import express from 'express';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';
import {
  getProgressForChallenge,
  settleChallenge,
} from '../services/challengeService.js';
import { addDays, challengeScore, compareChallengeStandings } from '@runquest/shared';
import { tomorrowStockholm, at3amStockholm } from '../utils/dateUtils.js';
import { buildPageMeta, fetchOffsetPage, parseOffsetPage } from '../utils/pagination.js';
import { groupIdOrRespondEmpty } from '../utils/groupScope.js';
import { recordChallengeAccepted, recordChallengeReceived, retractChallengeReceived } from '../services/activityLog.js';
import {
  CHALLENGE_HISTORY_COLUMNS,
  computeRecord,
  toChallengeHistoryItem,
  type UserSummary,
} from '../services/challengeHistory.js';
import type { ChallengeGroupHistoryApiResponse, HeadToHeadApiResponse } from '@runquest/shared';
import { errorCode } from '../utils/errorCode.js';
import { isUuid } from '../utils/uuid.js';

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
    const groupId = req.user!.group_id;
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
        .select('id, challenge_id, outcome, type, delta, remaining, expires_at, created_at')
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

    res.json({
      success: true,
      data: {
        tokens,
        sent_challenge: activeChallengeRes.data ?? null,
        received_challenges: receivedRes.data ?? [],
        boosts: boostsRes.data ?? [],
        history: historyRes.data ?? [],
        group_active,
      },
    });
  } catch (err) {
    logger.error(`❌ Error fetching challenges (${errorCode(err)})`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/challenges/send ───────────────────────────────────────────────
// Body: { token_id, opponent_id }
router.post('/send', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const userId = req.user!.user_id;
    const groupId = req.user!.group_id;
    const { token_id, opponent_id } = req.body;

    if (!token_id || !opponent_id) {
      res.status(400).json({ error: 'token_id and opponent_id are required' }); return;
    }
    // Före första databasfrågan: opponent_id kommer ur request-body och når aldrig ett filter som icke-uuid.
    if (!isUuid(opponent_id)) {
      res.status(400).json({ error: 'opponent_id must be a valid uuid' }); return;
    }
    if (opponent_id === userId) {
      res.status(400).json({ error: 'You cannot challenge yourself' }); return;
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
      res.status(403).json({ error: 'Token not found or does not belong to you' }); return;
    }
    if (token.sent_at !== null) {
      res.status(400).json({ error: 'Token has already been sent' }); return;
    }
    if (!challenger) {
      res.status(404).json({ error: 'Challenger not found' }); return;
    }
    if (!opponent) {
      res.status(404).json({ error: 'Opponent not found' }); return;
    }
    // isUuid släpper igenom versaler och databasen jämför uuid skiftlägesokänsligt: kontrollera även mot det riktiga id:t.
    if (opponent.id === userId) {
      res.status(400).json({ error: 'You cannot challenge yourself' }); return;
    }
    // Fail-closed (ADR 007 A6): en token utan group_id får inte utmana någon över gruppgränsen.
    if (!groupId || opponent.group_id !== groupId) {
      res.status(400).json({ error: 'Opponent is not in your group' }); return;
    }

    // Check for existing pending or active challenges for either party
    const { data: existingChallenges } = await supabase
      .from('challenges')
      .select('id, challenger_id, opponent_id')
      .in('status', ['pending', 'active'])
      .or(`challenger_id.eq.${userId},opponent_id.eq.${userId},challenger_id.eq.${opponent.id},opponent_id.eq.${opponent.id}`);

    const userBusy = existingChallenges?.some(
      (c: { id: string; challenger_id: string; opponent_id: string }) =>
        c.challenger_id === userId || c.opponent_id === userId
    );
    const opponentBusy = existingChallenges?.some(
      (c: { id: string; challenger_id: string; opponent_id: string }) =>
        c.challenger_id === opponent.id || c.opponent_id === opponent.id
    );

    if (userBusy) {
      res.status(400).json({ error: 'You already have an active or pending challenge' }); return;
    }
    if (opponentBusy) {
      res.status(400).json({ error: 'Opponent already has an active or pending challenge' }); return;
    }

    // Fetch reward details
    const { data: reward } = await supabase
      .from('challenge_rewards')
      .select('winner_type, winner_delta, winner_duration, loser_type, loser_delta, loser_duration')
      .eq('id', token.reward_id)
      .single();

    if (!reward) {
      res.status(500).json({ error: 'Failed to fetch reward config' }); return;
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
      res.status(500).json({ error: 'Failed to create challenge' }); return;
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
      res.status(500).json({ error: 'Failed to send challenge' }); return;
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
        opponent_id,
      },
      sentAt,
    );

    logger.info(`⚔️ Challenge sent: ${userId} → ${opponent_id} (${token.tier} / ${token.metric})`);

    res.status(201).json({ success: true, data: { challenge_id: challenge.id } });
  } catch (err) {
    logger.error(`❌ Error sending challenge (${errorCode(err)})`);
    res.status(500).json({ error: 'Internal server error' });
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
      res.status(400).json({ error: 'action must be "accept" or "decline"' }); return;
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
      res.status(404).json({ error: 'Challenge not found or already responded' }); return;
    }

    if (action === 'decline') {
      if (challenge.tier === 'legendary') {
        res.status(400).json({ error: 'Legendary challenges cannot be declined' }); return;
      }

      // Restore token and reset challenge_active before deleting (FK order)
      const restoreError = await restoreAfterDecline(supabase, id, challenge.challenger_id, challenge.opponent_id);
      if (restoreError) {
        // Utmaningen raderas inte med en token som fortfarande pekar på den; båda stegen är idempotenta, så klienten kan försöka igen.
        logger.error(`❌ Failed to restore token/challenge_active for declined challenge ${id} (${errorCode(restoreError)})`);
        res.status(500).json({ error: 'Failed to decline challenge' }); return;
      }
      const { error: deleteError } = await supabase.from('challenges').delete().eq('id', id);
      // Raden i flödet tas bara bort om utmaningen faktiskt raderades — annars visar flödet en utmaning som finns.
      if (deleteError) logger.error(`❌ Failed to delete declined challenge ${id} (${errorCode(deleteError)})`);
      else await retractChallengeReceived(id);

      logger.info(`❌ Challenge ${id} declined by ${userId} — token restored to challenger`);
      res.json({ success: true, message: 'Challenge declined' }); return;
    }

    // Accept: activate challenge — always starts next midnight Stockholm time
    const startDate = tomorrowStockholm();
    const endDate = addDays(startDate, challenge.duration_days);
    const determineAt = at3amStockholm(addDays(startDate, challenge.duration_days + 1)).toISOString();

    // Sekventiellt: utmaningen aktiveras först, spelarnas flagga efteråt. Misslyckas flaggan släpps aktiveringen
    // (tillbaka till pending), så utmaningen aldrig lämnas aktiv medan spelarna inte räknas som upptagna.
    // Villkorad på status = pending + radräkning: raderar en decline/withdraw/auto-decline utmaningen mellan läsningen
    // ovan och denna skrivning träffar updaten 0 rader utan fel — då får varken flaggor eller loggrad sättas.
    const { data: activated, error: activateError } = await supabase
      .from('challenges')
      .update({ status: 'active', start_date: startDate, end_date: endDate, determine_at: determineAt })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id');
    if (activateError) {
      logger.error(`❌ Failed to activate challenge ${id} (${errorCode(activateError)})`);
      res.status(500).json({ error: 'Failed to accept challenge' }); return;
    }
    // supabase-js ger alltid en array efter .select() utan fel; en tom array = ingen rad aktiverades.
    if (Array.isArray(activated) && activated.length === 0) {
      res.status(404).json({ error: 'Challenge not found or already responded' }); return;
    }

    const { error: flagError } = await supabase
      .from('users')
      .update({ challenge_active: true })
      .in('id', [challenge.challenger_id, challenge.opponent_id]);
    if (flagError) {
      logger.error(`❌ Failed to set challenge_active for challenge ${id} (${errorCode(flagError)})`);
      const { error: revertError } = await supabase
        .from('challenges')
        .update({ status: 'pending', start_date: null, end_date: null, determine_at: null })
        .eq('id', id);
      if (revertError) logger.error(`❌ Could not revert activation of challenge ${id} (${errorCode(revertError)})`);
      res.status(500).json({ error: 'Failed to accept challenge' }); return;
    }

    // Efter lyckad aktivering + flagga (aldrig på revert-grenen). Icke-kastande: ett loggfel fäller aldrig accepten.
    await recordChallengeAccepted(challenge, startDate);

    logger.info(`✅ Challenge ${id} accepted. Runs ${startDate} → ${endDate}`);

    res.json({ success: true, message: 'Challenge accepted', data: { start_date: startDate, end_date: endDate } });
  } catch (err) {
    logger.error(`❌ Error responding to challenge (${errorCode(err)})`);
    res.status(500).json({ error: 'Internal server error' });
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
      res.status(404).json({ error: 'Challenge not found or cannot be withdrawn' }); return;
    }

    if (challenge.tier === 'legendary') {
      res.status(400).json({ error: 'Legendary challenges cannot be withdrawn' }); return;
    }

    const restoreError = await restoreAfterDecline(supabase, id, challenge.challenger_id, challenge.opponent_id);
    if (restoreError) {
      logger.error(`❌ Failed to restore token/challenge_active for withdrawn challenge ${id} (${errorCode(restoreError)})`);
      res.status(500).json({ error: 'Failed to withdraw challenge' }); return;
    }
    const { error: deleteError } = await supabase.from('challenges').delete().eq('id', id);
    if (deleteError) logger.error(`❌ Failed to delete withdrawn challenge ${id} (${errorCode(deleteError)})`);
    else await retractChallengeReceived(id);

    logger.info(`↩️ Challenge ${id} withdrawn by challenger ${userId} — token restored`);
    res.json({ success: true, message: 'Challenge withdrawn' });
  } catch (err) {
    logger.error(`❌ Error withdrawing challenge (${errorCode(err)})`);
    res.status(500).json({ error: 'Internal server error' });
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
    if (!page.ok) { res.status(400).json({ error: page.error }); return; }
    const { limit, offset } = page;

    const groupId = req.user!.group_id;
    if (!groupId) {
      const empty: ChallengeGroupHistoryApiResponse = { success: true, data: { items: [] }, meta: buildPageMeta(0, limit, offset) };
      res.json(empty); return;
    }

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

    const body: ChallengeGroupHistoryApiResponse = {
      success: true,
      data: { items: rows.map((c: any) => toChallengeHistoryItem(c, users)) },
      meta: buildPageMeta(total, limit, offset),
    };
    res.json(body);
  } catch (err) {
    logger.error(`❌ Error fetching challenge group history (${errorCode(err)})`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/challenges/head-to-head/:userId[?limit=] ───────────────────────
// Anroparens uppgörelser mot en annan gruppmedlem (ADR 007 B6).
const HEAD_TO_HEAD_MAX_LIMIT = 20;

router.get('/head-to-head/:userId', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const me = req.user!.user_id;
    const otherId = req.params.userId;

    if (!isUuid(otherId)) { res.status(400).json({ error: 'userId must be a valid uuid' }); return; }
    if (otherId === me) { res.status(400).json({ error: 'Cannot compare with yourself' }); return; }

    const page = parseOffsetPage({ limit: req.query.limit }, { defaultLimit: 5, maxLimit: HEAD_TO_HEAD_MAX_LIMIT });
    if (!page.ok) { res.status(400).json({ error: page.error }); return; }

    // Samma svar för "finns inte" och "annan grupp" — läcker inte existens.
    const notFound = () => res.status(404).json({ error: 'User not found' });
    const groupId = req.user!.group_id;
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

    const body: HeadToHeadApiResponse = {
      success: true,
      data: {
        opponent: { id: otherId, name: other.name, profile_picture: other.profile_picture },
        record: computeRecord(completed, me),
        history: completed.slice(0, page.limit).map((c) => toChallengeHistoryItem(c, summaries)),
        active: open ? { id: open.id, status: open.status, challenger_id: open.challenger_id } : null,
      },
    };
    res.json(body);
  } catch (err) {
    logger.error(`❌ Error fetching head-to-head (${errorCode(err)})`);
    res.status(500).json({ error: 'Internal server error' });
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
      res.status(404).json({ error: 'Challenge not found' }); return;
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

    res.json({
      success: true,
      data: {
        challenge_id: id,
        metric: challenge.metric,
        start_date: challenge.start_date,
        end_date: challenge.end_date,
        progress: progress ?? [],
      },
    });
  } catch (err) {
    logger.error(`❌ Error fetching challenge progress (${errorCode(err)})`);
    res.status(500).json({ error: 'Internal server error' });
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
      res.status(500).json({ error: 'Failed to fetch group stats' }); return;
    }

    // Only flag the sender (challenger) — a receiver can still accept other challenges
    const pendingChallengerIds = new Set<string>();
    (pendingChallenges ?? []).forEach((c: any) => {
      pendingChallengerIds.add(c.challenger_id);
    });

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
        has_pending_challenge: pendingChallengerIds.has(u.id),
        current_level: u.current_level,
        profile_picture: u.profile_picture ?? null,
      };
    });

    res.json({ success: true, data: stats });
  } catch (err) {
    logger.error(`❌ Error fetching group stats (${errorCode(err)})`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
