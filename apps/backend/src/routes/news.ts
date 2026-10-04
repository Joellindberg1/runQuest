// 📰 News Routes (ADR 008 beslut 9) — Pack News: händelseloggen som flöde.
// Nya endpoints enligt ADR 007 A: { success, data, meta? } / { error }, snake_case, gruppavgränsat ur JWT.
// Läsning sker uteslutande här (service role); tabellen har ingen anon-/authenticated-åtkomst (beslut 10).
import express from 'express';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { ACTIVITY_LOG_TABLE } from '../services/activityLog.js';
import {
  ACTIVITY_TYPES,
  isActivityType,
  type ActivityType,
  type NewsApiResponse,
  type NewsItem,
  type NewsMeta,
  type NewsSeenApiResponse,
  type NewsUserRef,
} from '@runquest/shared';

const router = express.Router();

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const ITEM_COLUMNS =
  'id, type, actor_user_id, target_user_id, payload, payload_version, occurred_at, created_at, is_backfill';

/** Positivt heltal ur en querystring-sträng, annars null. */
function parsePositiveInt(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

type Reader = { news_last_seen_id: number | null; created_at: string | null };

async function readReader(userId: string): Promise<Reader | null> {
  const { data, error } = await getSupabaseClient()
    .from('users')
    .select('news_last_seen_id, created_at')
    .eq('id', userId)
    .single();
  if (error || !data) return null;
  return {
    news_last_seen_id: data.news_last_seen_id == null ? null : Number(data.news_last_seen_id),
    created_at: data.created_at ?? null,
  };
}

/**
 * Oläst-predikatet (ADR 008 beslut 8) i en rad: id över vattenmärket, ej backfill, skapad efter
 * användaren (nya medlemmar ärver inte gamla nyheter) och inte användarens egen handling.
 */
function isUnread(
  row: { id: number; is_backfill: boolean; created_at: string; actor_user_id: string | null },
  userId: string,
  reader: Reader,
): boolean {
  if (row.is_backfill) return false;
  if (row.id <= (reader.news_last_seen_id ?? 0)) return false;
  if (row.actor_user_id === userId) return false;
  if (reader.created_at && !(Date.parse(row.created_at) > Date.parse(reader.created_at))) return false;
  return true;
}

/**
 * Antal olästa i gruppen över ALLA typer — samma predikat som isUnread, räknat i databasen:
 * kandidater minus användarens egna handlingar (actor = U; rader utan aktör räknas alltså som olästa).
 */
async function countUnread(groupId: string, userId: string, reader: Reader): Promise<number> {
  const supabase = getSupabaseClient();
  const candidates = () => {
    let q = supabase
      .from(ACTIVITY_LOG_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('group_id', groupId)
      .eq('is_backfill', false)
      .gt('id', reader.news_last_seen_id ?? 0);
    if (reader.created_at) q = q.gt('created_at', reader.created_at);
    return q;
  };
  const [all, own] = await Promise.all([candidates(), candidates().eq('actor_user_id', userId)]);
  if (all.error) throw all.error;
  if (own.error) throw own.error;
  return Math.max(0, (all.count ?? 0) - (own.count ?? 0));
}

async function fetchUserRefs(ids: string[]): Promise<Map<string, NewsUserRef>> {
  const map = new Map<string, NewsUserRef>();
  if (ids.length === 0) return map;
  const { data, error } = await getSupabaseClient()
    .from('users')
    .select('id, name, profile_picture')
    .in('id', ids);
  if (error) throw error;
  for (const u of data ?? []) map.set(u.id, { id: u.id, name: u.name, profile_picture: u.profile_picture ?? null });
  return map;
}

// GET /api/news[?limit=&before=&after=&type=]
// Keyset på id (sortering id desc). `before=<id>` ger äldre rader, `after=<id>` rader nyare än id:t
// (samma sortering; has_more/next_before beskriver alltid äldre rader inom intervallet, så ett glapp
// mellan klientens kursor och sidans nederkant fylls med ?before=next_before).
router.get('/', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const { limit: rawLimit, before: rawBefore, after: rawAfter, type: rawType } = req.query;

    let limit = DEFAULT_LIMIT;
    if (rawLimit !== undefined) {
      const n = parsePositiveInt(rawLimit);
      if (n === null || n > MAX_LIMIT) {
        res.status(400).json({ error: `limit must be an integer between 1 and ${MAX_LIMIT}` }); return;
      }
      limit = n;
    }

    let before: number | null = null;
    let after: number | null = null;
    if (rawBefore !== undefined) {
      before = parsePositiveInt(rawBefore);
      if (before === null) { res.status(400).json({ error: 'before must be a positive integer' }); return; }
    }
    if (rawAfter !== undefined) {
      after = parsePositiveInt(rawAfter);
      if (after === null) { res.status(400).json({ error: 'after must be a positive integer' }); return; }
    }
    if (before !== null && after !== null) {
      res.status(400).json({ error: 'before and after cannot be combined' }); return;
    }

    let types: ActivityType[] | null = null;
    if (rawType !== undefined) {
      const parts = typeof rawType === 'string' ? rawType.split(',').map((t) => t.trim()) : null;
      const bad = parts === null ? ['type'] : parts.filter((t) => !isActivityType(t));
      if (parts === null || parts.length === 0 || bad.length > 0) {
        res.status(400).json({ error: `type must be a comma-separated list of: ${ACTIVITY_TYPES.join(', ')}` }); return;
      }
      types = [...new Set(parts as ActivityType[])];
    }

    const userId = req.user!.user_id;
    const groupId = req.user!.group_id;
    const emptyMeta: NewsMeta = { unread_count: 0, last_seen_id: null, has_more: false, next_before: null };

    // Saknad grupp ger tom data, aldrig alla grupper (ADR 007 A6)
    if (!groupId) {
      const empty: NewsApiResponse = { success: true, data: { items: [] }, meta: emptyMeta };
      res.json(empty); return;
    }

    const reader = await readReader(userId);
    if (!reader) { res.status(404).json({ error: 'User not found' }); return; }

    const supabase = getSupabaseClient();
    let query = supabase
      .from(ACTIVITY_LOG_TABLE)
      .select(ITEM_COLUMNS)
      .eq('group_id', groupId)
      .order('id', { ascending: false })
      .limit(limit + 1); // en extra rad avgör has_more
    if (before !== null) query = query.lt('id', before);
    if (after !== null) query = query.gt('id', after);
    if (types) query = query.in('type', types);

    const [{ data: rows, error }, unreadCount] = await Promise.all([query, countUnread(groupId, userId, reader)]);
    if (error) throw error;

    const all = rows ?? [];
    const hasMore = all.length > limit;
    const page = hasMore ? all.slice(0, limit) : all;

    const refIds = [...new Set(page.flatMap((r: any) => [r.actor_user_id, r.target_user_id]).filter(Boolean))] as string[];
    const refs = await fetchUserRefs(refIds);

    const items = page.map((r: any) => ({
      id: Number(r.id),
      type: r.type,
      occurred_at: r.occurred_at,
      payload_version: r.payload_version,
      actor: r.actor_user_id ? (refs.get(r.actor_user_id) ?? null) : null,
      target: r.target_user_id ? (refs.get(r.target_user_id) ?? null) : null,
      payload: r.payload,
      is_backfill: r.is_backfill,
      is_unread: isUnread({ ...r, id: Number(r.id) }, userId, reader),
    })) as NewsItem[];

    const body: NewsApiResponse = {
      success: true,
      data: { items },
      meta: {
        unread_count: unreadCount,
        last_seen_id: reader.news_last_seen_id,
        has_more: hasMore,
        next_before: hasMore && items.length > 0 ? items[items.length - 1].id : null,
      },
    };
    res.json(body);
  } catch (error) {
    logger.error('❌ Error fetching news:', error);
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});

// POST /api/news/seen  body { up_to_id?: number }
// Sätter anroparens users.news_last_seen_id — aldrig bakåt (villkoret ligger i UPDATE:ns WHERE, så en sen
// eller omkastad request inte kan sänka märket). Utan up_to_id = senaste raden i gruppen ("Mark all read").
router.post('/seen', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const body = (req.body ?? {}) as { up_to_id?: unknown };
    const upTo = body.up_to_id;
    if (upTo !== undefined && !(typeof upTo === 'number' && Number.isSafeInteger(upTo) && upTo > 0)) {
      res.status(400).json({ error: 'up_to_id must be a positive integer' }); return;
    }

    const userId = req.user!.user_id;
    const groupId = req.user!.group_id;
    const supabase = getSupabaseClient();

    const reader = await readReader(userId);
    if (!reader) { res.status(404).json({ error: 'User not found' }); return; }

    if (!groupId) {
      const empty: NewsSeenApiResponse = { success: true, data: { last_seen_id: reader.news_last_seen_id, unread_count: 0 } };
      res.json(empty); return;
    }

    // Senaste raden i gruppen. up_to_id kläms till den: ett id bortom flödet får inte tysta framtida nyheter.
    const { data: latestRows, error: latestError } = await supabase
      .from(ACTIVITY_LOG_TABLE)
      .select('id')
      .eq('group_id', groupId)
      .order('id', { ascending: false })
      .limit(1);
    if (latestError) throw latestError;
    const latest: number | null = latestRows?.[0]?.id == null ? null : Number(latestRows[0].id);
    const target = latest === null ? null : (typeof upTo === 'number' ? Math.min(upTo, latest) : latest);

    let current = reader.news_last_seen_id;
    if (target !== null && (current === null || target > current)) {
      const update = supabase.from('users').update({ news_last_seen_id: target }).eq('id', userId);
      const { error: updateError } = await (current === null
        ? update.is('news_last_seen_id', null)
        : update.lt('news_last_seen_id', target));
      if (updateError) throw updateError;
      // En samtidig request kan ha hunnit före — läs det faktiska värdet.
      const fresh = await readReader(userId);
      current = fresh ? fresh.news_last_seen_id : target;
    }

    const refreshed: Reader = { ...reader, news_last_seen_id: current };
    const result: NewsSeenApiResponse = {
      success: true,
      data: { last_seen_id: current, unread_count: await countUnread(groupId, userId, refreshed) },
    };
    res.json(result);
  } catch (error) {
    logger.error('❌ Error marking news as seen:', error);
    res.status(500).json({ error: 'Failed to update news state' });
  }
});

export default router;
