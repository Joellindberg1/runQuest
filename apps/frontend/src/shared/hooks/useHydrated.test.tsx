import { describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { useHydrated } from './useHydrated';

function Probe({ onRender }: { onRender?: (hydrated: boolean) => void }) {
  const hydrated = useHydrated();
  onRender?.(hydrated);
  return <p>{hydrated ? 'client' : 'server'}</p>;
}

describe('useHydrated', () => {
  it('is false when rendering on the server', () => {
    expect(renderToString(<Probe />)).toContain('server');
  });

  it('is true from the first render when the component is rendered on the client only', () => {
    const seen: boolean[] = [];
    render(<Probe onRender={(hydrated) => seen.push(hydrated)} />);
    expect(seen).toEqual([true]);
  });

  it('matches the server markup in the first client render, then turns true without a hydration error', async () => {
    const container = document.createElement('div');
    container.innerHTML = renderToString(<Probe />);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: boolean[] = [];
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, <Probe onRender={(hydrated) => seen.push(hydrated)} />);
    });
    expect(seen[0]).toBe(false);
    expect(seen.at(-1)).toBe(true);
    expect(container.textContent).toBe('client');
    expect(consoleError).not.toHaveBeenCalled();
    act(() => root?.unmount());
    consoleError.mockRestore();
  });
});
