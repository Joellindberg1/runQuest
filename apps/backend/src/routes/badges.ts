// 🏅 Badge Routes (ADR 009 beslut 4 och 9) — läs-API för användarnas badges.
// Nya endpoints enligt ADR 007 A: { success, data, meta? } / { error }, snake_case, kontrakt i shared/contracts.
// Gruppavgränsat från dag ett: ett mål utanför anroparens grupp ger 404 med samma body som ett obefintligt
// (ingen existensläcka). Tabellen user_badges har ingen anon-/authenticated-åtkomst — läsning sker bara här
// (service role). Skrivvägarna (PUT /showcase, POST /seen, RUN-121) rör bara anroparens egna rader.
import express from 'express';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import {
  BADGE_SERIES,
  MAX_SHOWCASE,
  countHolders,
  resolveShowcase,
  type BadgeGroupApiResponse,
  type BadgeUserApiResponse,
  type BadgeUserItem,
  type SeenApiResponse,
  type ShowcaseApiResponse,
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

/** `series` i en request-body: en array av strängar, annars null (ogiltigt). */
function parseSeriesList(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((s) => typeof s === 'string')) return null;
  return value as string[];
}

// PUT /api/badges/showcase
// Servern är sanningen för valet (UI:t visar bara): ≤ 3, unika, kända och ÄGDA av anroparen, annars 400.
// En enda update av anroparens egen rad (som displayed_title_ids). Äger man inte serien längre när
// läsvägen kör, skär resolveShowcase bort den — en rad som raderas efter valideringen ger alltså aldrig
// ett felaktigt svar, och evaluateBadges rensar arrayen.
router.put('/showcase', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const me = req.user!.user_id;
    const series = parseSeriesList(req.body?.series);
    if (!series) { res.status(400).json({ error: 'series must be an array of badge series keys' }); return; }
    if (series.length > MAX_SHOWCASE) {
      res.status(400).json({ error: `series may contain at most ${MAX_SHOWCASE} entries` }); return;
    }
    if (new Set(series).size !== series.length) { res.status(400).json({ error: 'series must be unique' }); return; }
    if (!series.every((s) => getSeriesOrder().has(s))) { res.status(400).json({ error: 'series contains an unknown badge series' }); return; }

    const supabase = getSupabaseClient();
    if (series.length > 0) {
      const { data: rows, error: ownedError } = await supabase
        .from('user_badges')
        .select('series, tier')
        .eq('user_id', me);
      if (ownedError) throw ownedError;
      const owned = new Set(((rows ?? []) as BadgeRow[]).filter((r) => r.tier >= 1).map((r) => r.series));
      if (!series.every((s) => owned.has(s))) {
        res.status(400).json({ error: 'series contains a badge series you have not earned' }); return;
      }
    }

    const { error: updateError } = await supabase
      .from('users')
      .update({ displayed_badge_series: series })
      .eq('id', me);
    if (updateError) throw updateError;

    const body: ShowcaseApiResponse = { success: true, data: { showcase: series } };
    res.json(body);
  } catch (error) {
    logger.error('❌ Error saving badge showcase:', error);
    res.status(500).json({ error: 'Failed to save showcase' });
  }
});

// POST /api/badges/seen
// Popup-vattenmärket: seen_tier = tier för anroparens rader. Idempotent (rader som redan är sedda skrivs inte
// om) och monotont. Varje update är compare-and-set på den lästa tiern: har evaluateBadges sänkt tiern
// mellan läsningen och updaten matchar ingen rad, och CHECK (seen_tier <= tier) kan aldrig brytas.
router.post('/seen', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const me = req.user!.user_id;
    const requested = req.body?.series === undefined ? null : parseSeriesList(req.body.series);
    if (req.body?.series !== undefined && !requested) {
      res.status(400).json({ error: 'series must be an array of badge series keys' }); return;
    }
    if (requested && !requested.every((s) => getSeriesOrder().has(s))) {
      res.status(400).json({ error: 'series contains an unknown badge series' }); return;
    }
    if (requested && requested.length === 0) {
      const none: SeenApiResponse = { success: true, data: { updated: [] } };
      res.json(none); return;
    }

    const supabase = getSupabaseClient();
    let query = supabase.from('user_badges').select('series, tier, seen_tier').eq('user_id', me);
    if (requested) query = query.in('series', [...new Set(requested)]);
    const { data: rows, error: readError } = await query;
    if (readError) throw readError;

    const unseen = ((rows ?? []) as BadgeRow[])
      .filter(isKnownSeries)
      .filter((row) => (row.seen_tier ?? 0) < row.tier)
      .sort((a, b) => getSeriesOrder().get(a.series)! - getSeriesOrder().get(b.series)!);

    const updated: string[] = [];
    for (const row of unseen) {
      const { data: changed, error: updateError } = await supabase
        .from('user_badges')
        .update({ seen_tier: row.tier })
        .eq('user_id', me)
        .eq('series', row.series)
        .eq('tier', row.tier)
        .select('series');
      if (updateError) throw updateError;
      if ((changed ?? []).length > 0) updated.push(row.series);
    }

    const body: SeenApiResponse = { success: true, data: { updated } };
    res.json(body);
  } catch (error) {
    logger.error('❌ Error marking badges as seen:', error);
    res.status(500).json({ error: 'Failed to mark badges as seen' });
  }
});

export default router;
