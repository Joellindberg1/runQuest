import type { ActivityType } from '@runquest/shared';
import { KARL, ME, NICK, item, type ItemOf } from './news.fixture';

// Ett exempel per händelsetyp i API-formen. Kartan är uttömmande mot ACTIVITY_TYPES (shared): lägger shared till en typ
// får kartan ett tsc-fel här, och paritetstestet i backend (newsFakeParity.test.ts) kör varje typ genom den riktiga rutten
// och mot newsServer. Payloaderna är verkliga former, inte tomma objekt, så ett fält som saknas eller byter namn märks i jämförelsen.

type Overrides<T extends ActivityType> = Partial<Omit<ItemOf<T>, 'type' | 'payload' | 'id'>>;
type SampleBuilders = { [T in ActivityType]: (id: number, over?: Overrides<T>) => ItemOf<T> };

const BOOST = { type: 'multiplier_days', delta: 0.2, duration: 4 } as const;

export const newsSamples: SampleBuilders = {
  title_unlocked: (id, over) => item('title_unlocked', id, { title_id: 't-longest', title_name: 'The Longest Run', metric_key: 'longestRun', value: 32.8 }, { actor: KARL, ...over }),
  title_taken: (id, over) =>
    item('title_taken', id, { title_id: 't-longest', title_name: 'The Longest Run', metric_key: 'longestRun', value: 32.8, previous_value: 30, reason: 'overtaken' }, { actor: KARL, target: ME, ...over }),
  title_revoked: (id, over) => item('title_revoked', id, { title_id: 't-longest', title_name: 'The Longest Run', metric_key: 'longestRun' }, { target: ME, ...over }),
  challenge_received: (id, over) => item('challenge_received', id, { challenge_id: 'c1', tier: 'major', metric: 'km', duration_days: 7 }, { actor: NICK, target: ME, ...over }),
  challenge_won: (id, over) =>
    item('challenge_won', id, {
      challenge_id: 'c1', tier: 'major', metric: 'km', duration_days: 7, winner_value: 44, loser_value: 38.2, winner_boost: BOOST, loser_boost: { ...BOOST, delta: -0.1 },
    }, { actor: NICK, target: ME, ...over }),
  challenge_draw: (id, over) =>
    item('challenge_draw', id, { challenge_id: 'c1', tier: 'minor', metric: 'km', duration_days: 3, challenger_value: 12, opponent_value: 12 }, { actor: NICK, target: ME, ...over }),
  level_up: (id, over) => item('level_up', id, { level: 7 }, { actor: KARL, ...over }),
  run_milestone: (id, over) => item('run_milestone', id, { kind: 'total_km', threshold: 100 }, { actor: KARL, ...over }),
  streak_broken: (id, over) => item('streak_broken', id, { length: 27, last_run_date: '2026-10-05' }, { actor: KARL, ...over }),
  event_open: (id, over) =>
    item('event_open', id, { event_id: 'e-5k', event_type: 'participation', template_name: '5K Friday', icon: 'calendar', reward_xp: 25, ends_at: '2026-10-08T21:59:00Z' }, over),
  event_closed: (id, over) =>
    item('event_closed', id, {
      event_id: 'e-5k', event_type: 'competition', template_name: '5K Friday', participants: 3, members: 5, top: [{ user_id: KARL.id, rank: 1, xp: 120 }],
    }, over),
  badge_earned: (id, over) => item('badge_earned', id, { series: 'streak_keeper', tier: 2, previous_tier: 1 }, { actor: KARL, ...over }),
  release_published: (id, over) => item('release_published', id, { version: '0.7.1', title: 'Parity' }, over),
  rank_passed: (id, over) => item('rank_passed', id, { measure: 'xp', passer_rank: 2, passed_rank: 3 }, { actor: KARL, target: ME, ...over }),
  challenge_accepted: (id, over) =>
    item('challenge_accepted', id, { challenge_id: 'c1', tier: 'major', metric: 'km', duration_days: 7, start_date: '2026-10-09' }, { actor: KARL, target: ME, ...over }),
};
