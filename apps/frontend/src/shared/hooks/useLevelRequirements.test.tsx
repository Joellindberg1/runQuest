import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
const service = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('@/providers/authContext', () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock('@/shared/services/levelService', () => ({ frontendLevelService: service }));

import { useLevelRequirements, LEVELS_QUERY_KEY } from './useLevelRequirements';

const TABLE = [{ level: 1, xp_required: 0 }, { level: 2, xp_required: 100 }];

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(() => useLevelRequirements(), { wrapper }) };
}

beforeEach(() => {
  auth.user = null;
  service.refresh.mockReset();
});

describe('useLevelRequirements', () => {
  it('utloggad: inget anrop alls', async () => {
    const { result } = setup();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(service.refresh).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('inloggad: hämtar en gång och cachar för alltid (statisk tabell)', async () => {
    auth.user = { id: 'u1' };
    service.refresh.mockResolvedValue(TABLE);
    const { result, client } = setup();

    await waitFor(() => expect(result.current.data).toEqual(TABLE));

    expect(service.refresh).toHaveBeenCalledTimes(1);
    expect(client.getQueryState(LEVELS_QUERY_KEY)?.dataUpdatedAt).toBeGreaterThan(0);
    expect(client.getQueryCache().find({ queryKey: LEVELS_QUERY_KEY })?.isStale()).toBe(false);
  });

  it('fel: ett omförsök, sedan felläge (levelService räknar under tiden mot fallback)', async () => {
    auth.user = { id: 'u1' };
    service.refresh.mockRejectedValue(new Error('offline'));
    const { result } = setup();

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(service.refresh).toHaveBeenCalledTimes(2);
  });
});
