// Test av byggstegets Sentry-inställningar (ren logik, inga nätverksanrop). Körs med `node --test scripts/*.test.mjs`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { SENTRY_ORG, SENTRY_URL, currentSentryRelease, sentryReleaseName, sentryUploadOptions, uploadNotice } from './sentry-build.mjs';

const FAKE_TOKEN = 'FAKE_TEST_TOKEN_1_not_a_real_secret';

describe('sentryReleaseName', () => {
  it('joins the version and a short commit sha', () => {
    assert.equal(sentryReleaseName('0.8.0', '0123456789abcdef0123456789abcdef01234567'), 'runquest@0.8.0+0123456');
  });

  it('is the bare version when there is no commit sha', () => {
    assert.equal(sentryReleaseName('0.8.0', undefined), 'runquest@0.8.0');
    assert.equal(sentryReleaseName('0.8.0', ''), 'runquest@0.8.0');
  });

  it('ignores a value that is not a commit sha, so a stray variable can never put odd characters in the release name', () => {
    assert.equal(sentryReleaseName('0.8.0', 'not a sha/\n'), 'runquest@0.8.0');
  });
});

describe('currentSentryRelease', () => {
  it('uses the version in the root package.json and the Railway commit sha', () => {
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(currentSentryRelease({ RAILWAY_GIT_COMMIT_SHA: 'abcdef1234567890' }), `runquest@${version}+abcdef1`);
    assert.equal(currentSentryRelease({}), `runquest@${version}`);
  });
});

describe('sentryUploadOptions', () => {
  const release = 'runquest@0.8.0+abcdef1';

  it('is null without SENTRY_AUTH_TOKEN, so nothing is ever uploaded or sent', () => {
    assert.equal(sentryUploadOptions({ env: {}, project: 'runquest-frontend', release }), null);
    assert.equal(sentryUploadOptions({ env: { SENTRY_AUTH_TOKEN: '  ' }, project: 'runquest-frontend', release }), null);
  });

  it('targets the EU organisation and the given project with the same release the SDK reports', () => {
    const options = sentryUploadOptions({ env: { SENTRY_AUTH_TOKEN: FAKE_TOKEN }, project: 'runquest-backend', release });

    assert.equal(options?.org, SENTRY_ORG);
    assert.equal(options?.url, SENTRY_URL);
    assert.equal(options?.project, 'runquest-backend');
    assert.equal(options?.authToken, FAKE_TOKEN);
    assert.equal(options?.release.name, release);
  });

  it('sends no plugin telemetry and does not read git, so the build talks only to our own Sentry project', () => {
    const options = sentryUploadOptions({ env: { SENTRY_AUTH_TOKEN: FAKE_TOKEN }, project: 'runquest-frontend', release });

    assert.equal(options?.telemetry, false);
    assert.equal(options?.release.setCommits, false);
    assert.equal(options?.release.deploy, false);
  });

  it('lets the build continue when the upload fails, with a warning that never contains the token', () => {
    const options = sentryUploadOptions({ env: { SENTRY_AUTH_TOKEN: FAKE_TOKEN }, project: 'runquest-frontend', release });
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      options?.errorHandler(new Error(`request with ${FAKE_TOKEN} failed`));
    } finally {
      console.warn = original;
    }

    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /runquest-frontend/);
    assert.doesNotMatch(warnings[0], new RegExp(FAKE_TOKEN));
  });
});

describe('uploadNotice', () => {
  it('says plainly that the upload is skipped when there is no token', () => {
    assert.match(uploadNotice('runquest-frontend', null), /SENTRY_AUTH_TOKEN/);
    assert.match(uploadNotice('runquest-frontend', null), /skipped/i);
  });

  it('names the project and release when the maps will be uploaded', () => {
    const options = sentryUploadOptions({ env: { SENTRY_AUTH_TOKEN: FAKE_TOKEN }, project: 'runquest-frontend', release: 'runquest@0.8.0' });
    const notice = uploadNotice('runquest-frontend', options);

    assert.match(notice, /runquest-frontend/);
    assert.match(notice, /runquest@0\.8\.0/);
    assert.doesNotMatch(notice, new RegExp(FAKE_TOKEN));
  });
});
