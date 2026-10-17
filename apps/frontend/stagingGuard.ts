// Stagingskyddet vid bygget (v0.8.0): i en stagingbyggd frontend får sökmotorer varken indexera eller crawla sidan. Prodbygget påverkas inte:
// utan VITE_APP_ENV=staging gör pluginen ingenting, och public/robots.txt och sitemap.xml når dist/ som de är.
//
// Railpack serverar apps/frontend/dist som statiska filer, så skyddet måste ligga i själva bygget: en <meta name="robots"> i index.html och en
// robots.txt som ersätter den från public/. Sitemapen pekar på prodadresser och tas bort. Bannern i UI:t läser samma variabel (App.tsx).

import { rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

export const STAGING_APP_ENV = 'staging';
export const STAGING_ROBOTS_TXT = 'User-agent: *\nDisallow: /\n';

export function stagingGuard(appEnv: string | undefined): Plugin {
  const plugin: Plugin = { name: 'rq-staging-guard' };
  if (appEnv !== STAGING_APP_ENV) return plugin;

  let outDir = '';
  plugin.configResolved = (config) => {
    outDir = resolve(config.root, config.build.outDir);
  };
  plugin.transformIndexHtml = () => [
    { tag: 'meta', attrs: { name: 'robots', content: 'noindex, nofollow' }, injectTo: 'head-prepend' },
  ];
  // Efter att Vite kopierat public/: annars skulle prodens robots.txt skriva över den här.
  plugin.writeBundle = { order: 'post', handler: () => {
    writeFileSync(join(outDir, 'robots.txt'), STAGING_ROBOTS_TXT);
    rmSync(join(outDir, 'sitemap.xml'), { force: true });
  } };
  return plugin;
}
