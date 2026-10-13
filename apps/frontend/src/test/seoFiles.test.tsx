import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { paths } from '@/paths';

// robots.txt och sitemap.xml ligger i public/ och serveras som de är (Caddyfile ändras inte). Vakten läser filerna från disk.
// Filen är .tsx för att DOMParser (jsdom) validerar sitemapens XML: .test.ts går i node-projektet, som saknar den.

const ORIGIN = 'https://www.runquest.dev';
const read = (relative: string) => readFileSync(resolve(__dirname, relative), 'utf8').replace(/\r/g, '');

describe('robots.txt', () => {
  const groups = read('../../public/robots.txt')
    .trim()
    .split(/\n\s*\n/)
    .map((block) => block.split('\n').map((line) => line.trim()).filter(Boolean))
    .filter((lines) => lines.some((line) => /^User-agent:/i.test(line)));

  it('robots.txt pekar ut sitemapen med absolut adress och stänger /preview', () => {
    const text = read('../../public/robots.txt');
    expect(text.trim().split('\n').pop()).toBe(`Sitemap: ${ORIGIN}/sitemap.xml`);
    expect(groups.map((lines) => lines[0])).toEqual([
      'User-agent: Googlebot',
      'User-agent: Bingbot',
      'User-agent: Twitterbot',
      'User-agent: facebookexternalhit',
      'User-agent: *',
    ]);
    // En crawler följer bara sin egen grupp, så varje grupp stänger /preview och släpper in resten.
    for (const lines of groups) {
      expect(lines, lines[0]).toContain('Disallow: /preview');
      expect(lines, lines[0]).toContain('Allow: /');
    }
  });
});

describe('sitemap.xml', () => {
  const sitemap = read('../../public/sitemap.xml');

  /** De publika sidorna ur routerträdet: routerna utanför RequireAuth, utom login-dialogen, preview-sidorna och redirecten. */
  const publicPages = (): string[] => {
    const routes = read('../routes.tsx');
    const outsideAuth = routes.slice(0, routes.indexOf('<RequireAuth'));
    const keys = [...outsideAuth.matchAll(/<Route\s[^>]*path=\{paths\.(\w+)\}/g)].map((match) => match[1] as keyof typeof paths);
    const excluded: ReadonlyArray<keyof typeof paths> = ['login', 'legacyChallenges', 'previewBoard', 'previewDuels', 'previewBadges'];
    return keys.filter((key) => !excluded.includes(key)).map((key) => String(paths[key]));
  };

  it('sitemap.xml är giltig XML och listar exakt de publika sidorna', () => {
    const document = new DOMParser().parseFromString(sitemap, 'application/xml');
    expect(document.querySelector('parsererror')).toBeNull();
    expect(document.documentElement.localName).toBe('urlset');
    expect(document.documentElement.namespaceURI).toBe('http://www.sitemaps.org/schemas/sitemap/0.9');

    const listed = [...document.getElementsByTagName('loc')].map((loc) => loc.textContent);
    expect(listed.sort()).toEqual(publicPages().map((page) => `${ORIGIN}${page}`).sort());
    expect(listed).toEqual(expect.arrayContaining([`${ORIGIN}/`, `${ORIGIN}/legal`]));
  });
});
