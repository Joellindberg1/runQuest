// 📅 Event Routes
import { logger } from '../utils/logger.js';
import express from 'express';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = express.Router();

// ─── GET /api/events ─────────────────────────────────────────────────────────
// Returnerar aktiva + schemalagda events för användarens grupp,
// med template-info och användarens egna entries.

router.get('/', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const userId  = req.user!.user_id;
    const groupId = req.user!.group_id;

    if (!groupId) {
      res.json({ events: [] });
      return;
    }

    const supabase = getSupabaseClient();

    // Hämta aktiva och schemalagda events för gruppen
    const { data: events, error } = await supabase
      .from('events')
      .select(`
        id,
        type,
        metric,
        status,
        starts_at,
        ends_at,
        event_templates (
          name,
          icon,
          description,
          min_km,
          reward_xp,
          reward_xp_1st,
          reward_xp_2nd,
          reward_xp_3rd,
          requires_weather
        )
      `)
      .eq('group_id', groupId)
      .in('status', ['active', 'scheduled'])
      .order('starts_at', { ascending: true });

    if (error) {
      logger.error('❌ [EventsRoute] Fetch events error:', error);
      res.status(500).json({ error: 'Failed to fetch events' });
      return;
    }

    if (!events?.length) {
      res.json({ events: [] });
      return;
    }

    const eventIds = events.map((e: any) => e.id);

    // Hämta användarens egna entries för dessa events
    const { data: myEntries } = await supabase
      .from('event_entries')
      .select('event_id, rank, xp_awarded, qualified_at, total_value')
      .eq('user_id', userId)
      .in('event_id', eventIds);

    const entryMap = new Map(
      (myEntries ?? []).map((e: any) => [e.event_id, e])
    );

    // Hämta alla entries för competition-events (för live-leaderboard)
    const competitionEventIds = events.filter((e: any) => e.type === 'competition').map((e: any) => e.id);

    // Map: eventId → leaderboard entries (beräknas nedan)
    const leaderboardMap = new Map<string, Array<{ userId: string; userName: string; totalValue: number; rank: number }>>();

    if (competitionEventIds.length > 0) {
      // Hämta alla deltagare för dessa events
      const { data: allEntries } = await supabase
        .from('event_entries')
        .select('event_id, user_id')
        .in('event_id', competitionEventIds);

      // Hämta användarnamn
      const participantUserIds = [...new Set((allEntries ?? []).map((e: any) => e.user_id))];
      const { data: userRows } = await supabase
        .from('users')
        .select('id, name')
        .in('id', participantUserIds);

      const userNameMap = new Map((userRows ?? []).map((u: any) => [u.id, u.name]));

      // Beräkna live-total per användare per event
      for (const event of events.filter((e: any) => e.type === 'competition')) {
        const isKm = event.metric === 'km';
        const participants = (allEntries ?? []).filter((e: any) => e.event_id === event.id);

        const scored: Array<{ userId: string; userName: string; totalValue: number; rank: number }> = [];
        for (const p of participants) {
          const { data: runs } = await supabase
            .from('runs')
            .select(isKm ? 'distance' : 'total_elevation_gain')
            .eq('user_id', p.user_id)
            .gte('date', event.starts_at.slice(0, 10))
            .lte('date', event.ends_at.slice(0, 10));

          const totalValue = (runs ?? []).reduce((sum: number, r: any) =>
            sum + Number(isKm ? r.distance : r.total_elevation_gain ?? 0), 0
          );
          scored.push({ userId: p.user_id as string, userName: (userNameMap.get(p.user_id) ?? 'Unknown') as string, totalValue, rank: 0 });
        }

        scored.sort((a, b) => b.totalValue - a.totalValue);
        scored.forEach((s, i) => { s.rank = i + 1; });
        leaderboardMap.set(event.id, scored);
      }
    }

    const result = events.map((e: any) => {
      const tmpl = e.event_templates;
      const myEntry = entryMap.get(e.id) ?? null;
      const leaderboard = leaderboardMap.get(e.id) ?? null;

      // Hitta min rank i live-leaderboard för competition
      const myLiveEntry = leaderboard?.find(l => l.userId === userId) ?? null;

      return {
        id: e.id,
        type: e.type,
        metric: e.metric,
        status: e.status,
        startsAt: e.starts_at,
        endsAt: e.ends_at,
        template: {
          name: tmpl?.name ?? '',
          icon: tmpl?.icon ?? 'calendar',
          description: tmpl?.description ?? '',
          minKm: Number(tmpl?.min_km ?? 0),
          rewardXp: Number(tmpl?.reward_xp ?? 0),
          rewardXp1st: Number(tmpl?.reward_xp_1st ?? 0),
          rewardXp2nd: Number(tmpl?.reward_xp_2nd ?? 0),
          rewardXp3rd: Number(tmpl?.reward_xp_3rd ?? 0),
          requiresWeather: tmpl?.requires_weather ?? null,
        },
        myEntry: myEntry
          ? {
              qualified: true,
              qualifiedAt: (myEntry as any).qualified_at,
              rank: myLiveEntry?.rank ?? (myEntry as any).rank,
              xpAwarded: (myEntry as any).xp_awarded,
              totalValue: myLiveEntry?.totalValue ?? (myEntry as any).total_value,
            }
          : null,
        leaderboard: leaderboard?.map(l => ({
          userId: l.userId,
          userName: l.userId === userId ? 'Du' : l.userName,
          totalValue: l.totalValue,
          rank: l.rank,
          isMe: l.userId === userId,
        })) ?? null,
        participantCount: leaderboard?.length ?? 0,
      };
    });

    res.json({ events: result });
  } catch (err) {
    logger.error('❌ [EventsRoute] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/events/history ──────────────────────────────────────────────────
// Returnerar settled events för användarens grupp (senaste 30), med myEntry och leaderboard.

router.get('/history', authenticateJWT, async (req, res): Promise<void> => {
  try {
    const userId  = req.user!.user_id;
    const groupId = req.user!.group_id;

    if (!groupId) {
      res.json({ events: [] });
      return;
    }

    const supabase = getSupabaseClient();

    const { data: events, error } = await supabase
      .from('events')
      .select(`
        id,
        type,
        metric,
        status,
        starts_at,
        ends_at,
        event_templates ( name, icon, description, min_km, reward_xp, reward_xp_1st, reward_xp_2nd, reward_xp_3rd )
      `)
      .eq('group_id', groupId)
      .eq('status', 'settled')
      .order('ends_at', { ascending: false })
      .limit(30);

    if (error) {
      logger.error('❌ [EventsRoute] History fetch error:', error);
      res.status(500).json({ error: 'Failed to fetch history' });
      return;
    }
    if (!events?.length) {
      res.json({ events: [] });
      return;
    }

    const eventIds = events.map((e: any) => e.id);

    // Hämta användarens egna entries
    const { data: myEntries } = await supabase
      .from('event_entries')
      .select('event_id, rank, xp_awarded, qualified_at, total_value')
      .eq('user_id', userId)
      .in('event_id', eventIds);
    const entryMap = new Map((myEntries ?? []).map((e: any) => [e.event_id, e]));

    // Hämta alla entries för leaderboard (settled → total_value finns)
    const { data: allEntries } = await supabase
      .from('event_entries')
      .select('event_id, user_id, rank, total_value, xp_awarded')
      .in('event_id', eventIds)
      .order('rank', { ascending: true });

    const participantUserIds = [...new Set((allEntries ?? []).map((e: any) => e.user_id))];

    // Hämta alla gruppmedlemmar (för att visa vem som MISSADE participation-events)
    const { data: groupMembers } = await supabase
      .from('users')
      .select('id, name')
      .eq('group_id', groupId);
    const allMemberIds = (groupMembers ?? []).map((u: any) => u.id);

    // Bygg namnkarta för alla relevanta user-ids
    const allUserIds = [...new Set([...participantUserIds, ...allMemberIds])];
    const { data: userRows } = await supabase
      .from('users')
      .select('id, name')
      .in('id', allUserIds);
    const userNameMap = new Map((userRows ?? []).map((u: any) => [u.id, u.name]));

    const result = events.map((e: any) => {
      const tmpl = e.event_templates;
      const myEntry = entryMap.get(e.id) ?? null;
      const eventEntries = (allEntries ?? []).filter((row: any) => row.event_id === e.id);
      const qualifiedUserIds = new Set(eventEntries.map((row: any) => row.user_id));

      // Competition: leaderboard med rank + värde
      // Participation: alla gruppmedlemmar med qualified-flag
      const leaderboard = e.type === 'competition'
        ? eventEntries.map((row: any) => ({
            userId: row.user_id,
            userName: row.user_id === userId ? 'Du' : (userNameMap.get(row.user_id) ?? 'Unknown'),
            totalValue: Number(row.total_value ?? 0),
            rank: row.rank,
            xpAwarded: row.xp_awarded,
            qualified: true,
            isMe: row.user_id === userId,
          }))
        : allMemberIds.map((uid: string) => ({
            userId: uid,
            userName: uid === userId ? 'Du' : (userNameMap.get(uid) ?? 'Unknown'),
            totalValue: 0,
            rank: null,
            xpAwarded: qualifiedUserIds.has(uid) ? Number(tmpl?.reward_xp ?? 0) : 0,
            qualified: qualifiedUserIds.has(uid),
            isMe: uid === userId,
          }));

      return {
        id: e.id,
        type: e.type,
        metric: e.metric,
        status: e.status,
        startsAt: e.starts_at,
        endsAt: e.ends_at,
        template: {
          name: tmpl?.name ?? '',
          icon: tmpl?.icon ?? 'calendar',
          description: tmpl?.description ?? '',
          minKm: Number(tmpl?.min_km ?? 0),
          rewardXp: Number(tmpl?.reward_xp ?? 0),
          rewardXp1st: Number(tmpl?.reward_xp_1st ?? 0),
          rewardXp2nd: Number(tmpl?.reward_xp_2nd ?? 0),
          rewardXp3rd: Number(tmpl?.reward_xp_3rd ?? 0),
        },
        myEntry: myEntry
          ? { qualified: true, qualifiedAt: (myEntry as any).qualified_at, rank: (myEntry as any).rank, xpAwarded: (myEntry as any).xp_awarded, totalValue: (myEntry as any).total_value }
          : null,
        leaderboard,
      };
    });

    res.json({ events: result });
  } catch (err) {
    logger.error('❌ [EventsRoute] History unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
