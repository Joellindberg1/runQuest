import { describe, expect, it } from 'vitest';
import { currentSentryRelease, sentryReleaseName } from '../../../../../scripts/sentry-build.mjs';
import { RELEASE_PATTERN } from './scrubSentryEvent';

// Frontendens rensning släpper bara igenom en release i sin kända form (runquest@<version>+<sha7>). Byggets namn kommer från
// scripts/sentry-build.mjs. Ändras något av formaten (en version med ett nytt format, en längre sha) utan det andra tappar rensningen
// releasen, och källkartorna hittas inte i Sentry. Det här testet fäller bygget i CI innan dess.
describe('the release name of the build and the release pattern of the scrubber', () => {
  const SHA = 'abcdef0123456789abcdef0123456789abcdef01';

  it('match for the release this repo would build now, with and without a commit sha', () => {
    expect(currentSentryRelease({})).toMatch(RELEASE_PATTERN);
    expect(currentSentryRelease({ RAILWAY_GIT_COMMIT_SHA: SHA })).toMatch(RELEASE_PATTERN);
    expect(currentSentryRelease({ RAILWAY_GIT_COMMIT_SHA: SHA.toUpperCase() })).toMatch(RELEASE_PATTERN);
  });

  it('match for a user version and an internal four-part version, with and without a commit sha', () => {
    for (const version of ['0.8.0', '0.8.1', '1.12.3', '0.8.0.1', '0.8.0.12']) {
      expect(sentryReleaseName(version, undefined)).toMatch(RELEASE_PATTERN);
      expect(sentryReleaseName(version, SHA)).toMatch(RELEASE_PATTERN);
    }
  });

  it('does not match a release that has anything else in it', () => {
    for (const release of ['someone@example.com', 'runquest@0.8.0-rc.1', 'runquest@0.8.0+abc', 'runquest@0.8.0+abcdef1 anna', 'runquest@0.8.0\n']) {
      expect(release).not.toMatch(RELEASE_PATTERN);
    }
  });
});
