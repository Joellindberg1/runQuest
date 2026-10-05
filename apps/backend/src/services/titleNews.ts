// 🏆 Titelhändelser för Pack News (ADR 008 beslut 6) — snapshot-diff på appnivå.
//
// title_leaderboard skrivs över (DELETE + INSERT per titel via trigger) och user_titles.earned_at sätts
// om vid varje värdeändring, så ett holderskifte går inte att återskapa i efterhand. Därför tas en
// ögonblicksbild av innehavarna (position 1) FÖRE och EFTER en titelbearbetning, och den rena
// diffTitleHolders (shared) avgör vad som hänt. Titelhändelser loggas ENDAST framåt (ingen backfill).
//
// Alla funktioner här är icke-kastande: loggen får aldrig fälla titelkedjan.
import { getSupabaseClient } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { todayStockholm } from '../utils/dateUtils.js';
import { recordActivities } from './activityLog.js';
import { buildTitleDrafts, diffTitleHolders, type TitleHolder, type TitleMeta } from '@runquest/shared';

/** Nuvarande innehavare (position 1) per titel, ~21 rader. null om läsningen felar (då hoppas diffen över). */
export async function snapshotTitleHolders(): Promise<TitleHolder[] | null> {
  try {
    const { data, error } = await getSupabaseClient()
      .from('title_leaderboard')
      .select('title_id, user_id, value')
      .eq('position', 1);
    if (error) {
      logger.error('❌ [TitleNews] Could not snapshot title holders:', error);
      return null;
    }
    return (data ?? []).map((r: any) => ({ title_id: r.title_id, user_id: r.user_id, value: Number(r.value) }));
  } catch (e) {
    logger.error('❌ [TitleNews] Unexpected error snapshotting title holders:', e);
    return null;
  }
}

/**
 * Jämför före/efter och skriver title_unlocked / title_taken / title_revoked.
 * Samma innehavare (även med ändrat värde) ger ingen rad. Nycklarna (activityKeys) skyddar mot att
 * två samtidiga bearbetningar upptäcker samma byte.
 */
export async function emitTitleNews(before: TitleHolder[], after: TitleHolder[]): Promise<void> {
  try {
    // Steg 1: vilka titlar bytte innehavare? (vanligaste utfallet: inga → inga fler queries)
    const preliminary = diffTitleHolders(before, after, () => true);
    if (preliminary.length === 0) return;

    const supabase = getSupabaseClient();
    const titleIds = [...new Set(preliminary.map((c) => c.title_id))];

    // Steg 2: har förra innehavaren kvar sin user_titles-rad? (taken: 'overtaken' vs 'revoked')
    const oldHolderIds = [...new Set(
      preliminary.flatMap((c) => (c.kind === 'taken' ? [c.old_holder_id] : [])),
    )];
    const stillHeld = new Set<string>();
    if (oldHolderIds.length > 0) {
      const { data, error } = await supabase
        .from('user_titles')
        .select('title_id, user_id')
        .in('title_id', titleIds)
        .in('user_id', oldHolderIds);
      if (error) throw error;
      for (const r of data ?? []) stillHeld.add(`${r.title_id}:${r.user_id}`);
    }
    const changes = diffTitleHolders(before, after, (titleId, userId) => stillHeld.has(`${titleId}:${userId}`));

    // Steg 3: titelnamn (ögonblicksbild i payloaden) och nya innehavarens grupp (vid revoked den förras).
    const userIds = [...new Set(changes.flatMap((c) =>
      c.kind === 'taken' ? [c.new_holder_id] : [c.user_id],
    ))];
    const [titlesRes, usersRes] = await Promise.all([
      supabase.from('titles').select('id, name, metric_key').in('id', titleIds),
      supabase.from('users').select('id, group_id').in('id', userIds),
    ]);
    if (titlesRes.error) throw titlesRes.error;
    if (usersRes.error) throw usersRes.error;

    const titles = new Map<string, TitleMeta>((titlesRes.data ?? []).map((t: any) => [t.id, t]));
    const groups = new Map<string, string | null>((usersRes.data ?? []).map((u: any) => [u.id, u.group_id ?? null]));

    await recordActivities(buildTitleDrafts(changes, titles, groups, new Date().toISOString(), todayStockholm()));
  } catch (e) {
    logger.error('❌ [TitleNews] Failed to emit title news:', e);
  }
}
