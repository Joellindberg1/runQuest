import { describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import ChallengesPreviewPage from './ChallengesPreviewPage';
import { renderWithApp } from '@/test/renderApp';

// /preview/challenges ritar den nya Duels-layouten med exempeldata, utan inloggning och utan backend.

function renderPreview(entry = '/preview/challenges', width = 390) {
  return renderWithApp(
    <Routes>
      <Route path="/preview/challenges" element={<ChallengesPreviewPage />} />
    </Routes>,
    { entry, width, user: null },
  );
}

describe('/preview/challenges', () => {
  it('visar Duels-skärmen (rubrik, flikar, live-dueller, inkommande, tokens) utan inloggning', () => {
    renderPreview();
    expect(screen.getByRole('heading', { name: 'Challenges', level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Standings', 'Live', 'Rules', 'History']);
    expect(screen.getByText('Waiting on you')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Live duels' })).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('region', { name: 'Your tokens' })).toBeInTheDocument();
  });

  it('flikarna byter vy över ?view= och historiken kan filtreras till mina', () => {
    renderPreview();
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(screen.getByRole('list', { name: 'Matches' })).toBeInTheDocument();
    const all = within(screen.getByRole('list', { name: 'Matches' })).getAllByRole('listitem').length;
    fireEvent.click(screen.getByRole('button', { name: 'Whole pack' }));
    expect(within(screen.getByRole('list', { name: 'Matches' })).getAllByRole('listitem').length).toBeLessThan(all);
  });

  it('desktop: samma layout med rekord-panelen i sidokolumnen', () => {
    renderPreview('/preview/challenges', 1280);
    expect(screen.getByRole('region', { name: 'Your record' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send a challenge' })).toBeInTheDocument();
  });
});
