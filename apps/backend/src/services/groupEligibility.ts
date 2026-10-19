// "Best so far" i Titles-skärmen: serverberäknade titelvärden för en grupps aktiva medlemmar (GET /titles/group-eligibility).
//
// Samma källor som omräkningen av user_titles (processGroupTitles), så att siffrorna matchar de lagrade innehavarna (ADR 012 beslut 5.7):
// medlemmarna läses ur group_members (aktivt medlemskap), aldrig ur users.group_id; rundorna räknas inom medlemskapets fönster
// (titleWindow/titleInputs); klockan är gruppens (getTitleRecalcContext).
import { titleWindow, type GroupEligibilityEntry } from '@runquest/shared';
import { supabase } from '../config/database.js';
import { errorWithCode } from '../utils/errorCode.js';
import { enhancedTitleService } from './enhancedTitleService';
import { titleInputs } from './titleInputs.js';
import { getTitleRecalcContext } from './titleRecalcClock';

/** Administratörskontot tävlar inte och visas inte i "Best so far". */
const ADMIN_ACCOUNT_NAME = 'Admin';

/**
 * Värdena för gruppens aktiva medlemmar. Kastar med databasens kod om medlemmarna eller användarna inte går att läsa.
 * Fail-closed: utan groupId kastas det innan något läses.
 */
export async function getGroupEligibility(groupId: string): Promise<GroupEligibilityEntry[]> {
  if (typeof groupId !== 'string' || groupId === '') throw new Error('getGroupEligibility kräver groupId');

  const { data: members, error: membersError } = await supabase.client
    .from('group_members')
    .select('user_id, starts_on')
    .eq('group_id', groupId)
    .is('left_at', null);
  if (membersError) throw errorWithCode('Failed to fetch group members', membersError);

  const startsOnByUser = new Map<string, string | null>((members ?? []).map((m: any) => [m.user_id as string, m.starts_on as string | null]));
  if (startsOnByUser.size === 0) return [];

  const { data: users, error: usersError } = await supabase.client
    .from('users')
    .select('id, name, total_km, longest_streak, gender')
    .in('id', [...startsOnByUser.keys()])
    .neq('name', ADMIN_ACCOUNT_NAME);
  if (usersError || !users) throw errorWithCode('Failed to fetch group users', usersError);

  // Ett gemensamt "nu" för hela svaret: gruppens senaste omräkning, så att winterKm räknar samma vinter som de lagrade
  // innehavarna (RUN-141).
  const ctx = await getTitleRecalcContext(groupId);

  return Promise.all(
    users.map(async (user: any): Promise<GroupEligibilityEntry> => {
      const { data: runs } = await supabase.client
        .from('runs')
        .select('date, distance, start_time, total_elevation_gain, pace_std_dev, moving_time, run_weather(temperature_c, wind_speed_ms, wind_gusts_ms)')
        .eq('user_id', user.id)
        .order('date', { ascending: true });

      const runsWithAlias = (runs ?? []).map((r: any) => ({ ...r, distance_km: r.distance }));
      const window = titleWindow({ starts_on: startsOnByUser.get(user.id) ?? null });
      const input = titleInputs(runsWithAlias, window, { total_km: user.total_km, longest_streak: user.longest_streak });
      const values = enhancedTitleService.calculateUserValues(input.runs, input.stats.totalKm, input.stats.longestStreak, ctx);

      return { userId: user.id, name: user.name, gender: user.gender ?? null, values };
    }),
  );
}
