import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backendApi } from '@/shared/services/backendApi';
import { fetchOnboardingStatus, markOnboardingSeen } from './onboardingApi';

// Onboarding-anropen går genom den delade klienten: samma token, samma bas-URL och samma väg för en utgången session som alla andra anrop.

const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.setItem('runquest_token', 'tok-123');
  localStorage.setItem('runquest_user', JSON.stringify({ id: 'u1', name: 'Anna', email: 'a@example.com' }));
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  backendApi.onUnauthorized = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('fetchOnboardingStatus', () => {
  it('hämtar GET /onboarding/status med token och ger de sedda stegen', async () => {
    fetchMock.mockResolvedValue(reply(200, { seen: ['onboarding_v1', 'tour_x'] }));

    expect(await fetchOnboardingStatus()).toEqual(['onboarding_v1', 'tour_x']);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url).endsWith('/onboarding/status')).toBe(true);
    expect(init.method ?? 'GET').toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
  });

  it('ett svar utan seen är en tom lista', async () => {
    fetchMock.mockResolvedValue(reply(200, {}));

    expect(await fetchOnboardingStatus()).toEqual([]);
  });

  it('kastar utan token och gör inget anrop', async () => {
    localStorage.clear();

    await expect(fetchOnboardingStatus()).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([500, 403])('kastar vid status %i så att en tom lista inte cachas som "inget är sett"', async (status) => {
    fetchMock.mockResolvedValue(reply(status, { error: 'nope' }));

    await expect(fetchOnboardingStatus()).rejects.toThrow();
  });

  it('en utgången session (401) loggar ut som alla andra anrop och kastar', async () => {
    const onUnauthorized = vi.fn();
    backendApi.onUnauthorized = onUnauthorized;
    fetchMock.mockResolvedValue(reply(401, { error: 'Invalid token' }));

    await expect(fetchOnboardingStatus()).rejects.toThrow();

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('runquest_token')).toBeNull();
  });
});

describe('markOnboardingSeen', () => {
  it('skickar POST /onboarding/mark-seen med token och exakt { slug }', async () => {
    fetchMock.mockResolvedValue(reply(200, { success: true }));

    await markOnboardingSeen('onboarding_v1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url).endsWith('/onboarding/mark-seen')).toBe(true);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok-123', 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ slug: 'onboarding_v1' });
  });

  it('kastar när servern svarar med ett fel', async () => {
    fetchMock.mockResolvedValue(reply(500, { error: 'nope' }));

    await expect(markOnboardingSeen('onboarding_v1')).rejects.toThrow();
  });

  it('kastar utan token', async () => {
    localStorage.clear();
    fetchMock.mockResolvedValue(reply(401, { error: 'No token' }));

    await expect(markOnboardingSeen('onboarding_v1')).rejects.toThrow();
  });
});
