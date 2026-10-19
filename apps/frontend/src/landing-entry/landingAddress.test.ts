import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isLandingAddress } from './landingAddress';

// Landningens adresser: `/` och varje adress som Caddy löser till dist/landing.html. Lean routern lämnar över allt annat till fullappen med en omladdning,
// så en adress som ger landing.html själv men inte räknas som landningens vore en evig omladdningsloop (landing.html -> överlämning -> samma adress -> landing.html).

// Sökvägarna i variabler: Vite skriver annars om en bokstavlig new URL('./…', import.meta.url) till en asset-URL.
const CADDYFILE = '../../../../Caddyfile';
const caddyfile = readFileSync(fileURLToPath(new URL(CADDYFILE, import.meta.url)), 'utf8');

/** Adresserna `p` för vilka någon av `try_files`-mallarna ger exakt `file`: mallen `{path}.html` ger `/landing` -> `/landing.html`. */
function addressesResolvingTo(file: string, templates: string[]): string[] {
  return templates.flatMap((template) => {
    const [before, after = ''] = template.split('{path}');
    if (!template.includes('{path}') || !file.startsWith(before) || !file.endsWith(after)) return [];
    return [file.slice(before.length, file.length - after.length)];
  });
}

describe('isLandingAddress', () => {
  it.each([
    '/',
    '/?utm_source=x',
    '/?tab=titles#top',
    '/landing',
    '/landing.html',
    '/landing?utm_source=x',
    '/landing.html?utm_source=x#top',
    '/Landing.HTML',
    '/LANDING',
    '/landing/',
  ])('%s is the landing', (address) => {
    expect(isLandingAddress(address)).toBe(true);
  });

  it.each(['/board', '/login', '/legal', '/landing-page', '/landing.html.bak', '/landing/extra', '/index.html', '/landings', '/x/landing.html'])(
    '%s is not the landing',
    (address) => {
      expect(isLandingAddress(address)).toBe(false);
    },
  );

  // Adresser som Caddy slår ihop eller rensar (path-matcharen) eller som URL-parsern tolkar som värd. De ska aldrig kasta: ett kast i renderingen lämnade sidan vit.
  it.each([
    ['//', true],
    ['///', true],
    ['///x', false],
    ['//evil.example', false],
    ['/%2f', false],
    ['/%2F//', false],
    ['/./', true],
    ['/./landing', true],
    ['/x/../landing.html', true],
    ['', true],
    ['landing', true],
    ['http://[', false],
  ])('%s does not throw and is %s', (address, expected) => {
    expect(() => isLandingAddress(address)).not.toThrow();
    expect(isLandingAddress(address)).toBe(expected);
  });

  it('counts every address that the Caddyfile try_files resolves to landing.html', () => {
    const line = /^\s*try_files\s+(.+)$/m.exec(caddyfile)?.[1];
    expect(line, 'en try_files-rad i Caddyfile').toBeDefined();
    const templates = line!.trim().split(/\s+/);
    const addresses = addressesResolvingTo('/landing.html', templates);
    // Både filen själv och filen utan ändelse, som Caddy ger via {path}.html: annars hittar testet inte det som loopade.
    expect(addresses).toEqual(expect.arrayContaining(['/landing.html', '/landing']));
    for (const address of addresses) expect(isLandingAddress(address), address).toBe(true);
  });
});
