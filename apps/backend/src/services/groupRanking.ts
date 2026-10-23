// Gruppens titelranking byggs om per grupp (ADR 012 beslut 4.3 och 4.4): update_group_title_leaderboards(groupId) bygger alla titlar för EN grupp
// och rör ingen annan grupps lista. Det är den ENDA vägen som skriver title_leaderboard (migration 058 släppte triggern på user_titles och
// omslagsfunktionerna): titelomräkningen (processGroupTitles, en gång per gruppomräkning), medlemskapsvägarna (join, konto skapat av admin)
// och admin populate/refresh går hit.
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { errorCode, errorWithCode } from '../utils/errorCode.js';

/** Bygger om alla titlars topp 10 för en grupp. Kastar med databasens kod. Fail-closed: utan groupId kastas det, ingen global ombyggnad. */
export async function rebuildGroupTitleRanking(groupId: string, db: SupabaseClient = getSupabaseClient()): Promise<void> {
  if (typeof groupId !== 'string' || groupId === '') throw new Error('rebuildGroupTitleRanking kräver groupId');
  const { error } = await db.rpc('update_group_title_leaderboards', { p_group_id: groupId });
  if (error) throw errorWithCode(`Failed to rebuild the title ranking of group ${groupId}`, error);
}

/**
 * Efter en lyckad join (ADR 012 beslut 2.4): gruppens ranking byggs om, utan titelnyheter (inget snapshot och ingen emitTitleNews).
 * Medlemskapet är redan sparat, så ett fel här loggas (en gång, med koden) men fäller aldrig anropet; nästa titelomräkning bygger om.
 */
export async function rebuildGroupRankingAfterJoin(groupId: string, db: SupabaseClient = getSupabaseClient()): Promise<void> {
  try {
    await rebuildGroupTitleRanking(groupId, db);
  } catch (error) {
    logger.error(`❌ Failed to rebuild the title ranking of group ${groupId} after a join (${errorCode(error)})`);
  }
}
