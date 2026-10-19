// Källkartor är till för Sentry och aldrig publika: de visar hela källkoden. Bygget genererar dolda kartor (`build.sourcemap: 'hidden'`, ingen
// sourceMappingURL i skripten), Sentrys plugin laddar upp dem i writeBundle om SENTRY_AUTH_TOKEN finns, och den här pluginen tar bort dem ur dist.
// Borttagningen sker alltid, med eller utan token: dist/ serveras som den är av Caddy, och en .map där vore en publik kopia av källan.
//
// closeBundle och inte writeBundle: Rollup kör writeBundle-krokar parallellt, så Sentrys asynkrona uppladdning kan fortfarande läsa kartorna
// när en annan plugins writeBundle körs. closeBundle kommer först när alla writeBundle är färdiga.
import { readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

export function stripSourceMaps(): Plugin {
  let outDir = '';
  return {
    name: 'rq-strip-source-maps',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle: {
      order: 'post',
      handler() {
        for (const entry of readdirSync(outDir, { recursive: true, withFileTypes: true })) {
          if (entry.isFile() && entry.name.endsWith('.map')) rmSync(join(entry.parentPath, entry.name), { force: true });
        }
      },
    },
  };
}
