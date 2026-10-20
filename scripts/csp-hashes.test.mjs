// Test av CSP-vakten (scripts/csp-hashes.mjs): ren logik mot små HTML-exempel och Caddyfile-text, inget bygge och inget nätverk.
// Körs med `node --test scripts/*.test.mjs`. Mot det riktiga dist/ körs samma kontroll av scripts/verify-static-serving.sh.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { checkCsp, cspFromCaddyfile, hashOf, inlineScripts, parseCsp } from './csp-hashes.mjs';

const sha256 = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

const POLICY_BASE = [
  "default-src 'self'",
  "script-src 'self' SCRIPT_HASHES",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' https://api.runquest.dev https://gateway.umami.is https://*.ingest.de.sentry.io",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const policy = ({ scripts = [], base = POLICY_BASE } = {}) => base.replace('SCRIPT_HASHES', scripts.map(sha256).join(' ')).replace(/ ;/g, ';');

const page = (name, html) => ({ name, html });

describe('inlineScripts', () => {
  it('returns the text of inline scripts, and ignores scripts with a src and styles', () => {
    const html = '<html><head><script>let a = 1;</script><script type="module" src="/a.js"></script><style>b { c: d }</style></head></html>';
    assert.deepEqual(inlineScripts(html), ['let a = 1;']);
  });

  it('ignores markup inside comments', () => {
    assert.deepEqual(inlineScripts('<!-- <script>commented()</script> --><script>real()</script>'), ['real()']);
  });

  it('ignores data blocks that the browser never runs', () => {
    const html = '<script type="application/ld+json">{"a":1}</script><script type="importmap">{}</script>';
    assert.deepEqual(inlineScripts(html), []);
  });
});

describe('hashOf', () => {
  it('hashes the text as the browser reads it, with line breaks normalised to LF', () => {
    assert.equal(hashOf('a\r\nb\rc'), sha256('a\nb\nc'));
  });
});

describe('parseCsp', () => {
  it('splits a policy into directives and sources', () => {
    const parsed = parseCsp("default-src 'self'; script-src 'self' 'sha256-abc='; object-src 'none'");
    assert.deepEqual(parsed.get('script-src'), ["'self'", "'sha256-abc='"]);
    assert.deepEqual(parsed.get('object-src'), ["'none'"]);
  });
});

describe('cspFromCaddyfile', () => {
  it('reads the header name and value of the one Content-Security-Policy line', () => {
    const text = 'header {\n\tX-Content-Type-Options "nosniff"\n\tContent-Security-Policy-Report-Only "default-src \'self\'; object-src \'none\'"\n}\n';
    assert.deepEqual(cspFromCaddyfile(text), { header: 'Content-Security-Policy-Report-Only', value: "default-src 'self'; object-src 'none'" });
  });

  it('refuses a Caddyfile with no policy or with two', () => {
    assert.throws(() => cspFromCaddyfile('header {\n}\n'), /Content-Security-Policy/);
    const twice = 'header {\n\tContent-Security-Policy "a"\n\tContent-Security-Policy-Report-Only "b"\n}\n';
    assert.throws(() => cspFromCaddyfile(twice), /exactly one/);
  });

  it('ignores a policy that is only mentioned in a comment', () => {
    const text = '# Content-Security-Policy "kommentar"\nheader {\n\tContent-Security-Policy "default-src \'self\'"\n}\n';
    assert.equal(cspFromCaddyfile(text).value, "default-src 'self'");
  });
});

describe('checkCsp', () => {
  const script = 'let a = 1;';
  const pages = [page('index.html', `<script>${script}</script>`)];

  it('passes when every inline script has its hash and no hash is left over', () => {
    assert.deepEqual(checkCsp({ csp: policy({ scripts: [script] }), pages }), []);
  });

  it('fails when an inline script changed, naming the page and the stale hash', () => {
    const changed = [page('index.html', '<script>let a = 2;</script>')];
    const problems = checkCsp({ csp: policy({ scripts: [script] }), pages: changed });
    assert.equal(problems.length, 2);
    assert.match(problems.join('\n'), /index\.html.*inline script.*missing from script-src/s);
    assert.match(problems.join('\n'), /stale/);
  });

  it('fails on a hash in script-src that no page has any more', () => {
    const problems = checkCsp({ csp: policy({ scripts: [script, 'let removed = 1;'] }), pages });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /stale hash in script-src/);
  });

  it('fails when script-src allows unsafe-inline, unsafe-eval or strict-dynamic', () => {
    for (const token of ["'unsafe-inline'", "'unsafe-eval'", "'strict-dynamic'"]) {
      const base = POLICY_BASE.replace("script-src 'self'", `script-src 'self' ${token}`);
      const problems = checkCsp({ csp: policy({ scripts: [script], base }), pages });
      assert.match(problems.join('\n'), new RegExp(`script-src must not contain ${token}`));
    }
  });

  it('fails when a required directive is missing or weaker than the rule', () => {
    const weak = POLICY_BASE.replace("frame-ancestors 'none'", "frame-ancestors 'self'").replace("; object-src 'none'", '');
    const problems = checkCsp({ csp: policy({ scripts: [script], base: weak }), pages }).join('\n');
    assert.match(problems, /frame-ancestors must be 'none'/);
    assert.match(problems, /object-src must be 'none'/);
  });

  it('fails when style-src is anything but self plus unsafe-inline, so a change of the style rule is deliberate', () => {
    const strict = POLICY_BASE.replace("style-src 'self' 'unsafe-inline'", "style-src 'self'");
    assert.match(checkCsp({ csp: policy({ scripts: [script], base: strict }), pages }).join('\n'), /style-src must be 'self' 'unsafe-inline'/);
    const open = POLICY_BASE.replace("style-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    assert.match(checkCsp({ csp: policy({ scripts: [script], base: open }), pages }).join('\n'), /style-src must be 'self' 'unsafe-inline'/);
  });

  it('fails when the Umami host is not in connect-src, or when a script host is whitelisted', () => {
    const noUmami = POLICY_BASE.replace(' https://gateway.umami.is', '');
    assert.match(checkCsp({ csp: policy({ scripts: [script], base: noUmami }), pages }).join('\n'), /connect-src must contain https:\/\/gateway\.umami\.is/);
    const hosted = POLICY_BASE.replace("script-src 'self'", "script-src 'self' https://cloud.umami.is");
    assert.match(checkCsp({ csp: policy({ scripts: [script], base: hosted }), pages }).join('\n'), /script-src must only contain 'self' and hashes/);
  });
});
