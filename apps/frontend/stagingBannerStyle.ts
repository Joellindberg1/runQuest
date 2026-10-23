// Stagingbannerns stilmall som länk i båda HTML-filerna, bara i ett stagingbygge (RUN-342). Bannern står förrenderad i `#root` i index.html och landing.html, och laddningsvyns
// läge under den beror på bannerns höjd (`--rq-staging-banner-h`, som stilmallen räknar ut). Stilen måste därför följa med dokumentets första stilmallar: lades den i en
// lazy-chunk (som förut) ritades bannern ostylad tills chunken kommit, och ovalen hoppade en halv bannerhöjd när höjden blev känd. Utan VITE_APP_ENV=staging gör pluginen
// ingenting, så prodbyggets HTML och CSS är oförändrade.
import type { Plugin } from 'vite';
import { STAGING_APP_ENV } from './stagingGuard';

export const STAGING_BANNER_STYLESHEET = '/src/app-shell/staging-banner.css';

export function stagingBannerStyle(appEnv: string | undefined): Plugin {
  const plugin: Plugin = { name: 'rq-staging-banner-style' };
  if (appEnv !== STAGING_APP_ENV) return plugin;
  // 'pre': Vite bundlar en länkad stilmall bara om taggen finns när det behandlar HTML-filen.
  plugin.transformIndexHtml = {
    order: 'pre',
    handler: () => [{ tag: 'link', attrs: { rel: 'stylesheet', href: STAGING_BANNER_STYLESHEET }, injectTo: 'head' }],
  };
  return plugin;
}
