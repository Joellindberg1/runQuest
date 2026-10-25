import { useEffect, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation, useNavigate } from 'react-router-dom';
import { AppBrowserRouter } from './AppBrowserRouter';

// Utloggningen (AvatarMenu) byter adress och nollställer användaren i samma händelse och kräver att båda syns i EN rendering. Läggs adressbytet i en övergång
// ritar React tillståndsändringen först, med den gamla adressen kvar: en utloggad användare på en skyddad adress skickas då till inloggningen i stället för till Landing.
function Probe({ commits }: { commits: string[] }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [signedOut, setSignedOut] = useState(false);
  useEffect(() => {
    commits.push(`${pathname} signedOut=${signedOut}`);
  });
  return (
    <button
      type="button"
      onClick={() => {
        navigate('/landing', { replace: true });
        setSignedOut(true);
      }}
    >
      Log out
    </button>
  );
}

describe('the app router', () => {
  it('shows a navigation and a state change made in the same event together, never one without the other', async () => {
    window.history.replaceState({}, '', '/profile');
    const commits: string[] = [];
    render(
      <AppBrowserRouter>
        <Probe commits={commits} />
      </AppBrowserRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(commits.at(-1)).toBe('/landing signedOut=true');
    expect(commits).not.toContain('/profile signedOut=true');
  });
});
