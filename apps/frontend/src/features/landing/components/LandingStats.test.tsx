import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { isInaccessible } from '@testing-library/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { formatInt } from '@/features/log/logFormat';
import { LandingStats } from './LandingStats';

const respondWith = (data: { runners: number; challenges: number; km: number }) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify({ success: true, data }), { status: 200 })));

function renderStats(fetchSpy: ReturnType<typeof respondWith> | ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchSpy);
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={client}>
      <LandingStats />
    </QueryClientProvider>,
  );
}

const items = () => within(screen.getByRole('region', { name: 'RunQuest in numbers' })).getAllByRole('listitem');
/** Texten som Testing Library ser den: tusentalsmellanrummet (smalt, ej brytande) är ett vanligt mellanslag. */
const plain = (value: number) => formatInt(value).replace(/\s/g, ' ');
const normalised = (node: HTMLElement) => (node.textContent ?? '').replace(/\s+/g, ' ').trim();

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LandingStats', () => {
  it('siffrorna visar km, löpare och utmaningar ur svaret i den ordningen', async () => {
    renderStats(respondWith({ runners: 6, challenges: 4, km: 4551 }));
    await screen.findByText(plain(4551));
    expect(items().map(normalised)).toEqual(['4 551 km logged', '6 runners', '4 challenges']);
  });

  it('siffrorna räknas inte upp från noll: första bilden med svaret visar slutvärdet och ingen animationsram begärs', async () => {
    const frame = vi.spyOn(window, 'requestAnimationFrame');
    renderStats(respondWith({ runners: 6, challenges: 4, km: 4551 }));
    const km = await screen.findByText(plain(4551));
    expect(km).toBeInTheDocument();
    expect(frame).not.toHaveBeenCalled();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('siffrorna visar platshållare medan de laddar', () => {
    renderStats(vi.fn(() => new Promise<Response>(() => {})));
    const region = screen.getByRole('region', { name: 'RunQuest in numbers' });
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(items().map(normalised)).toEqual(['— km logged', '— runners', '— challenges']);
  });

  it('när svaret har kommit är raden inte längre upptagen', async () => {
    renderStats(respondWith({ runners: 6, challenges: 4, km: 4551 }));
    await screen.findByText(plain(4551));
    expect(screen.getByRole('region', { name: 'RunQuest in numbers' })).not.toHaveAttribute('aria-busy', 'true');
  });

  it('skärmläsare får varje tal med sin etikett som en enhet, utan live-region', async () => {
    const { container } = renderStats(respondWith({ runners: 1, challenges: 0, km: 1_000_000 }));
    await screen.findByText(plain(1_000_000));
    expect(items().map(normalised)).toEqual(['1 000 000 km logged', '1 runner', '0 challenges']);
    // Tillgänglighetsträdet: varken talet eller etiketten är gömda (aria-hidden), så skärmläsaren läser båda i ordning.
    for (const item of items()) {
      expect(item.querySelectorAll('span')).toHaveLength(2);
      for (const part of item.querySelectorAll('span')) expect(isInaccessible(part)).toBe(false);
      expect(isInaccessible(item)).toBe(false);
    }
    expect(container.querySelector('[aria-live]')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
