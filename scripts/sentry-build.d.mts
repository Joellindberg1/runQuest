export const SENTRY_ORG: string;
export const SENTRY_URL: string;

export interface SentryUploadOptions {
  org: string;
  url: string;
  project: string;
  authToken: string;
  telemetry: false;
  release: { name: string; inject: false; setCommits: false; deploy: false };
  errorHandler: (error: unknown) => void;
}

export function sentryReleaseName(version: string, commitSha: string | undefined): string;
export function currentSentryRelease(env?: Record<string, string | undefined>): string;
export function sentryUploadOptions(input: {
  env: Record<string, string | undefined>;
  project: string;
  release: string;
}): SentryUploadOptions | null;
export function uploadNotice(project: string, options: SentryUploadOptions | null): string;
