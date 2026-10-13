import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { AppRoutes } from '@/routes';
import { renderWithApp } from '@/test/renderApp';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/legal i routerträdet', () => {
  it('legal route renders without auth', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    renderWithApp(<AppRoutes />, { entry: '/legal#terms', user: null });

    expect(await screen.findByRole('heading', { level: 1, name: 'Privacy & Terms' })).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe('/legal');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
