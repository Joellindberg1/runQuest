import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backendEnvFile } from '../lib/backendEnvFile.js';

const BACKEND = path.resolve('/work/apps/backend');
const withPackageJsonAt = (...dirs: string[]) => (candidate: string) => dirs.some((dir) => candidate === path.join(dir, 'package.json'));

describe('backendEnvFile', () => {
  it('finds apps/backend/.env from the TypeScript source, two levels below the backend', () => {
    expect(backendEnvFile(path.join(BACKEND, 'src', 'scripts'), withPackageJsonAt(BACKEND))).toBe(path.join(BACKEND, '.env'));
  });

  it('finds the same file from the built dist/, one level below the backend', () => {
    expect(backendEnvFile(path.join(BACKEND, 'dist'), withPackageJsonAt(BACKEND))).toBe(path.join(BACKEND, '.env'));
  });

  it('falls back to the starting directory when no package.json is found on the way up', () => {
    expect(backendEnvFile(path.join(BACKEND, 'dist'), () => false)).toBe(path.join(BACKEND, 'dist', '.env'));
  });

  it('resolves to the real apps/backend from where the script sources live', () => {
    const scriptsDir = path.dirname(fileURLToPath(new URL('../sentryTest.ts', import.meta.url)));

    const envFile = backendEnvFile(scriptsDir, existsSync);

    expect(path.basename(path.dirname(envFile))).toBe('backend');
    expect(existsSync(path.join(path.dirname(envFile), 'package.json'))).toBe(true);
  });
});
