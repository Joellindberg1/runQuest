import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { Router, type Location, type Navigator } from 'react-router-dom';
import { requestRunnerFocus, takeRunnerFocus } from '@/shared/utils/runnerFocusIntent';
import { useRestoreRunnerFocus } from './useRestoreRunnerFocus';

const KARL = 'u-karl';

const location = (pathname: string): Location => ({ pathname, search: '', hash: '', state: null, key: pathname });

/** En navigator som är en ny identitet varje gång: `useNavigate` följer den, så hooken kör om sin effekt på samma plats. */
const newNavigator = (): Navigator => ({
  createHref: () => '',
  go: () => {},
  push: () => {},
  replace: () => {},
});

function Page() {
  useRestoreRunnerFocus();
  return (
    <main>
      <h1>Page</h1>
    </main>
  );
}

function PageWithTwoRows() {
  useRestoreRunnerFocus();
  return (
    <main>
      <h1>Page</h1>
      <button id="first" data-runner-id={KARL}>Karl, first row</button>
      <button id="second" data-runner-id={KARL}>Karl, second row</button>
    </main>
  );
}

const tree = (at: Location, navigator: Navigator) => (
  <Router location={at} navigator={navigator}>
    <Page />
  </Router>
);

afterEach(() => {
  takeRunnerFocus();
  document.body.innerHTML = '';
});

describe('useRestoreRunnerFocus', () => {
  it('keeps the focus intent when its effect runs again on the same location, before the row is drawn', async () => {
    const titles = location('/titles');
    const board = location('/board');
    const { rerender } = render(tree(titles, newNavigator()));

    // Ett steg bakåt lämnar en avsikt i minnet, och sidan under har ännu ingen rad.
    requestRunnerFocus(KARL);
    rerender(tree(board, newNavigator()));
    // Samma plats, ny navigator: effekten kör om medan raden fortfarande väntas. Avsikten hämtades vid platsbytet och får inte hämtas igen (då är den borta).
    rerender(tree(board, newNavigator()));

    document.querySelector('main')!.insertAdjacentHTML('beforeend', `<button id="row" data-runner-id="${KARL}">Karl</button>`);

    await waitFor(() => expect(document.getElementById('row')).toHaveFocus());
  });

  it('does not take an intent that was requested after the location settled', async () => {
    const titles = location('/titles');
    const board = location('/board');
    const { rerender } = render(tree(titles, newNavigator()));
    rerender(tree(board, newNavigator()));
    document.querySelector('main')!.insertAdjacentHTML('beforeend', `<button id="row" data-runner-id="${KARL}">Karl</button>`);

    // En avsikt för nästa platsbyte ska inte tas av en omkörning av effekten på den nuvarande platsen.
    requestRunnerFocus(KARL);
    rerender(tree(board, newNavigator()));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(document.getElementById('row')).not.toHaveFocus();
    expect(takeRunnerFocus()).toBe(KARL);
  });

  it('puts the focus on the element that was clicked, not on the first row of the same runner, when a cancelled send flow comes back', async () => {
    const duels = location('/duels');
    const { rerender } = render(
      <Router location={duels} navigator={newNavigator()}>
        <PageWithTwoRows />
      </Router>,
    );
    fireEvent.click(document.getElementById('second')!);

    requestRunnerFocus(KARL);
    rerender(
      <Router location={location('/duels-after-cancel')} navigator={newNavigator()}>
        <PageWithTwoRows />
      </Router>,
    );

    await waitFor(() => expect(document.getElementById('second')).toHaveFocus());
    expect(document.getElementById('first')).not.toHaveFocus();
  });
});
