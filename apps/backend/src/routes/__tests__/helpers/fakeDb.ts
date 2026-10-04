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
  /** Ger insatta rader utan `id` ett löpande id ('gen-1', ...) — för routes som läser tillbaka id efter insert. */
  autoIds?: boolean;
  /** Tabeller vars insatta rader utan `id` får ett numeriskt löpande id (1, 2, ...) — som en bigint identity (activity_log). */
  numericIds?: string[];
  /** Svar för supabase.rpc(namn, args). Okänd rpc → { data: null, error: null }. */
  rpc?: Record<string, (args: any) => { data?: unknown; error?: { message: string } | null }>;
}

function pick(row: Row, path: string): unknown {
  return path.split('.').reduce<any>((acc, key) => (acc == null ? undefined : acc[key]), row);
}

export function createFakeDb(tables: Record<string, Row[]>, options: FakeDbOptions = {}) {
  const queries: RecordedQuery[] = [];
  let nextId = 1;
  const numericCounters: Record<string, number> = {};
  const nextNumericId = (table: string) => (numericCounters[table] = (numericCounters[table] ?? 0) + 1);

  function from(table: string) {
    const q: RecordedQuery = { table, select: null, filters: [], range: null, limit: null };
    queries.push(q);
    let orderBy: Array<{ column: string; ascending: boolean }> = [];
    let wantCount = false;
    let head = false;
    let single = false;
    let maybe = false;
    let mutation: { kind: 'update' | 'insert' | 'delete' | 'upsert'; values?: Row | Row[]; onConflict?: string; ignoreDuplicates?: boolean } | null = null;

    const builder: any = {
      select(columns?: string, opts?: { count?: string; head?: boolean }) {
        q.select = columns ?? '*';
        if (opts?.count) wantCount = true;
        if (opts?.head) head = true;
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
      /** PostgREST-or: "col.eq.val,col2.neq.val,col3.is.null" — en rad matchar om NÅGOT villkor gäller. */
      or(expr: string) { q.filters.push({ op: 'or', column: '', value: expr }); return builder; },
      order(column: string, opts?: { ascending?: boolean }) {
        orderBy.push({ column, ascending: opts?.ascending ?? true });
        return builder;
      },
      update(values: Row) { mutation = { kind: 'update', values }; return builder; },
      insert(values: Row | Row[]) { mutation = { kind: 'insert', values }; return builder; },
      delete() { mutation = { kind: 'delete' }; return builder; },
      upsert(values: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
        mutation = { kind: 'upsert', values, onConflict: opts?.onConflict, ignoreDuplicates: opts?.ignoreDuplicates };
        return builder;
      },
      range(from: number, to: number) { q.range = [from, to]; return builder; },
      limit(n: number) { q.limit = n; return builder; },
      single() { single = true; return builder; },
      maybeSingle() { single = true; maybe = true; return builder; },
      then(resolve: (v: any) => void, reject?: (e: unknown) => void) {
        try { resolve(execute()); } catch (e) { reject?.(e); }
      },
    };

    function execute() {
      const err = options.errors?.[table] ?? options.failWhen?.(q);
      if (err) return { data: null, error: err, count: null };

      if (mutation?.kind === 'upsert') {
        // INSERT … ON CONFLICT (cols) DO NOTHING / DO UPDATE — konfliktkolumnerna är en kommalista.
        const raw = Array.isArray(mutation.values) ? mutation.values : [mutation.values as Row];
        const cols = (mutation.onConflict ?? 'id').split(',').map((c) => c.trim());
        const sameKey = (a: Row, b: Row) => cols.every((c) => a[c] !== undefined && a[c] === b[c]);
        const inserted: Row[] = [];
        for (const r of raw) {
          const existing = (tables[table] ?? []).find((e) => sameKey(e, r));
          if (existing) {
            if (!mutation.ignoreDuplicates) Object.assign(existing, r);
            continue;
          }
          const row = options.numericIds?.includes(table) && r.id === undefined ? { ...r, id: nextNumericId(table) } : r;
          tables[table] = [...(tables[table] ?? []), row];
          inserted.push(row);
        }
        return { data: single ? inserted[0] ?? null : inserted, error: null, count: null };
      }

      if (mutation?.kind === 'insert') {
        const raw = Array.isArray(mutation.values) ? mutation.values : [mutation.values as Row];
        const withGenerated = options.autoIds ? raw.map((r) => (r.id === undefined ? { ...r, id: `gen-${nextId++}` } : r)) : raw;
        const inserted = options.numericIds?.includes(table)
          ? withGenerated.map((r) => (r.id === undefined ? { ...r, id: nextNumericId(table) } : r))
          : withGenerated;
        tables[table] = [...(tables[table] ?? []), ...inserted];
        return { data: single ? inserted[0] ?? null : inserted, error: null, count: null };
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
            case 'or':
              return String(f.value).split(',').some((part) => {
                const [col, op, ...rest] = part.split('.');
                const val = rest.join('.');
                const cv = pick(r, col) as any;
                if (op === 'eq') return String(cv) === val;
                if (op === 'neq') return String(cv) !== val;
                if (op === 'is') return val === 'null' ? cv == null : String(cv) === val;
                return false;
              });
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
      // PostgREST svarar 416 (PGRST103) när offset ligger bortom sista raden
      if (q.range && q.range[0] > 0 && q.range[0] >= total) {
        return { data: null, error: { code: 'PGRST103', message: 'Requested range not satisfiable' }, count: null, status: 416 };
      }
      if (head) return { data: null, error: null, count: wantCount ? total : null };
      if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
      if (q.limit != null) rows = rows.slice(0, q.limit);
      // Kopior, som PostgREST: en rad som lästs ändras inte av en senare update (annars ser koden "nya" värden som "föregående").
      rows = rows.map((r) => ({ ...r }));
      if (single) return { data: rows[0] ?? null, error: rows[0] || maybe ? null : { message: 'not found', code: 'PGRST116' } };
      return { data: rows, error: null, count: wantCount ? total : null };
    }

    return builder;
  }

  function rpc(name: string, args?: any) {
    const result = options.rpc?.[name]?.(args) ?? { data: null, error: null };
    return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  }

  return { client: { from, rpc }, queries };
}
