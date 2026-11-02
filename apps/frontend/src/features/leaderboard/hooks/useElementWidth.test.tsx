import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useElementWidth } from './useElementWidth';

// jsdom har ingen layout: bredden läses ur getBoundingClientRect, som provet styr, och ResizeObserver är en styrbar fejk som ger samma återanrop som webbläsaren när ytan byter storlek.

let width = 0;
let observers: Array<{ callback: () => void; disconnected: boolean }> = [];
const realObserver = globalThis.ResizeObserver;

class FakeResizeObserver {
  entry: { callback: () => void; disconnected: boolean };
  constructor(callback: () => void) {
    this.entry = { callback, disconnected: false };
    observers.push(this.entry);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    this.entry.disconnected = true;
  }
}

beforeEach(() => {
  width = 0;
  observers = [];
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }));
});
afterEach(() => {
  globalThis.ResizeObserver = realObserver;
  vi.restoreAllMocks();
});

function Probe() {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const measured = useElementWidth(element);
  return (
    <>
      <div ref={setElement} data-testid="area" />
      <output>{measured}</output>
    </>
  );
}

const shown = () => screen.getByRole('status').textContent;

describe('useElementWidth', () => {
  it('is 0 until there is an element and a width to read', () => {
    render(<Probe />);
    expect(shown()).toBe('0');
  });

  it('reads the width when the element mounts, before anything is painted', () => {
    width = 175;
    render(<Probe />);
    expect(shown()).toBe('175');
  });

  it('follows the element when it changes size', () => {
    width = 120;
    render(<Probe />);
    expect(shown()).toBe('120');

    width = 196;
    act(() => observers.forEach((observer) => observer.callback()));

    expect(shown()).toBe('196');
  });

  it('keeps the last width while the element is hidden (a width of 0 is not a measurement)', () => {
    width = 175;
    render(<Probe />);

    width = 0;
    act(() => observers.forEach((observer) => observer.callback()));

    expect(shown()).toBe('175');
  });

  it('stops observing when the element goes away', () => {
    width = 175;
    const { unmount } = render(<Probe />);
    expect(observers.every((observer) => !observer.disconnected)).toBe(true);

    unmount();

    expect(observers.every((observer) => observer.disconnected)).toBe(true);
  });
});
