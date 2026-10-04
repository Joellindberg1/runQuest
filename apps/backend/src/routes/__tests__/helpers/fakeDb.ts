/**
 * Minimal in-memory fake av supabase-js query builder för route-tester.
 *
 * Till skillnad från de handskrivna mock-stubbarna i övriga route-tester
 * TILLÄMPAR den filter (eq/in/gte/lte/...) på riktiga rader, inklusive
 * punktade sökvägar mot inbäddade relationer ('users.group_id'). Därmed bevisar
 * ett test att en annan grupps data aldrig syns — inte bara att .eq() anropades.
 * Select-projektion tillämpas medvetet INTE: läckagetester ska visa att
 * routen själv inte vidarebefordrar fält den inte valt.
 */

export type Row = Record<string, any>;

export interface RecordedQuery {
  table: string;
  select: string | null;
  filters: Array<{ op: string; column: string; value: unknown }>;
  range: [number, number] | null;
  limit: number | null;
}

export interface FakeDbOptions {
  /** Tabeller som ska svara med fel (PostgREST-liknande). */
  errors?: Record<string, { message: string }>;
  /** Fel för enskilda queries (t.ex. bara historikfrågan) — utvärderas vid körning, när alla filter är satta. */
  failWhen?: (q: RecordedQuery) => { message: string } | null;
}

function pick(row: Row, path: string): unknown {
  return path.split('.').reduce<any>((acc, key) => (acc == null ? undefined : acc[key]), row);
}

export function createFakeDb(tables: Record<string, Row[]>, options: FakeDbOptions = {}) {
  const queries: RecordedQuery[] = [];

  function from(table: string) {
    const q: RecordedQuery = { table, select: null, filters: [], range: null, limit: null };
    queries.push(q);
    let orderBy: Array<{ column: string; ascending: boolean }> = [];
    let wantCount = false;
    let single = false;
    let mutation: { kind: 'update' | 'insert' | 'delete'; values?: Row | Row[] } | null = null;

    const builder: any = {
      select(columns?: string, opts?: { count?: string; head?: boolean }) {
        q.select = columns ?? '*';
        if (opts?.count) wantCount = true;
        return builder;
      },
      eq(column: string, value: unknown) { q.filters.push({ op: 'eq', column, value }); return builder; },
      neq(column: string, value: unknown) { q.filters.push({ op: 'neq', column, value }); return builder; },
      gt(column: string, value: unknown) { q.filters.push({ op: 'gt', column, value }); return builder; },
      gte(column: string, value: unknown) { q.filters.push({ op: 'gte', column, value }); return builder; },
      lt(column: string, value: unknown) { q.filters.push({ op: 'lt', column, value }); return builder; },
      lte(column: string, value: unknown) { q.filters.push({ op: 'lte', column, value }); return builder; },
      in(column: string, value: unknown) { q.filters.push({ op: 'in', column, value }); return builder; },
      is(column: string, value: unknown) { q.filters.push({ op: 'is', column, value }); return builder; },
      order(column: string, opts?: { ascending?: boolean }) {
        orderBy.push({ column, ascending: opts?.ascending ?? true });
        return builder;
      },
      update(values: Row) { mutation = { kind: 'update', values }; return builder; },
      insert(values: Row | Row[]) { mutation = { kind: 'insert', values }; return builder; },
      delete() { mutation = { kind: 'delete' }; return builder; },
      range(from: number, to: number) { q.range = [from, to]; return builder; },
      limit(n: number) { q.limit = n; return builder; },
      single() { single = true; return builder; },
      maybeSingle() { single = true; return builder; },
      then(resolve: (v: any) => void, reject?: (e: unknown) => void) {
        try { resolve(execute()); } catch (e) { reject?.(e); }
      },
    };

    function execute() {
      const err = options.errors?.[table] ?? options.failWhen?.(q);
      if (err) return { data: null, error: err, count: null };

      if (mutation?.kind === 'insert') {
        const inserted = Array.isArray(mutation.values) ? mutation.values : [mutation.values as Row];
        tables[table] = [...(tables[table] ?? []), ...inserted];
        return { data: inserted, error: null, count: null };
      }

      let rows = [...(tables[table] ?? [])];
      for (const f of q.filters) {
        rows = rows.filter((r) => {
          const v = pick(r, f.column) as any;
          switch (f.op) {
            case 'eq': return v === f.value;
            case 'neq': return v !== f.value;
            case 'gt': return v > (f.value as any);
            case 'gte': return v >= (f.value as any);
            case 'lt': return v < (f.value as any);
            case 'lte': return v <= (f.value as any);
            case 'in': return (f.value as unknown[]).includes(v);
            case 'is': return f.value === null ? v == null : v === f.value;
            default: return true;
          }
        });
      }
      if (mutation?.kind === 'update') {
        for (const r of rows) Object.assign(r, mutation.values as Row);
      } else if (mutation?.kind === 'delete') {
        tables[table] = (tables[table] ?? []).filter((r) => !rows.includes(r));
      }
      for (const o of [...orderBy].reverse()) {
        rows.sort((a, b) => {
          const av = pick(a, o.column) as any;
          const bv = pick(b, o.column) as any;
          if (av === bv) return 0;
          return (av < bv ? -1 : 1) * (o.ascending ? 1 : -1);
        });
      }
      const total = rows.length;
      if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
      if (q.limit != null) rows = rows.slice(0, q.limit);
      if (single) return { data: rows[0] ?? null, error: rows[0] ? null : { message: 'not found', code: 'PGRST116' } };
      return { data: rows, error: null, count: wantCount ? total : null };
    }

    return builder;
  }

  return { client: { from }, queries };
}
