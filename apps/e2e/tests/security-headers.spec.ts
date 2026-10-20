import { expect, test } from '../support/test';

// Säkerhetshuvudena som Caddy sätter på varje svar (Caddyfile, docs/release.md "Säkerhetshuvuden"). Svaren hämtas utan webbläsare och utan inloggning, så provet
// gäller bara frontendens statiska server. CSP:n kan vara skarp eller Report-Only (staging körs först som Report-Only): båda rubrikerna räknas, och provet skriver
// ut vilken som gäller. Att sidorna sedan faktiskt följer policyn prövas av `cspGuard` i support/test.ts, som fäller varje prov där en skarp CSP blockerar något.
test.use({ storageState: { cookies: [], origins: [] } });

const PATHS = ['/', '/login', '/assets/does-not-exist.js'];

for (const path of PATHS) {
  test(`${path} carries the security headers`, async ({ request }, testInfo) => {
    const response = await request.get(path, { maxRedirects: 0 });
    const headers = response.headers();

    expect(headers['strict-transport-security'], 'HSTS is one year, without includeSubDomains or preload').toBe('max-age=31536000');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');

    const enforced = headers['content-security-policy'];
    const reportOnly = headers['content-security-policy-report-only'];
    const policy = enforced ?? reportOnly;
    expect(policy, 'neither Content-Security-Policy nor Content-Security-Policy-Report-Only is set').toBeDefined();
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("script-src 'self' ");
    expect(policy).not.toMatch(/unsafe-eval|strict-dynamic/);
    expect(policy?.match(/script-src[^;]*/)?.[0]).not.toContain('unsafe-inline');
    testInfo.annotations.push({ type: 'csp-mode', description: enforced ? 'enforced' : 'report-only' });
  });
}
