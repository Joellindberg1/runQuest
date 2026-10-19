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
  /** Typ av skrivning om queryn är en mutation (för failWhen). */
  mutation?: 'update' | 'insert' | 'delete' | 'upsert';
}

export interface FakeDbOptions {
  /** Tabeller som ska svara med fel (PostgREST-liknande). */
  errors?: Record<string, { message: string }>;
  /** Fel för enskilda queries (t.ex. bara historikfrågan) — utvärderas vid körning, när alla filter är satta. */
  failWhen?: (q: RecordedQuery) => { message: string; code?: string; details?: string } | null;
  /** Ger insatta rader utan `id` ett löpande id ('gen-1', ...) — för routes som läser tillbaka id efter insert. */
  autoIds?: boolean;
  /** Tabeller vars insatta rader utan `id` får ett numeriskt löpande id (1, 2, ...) — som en bigint identity (activity_log). */
  numericIds?: string[];
  /**
   * Unika index som INSERT ska respektera (Postgres-semantik: rader där någon kolumn är null ingår aldrig i ett
   * partiellt index med `is not null`-villkor, och null krockar inte med null). En krock ger 23505 med indexnamnet i
   * meddelandet, som PostgREST. `beforeInsert` körs före varje insert i tabellen (t.ex. för att simulera ett samtidigt anrop).
   */
  uniqueIndexes?: Array<{ table: string; name: string; columns: string[] }>;
  /**
   * Primärnycklar för tabeller som upsertas utan `onConflict` — som i Postgres, där konflikten då avgörs av PK.
   * Utan en post här faller fakeDb tillbaka på kolumnen `id`. Unika index (`uniqueIndexes`) gäller även upsert: en krock
   * med en ANNAN rad än den som upsertas ger 23505, som i Postgres.
   */
  primaryKeys?: Record<string, string[]>;
  /** Anropas precis innan en insert i `table` utvärderas — för att simulera att en annan förfrågan hann före. */
  beforeInsert?: (table: string, tables: Record<string, Row[]>) => void;
  /** Svar för supabase.rpc(namn, args). Okänd rpc → { data: null, error: null }. */
  rpc?: Record<string, (args: any) => { data?: unknown; error?: { message: string; code?: string; details?: string; hint?: string } | null }>;
}

function pick(row: Row, path: string): unknown {
  return path.split('.').reduce<any>((acc, key) => (acc == null ? undefined : acc[key]), row);
}

/** Delar ett PostgREST-logikuttryck vid kommatecken på toppnivå: inte inuti "citat" (med \-escape), (parenteser) eller {klamrar}. */
function splitTopLevel(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (quoted) {
      if (ch === '\\') i++;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === '(' || ch === '{') depth++;
    else if (ch === ')' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) { parts.push(expr.slice(start, i)); start = i + 1; }
  }
  parts.push(expr.slice(start));
  return parts;
}

/** Ett citerat PostgREST-värde ("...", med \" och \\ som escape) avcitas; ett oquotat värde används som det är. */
function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1).replace(/\\(.)/g, '$1');
  return value;
}

/** Postgres jsonb `@>`: objekt innehåller nycklar rekursivt, en lista innehåller varje element i någon av sina egna, skalärer är lika. */
function jsonContains(container: unknown, contained: unknown): boolean {
  const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (Array.isArray(container) && Array.isArray(contained)) {
    return contained.every((e) => container.some((c) => jsonContains(c, e)));
  }
  if (isObject(container) && isObject(contained)) {
    return Object.entries(contained).every(([k, v]) => k in container && jsonContains(container[k], v));
  }
  if (Array.isArray(container) || Array.isArray(contained) || isObject(container) || isObject(contained)) return false;
  return container === contained;
}

/** Ett enskilt `kolumn.operator.värde` eller en nästlad `and(...)`/`or(...)` i ett or()-uttryck. */
function matchesTerm(row: Row, term: string): boolean {
  const nested = /^(and|or)\((.*)\)$/s.exec(term);
  if (nested) return matchesLogic(row, nested[2], nested[1] as 'and' | 'or');
  const [col, op, ...rest] = term.split('.');
  const val = unquote(rest.join('.'));
  const cv = pick(row, col) as any;
  switch (op) {
    case 'eq': return String(cv) === val;
    case 'neq': return String(cv) !== val;
    case 'lt': return cv != null && Number(cv) < Number(val);
    case 'gt': return cv != null && Number(cv) > Number(val);
    case 'is': return val === 'null' ? cv == null : String(cv) === val;
    case 'cs': {
      let wanted: unknown;
      try { wanted = JSON.parse(val); } catch { throw new Error(`fakeDb: cs stöder bara en jsonb-literal, fick "${val}"`); }
      return cv != null && jsonContains(cv, wanted);
    }
    default:
      // PostgREST svarar 400 på en okänd operator; ett test får aldrig tyst gå mot en falsk modell.
      throw new Error(`fakeDb: operatorn "${op}" i or()-uttrycket stöds inte (${term})`);
  }
}

function matchesLogic(row: Row, expr: string, mode: 'and' | 'or'): boolean {
  const terms = splitTopLevel(expr);
  return mode === 'and' ? terms.every((t) => matchesTerm(row, t)) : terms.some((t) => matchesTerm(row, t));
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
      /** PostgREST-not, stöder `in` med listsyntax: .not('days', 'in', '(5,30)'). */
      not(column: string, operator: string, value: unknown) {
        q.filters.push({ op: `not.${operator}`, column, value });
        return builder;
      },
      /** PostgREST-or: "col.eq.val,col2.neq.val,col3.is.null" — en rad matchar om NÅGOT villkor gäller. */
      or(expr: string) { q.filters.push({ op: 'or', column: '', value: expr }); return builder; },
      order(column: string, opts?: { ascending?: boolean }) {
        orderBy.push({ column, ascending: opts?.ascending ?? true });
        return builder;
      },
      update(values: Row) { mutation = { kind: 'update', values }; q.mutation = 'update'; return builder; },
      insert(values: Row | Row[]) { mutation = { kind: 'insert', values }; q.mutation = 'insert'; return builder; },
      delete() { mutation = { kind: 'delete' }; q.mutation = 'delete'; return builder; },
      upsert(values: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
        mutation = { kind: 'upsert', values, onConflict: opts?.onConflict, ignoreDuplicates: opts?.ignoreDuplicates };
        q.mutation = 'upsert';
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
      // Före felkontrollen: ett simulerat samtidigt anrop hinner committa oavsett om vår egen insert sedan felar.
      if (mutation?.kind === 'insert') options.beforeInsert?.(table, tables);
      const err = options.errors?.[table] ?? options.failWhen?.(q);
      if (err) return { data: null, error: err, count: null };

      if (mutation?.kind === 'upsert') {
        // INSERT … ON CONFLICT (cols) DO NOTHING / DO UPDATE — konfliktkolumnerna är en kommalista.
        const raw = Array.isArray(mutation.values) ? mutation.values : [mutation.values as Row];
        const cols = mutation.onConflict ? mutation.onConflict.split(',').map((c) => c.trim()) : options.primaryKeys?.[table] ?? ['id'];
        const sameKey = (a: Row, b: Row) => cols.every((c) => a[c] !== undefined && a[c] === b[c]);
        const inserted: Row[] = [];
        const written: Row[] = []; // insatta + uppdaterade, i ordning
        for (const r of raw) {
          const existing = (tables[table] ?? []).find((e) => sameKey(e, r));
          // Unikt index: en ANNAN rad än den som upsertas med samma icke-null nyckel → 23505, som i Postgres.
          for (const index of options.uniqueIndexes ?? []) {
            if (index.table !== table) continue;
            const merged: Row = { ...existing, ...r };
            if (!index.columns.every((c) => merged[c] != null)) continue;
            const clash = (tables[table] ?? []).some((e) => e !== existing && index.columns.every((c) => e[c] != null && e[c] === merged[c]));
            if (clash) {
              return {
                data: null,
                error: {
                  code: '23505',
                  message: `duplicate key value violates unique constraint "${index.name}"`,
                  details: `Key (${index.columns.join(', ')}) already exists.`,
                },
                count: null,
              };
            }
          }
          if (existing) {
            if (!mutation.ignoreDuplicates) { Object.assign(existing, r); written.push(existing); }
            continue;
          }
          const row = options.numericIds?.includes(table) && r.id === undefined ? { ...r, id: nextNumericId(table) } : r;
          tables[table] = [...(tables[table] ?? []), row];
          inserted.push(row);
          written.push(row);
        }
        // PostgREST: utan .select() svarar en upsert return=minimal (data null). Med .select() kommer bara de rader som
        // skrevs: med ignoreDuplicates de nyinsatta (ON CONFLICT DO NOTHING RETURNING), annars även de uppdaterade.
        if (q.select === null) return { data: null, error: null, count: null };
        const returned = mutation.ignoreDuplicates ? inserted : written;
        return { data: single ? returned[0] ?? null : returned, error: null, count: null };
      }

      if (mutation?.kind === 'insert') {
        const raw = Array.isArray(mutation.values) ? mutation.values : [mutation.values as Row];
        for (const index of options.uniqueIndexes ?? []) {
          if (index.table !== table) continue;
          const taken = (r: Row) => index.columns.every((c) => r[c] != null);
          for (const r of raw.filter(taken)) {
            if ((tables[table] ?? []).some((e) => taken(e) && index.columns.every((c) => e[c] === r[c]))) {
              return {
                data: null,
                error: {
                  code: '23505',
                  message: `duplicate key value violates unique constraint "${index.name}"`,
                  details: `Key (${index.columns.join(', ')}) already exists.`,
                },
                count: null,
              };
            }
          }
        }
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
            case 'not.in': {
              const list = String(f.value).replace(/^\(|\)$/g, '').split(',').map((s) => s.trim());
              return !list.includes(String(v));
            }
            case 'not.is': return f.value === null ? v != null : v !== f.value;
            case 'or': return matchesLogic(r, String(f.value), 'or');
            default:
              // En okänd not-operator får aldrig tyst matcha alla rader (en delete skulle då tömma tabellen).
              if (f.op.startsWith('not.')) throw new Error(`fakeDb: ${f.op} stöds inte`);
              return true;
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
      // PostgREST: single() och maybeSingle() svarar PGRST116 när mer än en rad matchar (och single() även när ingen gör det).
      if (single && rows.length > 1) return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } };
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
