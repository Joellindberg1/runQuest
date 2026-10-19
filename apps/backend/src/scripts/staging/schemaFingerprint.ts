/**
 * schemaFingerprint.ts — the pure part of staging:schema-diff. Catalog queries that give a project's schema a comparable fingerprint,
 * the normalisation of text that differs without meaning, the diff of two fingerprints, and the list of known, explained differences.
 *
 * Each query returns rows { key, value }: key names the object, value is a deterministic text of everything we compare about it.
 * All queries are plain SELECTs on the system catalogs of schema public (they must pass assertReadOnlySql, because they also run on prod).
 */
import type { Row } from './stagingTarget.js';

export type FingerprintCategory =
  | 'columns'
  | 'relations'
  | 'functions'
  | 'function_grants'
  | 'table_grants'
  | 'column_grants'
  | 'policies'
  | 'indexes'
  | 'constraints'
  | 'triggers'
  | 'views'
  | 'enums';

/** The order the diff is printed in. */
export const FINGERPRINT_CATEGORIES: readonly FingerprintCategory[] = [
  'relations',
  'columns',
  'constraints',
  'indexes',
  'triggers',
  'policies',
  'table_grants',
  'column_grants',
  'functions',
  'function_grants',
  'views',
  'enums',
];

const PUBLIC_NS = "(select oid from pg_namespace where nspname = 'public')";
const NOT_EXTENSION_OWNED = (classid: string, objid: string) =>
  `not exists (select 1 from pg_depend d where d.classid = '${classid}'::regclass and d.objid = ${objid} and d.deptype = 'e')`;
const FUNCTION_KEY = "'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'";
const GRANTEE ="case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end";

/** One catalog query per category. Ordered by key so that two runs over the same schema print the same. */
export const FINGERPRINT_QUERIES: Readonly<Record<FingerprintCategory, string>> = {
  // Tables, views, materialized views, sequences: kind and row level security. FORCE RLS is part of "RLS".
  // The owner and the storage options (reloptions, e.g. security_invoker on a view) are part of the relation.
  relations: `select c.relname as key, jsonb_build_object('kind', c.relkind::text, 'rls_enabled', c.relrowsecurity, 'rls_forced', c.relforcerowsecurity,
    'owner', pg_get_userbyid(c.relowner), 'options', c.reloptions::text)::text as value
    from pg_class c where c.relnamespace = ${PUBLIC_NS} and c.relkind in ('r','p','v','m','S') order by 1`,
  // From pg_attribute, not information_schema (which only shows columns the reading role has a privilege on). Position is left out: a dropped
  // column leaves a gap that a fresh baseline does not have.
  columns: `select c.relname || '.' || a.attname as key, jsonb_build_object('type', format_type(a.atttypid, a.atttypmod), 'not_null', a.attnotnull,
    'default', pg_get_expr(d.adbin, d.adrelid), 'identity', a.attidentity::text, 'generated', a.attgenerated::text)::text as value
    from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where c.relnamespace = ${PUBLIC_NS} and c.relkind in ('r','p','v','m') order by 1`,
  // Table names come from a join, not from a regclass cast: a cast prints the schema or not depending on the search_path of the session.
  constraints: `select r.relname || '.' || k.conname as key, jsonb_build_object('type', k.contype::text, 'definition', pg_get_constraintdef(k.oid))::text as value
    from pg_constraint k join pg_class r on r.oid = k.conrelid where k.connamespace = ${PUBLIC_NS} and k.contype <> 'n' order by 1`,
  indexes: `select tablename || '.' || indexname as key, jsonb_build_object('definition', indexdef)::text as value
    from pg_indexes where schemaname = 'public' order by 1`,
  triggers: `select r.relname || '.' || t.tgname as key, jsonb_build_object('definition', pg_get_triggerdef(t.oid), 'enabled', t.tgenabled::text)::text as value
    from pg_trigger t join pg_class r on r.oid = t.tgrelid where not t.tgisinternal and r.relnamespace = ${PUBLIC_NS} order by 1`,
  policies: `select tablename || '.' || policyname as key, jsonb_build_object('permissive', permissive, 'roles', array_to_string(roles, ','), 'cmd', cmd,
    'using', qual, 'with_check', with_check)::text as value from pg_policies where schemaname = 'public' order by 1`,
  // acldefault takes a "char", not text: a CASE of two string literals is text, and acldefault(text, oid) does not exist (found on the first
  // real run). The casts below are locked by a test.
  table_grants: `select c.relname || ' -> ' || ${GRANTEE} || ' ' || a.privilege_type as key, jsonb_build_object('grantable', a.is_grantable)::text as value
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 's'::"char" else 'r'::"char" end, c.relowner))) a
    where c.relnamespace = ${PUBLIC_NS} and c.relkind in ('r','p','v','m','S') order by 1`,
  column_grants: `select c.relname || '.' || t.attname || ' -> ' || ${GRANTEE} || ' ' || a.privilege_type as key, jsonb_build_object('grantable', a.is_grantable)::text as value
    from pg_class c join pg_attribute t on t.attrelid = c.oid and t.attacl is not null and not t.attisdropped
    cross join lateral aclexplode(t.attacl) a where c.relnamespace = ${PUBLIC_NS} order by 1`,
  // pg_get_functiondef is the whole definition including the body; the diff normalises line endings and blank lines (normalizeSqlText).
  // The key is the signature with parameter names, written out (not a regprocedure cast, whose output depends on the search_path).
  // The owner is the first line of the value.
  functions: `select ${FUNCTION_KEY} as key, 'owner: ' || pg_get_userbyid(p.proowner) || chr(10) || pg_get_functiondef(p.oid) as value
    from pg_proc p where p.pronamespace = ${PUBLIC_NS} and p.prokind in ('f','p') and ${NOT_EXTENSION_OWNED('pg_proc', 'p.oid')} order by 1`,
  // Function grants with the default made explicit: a function without an ACL has EXECUTE for PUBLIC.
  function_grants: `select ${FUNCTION_KEY} || ' -> ' || ${GRANTEE} || ' ' || a.privilege_type as key, jsonb_build_object('grantable', a.is_grantable)::text as value
    from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) a
    where p.pronamespace = ${PUBLIC_NS} and p.prokind in ('f','p') and ${NOT_EXTENSION_OWNED('pg_proc', 'p.oid')} order by 1`,
  views: `select viewname as key, 'owner: ' || viewowner || chr(10) || definition as value from pg_views where schemaname = 'public' order by 1`,
  enums: `select t.typname as key, (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid) as value
    from pg_type t where t.typnamespace = ${PUBLIC_NS} and t.typtype = 'e' order by 1`,
};

export type Fingerprint = Record<FingerprintCategory, Map<string, string>>;

/**
 * Text that differs without meaning: CRLF/CR line endings, trailing whitespace on a line, blank lines and blank lines at the ends.
 * Used for function and view bodies (two function bodies differed 2026-10-17 only by CRLF and blank lines).
 */
export function normalizeSqlText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line !== '')
    .join('\n');
}

const NORMALIZED: ReadonlySet<FingerprintCategory> = new Set(['functions', 'views']);

/** Turns the rows of one query into a map. Duplicate keys and rows without a key are errors (they would hide a difference). */
export function rowsToMap(category: FingerprintCategory, rows: Row[], options: { normalize: boolean }): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.key !== 'string' || row.key === '') throw new Error(`${category}: a row without a key.`);
    if (map.has(row.key)) throw new Error(`${category}: the key ${row.key} occurs twice.`);
    const value = row.value === null || row.value === undefined ? '' : String(row.value);
    map.set(row.key, options.normalize && NORMALIZED.has(category) ? normalizeSqlText(value) : value);
  }
  return map;
}

/** A category's rows both raw and normalised, so that the diff can report differences that normalisation removed. */
export function buildCategory(category: FingerprintCategory, rows: Row[]): { normalized: Map<string, string>; raw: Map<string, string> } {
  return { normalized: rowsToMap(category, rows, { normalize: true }), raw: rowsToMap(category, rows, { normalize: false }) };
}

export interface SideFingerprint {
  normalized: Fingerprint;
  raw: Fingerprint;
}

export function buildFingerprint(rowsByCategory: Record<FingerprintCategory, Row[]>): SideFingerprint {
  const normalized = {} as Fingerprint;
  const raw = {} as Fingerprint;
  for (const category of FINGERPRINT_CATEGORIES) {
    const built = buildCategory(category, rowsByCategory[category]);
    normalized[category] = built.normalized;
    raw[category] = built.raw;
  }
  return { normalized, raw };
}

export type DiffKind = 'only_in_prod' | 'only_in_staging' | 'different';

export interface DiffEntry {
  category: FingerprintCategory;
  key: string;
  kind: DiffKind;
  prod?: string;
  staging?: string;
  /** Set when the entry is a known, explained difference. */
  known?: string;
}

export interface SchemaDiff {
  entries: DiffEntry[];
  /** Keys whose raw text differs but whose normalised text is equal (the CRLF/blank-line noise). Not a difference. */
  normalizedAway: { category: FingerprintCategory; key: string }[];
  /** The number of keys compared per category (prod), for the summary. */
  compared: Record<FingerprintCategory, number>;
}

export function diffFingerprints(prod: SideFingerprint, staging: SideFingerprint): SchemaDiff {
  const entries: DiffEntry[] = [];
  const normalizedAway: SchemaDiff['normalizedAway'] = [];
  const compared = {} as Record<FingerprintCategory, number>;
  for (const category of FINGERPRINT_CATEGORIES) {
    const p = prod.normalized[category];
    const s = staging.normalized[category];
    compared[category] = p.size;
    for (const key of [...new Set([...p.keys(), ...s.keys()])].sort()) {
      const inProd = p.has(key);
      const inStaging = s.has(key);
      if (inProd && !inStaging) entries.push({ category, key, kind: 'only_in_prod', prod: p.get(key) });
      else if (!inProd && inStaging) entries.push({ category, key, kind: 'only_in_staging', staging: s.get(key) });
      else if (p.get(key) !== s.get(key)) entries.push({ category, key, kind: 'different', prod: p.get(key), staging: s.get(key) });
      else if (prod.raw[category].get(key) !== staging.raw[category].get(key)) normalizedAway.push({ category, key });
    }
  }
  return { entries, normalizedAway, compared };
}

/**
 * Known, explained differences. A rule names the exact keys it explains. It applies only when the set of entries of its kind (for example every
 * EXECUTE grant to one role that exists only in prod) is EXACTLY that set: one more difference of the same kind, or one of them having been fixed,
 * means that none of them is treated as known and the person reading the diff has to look again.
 */
export interface KnownRule {
  id: string;
  explanation: string;
  /** Which entries the rule is about; the rule applies only when their keys are exactly `expectedKeys`. */
  candidate: (entry: DiffEntry) => boolean;
  expectedKeys: readonly string[];
}

/**
 * Empty on purpose: both projects have 056 since 2026-10-19, so every difference is unexplained until a rule with a reason is added here.
 * (Until 056, prod lacked PUBLIC execute on four title/xp functions while staging had it, RUN-226; a temporary rule covered the anon and
 * authenticated grants between the two applies. Both rules are gone.)
 */
export const KNOWN_DIFFERENCES: readonly KnownRule[] = [];

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && new Set(a).size === a.length && a.every((k) => b.includes(k));

export function markKnown(entries: DiffEntry[], rules: readonly KnownRule[] = KNOWN_DIFFERENCES): DiffEntry[] {
  const marked = entries.map((e) => ({ ...e }));
  for (const rule of rules) {
    const hits = marked.filter((e) => rule.candidate(e));
    if (!sameSet(hits.map((e) => e.key), rule.expectedKeys)) continue;
    for (const e of hits) e.known = rule.explanation;
  }
  return marked;
}

/** The rules that found candidates but not exactly their expected keys, with what is missing and what is extra, for a warning line. */
export function unmatchedRules(entries: DiffEntry[], rules: readonly KnownRule[] = KNOWN_DIFFERENCES): { rule: KnownRule; missing: string[]; extra: string[] }[] {
  const out: { rule: KnownRule; missing: string[]; extra: string[] }[] = [];
  for (const rule of rules) {
    const keys = entries.filter((e) => rule.candidate(e)).map((e) => e.key);
    if (keys.length === 0 || sameSet(keys, rule.expectedKeys)) continue;
    out.push({ rule, missing: rule.expectedKeys.filter((k) => !keys.includes(k)), extra: keys.filter((k) => !rule.expectedKeys.includes(k)) });
  }
  return out;
}

/** What the fingerprint does not look at. Printed with every diff so that "no difference" is not read as "identical in every respect". */
export const NOT_COMPARED: readonly string[] = [
  'the storage and auth schemas (the profile-pictures bucket and its policies live in storage)',
  'default privileges (pg_default_acl)',
  'extensions and their versions',
  'event triggers',
  'constraints on domain types (pg_constraint rows with contypid set)',
  'data, sequences\' current values, and statistics',
  'roles and their settings',
];

const MAX_VALUE_LENGTH = 300;
const clip = (text: string) => (text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text);

/** For a multi-line value: the first line that differs, so a 200-line function does not flood the output. */
function firstDifferingLine(a: string, b: string): string {
  const al = a.split('\n');
  const bl = b.split('\n');
  const n = Math.max(al.length, bl.length);
  for (let i = 0; i < n; i++) {
    if (al[i] !== bl[i]) return `line ${i + 1}:\n        prod:    ${clip(al[i] ?? '(none)')}\n        staging: ${clip(bl[i] ?? '(none)')}`;
  }
  return '';
}

export function formatDiff(diff: SchemaDiff): string[] {
  const lines: string[] = [];
  const entries = markKnown(diff.entries);
  const unexplained = entries.filter((e) => !e.known);
  const known = entries.filter((e) => e.known);

  lines.push(`Compared (objects in prod): ${FINGERPRINT_CATEGORIES.map((c) => `${c}=${diff.compared[c]}`).join(' ')}`);
  if (diff.normalizedAway.length > 0) {
    lines.push(`Normalised away (CRLF / blank lines only, not a difference): ${diff.normalizedAway.map((n) => `${n.category}:${n.key}`).join(', ')}`);
  }
  lines.push(`Not compared: ${NOT_COMPARED.join('; ')}.`);
  for (const { rule, missing, extra } of unmatchedRules(diff.entries)) {
    lines.push(
      `Note: rule "${rule.id}" explains exactly ${rule.expectedKeys.length} grants, so none of the matching entries is treated as known.` +
        `${missing.length > 0 ? ` Not found: ${missing.join('; ')}.` : ''}${extra.length > 0 ? ` Not on the list: ${extra.join('; ')}.` : ''}`,
    );
  }

  const describe = (e: DiffEntry): string[] => {
    const head = `  [${e.category}] ${e.key}: ${e.kind.replace(/_/g, ' ')}`;
    if (e.kind === 'only_in_prod') return [head, `      prod: ${clip(e.prod ?? '')}`];
    if (e.kind === 'only_in_staging') return [head, `      staging: ${clip(e.staging ?? '')}`];
    const a = e.prod ?? '';
    const b = e.staging ?? '';
    if (a.includes('\n') || b.includes('\n')) return [head, `      differs at ${firstDifferingLine(a, b)}`];
    return [head, `      prod:    ${clip(a)}`, `      staging: ${clip(b)}`];
  };

  lines.push(unexplained.length === 0 ? 'Unexplained differences: none.' : `Unexplained differences: ${unexplained.length}`);
  for (const e of unexplained) lines.push(...describe(e));
  if (known.length > 0) {
    lines.push(`Known differences: ${known.length}`);
    for (const e of known) lines.push(`  [${e.category}] ${e.key} (known: ${e.known})`);
  }
  return lines;
}

/** 0 when every difference is known, 1 otherwise. */
export function hasUnexplainedDifferences(diff: SchemaDiff): boolean {
  return markKnown(diff.entries).some((e) => !e.known);
}
