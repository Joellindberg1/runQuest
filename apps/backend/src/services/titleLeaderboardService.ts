import { supabase } from '../config/database';
import { logger } from '../utils/logger.js';
import { errorCode, errorWithCode } from '../utils/errorCode.js';
import { rebuildGroupTitleRanking } from './groupRanking.js';
import type { TitleLeaderboardEntry, TitleRunnerUp, TitleStanding, UserTitleEntry, UserTitleStatus } from '@runquest/shared';

// Felhantering, en felhändelse per fel: metoderna här kastar ett fel med databasens kod (errorWithCode) och loggar inte det de kastar.
// Den som FÅNGAR loggar, en gång: rutten i routes/titles.ts, eller anroparen i tjänsterna. Det som sväljs här (getUserTitles) loggas här.
//
// Läsvägarna gäller EN grupp (ADR 012 beslut 5, ADR 007 A6): gruppen är ett obligatoriskt argument, ett tomt groupId kastar innan något
// läses, och filtret på group_id sätts ovillkorligt.

/** En rad ur title_leaderboard_view. En titel utan innehavare har position, user_id och group_id null (LEFT JOIN). */
interface LeaderboardViewRow {
  title_id: string;
  title_name: string;
  title_description: string;
  position: number | null;
  user_id: string | null;
  user_name: string;
  user_gender?: string | null;
  profile_picture?: string | null;
  value: number;
  earned_at: string;
  status: UserTitleStatus;
}

interface CatalogRow {
  id: string;
  name: string;
  description: string;
  unlock_requirement: number;
  metric_key?: string;
}

interface UserTitleRow {
  title_id: string;
  value: number;
  earned_at: string;
  titles?: {
    name: string;
    description: string;
  };
}

/** PostgreSQL invalid_text_representation: ett user-id som inte är ett uuid. */
const INVALID_UUID = '22P02';

function requireGroupId(groupId: unknown, operation: string): asserts groupId is string {
  if (typeof groupId !== 'string' || groupId === '') throw new Error(`${operation} kräver groupId`);
}

function standingOf(row: LeaderboardViewRow): TitleStanding {
  return {
    user_id: row.user_id as string,
    user_name: row.user_name,
    user_gender: row.user_gender ?? null,
    profile_picture: row.profile_picture,
    value: row.value,
    earned_at: row.earned_at,
  };
}

/**
 * Optimized title service for high-performance title leaderboard operations
 */
export class TitleLeaderboardService {

  /**
   * Titelkatalogen med EN grupps innehavare och tvåor/treor. Katalogen (alla titlar) och gruppens rader slås ihop här, i koden: ett filter
   * på group_id direkt i vyn skulle tappa titlar utan innehavare (deras LEFT JOIN-rad har group_id null) och Titles-skärmen skulle förlora
   * sina olåsta titlar. En titel utan innehavare i gruppen finns kvar med holder null.
   */
  async getTitleLeaderboard(groupId: string): Promise<TitleLeaderboardEntry[]> {
    requireGroupId(groupId, 'getTitleLeaderboard');
    logger.info('🏆 Fetching optimized title leaderboard...');

    const [catalog, ranking] = await Promise.all([
      supabase.client
        .from('titles')
        .select('id, name, description, unlock_requirement, metric_key')
        .order('name'),
      supabase.client
        .from('title_leaderboard_view')
        .select('*')
        .eq('group_id', groupId)
        .order('title_name')
        .order('position'),
    ]);

    if (catalog.error) throw errorWithCode('Failed to read titles', catalog.error);
    if (ranking.error) throw errorWithCode('Failed to read title_leaderboard_view', ranking.error);

    const rows = (ranking.data ?? []) as LeaderboardViewRow[];
    logger.info('📊 Found', rows.length, 'rows in title_leaderboard_view');

    const entries = new Map<string, TitleLeaderboardEntry>();
    for (const title of (catalog.data ?? []) as CatalogRow[]) {
      entries.set(title.id, {
        id: title.id,
        name: title.name,
        description: title.description,
        unlock_requirement: title.unlock_requirement,
        metric_key: title.metric_key,
        holder: null,
        runners_up: [],
      });
    }

    for (const row of rows) {
      const entry = entries.get(row.title_id);
      if (!entry || !row.user_id || !row.position) continue;
      if (row.position === 1) {
        entry.holder = standingOf(row);
      } else if (row.position <= 3) {
        const runnerUp: TitleRunnerUp = { position: row.position, ...standingOf(row) };
        entry.runners_up.push(runnerUp);
      }
    }

    const result = [...entries.values()];
    logger.info(`✅ Loaded ${result.length} titles with optimized query`);

    return result;
  }

  /**
   * Titlarna för en användare i EN grupp, med placering i gruppens topp 10. Null när användaren inte har ett aktivt medlemskap i gruppen
   * (en användare i en annan grupp, en som lämnat, eller en som inte finns): anroparen svarar då 404 på samma sätt i alla tre fallen, så
   * att svaret inte avslöjar om användaren finns. Inget titelmaterial läses för en användare utanför gruppen.
   */
  async getUserTitles(groupId: string, userId: string): Promise<UserTitleEntry[] | null> {
    requireGroupId(groupId, 'getUserTitles');
    logger.info(`🏆 Fetching titles for user: ${userId}`);

    const { data: membership, error: membershipError } = await supabase.client
      .from('group_members')
      .select('id')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .is('left_at', null)
      .maybeSingle();

    if (membershipError) {
      if (membershipError.code === INVALID_UUID) return null;
      throw errorWithCode('Failed to read the group membership', membershipError);
    }
    if (!membership) return null;

    // First try to get from leaderboard view (top 10 positions of the group)
    const { data: leaderboardData, error: leaderboardError } = await supabase.client
      .from('title_leaderboard_view')
      .select('*')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .order('position');

    // Sväljs (svaret byggs av det som gick att läsa), så det loggas här, en gång.
    if (leaderboardError) {
      logger.error(`❌ Error fetching user titles from leaderboard (${errorCode(leaderboardError)})`);
    }

    // Also get ALL of the user's titles in this group (including those not in top 10)
    const { data: allUserTitles, error: allTitlesError } = await supabase.client
      .from('user_titles')
      .select(`
        title_id,
        value,
        earned_at,
        titles!user_titles_title_id_fkey (
          name,
          description
        )
      `)
      .eq('group_id', groupId)
      .eq('user_id', userId);

    if (allTitlesError) {
      logger.error(`❌ Error fetching all user titles (${errorCode(allTitlesError)})`);
    }

    // Combine and deduplicate
    const leaderboardTitles: UserTitleEntry[] = ((leaderboardData ?? []) as LeaderboardViewRow[]).map((row) => ({
      title_id: row.title_id,
      title_name: row.title_name,
      title_description: row.title_description,
      position: row.position,
      value: row.value,
      earned_at: row.earned_at,
      is_current_holder: row.position === 1,
      status: row.status,
    }));

    // Add titles not in leaderboard (position > 10 or no position)
    const leaderboardTitleIds = new Set(leaderboardTitles.map((t) => t.title_id));
    const additionalTitles: UserTitleEntry[] = ((allUserTitles ?? []) as UserTitleRow[])
      .filter((ut) => !leaderboardTitleIds.has(ut.title_id))
      .map((ut) => ({
        title_id: ut.title_id,
        title_name: ut.titles?.name || '',
        title_description: ut.titles?.description || '',
        position: null, // Not in top 10
        value: ut.value,
        earned_at: ut.earned_at,
        is_current_holder: false, // Can't be holder if not in top 10
        status: 'participant',
      }));

    const allTitles = [...leaderboardTitles, ...additionalTitles];
    logger.info(`✅ Found ${allTitles.length} titles for user ${userId} (${leaderboardTitles.length} in leaderboard, ${additionalTitles.length} additional)`);
    return allTitles;
  }

  /**
   * Get all titles (without leaderboard data)
   * Simple fetch of all available titles. Kolumnerna är uttryckliga (inte select *), så att svarsformen inte hänger på schemat:
   * de två frusna, globala innehavarkolumnerna (släppta i migration 058) läcker inte längre ut.
   */
  async getAllTitles(): Promise<any[]> {
    logger.info('🏆 Fetching all titles...');

    const { data, error } = await supabase.client
      .from('titles')
      .select('id, name, description, unlock_requirement, created_at, updated_at, metric_key, outdoor_only')
      .order('name');

    if (error) throw errorWithCode('Failed to read titles', error);

    logger.info(`✅ Fetched ${data?.length || 0} titles`);
    return data || [];
  }

  /**
   * Admin-underhåll: bygger om EN grupps ranking (alla titlar) ur user_titles. Aldrig alla gruppers: en admin agerar i sin egen grupp,
   * och utan groupId kastas det i stället för att falla tillbaka på en global ombyggnad (ADR 012 beslut 4.3).
   */
  async populateTitleLeaderboard(groupId: string): Promise<void> {
    logger.info('🔄 Populating the title leaderboard of one group...');

    await rebuildGroupTitleRanking(groupId, supabase.client);

    logger.info('✅ Title leaderboard populated');
  }
}

export const titleLeaderboardService = new TitleLeaderboardService();
