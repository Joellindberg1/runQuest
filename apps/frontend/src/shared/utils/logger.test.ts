import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/observability/errorReporting', () => ({ reportError: vi.fn() }));

import { reportError } from '@/shared/observability/errorReporting';
import { logger } from './logger';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(reportError).mockClear();
});

describe('logger.error', () => {
  it('logs to the console and reports an Error as it is, with the message as context', () => {
    const error = new Error('db down');

    logger.error('Failed to load board', error);

    expect(console.error).toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(error, { message: 'Failed to load board' });
  });

  it('reports a non-Error value as an Error built from the message, keeping the value as detail', () => {
    logger.error('Failed to load board', { status: 500 });

    const [reported, context] = vi.mocked(reportError).mock.calls[0] ?? [];
    expect(reported).toBeInstanceOf(Error);
    expect((reported as Error).message).toBe('Failed to load board');
    expect(context).toEqual({ message: 'Failed to load board', detail: { status: 500 } });
  });

  it('reports a bare message', () => {
    logger.error('Something odd');

    const [reported, context] = vi.mocked(reportError).mock.calls[0] ?? [];
    expect((reported as Error).message).toBe('Something odd');
    expect(context).toEqual({ message: 'Something odd' });
  });
});

describe('logger.warn', () => {
  it('does not report', () => {
    logger.warn('careful');

    expect(reportError).not.toHaveBeenCalled();
  });
});
