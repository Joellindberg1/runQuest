import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { ROW_WAIT_MS, focusRunnerRowWhenRendered } from './focusRunnerRow';

const KARL = 'u-karl';

const page = (html: string) => {
  document.body.innerHTML = html;
};

/** Låter nästa uppgift (fokus flyttas först då) och eventuella DOM-observatörer köra. */
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(1); });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('focusRunnerRowWhenRendered', () => {
  it('focuses the row in the main content and settles', async () => {
    page('<main><h1>Page</h1><button id="row" data-runner-id="u-karl">Karl</button></main>');
    const settled = vi.fn();

    focusRunnerRowWhenRendered(KARL, settled);
    await flush();

    expect(document.getElementById('row')).toHaveFocus();
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('ignores a row outside the main content', async () => {
    page('<aside><button id="side" data-runner-id="u-karl">Karl</button></aside><main><h1>Page</h1></main>');

    focusRunnerRowWhenRendered(KARL, () => {});
    await flush();

    expect(document.getElementById('side')).not.toHaveFocus();
  });

  it('waits for a row that is drawn later', async () => {
    page('<main><h1>Page</h1></main>');
    const settled = vi.fn();
    focusRunnerRowWhenRendered(KARL, settled);
    await flush();
    expect(settled).not.toHaveBeenCalled();

    document.querySelector('main')!.insertAdjacentHTML('beforeend', '<button id="row" data-runner-id="u-karl">Karl</button>');
    await flush();

    expect(document.getElementById('row')).toHaveFocus();
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('falls back on the main heading when no row shows up in time, and makes it focusable', async () => {
    page('<main><h1 id="title">Page</h1></main>');
    const settled = vi.fn();

    focusRunnerRowWhenRendered(KARL, settled);
    await act(async () => { await vi.advanceTimersByTimeAsync(ROW_WAIT_MS + 1); });

    expect(document.getElementById('title')).toHaveFocus();
    expect(document.getElementById('title')).toHaveAttribute('tabindex', '-1');
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('does not move the focus while another modal dialog is open, and does once it is gone', async () => {
    page('<main><h1>Page</h1><button id="row" data-runner-id="u-karl">Karl</button></main><div role="dialog" aria-modal="true" id="other"><button id="inside">Inside</button></div>');
    document.getElementById('inside')!.focus();
    const settled = vi.fn();

    focusRunnerRowWhenRendered(KARL, settled);
    await flush();
    expect(document.getElementById('row')).not.toHaveFocus();
    expect(settled).not.toHaveBeenCalled();

    document.getElementById('other')!.remove();
    await flush();

    expect(document.getElementById('row')).toHaveFocus();
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('gives up without moving the focus when a modal dialog is still open at the time limit', async () => {
    page('<main><h1 id="title">Page</h1><button id="row" data-runner-id="u-karl">Karl</button></main><div role="dialog" aria-modal="true"><button id="inside">Inside</button></div>');
    document.getElementById('inside')!.focus();
    const settled = vi.fn();

    focusRunnerRowWhenRendered(KARL, settled);
    await act(async () => { await vi.advanceTimersByTimeAsync(ROW_WAIT_MS + 1); });

    expect(document.getElementById('inside')).toHaveFocus();
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('the returned canceller stops it: no focus move and no settle', async () => {
    page('<main><h1>Page</h1></main>');
    const settled = vi.fn();
    const cancel = focusRunnerRowWhenRendered(KARL, settled);

    cancel();
    document.querySelector('main')!.insertAdjacentHTML('beforeend', '<button id="row" data-runner-id="u-karl">Karl</button>');
    await act(async () => { await vi.advanceTimersByTimeAsync(ROW_WAIT_MS + 1); });

    expect(document.getElementById('row')).not.toHaveFocus();
    expect(settled).not.toHaveBeenCalled();
  });
});
