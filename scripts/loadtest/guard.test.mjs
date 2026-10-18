// Vakten på lasttestets bas-URL: bara stagingbackenden och localhost/127.0.0.1 får träffas. Ren logik, inget nätverk.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BaseUrlRefused, STAGING_BACKEND_URL, assertWithinBase, resolveBaseUrl } from './guard.mjs';

const refused = (raw) => assert.throws(() => resolveBaseUrl(raw), BaseUrlRefused);

describe('resolveBaseUrl', () => {
  it('accepts the staging backend', () => {
    assert.equal(resolveBaseUrl(STAGING_BACKEND_URL), STAGING_BACKEND_URL);
    assert.equal(resolveBaseUrl(`${STAGING_BACKEND_URL}/`), STAGING_BACKEND_URL);
  });

  it('accepts localhost and 127.0.0.1 on any port, over http', () => {
    assert.equal(resolveBaseUrl('http://127.0.0.1:4010'), 'http://127.0.0.1:4010');
    assert.equal(resolveBaseUrl('http://localhost:3001/'), 'http://localhost:3001');
    assert.equal(resolveBaseUrl('http://[::1]:3001'), 'http://[::1]:3001');
  });

  it('refuses the production domains and a Supabase host', () => {
    refused('https://api.runquest.dev');
    refused('https://www.runquest.dev');
    refused('https://runquest.dev');
    refused('https://yrrqaxdngayakcivfrck.supabase.co');
    refused('https://aormctqrmguvncxrigwy.supabase.co');
  });

  it('refuses a production Railway host that merely looks like staging', () => {
    refused('https://runquest-backend-production.up.railway.app');
    refused('https://runquest-backend-staging.up.railway.app');
  });

  it('refuses hosts that only contain an allowed name as a part', () => {
    refused('https://runquest-backend-staging-staging.up.railway.app.evil.example');
    refused('https://evil.example/runquest-backend-staging-staging.up.railway.app');
    refused('http://localhost.evil.example');
    refused('http://127.0.0.1.evil.example');
    refused('https://evil.example@127.0.0.1');
    refused('http://127.0.0.1@api.runquest.dev');
    refused('http://runquest-backend-staging-staging.up.railway.app:80@api.runquest.dev');
  });

  it('refuses plain http to the staging host, odd ports on it and a trailing dot', () => {
    refused('http://runquest-backend-staging-staging.up.railway.app');
    refused('https://runquest-backend-staging-staging.up.railway.app:8443');
    refused('https://runquest-backend-staging-staging.up.railway.app.');
  });

  it('refuses a base path, credentials, other schemes and unparsable input', () => {
    refused(`${STAGING_BACKEND_URL}/api`);
    refused('https://user:pw@runquest-backend-staging-staging.up.railway.app');
    refused('ftp://127.0.0.1');
    refused('not a url');
    refused('');
    refused(undefined);
  });

  it('names the problem without echoing credentials from the input', () => {
    try {
      resolveBaseUrl('https://user:hemligt@api.runquest.dev');
      assert.fail('should refuse');
    } catch (error) {
      assert.ok(error instanceof BaseUrlRefused);
      assert.ok(!error.message.includes('hemligt'));
    }
  });
});

describe('assertWithinBase', () => {
  it('passes a URL on the same origin and refuses any other origin, including a redirect target', () => {
    assert.doesNotThrow(() => assertWithinBase('http://127.0.0.1:4010', 'http://127.0.0.1:4010/api/news?limit=20'));
    assert.throws(() => assertWithinBase('http://127.0.0.1:4010', 'https://api.runquest.dev/api/news'), BaseUrlRefused);
    assert.throws(() => assertWithinBase('http://127.0.0.1:4010', 'http://127.0.0.1:4011/api/news'), BaseUrlRefused);
  });
});
