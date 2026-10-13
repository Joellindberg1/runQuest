import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Startsidans statiska head (ADR 006-addendum 2026-10-13, alternativ a): index.html serveras oförändrad för varje SPA-adress, så titel, beskrivning,
// canonical, Open Graph och noscript står som text i filen och läses här från disk. Ikonerna och delningsbilden prövas på mått och storlek
// (PNG via IHDR, ICO via katalogen, SVG via viewBox) utan bildbibliotek.

// Sökvägarna i variabler: Vite skriver annars om en bokstavlig new URL('./…', import.meta.url) till en asset-URL.
const FRONTEND_DIR = '../..';
const frontend = fileURLToPath(new URL(FRONTEND_DIR, import.meta.url));
const publicDir = join(frontend, 'public');
const landingDir = join(frontend, 'src', 'features', 'landing');
const html = readFileSync(join(frontend, 'index.html'), 'utf8');

const SITE = 'https://www.runquest.dev';
const OG_IMAGE_MAX_BYTES = 307_200;

// ── Läsning av filformat ─────────────────────────────────────────────────────

const PNG_SIGNATURE = '89504e470d0a1a0a';

function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(join(publicDir, file));
  expect(bytes.subarray(0, 8).toString('hex'), `${file} är en PNG`).toBe(PNG_SIGNATURE);
  expect(bytes.subarray(12, 16).toString('latin1'), `${file} börjar med IHDR`).toBe('IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** ICO-katalogen: en post per bild, bredd/höjd i varsin byte (0 betyder 256). */
function icoSizes(file: string): number[] {
  const bytes = readFileSync(join(publicDir, file));
  expect(bytes.readUInt16LE(0), 'reserverat fält').toBe(0);
  expect(bytes.readUInt16LE(2), 'typ 1 = ikon').toBe(1);
  const count = bytes.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const entry = 6 + index * 16;
    const width = bytes[entry] || 256;
    expect(bytes[entry + 1] || 256, 'kvadratisk post').toBe(width);
    return width;
  }).sort((a, b) => a - b);
}

function svgViewBox(file: string): number[] {
  const text = readFileSync(join(publicDir, file), 'utf8');
  const match = /viewBox="([^"]+)"/.exec(text);
  expect(match, `${file} har en viewBox`).not.toBeNull();
  return match![1].trim().split(/[\s,]+/).map(Number);
}

// ── Läsning av head ──────────────────────────────────────────────────────────

const decodeEntities = (value: string) =>
  value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");

function attributes(tag: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) found[match[1]] = decodeEntities(match[2]);
  return found;
}

const headSection = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? '';
const metaTags = [...headSection.matchAll(/<meta\b[^>]*>/g)].map((match) => attributes(match[0]));
const linkTags = [...headSection.matchAll(/<link\b[^>]*>/g)].map((match) => attributes(match[0]));

const metaName = (name: string) => metaTags.find((tag) => tag.name === name)?.content;
const metaProperty = (property: string) => metaTags.find((tag) => tag.property === property)?.content;
const linkRel = (rel: string, predicate: (tag: Record<string, string>) => boolean = () => true) =>
  linkTags.find((tag) => tag.rel === rel && predicate(tag));
const title = decodeEntities(/<title>([\s\S]*?)<\/title>/.exec(headSection)?.[1] ?? '');

const noscriptMarkup = /<noscript>([\s\S]*?)<\/noscript>/.exec(html)?.[1] ?? '';
const normalize = (text: string) => decodeEntities(text.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Landningens h1 ur källtexten: filen hittas på `id="landing-title"`, inte på ett filnamn. */
function landingHeadline(): string {
  const files = (readdirSync(landingDir, { recursive: true }) as string[])
    .map((file) => file.replace(/\\/g, '/'))
    .filter((file) => file.endsWith('.tsx') && !/\.test\.tsx$/.test(file));
  const owner = files.find((file) => readFileSync(join(landingDir, file), 'utf8').includes('id="landing-title"'));
  expect(owner, 'en landningsfil med id="landing-title"').toBeDefined();
  const source = readFileSync(join(landingDir, owner!), 'utf8');
  const match = /<h1\b[^>]*id="landing-title"[^>]*>([\s\S]*?)<\/h1>/.exec(source);
  expect(match, 'h1 med id="landing-title"').not.toBeNull();
  return normalize(match![1]);
}

describe('ikoner och delningsbild', () => {
  it('ikonerna och delningsbilden har rätt mått och storlek', () => {
    expect(pngSize('apple-touch-icon.png')).toEqual({ width: 180, height: 180 });
    expect(pngSize('icon-192.png')).toEqual({ width: 192, height: 192 });
    expect(pngSize('icon-512.png')).toEqual({ width: 512, height: 512 });
    expect(pngSize('icon-maskable-512.png')).toEqual({ width: 512, height: 512 });
    expect(pngSize('og-image.v1.png')).toEqual({ width: 1200, height: 630 });
    expect(icoSizes('favicon.ico')).toEqual([16, 32, 48]);
    expect(svgViewBox('favicon.svg').slice(2)).toEqual([64, 64]);
    expect(statSync(join(publicDir, 'og-image.v1.png')).size).toBeLessThanOrEqual(OG_IMAGE_MAX_BYTES);
  });
});

describe('startsidans head', () => {
  it('startsidans head har title, description, canonical och alla og- och twitter-taggar', () => {
    expect(htmlLang()).toBe('en');

    expect(title.length).toBeGreaterThan(0);
    expect(title.length).toBeLessThanOrEqual(60);
    const description = metaName('description')!;
    expect(description.length).toBeGreaterThanOrEqual(70);
    expect(description.length).toBeLessThanOrEqual(160);

    expect(linkRel('canonical')?.href).toBe(`${SITE}/`);

    expect(metaProperty('og:type')).toBe('website');
    expect(metaProperty('og:url')).toBe(`${SITE}/`);
    expect(metaProperty('og:site_name')).toBe('RunQuest');
    expect(metaProperty('og:title')).toBe(title);
    expect(metaProperty('og:title')!.length).toBeLessThanOrEqual(60);
    expect(metaProperty('og:description')).toBe(description);
    expect(metaProperty('og:image')).toBe(`${SITE}/og-image.v1.png`);
    expect(metaProperty('og:image:width')).toBe('1200');
    expect(metaProperty('og:image:height')).toBe('630');
    expect(metaProperty('og:image:alt')!.length).toBeGreaterThan(10);

    expect(metaName('twitter:card')).toBe('summary_large_image');
    expect(metaName('twitter:title')).toBe(title);
    expect(metaName('twitter:description')).toBe(description);
    expect(metaName('twitter:image')).toBe(`${SITE}/og-image.v1.png`);
    expect(metaName('twitter:image:alt')).toBe(metaProperty('og:image:alt'));
  });

  it('länkar favicon, ikon, manifest och temafärg som filerna i public', () => {
    expect(linkRel('icon', (tag) => tag.type === 'image/svg+xml')?.href).toBe('/favicon.svg');
    expect(linkRel('icon', (tag) => tag.href === '/favicon.ico')?.sizes).toBe('16x16 32x32 48x48');
    expect(linkRel('apple-touch-icon')?.href).toBe('/apple-touch-icon.png');
    expect(linkRel('apple-touch-icon')?.sizes).toBe('180x180');
    expect(linkRel('manifest')?.href).toBe('/site.webmanifest');
    expect(metaName('theme-color')).toBe('#070e09');
    for (const tag of linkTags.filter((link) => link.href?.startsWith('/') && !link.href.startsWith('//'))) {
      expect(existsSync(join(publicDir, tag.href.slice(1))), `${tag.href} finns i public`).toBe(true);
    }
    expect(existsSync(join(publicDir, 'og-image.v1.png'))).toBe(true);
  });

  it('alla adresser till delningsbilden och canonical är absoluta mot www', () => {
    for (const value of [linkRel('canonical')?.href, metaProperty('og:url'), metaProperty('og:image'), metaName('twitter:image')]) {
      expect(value?.startsWith(`${SITE}/`)).toBe(true);
    }
  });

  it('noscript-rubriken är samma text som landningens h1', () => {
    const noscriptHeading = /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(noscriptMarkup)?.[1] ?? '';
    expect(normalize(noscriptHeading).toLowerCase()).toBe(landingHeadline().toLowerCase());
  });

  it('noscript står före #root, har ett stycke och en rad om att JavaScript behövs, utan stilberoende', () => {
    expect(html.indexOf('<noscript>')).toBeGreaterThan(html.indexOf('<body>'));
    expect(html.indexOf('<noscript>')).toBeLessThan(html.indexOf('id="root"'));
    expect([...noscriptMarkup.matchAll(/<p\b/g)].length).toBeGreaterThanOrEqual(2);
    expect(normalize(noscriptMarkup)).toMatch(/JavaScript/);
    expect(noscriptMarkup).not.toMatch(/\b(?:style|class)=|<style\b/);
  });

  it('description, og-texterna och noscript innehåller inga siffror', () => {
    const texts = [
      title,
      metaName('description'),
      metaProperty('og:title'),
      metaProperty('og:description'),
      metaProperty('og:image:alt'),
      metaName('twitter:title'),
      metaName('twitter:description'),
      metaName('twitter:image:alt'),
      normalize(noscriptMarkup),
    ];
    for (const text of texts) expect(text, String(text)).not.toMatch(/\d/);
  });

  // Integritetstexten (dataPolicy) säger att inga typsnitt hämtas från Google. Länkas Google Fonts åter in blir texten osann.
  it('index.html hämtar inga typsnitt från Google', () => {
    expect(html).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
  });

  it('förladdar exakt ett typsnitt: Bebas Neue, som landningens rubrik använder', () => {
    const preloads = linkTags.filter((tag) => tag.rel === 'preload' && tag.as === 'font');
    expect(preloads).toHaveLength(1);
    const [preload] = preloads;
    expect(preload.href).toMatch(/^\/fonts\/bebas-neue-400\.v\d+\.woff2$/);
    expect(preload.type).toBe('font/woff2');
    // Typsnitt hämtas alltid i CORS-läge: utan crossorigin förladdas filen men används inte, och hämtas två gånger.
    const rawPreload = [...headSection.matchAll(/<link\b[^>]*>/g)].map((match) => match[0]).find((tag) => /rel="preload"/.test(tag));
    expect(rawPreload).toMatch(/\scrossorigin(?:[\s=>/]|$)/);
    expect(existsSync(join(publicDir, preload.href.slice(1)))).toBe(true);
  });
});

describe('självhostade typsnitt', () => {
  const css = readFileSync(join(frontend, 'src', 'index.css'), 'utf8');
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => match[1]);
  const fontUrls = faces.map((face) => /url\(\s*['"]?([^'")\s]+)['"]?\s*\)/.exec(face)?.[1]);

  it('varje @font-face pekar på en versionerad woff2-fil i public/fonts och använder font-display swap', () => {
    expect(faces.length).toBeGreaterThanOrEqual(7);
    for (const [index, face] of faces.entries()) {
      const url = fontUrls[index];
      expect(url, face).toMatch(/^\/fonts\/[a-z0-9-]+\.v\d+\.woff2$/);
      expect(existsSync(join(publicDir, url!.slice(1))), `${url} finns i public`).toBe(true);
      expect(face).toMatch(/font-display:\s*swap/);
    }
  });

  it('de fyra typsnittsfamiljerna som temat använder finns som @font-face', () => {
    const families = new Set(faces.map((face) => /font-family:\s*['"]([^'"]+)['"]/.exec(face)?.[1]));
    expect([...families].sort()).toEqual(['Barlow Condensed', 'Bebas Neue', 'Oswald', 'Share Tech Mono']);
  });

  it('licensfilen ligger bredvid typsnitten', () => {
    expect(readFileSync(join(publicDir, 'fonts', 'OFL.txt'), 'utf8')).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/);
  });
});

describe('site.webmanifest', () => {
  const manifest = JSON.parse(readFileSync(join(publicDir, 'site.webmanifest'), 'utf8')) as {
    name: string;
    short_name: string;
    start_url: string;
    display: string;
    theme_color: string;
    background_color: string;
    icons: { src: string; sizes: string; type: string; purpose?: string }[];
  };

  it('beskriver appen som en webbplats med ikonerna i public', () => {
    expect(manifest.name).toBe('RunQuest');
    expect(manifest.short_name).toBe('RunQuest');
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('browser');
    expect(manifest.theme_color).toBe('#070e09');
    expect(manifest.background_color).toBe('#070e09');
    const byPurpose = (purpose: string) => manifest.icons.filter((icon) => (icon.purpose ?? 'any') === purpose).map((icon) => `${icon.sizes} ${icon.src}`);
    expect(byPurpose('any')).toEqual(['192x192 /icon-192.png', '512x512 /icon-512.png']);
    expect(byPurpose('maskable')).toEqual(['512x512 /icon-maskable-512.png']);
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png');
      expect(existsSync(join(publicDir, icon.src.slice(1))), `${icon.src} finns`).toBe(true);
    }
  });
});

function htmlLang(): string | undefined {
  return /<html\b[^>]*\blang="([^"]*)"/.exec(html)?.[1];
}
