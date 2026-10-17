/**
 * stagingSeedGroup.ts — creates the test group "Staging Pack" in STAGING with four fictitious users (one admin, who owns the group).
 * Nothing comes from prod. The login is a random password generated on every run, written ONLY to the git-ignored file
 * staging-testkonton.seed in the repo root (*.seed is in .gitignore) and never printed.
 *
 * Re-runnable: when the group already exists nothing is written (and no new password is generated, so the old seed file stays valid).
 * When one of the test e-mail addresses exists outside the group the script refuses instead of guessing.
 *
 * Run:  npm run staging:seed-group --workspace=@runquest/backend -- [--apply]
 *   Without --apply it is a DRY-RUN: it reads staging, prints what it would create, writes no row and no file.
 * Needs SUPABASE_STAGING_ACCESS_TOKEN in the shell. The target is hard-coded to the staging project.
 */
import bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MissingEnvError,
  STAGING_PROJECT_REF,
  STAGING_TOKEN_ENV,
  StagingGuardError,
  createSay,
  createStagingClient,
  describeTarget,
  requireToken,
  runIfEntry,
  type FetchLike,
} from './stagingTarget.js';

export const STAGING_GROUP_NAME = 'Staging Pack';
export const SEED_FILE_NAME = 'staging-testkonton.seed';
export const DEFAULT_SEED_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..', SEED_FILE_NAME);
const BCRYPT_ROUNDS = 10;

export interface TestPerson {
  name: string;
  email: string;
  admin: boolean;
}

/** The first person is the admin and the group's owner (group model, 2026-10-16: admin = the creator). */
export const TEST_PEOPLE: readonly TestPerson[] = [
  { name: 'Testa Admin', email: 'admin@staging.runquest.test', admin: true },
  { name: 'Sixten Snabb', email: 'sixten@staging.runquest.test', admin: false },
  { name: 'Lova Långdistans', email: 'lova@staging.runquest.test', admin: false },
  { name: 'Kim Kvällslöpare', email: 'kim@staging.runquest.test', admin: false },
];

const escapeLiteral = (text: string) => text.replace(/'/g, "''");

export interface SeedGroupIds {
  groupId: string;
  userIds: string[];
  inviteCode: string;
  passwordHash: string;
}

export function buildSeedGroupSql(ids: SeedGroupIds): string {
  const adminId = ids.userIds[0];
  let sql = `begin;\ninsert into public.groups (id, name, invite_code, owner_id) values ('${ids.groupId}', '${escapeLiteral(STAGING_GROUP_NAME)}', '${escapeLiteral(ids.inviteCode)}', null);\n`;
  TEST_PEOPLE.forEach((person, i) => {
    sql += `insert into public.users (id, name, email, password_hash, is_admin, group_id) values ('${ids.userIds[i]}', '${escapeLiteral(person.name)}', '${person.email}', '${escapeLiteral(ids.passwordHash)}', ${person.admin}, '${ids.groupId}');\n`;
  });
  return `${sql}update public.groups set owner_id = '${adminId}' where id = '${ids.groupId}';\ncommit;`;
}

export function formatSeedFile(input: { inviteCode: string; password: string }): string {
  return (
    `# Testkonton i STAGING (${STAGING_PROJECT_REF}). Gitignorerad (*.seed). Aldrig i prod.\n` +
    `# Grupp: ${STAGING_GROUP_NAME}, inbjudningskod ${input.inviteCode}\n` +
    `# Samma lösenord för alla: ${input.password}\n` +
    `${TEST_PEOPLE.map((p) => `${p.email}  ${p.name}${p.admin ? '  (admin, gruppens skapare)' : ''}`).join('\n')}\n`
  );
}

export interface SeedGroupOptions {
  apply: boolean;
}

export function parseArgs(argv: string[]): SeedGroupOptions {
  const usage = 'Usage: staging:seed-group [--apply]';
  let apply = false;
  for (const arg of argv) {
    if (arg === '--apply') apply = true;
    else throw new Error(`Unknown argument (not echoed, it could be a secret typed in the wrong place). ${usage}`);
  }
  return { apply };
}

export type SeedGroupOutcome = 'dry_run' | 'created' | 'already_exists' | 'refused_email_taken' | 'missing_env' | 'refused' | 'failed';

export interface SeedGroupReport {
  outcome: SeedGroupOutcome;
  apply: boolean;
  seedFile?: string;
  lines: string[];
}

export interface RunSeedGroupInput {
  apply: boolean;
  env: NodeJS.ProcessEnv;
  fetchImpl: FetchLike;
  log: (line: string) => void;
  seedFile?: string;
  /** Injectable for the tests. */
  hashPassword?: (password: string) => Promise<string>;
  generatePassword?: () => string;
  writeSeedFile?: (path: string, content: string) => void;
  removeSeedFile?: (path: string) => void;
}

export function exitCodeFor(report: Pick<SeedGroupReport, 'outcome'>): 0 | 1 {
  return report.outcome === 'dry_run' || report.outcome === 'created' || report.outcome === 'already_exists' ? 0 : 1;
}

const defaultWriteSeedFile = (path: string, content: string) => {
  writeFileSync(path, content, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows ignores the mode; the file is git-ignored either way.
  }
};

export async function runSeedGroup(input: RunSeedGroupInput): Promise<SeedGroupReport> {
  const { apply, env, fetchImpl } = input;
  const seedFile = input.seedFile ?? DEFAULT_SEED_FILE;
  const hashPassword = input.hashPassword ?? ((password: string) => bcrypt.hash(password, BCRYPT_ROUNDS));
  const generatePassword = input.generatePassword ?? (() => randomBytes(18).toString('base64url'));
  const writeSeedFile = input.writeSeedFile ?? defaultWriteSeedFile;
  const removeSeedFile = input.removeSeedFile ?? ((path: string) => rmSync(path, { force: true }));

  // The password is generated before anything is printed so that it, and the hash made from it, can be scrubbed from every line.
  const password = apply ? generatePassword() : '';
  const passwordHash = apply ? await hashPassword(password) : '';
  const { say, lines } = createSay(input.log, [env[STAGING_TOKEN_ENV] ?? '', password, passwordHash]);
  const report: SeedGroupReport = { outcome: 'failed', apply, lines };
  const finish = (outcome: SeedGroupOutcome): SeedGroupReport => ({ ...report, outcome });

  say(`staging:seed-group${apply ? ' --apply' : ' — DRY-RUN (nothing is written)'}`);
  say(`Target: ${describeTarget(STAGING_PROJECT_REF)}`);

  let client;
  try {
    // The password and its hash are scrubbed from an error body before it is cut, because the server may echo the failing statement.
    client = createStagingClient({ token: requireToken(env, STAGING_TOKEN_ENV), fetchImpl, extraSecrets: [password, passwordHash] });
  } catch (err) {
    if (err instanceof MissingEnvError) {
      say(err.message);
      return finish('missing_env');
    }
    if (err instanceof StagingGuardError) {
      say(err.message);
      return finish('refused');
    }
    throw err;
  }

  const existsSql = `select count(*)::int as n from public.groups where name = '${escapeLiteral(STAGING_GROUP_NAME)}'`;
  const emails = TEST_PEOPLE.map((p) => `'${p.email}'`).join(', ');
  let existingGroups: number;
  let takenEmails: number;
  try {
    const groups = await client.query(existsSql);
    existingGroups = Number(groups[0]?.n);
    const users = await client.query(`select count(*)::int as n from public.users where email in (${emails})`);
    takenEmails = Number(users[0]?.n);
  } catch (err) {
    say(`Could not check staging (${err instanceof Error ? err.message : 'error'}): nothing was written.`);
    return finish('failed');
  }
  if (!Number.isFinite(existingGroups) || !Number.isFinite(takenEmails)) {
    say('Could not read the existence check: nothing was written.');
    return finish('failed');
  }

  if (existingGroups > 0) {
    say(`"${STAGING_GROUP_NAME}" already exists in staging: nothing to do. The login is in ${SEED_FILE_NAME} from the run that created it.`);
    return finish('already_exists');
  }
  if (takenEmails > 0) {
    say(`One or more of the test e-mail addresses already exist outside "${STAGING_GROUP_NAME}": refusing to guess, nothing was written.`);
    return finish('refused_email_taken');
  }

  say(`${apply ? 'Creating' : 'Would create'} the group "${STAGING_GROUP_NAME}" with ${TEST_PEOPLE.length} users:`);
  for (const p of TEST_PEOPLE) say(`  ${p.email}  ${p.name}${p.admin ? '  (admin, owner)' : ''}`);
  if (!apply) {
    say(`The password is generated at --apply and written only to ${SEED_FILE_NAME} (git-ignored). Re-run with --apply to create them.`);
    return finish('dry_run');
  }

  const ids: SeedGroupIds = {
    groupId: randomUUID(),
    userIds: TEST_PEOPLE.map(() => randomUUID()),
    inviteCode: `STG${randomBytes(3).toString('hex').toUpperCase()}`,
    passwordHash,
  };
  // The file is written first so that the password cannot be lost after the rows exist; it is removed again if the insert fails.
  try {
    writeSeedFile(seedFile, formatSeedFile({ inviteCode: ids.inviteCode, password }));
  } catch {
    say('Could not write the seed file: nothing was created.');
    return finish('failed');
  }
  try {
    await client.query(buildSeedGroupSql(ids));
  } catch (err) {
    say(`Creating failed (${err instanceof Error ? err.message : 'error'}).`);
    // Remove the file only when it is certain that the group does not exist: if the insert did go through (a lost answer), the file is the
    // only copy of the password.
    let groupExists: boolean | undefined;
    try {
      groupExists = Number((await client.query(existsSql))[0]?.n) > 0;
    } catch {
      groupExists = undefined;
    }
    if (groupExists === false) {
      removeSeedFile(seedFile);
      say('The group does not exist, so the insert did not go through; the seed file was removed.');
    } else {
      say(`Could not confirm that the group is absent, so ${seedFile} was KEPT: check staging before running again.`);
    }
    return finish('failed');
  }
  say(`Created the group (invite code ${ids.inviteCode}) and ${TEST_PEOPLE.length} users. The login is in ${seedFile} (git-ignored, not printed here).`);
  return { ...report, outcome: 'created', seedFile, lines };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runSeedGroup({ ...options, env: process.env, fetchImpl: fetch, log: (line) => console.log(line) });
  process.exitCode = exitCodeFor(report);
}

runIfEntry(import.meta.url, 'staging:seed-group', main);
