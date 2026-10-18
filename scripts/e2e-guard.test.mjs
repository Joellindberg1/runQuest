// Test av E2E-vakten (ren logik, inget nätverk: robots-kontrollen får en fejkad fetch). Körs med `node --test scripts/*.test.mjs`.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  E2E_STAGING_BACKEND_HOST,
  E2E_STAGING_FRONTEND_HOST,
  E2eTargetError,
  assertStagingFrontendServes,
  assertStagingTarget,
  isBlockedRequestUrl,
  resolveE2eTargets,
} from './e2e-guard.mjs';

const STAGING_FRONTEND = `https://${E2E_STAGING_FRONTEND_HOST}`;
const STAGING_BACKEND = `https://${E2E_STAGING_BACKEND_HOST}`;

const PROD_URLS = [
  'https://runquest.dev',
  'https://www.runquest.dev',
  'https://api.runquest.dev',
  'https://api.runquest.dev/api',
  'https://runquest-production-1866.up.railway.app',
  'https://spectacular-rebirth-production-186c.up.railway.app',
];

describe('assertStagingTarget', () => {
  it('accepts the staging frontend and backend and returns the origin', () => {
    assert.equal(assertStagingTarget(STAGING_FRONTEND, 'frontend'), STAGING_FRONTEND);
    assert.equal(assertStagingTarget(`${STAGING_FRONTEND}/`, 'frontend'), STAGING_FRONTEND);
    assert.equal(assertStagingTarget(STAGING_BACKEND, 'backend'), STAGING_BACKEND);
  });

  it('accepts localhost over http, with or without a port', () => {
    assert.equal(assertStagingTarget('http://localhost:8080', 'frontend'), 'http://localhost:8080');
    assert.equal(assertStagingTarget('http://127.0.0.1:3001/', 'backend'), 'http://127.0.0.1:3001');
    assert.equal(assertStagingTarget('http://localhost', 'frontend'), 'http://localhost');
  });

  it('refuses every production address', () => {
    for (const url of PROD_URLS) {
      assert.throws(() => assertStagingTarget(url, 'frontend'), E2eTargetError, url);
      assert.throws(() => assertStagingTarget(url, 'backend'), E2eTargetError, url);
    }
  });

  it('refuses addresses that only look like staging or localhost', () => {
    const lookalikes = [
      `${STAGING_FRONTEND}.evil.example`,
      `https://evil.example/${E2E_STAGING_FRONTEND_HOST}`,
      `https://${E2E_STAGING_FRONTEND_HOST}@evil.example`,
      `https://evil.example@${E2E_STAGING_FRONTEND_HOST}`,
      `https://x.${E2E_STAGING_FRONTEND_HOST}`,
      `https://${E2E_STAGING_FRONTEND_HOST}:8443`,
      'https://localhost.evil.example',
      'https://localhost',
      'http://localhost.runquest.dev',
      'http://staging.runquest.dev',
    ];
    for (const url of lookalikes) {
      assert.throws(() => assertStagingTarget(url, 'frontend'), E2eTargetError, url);
    }
  });

  it('refuses staging over plain http', () => {
    assert.throws(() => assertStagingTarget(`http://${E2E_STAGING_FRONTEND_HOST}`, 'frontend'), E2eTargetError);
  });

  it('refuses a backend address as the frontend and the other way round', () => {
    assert.throws(() => assertStagingTarget(STAGING_BACKEND, 'frontend'), E2eTargetError);
    assert.throws(() => assertStagingTarget(STAGING_FRONTEND, 'backend'), E2eTargetError);
  });

  it('refuses paths, queries and fragments, so the target is always an origin', () => {
    for (const suffix of ['/board', '/?next=/x', '/#top']) {
      assert.throws(() => assertStagingTarget(`${STAGING_FRONTEND}${suffix}`, 'frontend'), E2eTargetError, suffix);
    }
  });

  it('refuses anything that is not an http(s) address', () => {
    for (const value of ['', '   ', 'not a url', 'file:///etc/passwd', 'javascript:alert(1)', 'ftp://localhost', undefined, null]) {
      assert.throws(() => assertStagingTarget(value, 'frontend'), E2eTargetError, String(value));
    }
  });

  it('never repeats credentials from a rejected address in the message', () => {
    try {
      assertStagingTarget('https://someone:hunter2-not-a-real-secret@www.runquest.dev', 'frontend');
      assert.fail('should have thrown');
    } catch (error) {
      assert.ok(error instanceof E2eTargetError);
      assert.ok(!error.message.includes('hunter2'));
      assert.ok(!error.message.includes('someone'));
    }
  });
});

describe('resolveE2eTargets', () => {
  const stagingEnv = { E2E_BASE_URL: STAGING_FRONTEND, E2E_API_URL: STAGING_BACKEND };

  it('resolves both targets and says whether they are local', () => {
    assert.deepEqual(resolveE2eTargets(stagingEnv), { baseUrl: STAGING_FRONTEND, apiUrl: STAGING_BACKEND, isLocal: false });
    assert.deepEqual(resolveE2eTargets({ E2E_BASE_URL: 'http://localhost:8080', E2E_API_URL: 'http://localhost:3001' }), {
      baseUrl: 'http://localhost:8080',
      apiUrl: 'http://localhost:3001',
      isLocal: true,
    });
  });

  it('refuses to start without a base URL and without an API URL', () => {
    assert.throws(() => resolveE2eTargets({}), /E2E_BASE_URL/);
    assert.throws(() => resolveE2eTargets({ E2E_BASE_URL: STAGING_FRONTEND }), /E2E_API_URL/);
    assert.throws(() => resolveE2eTargets({ E2E_BASE_URL: STAGING_FRONTEND, E2E_API_URL: '' }), /E2E_API_URL/);
  });

  it('refuses to start when either address is production', () => {
    assert.throws(() => resolveE2eTargets({ ...stagingEnv, E2E_BASE_URL: 'https://www.runquest.dev' }), E2eTargetError);
    assert.throws(() => resolveE2eTargets({ ...stagingEnv, E2E_API_URL: 'https://api.runquest.dev' }), E2eTargetError);
  });

  it('names the variable that was refused', () => {
    assert.throws(() => resolveE2eTargets({ ...stagingEnv, E2E_BASE_URL: 'https://www.runquest.dev' }), /E2E_BASE_URL/);
    assert.throws(() => resolveE2eTargets({ ...stagingEnv, E2E_API_URL: 'https://api.runquest.dev' }), /E2E_API_URL/);
  });
});

describe('isBlockedRequestUrl', () => {
  it('blocks every Railway address except the two staging services, so an unknown production host is blocked too', () => {
    for (const url of [
      'https://runquest-production-1866.up.railway.app/api/runs',
      'https://spectacular-rebirth-production-186c.up.railway.app/',
      'https://a-host-nobody-listed.up.railway.app/',
      'https://up.railway.app/',
      `https://x.${E2E_STAGING_FRONTEND_HOST}/`,
      'https://RUNQUEST-PRODUCTION-1866.UP.RAILWAY.APP/',
    ]) {
      assert.equal(isBlockedRequestUrl(url), true, url);
    }
    assert.equal(isBlockedRequestUrl(`${STAGING_FRONTEND}/`), false);
    assert.equal(isBlockedRequestUrl(`${STAGING_BACKEND}/api/news`), false);
  });

  it('recognises production hosts, including subdomains', () => {
    for (const url of [...PROD_URLS, 'https://cdn.runquest.dev/x.js', 'https://API.RunQuest.dev/api/runs']) {
      assert.equal(isBlockedRequestUrl(url), true, url);
    }
  });

  it('lets staging, localhost, third parties and lookalikes through', () => {
    for (const url of [
      `${STAGING_FRONTEND}/assets/app.js`,
      `${STAGING_BACKEND}/api/runs`,
      'http://localhost:8080/',
      'https://de.sentry.io/api/1/envelope/',
      'https://notrunquest.dev/',
      'https://runquest.dev.evil.example/',
    ]) {
      assert.equal(isBlockedRequestUrl(url), false, url);
    }
  });

  it('treats an unreadable address as not production, so the guard never throws inside a route handler', () => {
    assert.equal(isBlockedRequestUrl('not a url'), false);
  });
});

describe('the staging hosts', () => {
  it('share the backend address with the load test guard', async () => {
    const { STAGING_BACKEND_URL } = await import('./loadtest/guard.mjs');
    assert.equal(STAGING_BACKEND, STAGING_BACKEND_URL);
  });
});

describe('assertStagingFrontendServes', () => {
  const robots = (body, status = 200) => async () => new Response(body, { status });

  it('accepts a frontend whose robots.txt blocks every crawler', async () => {
    await assertStagingFrontendServes(STAGING_FRONTEND, robots('User-agent: *\nDisallow: /\n'));
  });

  it('asks the frontend it was given, and only that', async () => {
    const asked = [];
    await assertStagingFrontendServes(STAGING_FRONTEND, async (url) => {
      asked.push(String(url));
      return new Response('User-agent: *\nDisallow: /\n');
    });
    assert.deepEqual(asked, [`${STAGING_FRONTEND}/robots.txt`]);
  });

  it('does not wait forever for a frontend that does not answer', async () => {
    let signal;
    await assertStagingFrontendServes(STAGING_FRONTEND, async (_url, init) => {
      signal = init?.signal;
      return new Response('User-agent: *\nDisallow: /\n');
    });
    assert.ok(signal instanceof AbortSignal, 'the robots.txt request must carry a timeout signal');
  });

  it('refuses a frontend that lets crawlers in, which is what a production build serves', async () => {
    await assert.rejects(assertStagingFrontendServes(STAGING_FRONTEND, robots('User-agent: *\nAllow: /\nSitemap: https://www.runquest.dev/sitemap.xml\n')), E2eTargetError);
  });

  it('refuses a frontend with no robots.txt answer', async () => {
    await assert.rejects(assertStagingFrontendServes(STAGING_FRONTEND, robots('Not found', 404)), E2eTargetError);
    await assert.rejects(
      assertStagingFrontendServes(STAGING_FRONTEND, async () => {
        throw new Error('network down');
      }),
      E2eTargetError,
    );
  });

  it('does not ask a local dev server, which has no staging build', async () => {
    await assertStagingFrontendServes('http://localhost:8080', async () => {
      assert.fail('a local frontend must not be fetched');
    });
  });
});
