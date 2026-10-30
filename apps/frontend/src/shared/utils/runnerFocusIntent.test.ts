import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FOCUS_INTENT_TTL_MS, requestRunnerFocus, takeRunnerFocus } from './runnerFocusIntent';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  takeRunnerFocus();
  vi.useRealTimers();
});

describe('runnerFocusIntent', () => {
  it('hands the runner over once', () => {
    requestRunnerFocus('u-karl');

    expect(takeRunnerFocus()).toBe('u-karl');
    expect(takeRunnerFocus()).toBeNull();
  });

  it('is null when nothing was requested', () => {
    expect(takeRunnerFocus()).toBeNull();
  });

  it('expires when no page took it in time', () => {
    requestRunnerFocus('u-karl');

    vi.advanceTimersByTime(FOCUS_INTENT_TTL_MS + 1);

    expect(takeRunnerFocus()).toBeNull();
  });

  it('the latest request wins', () => {
    requestRunnerFocus('u-karl');
    requestRunnerFocus('u-adam');

    expect(takeRunnerFocus()).toBe('u-adam');
  });
});
