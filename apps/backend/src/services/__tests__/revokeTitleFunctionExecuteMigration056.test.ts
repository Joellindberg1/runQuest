/**
 * Static test: migration 056 closes EXECUTE on the three old title functions for public, anon and authenticated and makes sure
 * service_role holds it (ADR 012, ADR 002). Reads the SQL file from disk, no database.
 *
 * Why the behaviour is only read here and not run: privileges, the trigger and the wrappers exist only in Postgres, and staging and
 * prod are off limits for a builder. The tests therefore pin what makes the behaviour: the three full signatures, the revoke from
 * exactly the three client grantees, the grant to service_role, that nothing else is touched, the self-check that stops the
 * migration if a privilege is left, and the rollback block in the header. The proof in a real Postgres is the PGlite run in the
 * builder's report (anon and authenticated denied with 42501, service_role calls the wrappers, an insert fires the trigger) and the
 * catalog query in the header that Lead runs after apply.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const file = '056_revoke_legacy_title_function_execute.sql';
const sql = readFileSync(resolve(__dirname, '../../../migrations', file), 'utf8');

// Comments removed so that the rollback SQL and the catalog query in the header are not counted as executable code.
const code = sql.replace(/--.*$/gm, '');
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim();

const postcheck = code.match(/do \$postcheck\$[\s\S]*?\$postcheck\$;/i)?.[0] ?? '';
const statements = (postcheck ? code.replace(postcheck, ' ') : code).split(';').map(normalize).filter(Boolean);
const postcheckBody = normalize(postcheck);

const SIGNATURES = [
  'public.update_title_leaderboard(uuid)',
  'public.update_all_title_leaderboards()',
  'public.trigger_update_title_leaderboard()',
] as const;

/** Lines of the header between two markers that are executable SQL: `--` followed by at least three spaces. */
function headerBlock(name: string): string[] {
  const start = sql.indexOf(`-- ${name}-START`);
  const end = sql.indexOf(`-- ${name}-END`);
  expect(start, `${name}-START is missing`).toBeGreaterThan(-1);
  expect(end, `${name}-END is missing`).toBeGreaterThan(start);
  return sql
    .slice(start, end)
    .split(/\r?\n/)
    .filter((l) => /^--\s{3,}\S/.test(l))
    .map((l) => l.replace(/^--\s{3}/, ''));
}

describe(`migration ${file}`, () => {
  it('sets lock_timeout 5s as the first statement', () => {
    expect(statements[0]).toBe("set local lock_timeout = '5s'");
  });

  it('revokes execute from public, anon and authenticated on each of the three functions with the full signature', () => {
    for (const signature of SIGNATURES) {
      expect(statements, signature).toContain(`revoke execute on function ${signature} from public, anon, authenticated`);
    }
    expect(statements.filter((s) => s.startsWith('revoke'))).toHaveLength(3);
  });

  it('grants execute to service_role on each of the three functions, so the backend works whatever the default privileges are', () => {
    for (const signature of SIGNATURES) {
      expect(statements, signature).toContain(`grant execute on function ${signature} to service_role`);
    }
    expect(statements.filter((s) => s.startsWith('grant'))).toHaveLength(3);
  });

  it('touches nothing but those three functions and only their execute privilege', () => {
    // Exactly the six privilege statements plus lock_timeout: no create, drop, alter, table or data statement.
    expect(statements).toHaveLength(7);
    const named = [...code.matchAll(/\bpublic\.[a-z_]+\s*\([^)]*\)/gi)].map((m) => normalize(m[0]));
    expect(new Set(named)).toEqual(new Set(SIGNATURES));
    expect(code).not.toMatch(/\b(create|drop|alter|insert|update|delete|truncate)\b/i);
    // The group functions (055) and the shim keep their own grants; this migration does not mention them.
    expect(code).not.toMatch(/update_group_title_leaderboard|user_titles_fill_group_id/i);
    // Never widen: no grant to a client role or to public, and never revoke from service_role.
    expect(code).not.toMatch(/\bgrant\b[^;]*\bto\b[^;]*\b(public|anon|authenticated)\b/i);
    expect(code).not.toMatch(/\brevoke\b[^;]*\bservice_role\b/i);
    expect(code).not.toMatch(/\ball\b/i);
  });

  it('checks in the same transaction that no client role can execute and service_role can, and stops otherwise', () => {
    expect(postcheck).not.toBe('');
    expect(code.indexOf(postcheck)).toBeGreaterThan(code.lastIndexOf('grant execute'));
    for (const signature of SIGNATURES) {
      expect(postcheckBody, signature).toContain(`'${signature}'::regprocedure`);
    }
    // PUBLIC is grantee 0 in the ACL; anon and authenticated are checked with has_function_privilege (which also counts PUBLIC and inheritance).
    expect(postcheckBody).toContain('aclexplode');
    expect(postcheckBody).toMatch(/a\.grantee = 0/);
    expect(postcheckBody).toContain("has_function_privilege('anon'");
    expect(postcheckBody).toContain("has_function_privilege('authenticated'");
    expect(postcheckBody).toContain("has_function_privilege('service_role'");
    expect(postcheckBody).toContain('raise exception');
  });

  it('has a rollback in the header that grants execute back on the three functions, for staging with PUBLIC and for prod without', () => {
    const rollback = headerBlock('ROLLBACK').map(normalize);
    const grantBack = (grantees: string) => SIGNATURES.map((s) => `grant execute on function ${s} to ${grantees};`);
    expect(rollback).toEqual([
      "set local lock_timeout = '5s';",
      ...grantBack('public, anon, authenticated, service_role'),
      ...grantBack('anon, authenticated, service_role'),
    ]);
  });

  it('has a catalog query in the header that shows PUBLIC, anon, authenticated and service_role per function', () => {
    const query = headerBlock('QUERY').map(normalize).join(' ');
    for (const word of ["p.pronamespace = 'public'::regnamespace", 'a.grantee = 0', "has_function_privilege('anon'", "has_function_privilege('authenticated'", "has_function_privilege('service_role'", 'proacl']) {
      expect(query, word).toContain(word);
    }
    for (const name of ['update_title_leaderboard', 'update_all_title_leaderboards', 'trigger_update_title_leaderboard']) {
      expect(query, name).toContain(`'${name}'`);
    }
  });

  it('states the starting position of staging and prod and the order against 055 in the header', () => {
    expect(sql).toMatch(/Staging/);
    expect(sql).toMatch(/Prod/);
    expect(sql).toMatch(/055/);
    expect(sql).toMatch(/title_leaderboard_update_trigger/);
  });
});
