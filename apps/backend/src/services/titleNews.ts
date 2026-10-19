// 🏆 Titelhändelser för Pack News (ADR 008 beslut 6, ADR 012 beslut 5.3) — snapshot-diff på appnivå, per grupp.
//
// title_leaderboard skrivs över (DELETE + INSERT per grupp och titel via trigger) och user_titles.earned_at sätts
// om vid varje värdeändring, så ett holderskifte går inte att återskapa i efterhand. Därför tas en
// ögonblicksbild av gruppens position 1–2 FÖRE och EFTER en titelbearbetning, och den rena
// diffTitleHolders (shared) avgör vad som hänt (bara position 1; tvåan bärs med för "låg tvåa", ADR 011 beslut 7).
// Titelhändelser loggas ENDAST framåt (ingen backfill).
//
// En bild gäller EN grupp: en ändring i grupp A kan aldrig ge en nyhet i grupp B.
// Alla funktioner här är icke-kastande: loggen får aldrig fälla titelkedjan.
import { getSupabaseClient } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { todayStockholm } from '../utils/dateUtils.js';
import { recordActivities } from './activityLog.js';
import { buildTitleDrafts, diffTitleHolders, type TitleHolder, type TitleMeta } from '@runquest/shared';
import { errorCode } from '../utils/errorCode.js';

/**
 * Gruppens innehavare (position 1) per titel, med tvåan (position 2) som `runner_up`. Gruppen läses direkt ur
 * title_leaderboard.group_id, så ingen annan grupps rader kommer med. null om läsningen felar (då hoppas diffen över);
 * utan groupId läses ingenting (ingen global bild).
 */
export async function snapshotTitleHolders(groupId: string): Promise<TitleHolder[] | null> {
  if (typeof groupId !== 'string' || groupId === '') {
    logger.error('❌ [TitleNews] Snapshot of title holders needs a groupId');
    return null;
  }
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('title_leaderboard')
      .select('group_id, title_id, user_id, value, position')
      .eq('group_id', groupId)
      .in('position', [1, 2]);
    if (error) {
      logger.error(`❌ [TitleNews] Could not snapshot title holders (${errorCode(error)})`);
      return null;
    }
    const rows = (data ?? []) as Array<{ group_id: string; title_id: string; user_id: string; value: number | string; position: number }>;

    const runnerUps = new Map<string, { user_id: string; value: number }>();
    for (const r of rows) if (r.position === 2) runnerUps.set(r.title_id, { user_id: r.user_id, value: Number(r.value) });

    return rows
      .filter((r) => r.position === 1)
      .map((r) => ({
        group_id: r.group_id,
        title_id: r.title_id,
        user_id: r.user_id,
        value: Number(r.value),
        runner_up: runnerUps.get(r.title_id) ?? null,
      }));
  } catch (e) {
    logger.error(`❌ [TitleNews] Unexpected error snapshotting title holders (${errorCode(e)})`);
    return null;
  }
}

/**
 * Jämför gruppens före/efter och skriver title_unlocked / title_taken / title_revoked i den gruppen.
 * Samma innehavare (även med ändrat värde) ger ingen rad. Hållare från en annan grupp än `groupId` ignoreras.
 * Nycklarna (activityKeys) skyddar mot att två samtidiga bearbetningar upptäcker samma byte.
 * En title_taken bär tvåan ur gruppens före-bild som `runner_up_user_id` (ADR 011 beslut 7, ADR 012 beslut 5.4); den som
 * anropar med `emitNews:false` kommer aldrig hit, så inget fält skrivs vid tyst omräkning.
 */
export async function emitTitleNews(groupId: string, before: TitleHolder[], after: TitleHolder[]): Promise<void> {
  try {
    if (typeof groupId !== 'string' || groupId === '') return;
    const inGroup = (h: TitleHolder) => h.group_id === groupId;
    const groupBefore = before.filter(inGroup);
    const groupAfter = after.filter(inGroup);

    // Steg 1: vilka titlar bytte innehavare? (vanligaste utfallet: inga → inga fler queries)
    const preliminary = diffTitleHolders(groupBefore, groupAfter, () => true);
    if (preliminary.length === 0) return;

    const supabase = getSupabaseClient();
    const titleIds = [...new Set(preliminary.map((c) => c.title_id))];

    // Steg 2: har förra innehavaren kvar sin user_titles-rad I GRUPPEN? (taken: 'overtaken' vs 'revoked')
    const oldHolderIds = [...new Set(
      preliminary.flatMap((c) => (c.kind === 'taken' ? [c.old_holder_id] : [])),
    )];
    const stillHeld = new Set<string>();
    const heldKey = (group: string, titleId: string, userId: string) => `${group}:${titleId}:${userId}`;
    if (oldHolderIds.length > 0) {
      const { data, error } = await supabase
        .from('user_titles')
        .select('group_id, title_id, user_id')
        .eq('group_id', groupId)
        .in('title_id', titleIds)
        .in('user_id', oldHolderIds);
      if (error) throw error;
      for (const r of data ?? []) stillHeld.add(heldKey(r.group_id, r.title_id, r.user_id));
    }
    const changes = diffTitleHolders(
      groupBefore,
      groupAfter,
      (titleId, userId, holderGroupId) => stillHeld.has(heldKey(holderGroupId, titleId, userId)),
    );

    // Steg 3: titelnamn (ögonblicksbild i payloaden). Gruppen följer med hållaren i changes.
    const titlesRes = await supabase.from('titles').select('id, name, metric_key').in('id', titleIds);
    if (titlesRes.error) throw titlesRes.error;
    const titles = new Map<string, TitleMeta>((titlesRes.data ?? []).map((t: any) => [t.id, t]));

    await recordActivities(buildTitleDrafts(changes, titles, new Date().toISOString(), todayStockholm(), groupBefore));
  } catch (e) {
    logger.error(`❌ [TitleNews] Failed to emit title news (${errorCode(e)})`);
  }
}
