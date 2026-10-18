// The real recalculation mark store: the two rpc functions and the table of migration 057, through the service-role client.
// Thin on purpose: the rules (least date, version + 1, clear only on the same version) are in the SQL functions.
//
// Errors from the database are rethrown with the PostgREST code only (the message can carry values from the row).
import { getSupabaseClient } from '../../config/database.js';
import { errorCode, errorWithCode } from '../../utils/errorCode.js';
import type { PendingMark, RecalculationMarkStore } from './ports.js';

const databaseError = (operation: string, error: unknown): Error => errorWithCode(`${operation} failed (${errorCode(error)})`, error);

interface MarkRow {
  user_id: string;
  from_date: string;
  version: number | string;
}

/** A version is a whole number from 1 up. PostgREST sends a bigint as a number, or as a string if it does not fit one. */
function readVersion(value: unknown): number | null {
  const version = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof version === 'number' && Number.isSafeInteger(version) && version >= 1 ? version : null;
}

function toPending(row: MarkRow): PendingMark {
  const version = readVersion(row.version);
  if (version === null) throw errorWithCode('read marks failed (invalid_mark_version)', { code: 'invalid_mark_version' });
  return { userId: row.user_id, fromDate: row.from_date, version };
}

export function createRecalculationMarkStore(): RecalculationMarkStore {
  return {
    async mark(userId, fromDate) {
      const { data, error } = await getSupabaseClient().rpc('mark_recalculation', { p_user_id: userId, p_from_date: fromDate });
      if (error) throw databaseError('mark_recalculation', error);
      const version = readVersion(data);
      // No error and no version is not a mark that was written: the caller deletes something on the strength of this answer.
      if (version === null) throw errorWithCode('mark_recalculation failed (invalid_mark_version)', { code: 'invalid_mark_version' });
      return version;
    },

    async clear(userId, version) {
      const { data, error } = await getSupabaseClient().rpc('clear_recalculation_mark', { p_user_id: userId, p_version: version });
      if (error) throw databaseError('clear_recalculation_mark', error);
      return data === true;
    },

    async listPending(limit) {
      const { data, error } = await getSupabaseClient()
        .from('recalculation_marks')
        .select('user_id, from_date, version, marked_at')
        .order('marked_at', { ascending: true })
        .order('user_id', { ascending: true })
        .limit(limit);
      if (error) throw databaseError('listPending', error);
      return ((data as MarkRow[] | null) ?? []).map(toPending);
    },

    async read(userId) {
      const { data, error } = await getSupabaseClient()
        .from('recalculation_marks')
        .select('user_id, from_date, version')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw databaseError('read mark', error);
      return data ? toPending(data as MarkRow) : null;
    },
  };
}
