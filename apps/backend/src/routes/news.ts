// 📰 News Routes (ADR 008 beslut 9) — Pack News: händelseloggen som flöde.
// Nya endpoints enligt ADR 007 A: { success, data, meta? } / { error }, snake_case, gruppavgränsat ur JWT.
// Läsning sker uteslutande här (service role); tabellen har ingen anon-/authenticated-åtkomst (beslut 10).
import express from 'express';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { logger } from '../utils/logger.js';
import { groupIdOrRespondEmpty } from '../utils/groupScope.js';
import { ACTIVITY_LOG_TABLE } from '../services/activityLog.js';
import { isRowUnread, loadUnreadState, type Reader } from '../services/newsUnread.js';
import { acknowledgeRows, parseReadIds, pruneReadReceipts } from '../services/newsRead.js';
import {
  ACTIVITY_TYPES,
  NEWS_DEFAULT_LIMIT,
  NEWS_MAX_LIMIT,
  isActivityType,
  type ActivityType,
  type NewsApiResponse,
  type NewsItem,
  type NewsMeta,
  type NewsReadApiResponse,
  type NewsSeenApiResponse,
  type NewsUserRef,
} from '@runquest/shared';
import { errorCode } from '../utils/errorCode.js';

const router = express.Router();

const DEFAULT_LIMIT = NEWS_DEFAULT_LIMIT;
const MAX_LIMIT = NEWS_MAX_LIMIT;
const ITEM_COLUMNS =
  'id, type, actor_user_id, target_user_id, payload, payload_version, occurred_at, created_at, is_backfill';

/** Positivt heltal ur en querystring-sträng, annars null. */
function parsePositiveInt(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

async function readReader(userId: string): Promise<Reader | null> {
  const { data, error } = await getSupabaseClient()
    .from('users')
    .select('news_last_seen_id, created_at')
    .eq('id', userId)
    .single();
  // PGRST116 = ingen rad (användaren finns inte) → null → 404. Alla andra fel är databasfel → kastas → 500.
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  if (!data) return null;
  return {
    news_last_seen_id: data.news_last_seen_id == null ? null : Number(data.news_last_seen_id),
    created_at: data.created_at ?? null,
  };
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PostgREST-citering av ett värde i ett filteruttryck: omslutet av " med " och \ escapade (så att kommatecken, klamrar och citat inte delar villkoret). */
function postgrestQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Villkoret för ?involves=me (ADR 011 beslut 9), ett `.or(...)`-uttryck som läggs som extra AND ovanpå gruppfiltret:
 *   actor = jag ELLER target = jag ELLER (type = event_closed OCH payload @> {"entrant_ids":["<jag>"]})
 * `userId` MÅSTE vara ett validerat UUID (anroparen kontrollerar det): id:t interpoleras i filtersträngen. Containment-värdet
 * citeras dessutom, så att ett id aldrig kan lägga till villkor ens om valideringen skulle glömmas.
 *
 * Prestanda: feedet är per grupp (indexet group_id,id desc) och begränsat till högst 100 rader per sida; actor/target har egna
 * partiella index. Jsonb-containment mot `payload` saknar index. Revisit-trigger: ett GIN-index på `payload` (eller på
 * `payload->'entrant_ids'`) om en grupps activity_log växer till storleken där detta filter blir märkbart långsamt.
 */
function involvesFilter(rawUserId: string): string {
  // Små bokstäver: UUID-regexen är skiftlägesokänslig, men jsonb-containment jämför strängar exakt och entrant_ids skrivs med små.
  const userId = rawUserId.toLowerCase();
  const entrants = postgrestQuote(JSON.stringify({ entrant_ids: [userId] }));
  return `actor_user_id.eq.${userId},target_user_id.eq.${userId},and(type.eq.event_closed,payload.cs.${entrants})`;
}

// GET /api/news[?limit=&before=&after=&type=&involves=me]
// Keyset på id (sortering id desc). `before=<id>` ger äldre rader, `after=<id>` rader nyare än id:t
// (samma sortering; has_more/next_before beskriver alltid äldre rader inom intervallet, så ett glapp
// mellan klientens kursor och sidans nederkant fylls med ?before=next_before).
// `involves=me` är ett vyfilter på samma fråga (limit+1 på den filtrerade frågan, så has_more/next_before gäller det filtrerade
// flödet); det ändrar inte meta.unread_count, som alltid räknas över hela gruppen.
router.get('/', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const { limit: rawLimit, before: rawBefore, after: rawAfter, type: rawType, involves: rawInvolves } = req.query;

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

    // Exakt "me" (versalkänsligt); tomt, andra värden och upprepade parametrar (array) är 400.
    if (rawInvolves !== undefined && rawInvolves !== 'me') {
      res.status(400).json({ error: 'involves must be "me"' }); return;
    }
    const involvesMe = rawInvolves === 'me';

    const userId = req.user!.user_id;
    const groupId = req.user!.group_id;
    const emptyMeta: NewsMeta = { unread_count: 0, last_seen_id: null, has_more: false, next_before: null };

    // Saknad grupp ger tom data, aldrig alla grupper (ADR 007 A6)
    if (!groupId) {
      const empty: NewsApiResponse = { success: true, data: { items: [] }, meta: emptyMeta };
      res.json(empty); return;
    }

    // Id:t kommer ur JWT men interpoleras i filtersträngen nedan: bara ett riktigt UUID släpps igenom.
    if (involvesMe && !UUID.test(userId)) {
      res.status(400).json({ error: 'involves requires a valid user id' }); return;
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
    // Ett extra AND ovanpå .eq('group_id', …) ovan: gruppavgränsningen kommer alltid först och gäller alla grenar av or().
    if (involvesMe) query = query.or(involvesFilter(userId));

    const [{ data: rows, error }, { viewer, unreadCount }] = await Promise.all([
      query,
      loadUnreadState(groupId, userId, reader),
    ]);
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
      is_unread: isRowUnread(r, viewer),
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
    logger.error(`❌ Error fetching news (${errorCode(error)})`);
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
      // Villkoret ligger i WHERE och är en enda sats (null ELLER lägre): en samtidig request som hunnit höja
      // märket mellan vår läsning och skrivning förlorar aldrig, och märket kan aldrig sänkas.
      const { error: updateError } = await supabase
        .from('users')
        .update({ news_last_seen_id: target })
        .eq('id', userId)
        .or(`news_last_seen_id.is.null,news_last_seen_id.lt.${target}`);
      if (updateError) throw updateError;
      // En samtidig request kan ha hunnit före — läs det faktiska värdet.
      const fresh = await readReader(userId);
      current = fresh ? fresh.news_last_seen_id : target;
    }

    // Rader under golvet är redan lästa, så deras kvitton är inerta. Pruningen sker efter höjningen och med det FAKTISKA
    // golvet (aldrig lägre än det lagrade); den är best-effort och loggar själv, så ett fel här ändrar inte svaret.
    await pruneReadReceipts(userId, current);

    const refreshed: Reader = { ...reader, news_last_seen_id: current };
    const result: NewsSeenApiResponse = {
      success: true,
      data: { last_seen_id: current, unread_count: (await loadUnreadState(groupId, userId, refreshed)).unreadCount },
    };
    res.json(result);
  } catch (error) {
    logger.error(`❌ Error marking news as seen (${errorCode(error)})`);
    res.status(500).json({ error: 'Failed to update news state' });
  }
});

// POST /api/news/read  body { ids: number[] }  (ADR 011 beslut 4, läs-gesterna)
// Kvitterar enskilda rader i news_read. Läst-status är privat: skrivningen bär alltid token-användarens user_id, id:n
// utanför anroparens grupp eller på/under golvet ignoreras tyst, och svaret innehåller bara anroparens egen räknare.
//
// Ordning: (1) slå upp vilka id:n som gäller, (2) upsert med ignoreDuplicates (idempotent), (3) rensa anroparens kvitton
// på eller under golvet, (4) räkna om med samma loadUnreadState som GET /news, så att talet är exakt det GET visar direkt
// efter skrivningen. Ett fel i (1) eller (2) ger 500 utan detaljer. Ett fel i (3) loggas och ger ändå 200.
//
// Race mot /seen: höjer /seen golvet mellan vår läsning av golvet och vår skrivning kan ett kvitto hamna på eller under det
// nya golvet. Det är inert (rader under golvet är redan lästa) och rensas av nästa /read eller /seen. Ett id som
// återkallas mellan uppslagning och skrivning ger FK-fel (23503); acknowledgeRows gör då om det en gång (se newsRead.ts).
//
// Kvittofönstret: oläst-räknaren läser news_read som de senaste 501 raderna ovanför golvet (newsUnread.ts). Golvet är
// tabellens enda städning (här och i /seen); ADR 011:s revisit-trigger är > 1 000 rader per användare, då ska golvet
// kompakteras över det sammanhängande lästa prefixet.
//
// Rate limit: klientens gester buntas med READ_FLUSH_MS = 300 ms, alltså som mest ca 200 anrop per minut från en
// användare och bara om varje flush bär en ny oläst rad. 240 per minut och IP ligger över det taket (och ger marginal
// för några som delar IP), så vanlig hover-skrollning aldrig märker gränsen; den stoppar bara ett skript.
const READ_WINDOW_MS = 60 * 1000;
const READ_MAX_PER_WINDOW = 240;

/**
 * Routern byggs av en fabrik så att varje instans får en EGEN limiter-karta (ett test kan bygga en ny app utan att ärva
 * räknare). `app.ts` monterar default-exporten. /read ligger före flödesrutterna och sitter efter auth: anrop utan
 * token räknas aldrig mot gränsen.
 */
export function createNewsRouter(): express.Router {
  const root = express.Router();
  const readLimiter = createRateLimiter(READ_WINDOW_MS, READ_MAX_PER_WINDOW);

  root.post('/read', authenticateJWT, readLimiter, async (req, res): Promise<void> => {
    try {
      const ids = parseReadIds(req.body);
      if (!ids) {
        res.status(400).json({ error: 'ids must be 1 to 50 unique positive integers' }); return;
      }

      const empty: NewsReadApiResponse = { success: true, data: { unread_count: 0 } };
      const groupId = groupIdOrRespondEmpty(req, res, empty);
      if (!groupId) return;

      const userId = req.user!.user_id;
      const reader = await readReader(userId);
      if (!reader) { res.status(404).json({ error: 'User not found' }); return; }

      await acknowledgeRows(groupId, userId, ids, reader.news_last_seen_id ?? 0);
      await pruneReadReceipts(userId, reader.news_last_seen_id);

      const body: NewsReadApiResponse = {
        success: true,
        data: { unread_count: (await loadUnreadState(groupId, userId, reader)).unreadCount },
      };
      res.json(body);
    } catch (error) {
      logger.error(`❌ Error marking news rows as read (${errorCode(error)})`);
      res.status(500).json({ error: 'Failed to update news state' });
    }
  });

  root.use(router);
  return root;
}

export default createNewsRouter();
