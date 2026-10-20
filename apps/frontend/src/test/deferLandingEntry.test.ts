import { describe, expect, it } from 'vitest';
import { readEntry, replaceEntry } from '../../deferLandingEntry';

// Byggsteget som byter landningens modulskript och modulepreload-länkar mot boot-skriptet (se deferLandingEntry.ts). Själva byggets resultat prövas i
// landingBuild.test.ts; här prövas läsningen och omskrivningen av head, i den form Vite skriver den.
const viteHead = (...extra: string[]) =>
  [
    '<head>',
    '    <link rel="preload" href="/fonts/bebas-neue-400.v1.woff2" as="font" type="font/woff2" crossorigin />',
    '    <script type="module" crossorigin src="/assets/landing-AbC123.js"></script>',
    '    <link rel="modulepreload" crossorigin href="/assets/router-X1.js">',
    '    <link rel="modulepreload" crossorigin href="/assets/react-query-Y2.js">',
    '    <link rel="stylesheet" crossorigin href="/assets/theme-Q.css">',
    ...extra,
    '  </head>',
  ].join('\n');

describe('readEntry', () => {
  it('gives the module script and the modulepreload links in document order', () => {
    expect(readEntry(viteHead(), 'landing.html')).toEqual({ entry: '/assets/landing-AbC123.js', preloads: ['/assets/router-X1.js', '/assets/react-query-Y2.js'] });
  });

  it('finds the tags whatever order their attributes come in', () => {
    const html = '<script src="/assets/landing-Z.js" crossorigin type="module"></script>\n<link href="/assets/a.js" crossorigin rel="modulepreload">';
    expect(readEntry(html, 'landing.html')).toEqual({ entry: '/assets/landing-Z.js', preloads: ['/assets/a.js'] });
  });

  it('leaves font and image preloads, stylesheets, inline scripts and classic scripts alone', () => {
    const html = viteHead('    <script>window.x = 1</script>', '    <script src="/vendor.js"></script>', '    <script type="module">inline()</script>');
    expect(readEntry(html, 'landing.html').preloads).toEqual(['/assets/router-X1.js', '/assets/react-query-Y2.js']);
  });

  it('accepts an entry with no static imports (no preloads at all)', () => {
    expect(readEntry('<script type="module" crossorigin src="/assets/landing-Z.js"></script>', 'landing.html')).toEqual({ entry: '/assets/landing-Z.js', preloads: [] });
  });

  it('fails the build, naming the file, when there is no module script to defer', () => {
    expect(() => readEntry('<head><link rel="stylesheet" href="/a.css"></head>', 'landing.html')).toThrow(/landing\.html.*module script/);
  });

  it('fails the build when there is more than one module script, since the boot script can only start one entry', () => {
    const twice = `${viteHead()}\n<script type="module" crossorigin src="/assets/other-Q.js"></script>`;
    expect(() => readEntry(twice, 'landing.html')).toThrow(/landing\.html.*2 module scripts/);
  });
});

describe('replaceEntry', () => {
  const BOOT = '/assets/landing-boot-H4sh.js';

  it('puts the boot script where the module script was and removes every modulepreload link', () => {
    expect(replaceEntry(viteHead(), BOOT)).toBe(
      [
        '<head>',
        '    <link rel="preload" href="/fonts/bebas-neue-400.v1.woff2" as="font" type="font/woff2" crossorigin />',
        `    <script type="module" crossorigin src="${BOOT}"></script>`,
        '    <link rel="stylesheet" crossorigin href="/assets/theme-Q.css">',
        '  </head>',
      ].join('\n'),
    );
  });

  it('keeps CRLF line endings and leaves no blank line where the links were', () => {
    const result = replaceEntry(viteHead().replace(/\n/g, '\r\n'), BOOT);
    expect(result).not.toMatch(/\r\n\s*\r\n/);
    expect(result.split('\r\n')).toHaveLength(5);
    expect(result).not.toMatch(/(?<!\r)\n/);
  });

  it('leaves a page with no modulepreload links otherwise as it was', () => {
    const html = '<head>\n<script type="module" crossorigin src="/assets/landing-Z.js"></script>\n</head>';
    expect(replaceEntry(html, BOOT)).toBe(`<head>\n<script type="module" crossorigin src="${BOOT}"></script>\n</head>`);
  });
});
