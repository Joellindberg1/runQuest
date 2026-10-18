export const E2E_STAGING_FRONTEND_HOST: string;
export const E2E_STAGING_BACKEND_HOST: string;

export class E2eTargetError extends Error {}

export interface E2eTargets {
  baseUrl: string;
  apiUrl: string;
  /** Sant när både frontend och backend är localhost (inget stagingbygge att kontrollera). */
  isLocal: boolean;
}

export function assertStagingTarget(raw: unknown, role: 'frontend' | 'backend'): string;
export function resolveE2eTargets(env: Record<string, string | undefined>): E2eTargets;
export function isProdRequestUrl(raw: string): boolean;
export function assertStagingFrontendServes(baseUrl: string, fetchImpl?: (input: string) => Promise<Response>): Promise<void>;
