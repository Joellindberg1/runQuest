/**
 * backendEnvFile.ts — var apps/backend/.env ligger, sett från ett skript.
 *
 * Skriptet kör både som källa (src/scripts/x.ts, två nivåer under backend) och byggt (dist/x.js, en nivå under). En fast relativ
 * sökväg stämmer därför bara i det ena fallet. Vi går i stället uppåt tills en katalog har package.json: det är backendens rot.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

export function backendEnvFile(fromDir: string, exists: (candidate: string) => boolean = existsSync): string {
  let dir = fromDir;
  for (;;) {
    if (exists(path.join(dir, 'package.json'))) return path.join(dir, '.env');
    const parent = path.dirname(dir);
    if (parent === dir) return path.join(fromDir, '.env');
    dir = parent;
  }
}
