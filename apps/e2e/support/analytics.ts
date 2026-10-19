import type { Page } from '@playwright/test';

// Provet av sidvisningarna (tests/landing.spec.ts). Umami-skriptet (https://cloud.umami.is/script.js) ersätts i webbläsaren av en stub som bara rapporterar vad
// appen skulle ha skickat; ingenting når Umami. Ett stagingbygge laddar aldrig skriptet (umamiWebsiteIdOf), så provet gäller ett bygge med webbplats-id
// (`E2E_UMAMI_BUILD=1`, se docs/e2e.md): mot staging hoppas det över.

const UMAMI_SCRIPT = 'https://cloud.umami.is/script.js';

/** Ersätter Umami-skriptet. `window.umami.track` anropas som av riktiga skriptet med en funktion som bygger nyttolasten; den färdiga nyttolasten rapporteras. */
const STUB_SCRIPT = `(function () {
  var site = document.currentScript.dataset.websiteId;
  window.umami = {
    track: function (build) {
      var payload = build({ website: site, url: location.pathname + location.search, title: document.title, referrer: document.referrer });
      window.__rqUmamiSent({ url: payload.url, name: payload.name });
    },
  };
})();`;

export interface PageviewLog {
  /** Sidvisningar (inga namngivna händelser) i den ordning de skickades, som adresserna Umami skulle ha fått. */
  views: () => string[];
}

export function umamiBuildExpected(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.E2E_UMAMI_BUILD === '1';
}

/** Fångar sidvisningarna för sidans hela livstid, över alla dokument den hinner ha. Anropas före första navigeringen. */
export async function capturePageviews(page: Page): Promise<PageviewLog> {
  const sent: Array<{ url: string; name?: string }> = [];
  await page.exposeFunction('__rqUmamiSent', (item: { url: string; name?: string }) => {
    sent.push(item);
  });
  await page.route(UMAMI_SCRIPT, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_SCRIPT }));
  return { views: () => sent.filter((item) => item.name === undefined).map((item) => item.url) };
}
