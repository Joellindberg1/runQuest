import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PositionHistoryResponse } from '@runquest/shared';
import { setViewportWidth } from '@/test/viewport';
import { ME_ID, responseOf, runnerOf, weeksOf } from '../positionBoard.fixture';
import { PositionView } from './PositionView';

// Position-vyn med många veckor (All time): etikettantalet följer ytans uppmätta bredd, och vyn markeras upptagen medan det andra antalet veckor hämtas. Layout finns inte i jsdom: bredden
// läses ur getBoundingClientRect, som provet styr.

const FORTY_FOUR: PositionHistoryResponse = responseOf(weeksOf(44, 1), [
  runnerOf('u-karl', 'Karl Persson', Array.from({ length: 44 }, (_, i) => (i % 2 === 0 ? 1 : 2))),
  runnerOf(ME_ID, 'Joel Lindberg', Array.from({ length: 44 }, (_, i) => (i % 2 === 0 ? 2 : 1))),
]);
const EIGHT: PositionHistoryResponse = responseOf(weeksOf(8, 1), [
  runnerOf('u-karl', 'Karl Persson', [1, 2, 1, 2, 1, 2, 1, 2]),
  runnerOf(ME_ID, 'Joel Lindberg', [2, 1, 2, 1, 2, 1, 2, 1]),
]);

const labelsOf = (container: HTMLElement) => Array.from(container.querySelectorAll('.rq-board-position__week')).map((node) => node.textContent);

/** Ytan under grafen (veckoetiketternas yta) är `width` px bred; allt annat har ingen bredd. */
function measureWeeksFieldAs(width: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const measured = this.classList.contains('rq-board-position__weeks-field') ? width : 0;
    return { width: measured, height: 0, top: 0, left: 0, right: measured, bottom: 0, x: 0, y: 0, toJSON: () => ({}) };
  });
}

afterEach(() => vi.restoreAllMocks());

describe('PositionView with many weeks', () => {
  it('labels 44 weeks with seven labels on a wide chart and with fewer on a narrow one, never closer than a label pitch', () => {
    setViewportWidth(390);
    measureWeeksFieldAs(612);
    const wide = render(<PositionView data={FORTY_FOUR} meId={ME_ID} />);
    expect(labelsOf(wide.container)).toEqual(['W1', 'W9', 'W16', 'W23', 'W30', 'W37', 'W44']);
    wide.unmount();

    measureWeeksFieldAs(120);
    const narrow = render(<PositionView data={FORTY_FOUR} meId={ME_ID} />);
    // 120 px rymmer sex etiketter (24 px per etikett): steget blir nio veckor, så första veckan, var nionde bakifrån och den pågående ger fem etiketter.
    expect(labelsOf(narrow.container)).toEqual(['W1', 'W17', 'W26', 'W35', 'W44']);
  });

  it('does not thin the default eight weeks, whatever the width', () => {
    setViewportWidth(390);
    measureWeeksFieldAs(60);
    const { container } = render(<PositionView data={EIGHT} meId={ME_ID} />);

    expect(labelsOf(container)).toEqual(['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8']);
  });

  it('keeps all the labels it can before the chart has a width (as in the first paint)', () => {
    setViewportWidth(390);
    const { container } = render(<PositionView data={FORTY_FOUR} meId={ME_ID} />);

    expect(labelsOf(container)).toHaveLength(7);
  });

  it('marks the card busy while the other number of weeks loads, and not otherwise', () => {
    setViewportWidth(390);
    const { container, rerender } = render(<PositionView data={EIGHT} meId={ME_ID} />);
    expect(container.querySelector('.rq-board-position')).toHaveAttribute('aria-busy', 'false');

    rerender(<PositionView data={EIGHT} meId={ME_ID} busy />);

    expect(container.querySelector('.rq-board-position')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('img')).toBeInTheDocument();
  });
});
