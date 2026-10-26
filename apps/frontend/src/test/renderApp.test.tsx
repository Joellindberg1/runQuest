import { useEffect, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation, useNavigate } from 'react-router-dom';
import { renderWithApp } from './renderApp';

// Sidorna byter adress och sätter tillstånd i samma ögonblick (DuelsScreen: "Challenge sent" och sheeten stängs efter ett svar). Produktionens router lägger inte adressbytet i en
// övergång (AppBrowserRouter), så testernas router får inte heller göra det: annars syns tillståndet före adressbytet och ett prov som läser sidan direkt efter ser en halv uppdatering.
function Probe({ commits }: { commits: string[] }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [sent, setSent] = useState(false);
  useEffect(() => {
    commits.push(`${pathname} sent=${sent}`);
  });
  return (
    <button
      type="button"
      onClick={async () => {
        await Promise.resolve();
        setSent(true);
        navigate('/after', { replace: true });
      }}
    >
      Send
    </button>
  );
}

describe('the router of the page tests', () => {
  it('shows a state change and a navigation made in the same tick together, as the app does', async () => {
    const commits: string[] = [];
    renderWithApp(<Probe commits={commits} />, { entry: '/before' });

    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/after'));

    expect(commits.at(-1)).toBe('/after sent=true');
    expect(commits).not.toContain('/before sent=true');
  });
});
