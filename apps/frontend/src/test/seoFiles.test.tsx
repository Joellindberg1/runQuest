import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { createRoutesFromChildren, type RouteObject } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from '@/app-shell/RequireAuth';
import { paths } from '@/paths';
import { AppRoutes } from '@/routes';
import { renderWithApp } from '@/test/renderApp';

// robots.txt och sitemap.xml ligger i public/ och serveras som de är (Caddyfile ändras inte). Vakten läser filerna från disk.
// Filen är .tsx av två skäl: DOMParser (jsdom) validerar sitemapens XML, och routerträdet renderas för att läsa de publika sidorna.
// .test.ts går i node-projektet, som saknar båda.

// Routerns faktiska konfiguration: Routes fångar sina children i stället för att rendera dem.
const captured = vi.hoisted(() => ({ children: [] as ReactNode[] }));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    Routes: ({ children }: { children?: ReactNode }) => {
      captured.children.push(children);
      return null;
    },
  };
});

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

const EXCLUDED_FROM_SITEMAP: readonly string[] = [paths.login, paths.legacyChallenges];
const isExcluded = (path: string) => EXCLUDED_FROM_SITEMAP.includes(path) || path === paths.previewBoard || path.startsWith(`${paths.previewBoard}/`);

const joinPath = (parent: string, path: string | undefined): string => {
  if (!path) return parent;
  if (path.startsWith('/')) return path;
  return `${parent.replace(/\/$/, '')}/${path}`;
};

/** Sidorna (med element) som ingen förfader skyddar med RequireAuth. Wildcard och parametrar är aldrig sitemapsidor. */
function publicPaths(routes: RouteObject[], parent = '/', insideAuth = false): string[] {
  return routes.flatMap((route) => {
    const path = joinPath(parent, route.path);
    const protectedHere = insideAuth || (route.element as { type?: unknown } | null | undefined)?.type === RequireAuth;
    const own = !protectedHere && route.path !== undefined && route.element && !/[*:]/.test(path) ? [path] : [];
    return [...own, ...publicPaths(route.children ?? [], path, protectedHere)];
  });
}

describe('sitemap.xml', () => {
  beforeAll(() => {
    renderWithApp(<AppRoutes />, { entry: '/', user: null });
  });

  /** De publika sidorna ur routerns faktiska konfiguration, utom login-dialogen, preview-sidorna och redirecten. */
  const publicPages = (): string[] => {
    const [children] = captured.children;
    return publicPaths(createRoutesFromChildren(children)).filter((path) => !isExcluded(path));
  };

  it('sitemap.xml är giltig XML och listar exakt de publika sidorna', () => {
    const document = new DOMParser().parseFromString(read('../../public/sitemap.xml'), 'application/xml');
    expect(document.querySelector('parsererror')).toBeNull();
    expect(document.documentElement.localName).toBe('urlset');
    expect(document.documentElement.namespaceURI).toBe('http://www.sitemaps.org/schemas/sitemap/0.9');

    const listed = [...document.getElementsByTagName('loc')].map((loc) => loc.textContent);
    expect(listed.sort()).toEqual(publicPages().map((page) => `${ORIGIN}${page}`).sort());
    expect(listed).toEqual(expect.arrayContaining([`${ORIGIN}/`, `${ORIGIN}/legal`]));
  });
});
