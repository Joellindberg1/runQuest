#!/usr/bin/env node
// CSP-vakten: prövar repo-rotens Caddyfile mot det färdiga bygget. Inline-skript kan inte tillåtas med 'unsafe-inline' (och nonce går inte på statisk
// hosting), så Caddyfilen bär deras sha256-hashar. En hash som inte längre stämmer ger ett tyst blockerat skript i webbläsaren; den här kontrollen
// gör det till ett fel i bygget i stället:
//   - varje inline <script> i dist/**/*.html har sin hash i script-src,
//   - varje hash i script-src hör till ett skript som finns kvar (ingen kvarglömd hash som släpper in ett gammalt skript),
//   - script-src innehåller bara 'self' och hashar (aldrig unsafe-inline, unsafe-eval eller strict-dynamic), och grunddirektiven är kvar.
// Stilar hashas inte: se STYLE_SOURCES.
//
// Användning: node scripts/csp-hashes.mjs <dist-katalog> <Caddyfile>   (körs av scripts/verify-static-serving.sh efter frontend-bygget)
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Umamis tracker skickar hit (data-host-url sätts i umamiPageviews.ts). Tas den bort ur connect-src slutar statistiken tyst. */
export const UMAMI_HOST = 'https://gateway.umami.is';

const FORBIDDEN_SCRIPT_TOKENS = ["'unsafe-inline'", "'unsafe-eval'", "'strict-dynamic'"];
const HASH_TOKEN = /^'sha256-[A-Za-z0-9+/]+={0,2}'$/;
const EXACT_DIRECTIVES = {
  'default-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
};
/**
 * Stilar får inline ('unsafe-inline'), inte hashar: bibliotek lägger in <style> vid körning och texten går inte att fästa. react-remove-scroll (Radix-dialoger)
 * skriver in uppmätta marginaler och scrollistens bredd, och sonner skriver in sin CSS vid import; de förrenderade sidorna har dessutom style-attribut. En inline-stil kan inte
 * köra skript; det som återstår (CSS som läcker via attributväljare) begränsas av img-src, font-src och connect-src. Ändras regeln ska det vara ett medvetet val, därför prövas den exakt.
 */
const STYLE_SOURCES = ["'self'", "'unsafe-inline'"];
// Skripttyper som webbläsaren aldrig kör (datablock); CSP gäller dem inte.
const DATA_SCRIPT_TYPE = /\btype\s*=\s*["']?(application\/(ld\+)?json|importmap|speculationrules|text\/template)/i;

/** Hashen som CSP räknar: sha256 över elementets text, med radbrytningar normaliserade som HTML-tolkaren gör (CRLF och CR blir LF). */
export function hashOf(text) {
  const normalised = text.replace(/\r\n?/g, '\n');
  return `'sha256-${createHash('sha256').update(normalised, 'utf8').digest('base64')}'`;
}

/** Texten i sidans inline-skript. Skript med src och datablock räknas inte; kommentarer rensas först. */
export function inlineScripts(html) {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
  const scripts = [];
  for (const [, attributes, text] of withoutComments.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(attributes) || DATA_SCRIPT_TYPE.test(attributes) || text.trim() === '') continue;
    scripts.push(text);
  }
  return scripts;
}

/** Direktiv -> källor. */
export function parseCsp(value) {
  const directives = new Map();
  for (const part of value.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length > 0) directives.set(tokens[0], tokens.slice(1));
  }
  return directives;
}

/** Rubrikens namn och värde ur Caddyfilens enda CSP-rad (skarp eller Report-Only). Kommentarsrader räknas inte. */
export function cspFromCaddyfile(text) {
  const found = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(Content-Security-Policy(?:-Report-Only)?)\s+"([^"]*)"\s*$/.exec(line);
    if (match) found.push({ header: match[1], value: match[2] });
  }
  if (found.length === 0) throw new Error('Caddyfile has no Content-Security-Policy line');
  if (found.length > 1) throw new Error(`Caddyfile must have exactly one Content-Security-Policy line, found ${found.length}`);
  return found[0];
}

/**
 * Problemen mellan en policy och bygget, som läsbara rader (tom lista = allt stämmer).
 * pages: [{ name, html }].
 */
export function checkCsp({ csp, pages }) {
  const problems = [];
  const directives = parseCsp(csp);
  const scriptSources = directives.get('script-src') ?? [];

  for (const [directive, expected] of [...Object.entries(EXACT_DIRECTIVES), ['style-src', STYLE_SOURCES]]) {
    const actual = directives.get(directive);
    if (!actual || actual.join(' ') !== expected.join(' ')) problems.push(`${directive} must be ${expected.join(' ')}, found ${actual ? actual.join(' ') : 'nothing'}`);
  }
  if (!(directives.get('connect-src') ?? []).includes(UMAMI_HOST)) problems.push(`connect-src must contain ${UMAMI_HOST} (Umami's tracker sends there)`);
  for (const token of scriptSources) {
    if (FORBIDDEN_SCRIPT_TOKENS.includes(token)) problems.push(`script-src must not contain ${token}`);
    else if (token !== "'self'" && !HASH_TOKEN.test(token)) problems.push(`script-src must only contain 'self' and hashes, found ${token}`);
  }

  const builtHashes = new Map(); // hash -> sidorna som har skriptet
  for (const { name, html } of pages) {
    for (const text of inlineScripts(html)) {
      const hash = hashOf(text);
      builtHashes.set(hash, [...(builtHashes.get(hash) ?? []), name]);
    }
  }
  for (const [hash, where] of builtHashes) {
    if (!scriptSources.includes(hash)) problems.push(`${where.join(', ')}: inline script ${hash} is missing from script-src`);
  }
  for (const token of scriptSources) {
    if (HASH_TOKEN.test(token) && !builtHashes.has(token)) problems.push(`stale hash in script-src: ${token} matches no inline script in the build`);
  }
  return problems;
}

function htmlFilesUnder(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return htmlFilesUnder(path);
    return path.endsWith('.html') ? [path] : [];
  });
}

function main(argv) {
  const [distArg, caddyfileArg] = argv;
  if (!distArg || !caddyfileArg) {
    console.error('Usage: node scripts/csp-hashes.mjs <dist directory> <Caddyfile>');
    return 2;
  }
  const dist = resolve(distArg);
  const { header, value } = cspFromCaddyfile(readFileSync(resolve(caddyfileArg), 'utf8'));
  const pages = htmlFilesUnder(dist).map((path) => ({ name: relative(dist, path).replace(/\\/g, '/'), html: readFileSync(path, 'utf8') }));
  if (pages.length === 0) {
    console.error(`FAIL no .html files under ${dist}: build the frontend first`);
    return 1;
  }
  const problems = checkCsp({ csp: value, pages });
  if (problems.length > 0) {
    for (const problem of problems) console.error(`FAIL ${problem}`);
    return 1;
  }
  const scriptHashes = (parseCsp(value).get('script-src') ?? []).filter((token) => HASH_TOKEN.test(token)).length;
  console.log(`ok   ${header}: ${scriptHashes} script hashes match the inline scripts of ${pages.length} built pages`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
