import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, type Plugin } from 'vite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import viteConfig from '../../vite.config';
import { stripSourceMaps } from '../../stripSourceMaps';

// Källkartorna ska nå Sentry men aldrig vår publika dist/. Provet bygger ett litet projekt med dolda källkartor, med och utan pluginen,
// och en falsk "uppladdare" som läser kartorna i writeBundle (där Sentrys plugin laddar upp) för att visa att de finns kvar tills dess.

let workDir: string;

const mapFilesIn = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.map'))
    .map((entry) => join(entry.parentPath, entry.name));

async function buildFixture(name: string, extraPlugins: Plugin[]): Promise<string> {
  const root = join(workDir, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'index.html'), '<!doctype html><script type="module" src="/main.js"></script>');
  writeFileSync(join(root, 'main.js'), 'import("./lazy.js").then((m) => console.log(m.value));\n');
  writeFileSync(join(root, 'lazy.js'), 'export const value = "lazy chunk";\n');
  await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: extraPlugins,
    build: { outDir: join(root, 'dist'), emptyOutDir: true, sourcemap: 'hidden' },
  });
  return join(root, 'dist');
}

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'rq-strip-maps-'));
});
afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('source maps in the built output', () => {
  it('a hidden-source-map build without the plugin leaves .map files in dist (what the plugin prevents)', async () => {
    const dist = await buildFixture('without-plugin', []);
    expect(mapFilesIn(dist).length).toBeGreaterThan(0);
  });

  it('removes every .map file from dist, and the scripts do not point at a map', async () => {
    const dist = await buildFixture('with-plugin', [stripSourceMaps()]);

    expect(mapFilesIn(dist)).toEqual([]);
    const scripts = readdirSync(join(dist, 'assets')).filter((name) => name.endsWith('.js'));
    expect(scripts.length).toBeGreaterThan(1);
    for (const script of scripts) expect(readFileSync(join(dist, 'assets', script), 'utf8')).not.toContain('sourceMappingURL');
  });

  it('keeps the maps until the upload step has read them, then removes them', async () => {
    const seenByUpload: string[] = [];
    const upload: Plugin = {
      name: 'fake-upload',
      writeBundle: async (options) => {
        // Sentrys plugin är asynkront i writeBundle; ett långsamt steg får inte hinna före borttagningen.
        await new Promise((resolve) => setTimeout(resolve, 50));
        seenByUpload.push(...mapFilesIn(options.dir ?? ''));
      },
    };

    const dist = await buildFixture('with-upload', [upload, stripSourceMaps()]);

    expect(seenByUpload.length).toBeGreaterThan(0);
    expect(mapFilesIn(dist)).toEqual([]);
    expect(existsSync(join(dist, 'index.html'))).toBe(true);
  });
});

// Kopplingen: den riktiga konfigurationen bygger dolda kartor, tar bort dem och bakar in releasen som SDK:t rapporterar.
describe('the build configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  type ResolvedConfig = { define: Record<string, string>; build: { sourcemap: unknown }; plugins: unknown[] };
  const resolveConfig = async (env: Record<string, string>): Promise<ResolvedConfig> => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const factory = viteConfig as unknown as (input: { command: string; mode: string }) => Promise<ResolvedConfig>;
    return factory({ command: 'build', mode: 'production' });
  };
  const pluginNames = (config: ResolvedConfig): string[] => (config.plugins.flat() as { name: string }[]).map((plugin) => plugin.name);

  it('builds hidden source maps and strips them, with no Sentry plugin when there is no token', async () => {
    const config = await resolveConfig({ SENTRY_AUTH_TOKEN: '' });

    expect(config.build.sourcemap).toBe('hidden');
    expect(pluginNames(config)).toContain('rq-strip-source-maps');
    expect(pluginNames(config).some((name) => name.startsWith('sentry'))).toBe(false);
  });

  it('adds the Sentry upload plugin when a token is set, and strips the maps after it', async () => {
    const config = await resolveConfig({ SENTRY_AUTH_TOKEN: 'FAKE_TEST_TOKEN_1_not_a_real_secret' });
    const names = pluginNames(config);

    expect(names.some((name) => name.startsWith('sentry'))).toBe(true);
    expect(names.indexOf('rq-strip-source-maps')).toBeGreaterThan(names.findIndex((name) => name.startsWith('sentry')));
  });

  it('bakes the release into the bundle for the SDK to report', async () => {
    const config = await resolveConfig({ RAILWAY_GIT_COMMIT_SHA: 'abcdef1234567890' });

    expect(config.define['import.meta.env.VITE_SENTRY_RELEASE']).toMatch(/^"runquest@\d+\.\d+\.\d+\+abcdef1"$/);
  });
});
