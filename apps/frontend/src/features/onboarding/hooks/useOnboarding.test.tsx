import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ONBOARDING_QUERY_KEY, useOnboarding } from './useOnboarding';

const api = vi.hoisted(() => ({
  fetchOnboardingStatus: vi.fn(),
  markOnboardingSeen: vi.fn(),
}));
vi.mock('../onboardingApi', () => api);

function setup() {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

describe('useOnboarding.markSeen', () => {
  it('lägger till sluggen i den laddade listan', async () => {
    api.fetchOnboardingStatus.mockResolvedValue(['a']);
    api.markOnboardingSeen.mockResolvedValue(undefined);
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useOnboarding('b'), { wrapper });
    await waitFor(() => expect(client.getQueryData(ONBOARDING_QUERY_KEY)).toEqual(['a']));
    await act(async () => { result.current.markSeen(); });
    await waitFor(() => expect(client.getQueryData(ONBOARDING_QUERY_KEY)).toEqual(['a', 'b']));
  });

  it('en sparning som slutar efter att cachen rensats skriver inget [slug] i nästa användares cache', async () => {
    api.fetchOnboardingStatus.mockResolvedValue(['a']);
    const noop = () => {};
    let finish: () => void = noop;
    api.markOnboardingSeen.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useOnboarding('b'), { wrapper });
    await waitFor(() => expect(client.getQueryData(ONBOARDING_QUERY_KEY)).toEqual(['a']));

    act(() => { result.current.markSeen(); });
    await waitFor(() => expect(finish).not.toBe(noop)); // sparningen har startat
    act(() => { client.removeQueries({ queryKey: ONBOARDING_QUERY_KEY }); }); // logout/401 mitt i sparningen
    api.fetchOnboardingStatus.mockRejectedValue(new Error('no token')); // ingen omhämtning ska hinna fylla cachen
    await act(async () => { finish(); });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(client.getQueryData(ONBOARDING_QUERY_KEY)).toBeUndefined();
  });
});
