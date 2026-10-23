import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PendingNavigate } from './PendingNavigate';

// Att #root aldrig är tom under en omdirigering bevisas i webbläsaren av apps/e2e/tests/transitions.spec.ts. Här prövas regeln på komponenten: en serverrendering kör inga
// effekter, så den visar vad som ritas i commiten där omdirigeringen beställs (före adressbytet).
describe('a redirect that is still pending', () => {
  it('draws the loading view instead of nothing', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <PendingNavigate to="/board" />
      </MemoryRouter>,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('Loading');
  });

  it('ends on its target, replacing the loading view', async () => {
    render(
      <MemoryRouter initialEntries={['/from']}>
        <Routes>
          <Route path="/from" element={<PendingNavigate to="/board" />} />
          <Route path="/board" element={<h1>Board page</h1>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Board page' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
