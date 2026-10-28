import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { usePreloadRunnerPopup } from './usePreloadRunnerPopup';
import { loadRunnerPopup } from './loadRunnerPopup';

vi.mock('./loadRunnerPopup', () => ({ loadRunnerPopup: vi.fn(async () => ({})) }));

function Rows() {
  usePreloadRunnerPopup();
  return (
    <main>
      <button type="button" data-runner-id="u-karl">Karl row</button>
      <button type="button">Not a runner row</button>
    </main>
  );
}

beforeEach(() => vi.mocked(loadRunnerPopup).mockClear());

describe('preloading the profile popup chunk', () => {
  it('starts when the pointer moves over a runner row', () => {
    render(<Rows />);
    expect(loadRunnerPopup).not.toHaveBeenCalled();

    fireEvent.pointerOver(screen.getByRole('button', { name: 'Karl row' }));

    expect(loadRunnerPopup).toHaveBeenCalledTimes(1);
  });

  it('starts when a runner row gets keyboard focus', () => {
    render(<Rows />);

    screen.getByRole('button', { name: 'Karl row' }).focus();

    expect(loadRunnerPopup).toHaveBeenCalledTimes(1);
  });

  it('starts from an element inside a runner row too', () => {
    render(
      <>
        <Rows />
        <a href="/runner/u-ada" data-runner-id="u-ada"><span>Ada</span></a>
      </>,
    );

    fireEvent.pointerOver(screen.getByText('Ada'));

    expect(loadRunnerPopup).toHaveBeenCalledTimes(1);
  });

  it('ignores everything that does not open a runner', () => {
    render(<Rows />);

    fireEvent.pointerOver(screen.getByRole('button', { name: 'Not a runner row' }));
    screen.getByRole('button', { name: 'Not a runner row' }).focus();

    expect(loadRunnerPopup).not.toHaveBeenCalled();
  });

  it('asks once, however many rows the pointer passes', () => {
    render(<Rows />);
    const row = screen.getByRole('button', { name: 'Karl row' });

    fireEvent.pointerOver(row);
    fireEvent.pointerOver(row);
    row.focus();

    expect(loadRunnerPopup).toHaveBeenCalledTimes(1);
  });

  it('stops listening when the shell unmounts', () => {
    const { unmount } = render(<Rows />);
    unmount();
    // A row that is still in the document after the shell is gone, so the event does reach the document.
    const row = document.body.appendChild(document.createElement('button'));
    row.setAttribute('data-runner-id', 'u-karl');

    fireEvent.pointerOver(row);
    row.focus();

    expect(loadRunnerPopup).not.toHaveBeenCalled();
    row.remove();
  });
});
