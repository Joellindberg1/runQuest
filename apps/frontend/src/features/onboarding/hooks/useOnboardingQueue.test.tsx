import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FIXED_ONBOARDING_SLUGS, patchSlugForVersion } from '@runquest/shared';
import { changelog } from '@/features/changelog/changelogData';
import { useOnboardingQueue } from './useOnboardingQueue';

const api = vi.hoisted(() => ({ fetchOnboardingStatus: vi.fn() }));
vi.mock('../onboardingApi', () => api);

function queueFor(seen: string[]) {
  api.fetchOnboardingStatus.mockResolvedValue(seen);
  const client = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useOnboardingQueue(), { wrapper });
}

const announcedPatchSlugs = changelog.releases.filter((release) => release.announce === true).map((release) => patchSlugForVersion(release.version));

describe('useOnboardingQueue', () => {
  it('starts with the first-login tour for an account that has seen nothing', async () => {
    const { result } = queueFor([]);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.currentItem).toBe(FIXED_ONBOARDING_SLUGS[0]);
  });

  it('is empty for an account that has seen the fixed slugs and every announced patch note', async () => {
    const { result } = queueFor([...FIXED_ONBOARDING_SLUGS, ...announcedPatchSlugs]);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.currentItem).toBeNull();
  });

  it('surfaces a side tour that is missing from the seen list', async () => {
    const missing = FIXED_ONBOARDING_SLUGS[FIXED_ONBOARDING_SLUGS.length - 1];
    const { result } = queueFor([...FIXED_ONBOARDING_SLUGS.filter((slug) => slug !== missing), ...announcedPatchSlugs]);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.currentItem).toBe(missing);
  });
});
