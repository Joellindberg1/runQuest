// 🏅 Badge Routes (ADR 009 beslut 4 och 9) — läs-API för användarnas badges.
// Nya endpoints enligt ADR 007 A: { success, data, meta? } / { error }, snake_case, kontrakt i shared/contracts.
// Gruppavgränsat från dag ett: ett mål utanför anroparens grupp ger 404 med samma body som ett obefintligt
// (ingen existensläcka). Tabellen user_badges har ingen anon-/authenticated-åtkomst — läsning sker bara här
// (service role). Skrivvägarna (PUT /showcase, POST /seen) läggs i samma fil av RUN-121.
import express from 'express';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import {
  BADGE_SERIES,
  countHolders,
  resolveShowcase,
  type BadgeGroupApiResponse,
  type BadgeUserApiResponse,
  type BadgeUserItem,
} from '@runquest/shared';

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Serienas ordning i koden = visningsordningen i svaret (radordningen i databasen är ointressant).
 * Byggs vid första anropet, inte vid import: flera route-tester ersätter @runquest/shared med en
 * partiell mock, och app.ts importerar den här filen i alla.
 */
let seriesOrder: ReadonlyMap<string, number> | null = null;
function getSeriesOrder(): ReadonlyMap<string, number> {
  seriesOrder ??= new Map(BADGE_SERIES.map((series, index) => [series.key as string, index]));
  return seriesOrder;
}

interface BadgeRow {
  series: string;
  tier: number;
  earned_at?: string;
  seen_tier?: number;
}

/** Rader för serier koden inte känner till (t.ex. en framtida serie) kan klienten inte rendera. */
const isKnownSeries = (row: { series: string }): boolean => getSeriesOrder().has(row.series);

// GET /api/badges/user/:userId
// seen_tier (popup-vattenmärket) är anroparens egen state och returneras därför bara för anroparen själv.
// Anroparens egen profil är alltid tillgänglig, även med en token utan group_id (inaktuell efter groups/join,
// STATE zon 8) — det är hens egna data.
router.get('/user/:userId', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const me = req.user!.user_id;
    const targetId = req.params.userId;
    if (!UUID_RE.test(targetId)) { res.status(400).json({ error: 'userId must be a valid uuid' }); return; }

    // Samma svar för "finns inte" och "annan grupp".
    const notFound = () => res.status(404).json({ error: 'User not found' });
    const groupId = req.user!.group_id;
    const isSelf = targetId === me;

    const supabase = getSupabaseClient();
    const { data: target, error: targetError } = await supabase
      .from('users')
      .select('id, group_id, displayed_badge_series')
      .eq('id', targetId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) { notFound(); return; }
    if (!isSelf && !(groupId && target.group_id === groupId)) { notFound(); return; }

    const { data: rows, error: badgesError } = await supabase
      .from('user_badges')
      .select(isSelf ? 'series, tier, earned_at, seen_tier' : 'series, tier, earned_at')
      .eq('user_id', targetId);
    if (badgesError) throw badgesError;

    const owned = ((rows ?? []) as unknown as BadgeRow[])
      .filter(isKnownSeries)
      .sort((a, b) => getSeriesOrder().get(a.series)! - getSeriesOrder().get(b.series)!);

    const items: BadgeUserItem[] = owned.map((row) => ({
      series: row.series,
      tier: row.tier,
      earned_at: row.earned_at as string,
      ...(isSelf ? { seen_tier: row.seen_tier ?? 0 } : {}),
    }));
    const showcase = resolveShowcase(target.displayed_badge_series, new Map(owned.map((r) => [r.series, r.tier])))
      .map((entry) => entry.series);

    const body: BadgeUserApiResponse = { success: true, data: { items, showcase } };
    res.json(body);
  } catch (error) {
    logger.error('❌ Error fetching user badges:', error);
    res.status(500).json({ error: 'Failed to fetch badges' });
  }
});

// GET /api/badges/group
// Alla medlemmars valda badges (Board-rader) + gruppräkning "hålls av n" per serie och tier. EN query mot
// user_badges för hela gruppen, ingen N+1. Ingen grupp i token ger tom data — aldrig någon annans grupp.
router.get('/group', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const groupId = req.user!.group_id;
    if (!groupId) {
      const empty: BadgeGroupApiResponse = {
        success: true,
        data: { members: [], holders: countHolders([]) },
        meta: { member_count: 0 },
      };
      res.json(empty); return;
    }

    const supabase = getSupabaseClient();
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, displayed_badge_series')
      .eq('group_id', groupId)
      .order('id', { ascending: true });
    if (usersError) throw usersError;

    const members = users ?? [];
    let rows: BadgeRow[] = [];
    if (members.length > 0) {
      const { data: badges, error: badgesError } = await supabase
        .from('user_badges')
        .select('user_id, series, tier')
        .in('user_id', members.map((m: any) => m.id));
      if (badgesError) throw badgesError;
      rows = ((badges ?? []) as unknown as Array<BadgeRow & { user_id: string }>).filter(isKnownSeries);
    }

    const ownedByUser = new Map<string, Map<string, number>>();
    for (const row of rows as Array<BadgeRow & { user_id: string }>) {
      const owned = ownedByUser.get(row.user_id) ?? new Map<string, number>();
      owned.set(row.series, row.tier);
      ownedByUser.set(row.user_id, owned);
    }

    const body: BadgeGroupApiResponse = {
      success: true,
      data: {
        members: members.map((m: any) => ({
          user_id: m.id,
          showcase: resolveShowcase(m.displayed_badge_series, ownedByUser.get(m.id) ?? new Map()),
        })),
        holders: countHolders(rows),
      },
      meta: { member_count: members.length },
    };
    res.json(body);
  } catch (error) {
    logger.error('❌ Error fetching group badges:', error);
    res.status(500).json({ error: 'Failed to fetch badges' });
  }
});

export default router;
