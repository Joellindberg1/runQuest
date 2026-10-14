/**
 * The referential actions of every foreign key that points at runs(id), for tests that run against createFakeDb (which models no
 * foreign keys at all). Only for tests: server.ts never imports this folder (test-utils isolation test in __tests__/fakeStrava.test.ts).
 *
 * The rules are the ones the migrations define; this file only REPEATS them so that a behaviour test of the deletion chain can
 * show what the chain leaves behind. It is not the proof that the database does it:
 *   run_weather.run_id        ON DELETE CASCADE   migrations/000_baseline.sql (run_weather_run_id_fkey) and 013_create_run_weather.sql
 *   user_badges.source_run_id ON DELETE SET NULL  migrations/035_create_user_badges.sql
 *   event_entries.run_id      ON DELETE SET NULL  migrations/047_event_entries_run_id_set_null.sql (before it: NO ACTION, 000_baseline)
 * The migrations are pinned by stravaRemovalDbRules.test.ts and eventEntriesRunIdMigration047.test.ts, and the SQL itself is run
 * against a real Postgres (PGlite) by the critic.
 *
 * Use: wrap the fake client and give that to getSupabaseClient. Every query on `runs` that resolves with fewer run ids than before
 * (a delete) applies the actions to the other tables of the same `tables` object.
 */
import type { Row } from '../routes/__tests__/helpers/fakeDb.js';

interface FakeClient {
  from: (table: string) => any;
  rpc: (name: string, args?: any) => any;
}

/** One foreign key to runs(id): the table, the column and what a delete of the run does with the referencing row. */
export const RUN_FOREIGN_KEYS: ReadonlyArray<{ table: string; column: string; onDelete: 'cascade' | 'set null' }> = [
  { table: 'run_weather', column: 'run_id', onDelete: 'cascade' },
  { table: 'user_badges', column: 'source_run_id', onDelete: 'set null' },
  { table: 'event_entries', column: 'run_id', onDelete: 'set null' },
];

export function withRunForeignKeys<T extends FakeClient>(client: T, tables: Record<string, Row[]>): T {
  const runIds = (): Set<unknown> => new Set((tables.runs ?? []).map((row) => row.id));

  function applyActions(before: Set<unknown>): void {
    const after = runIds();
    const gone = new Set([...before].filter((id) => !after.has(id)));
    if (gone.size === 0) return;
    for (const { table, column, onDelete } of RUN_FOREIGN_KEYS) {
      if (!tables[table]) continue;
      if (onDelete === 'cascade') tables[table] = tables[table].filter((row) => !gone.has(row[column]));
      else for (const row of tables[table]) if (gone.has(row[column])) row[column] = null;
    }
  }

  // The builder returns itself from every chain method, so a proxy must hand out itself again for the wrapper to stay in the chain.
  function wrap(builder: any): any {
    const wrapper: any = new Proxy(builder, {
      get(target, property) {
        if (property === 'then') {
          return (resolve: (value: unknown) => void, reject?: (error: unknown) => void) => {
            const before = runIds();
            return target.then((result: unknown) => {
              applyActions(before);
              resolve(result);
            }, reject);
          };
        }
        const value = target[property];
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          const out = value.apply(target, args);
          return out === target ? wrapper : out;
        };
      },
    });
    return wrapper;
  }

  return {
    ...client,
    from: (table: string) => (table === 'runs' ? wrap(client.from(table)) : client.from(table)),
  };
}
