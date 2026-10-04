// Rena mappningar för utmaningshistorik (ADR 007 B5–B6). Ingen DB-åtkomst, inga regler — bara formning.
import type {
  ChallengeBoost,
  ChallengeHistoryItem,
  ChallengeParty,
  HeadToHeadRecord,
} from '@runquest/shared';

export const CHALLENGE_HISTORY_COLUMNS =
  'id, tier, metric, duration_days, start_date, end_date, determine_at, outcome, winner_id, ' +
  'challenger_id, opponent_id, challenger_level, opponent_level, challenger_final_value, opponent_final_value, ' +
  'winner_type, winner_delta, winner_duration, loser_type, loser_delta, loser_duration';

export interface UserSummary {
  name: string;
  profile_picture: string | null;
}

// numeric-kolumner kan komma som strängar via PostgREST
function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function party(id: string, level: number, users: Map<string, UserSummary>): ChallengeParty {
  const u = users.get(id);
  return { id, name: u?.name ?? 'Unknown', profile_picture: u?.profile_picture ?? null, level };
}

function boost(type: string, delta: unknown, duration: unknown): ChallengeBoost {
  return { type, delta: toNumberOrNull(delta) ?? 0, duration: toNumberOrNull(duration) };
}

export function toChallengeHistoryItem(row: any, users: Map<string, UserSummary>): ChallengeHistoryItem {
  return {
    id: row.id,
    tier: row.tier,
    metric: row.metric,
    duration_days: row.duration_days,
    start_date: row.start_date ?? null,
    end_date: row.end_date ?? null,
    ended_at: row.determine_at ?? null,
    outcome: row.outcome,
    winner_id: row.winner_id ?? null,
    challenger: party(row.challenger_id, row.challenger_level, users),
    opponent: party(row.opponent_id, row.opponent_level, users),
    challenger_value: toNumberOrNull(row.challenger_final_value),
    opponent_value: toNumberOrNull(row.opponent_final_value),
    winner_boost: boost(row.winner_type, row.winner_delta, row.winner_duration),
    loser_boost: boost(row.loser_type, row.loser_delta, row.loser_duration),
  };
}

/** Utfall ur `viewerId`:s perspektiv, räknat från outcome + vem som var utmanare. */
export function computeRecord(rows: Array<{ outcome: string | null; challenger_id: string }>, viewerId: string): HeadToHeadRecord {
  let wins = 0;
  let draws = 0;
  let losses = 0;
  for (const r of rows) {
    if (r.outcome === 'draw') { draws += 1; continue; }
    const viewerIsChallenger = r.challenger_id === viewerId;
    if (r.outcome === 'challenger_wins') viewerIsChallenger ? wins++ : losses++;
    else if (r.outcome === 'opponent_wins') viewerIsChallenger ? losses++ : wins++;
  }
  return { wins, draws, losses, total: wins + draws + losses };
}
