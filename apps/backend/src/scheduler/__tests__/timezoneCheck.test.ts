import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../utils/logger.js';
import { warnIfProcessTimezoneIsNotUtc } from '../timezoneCheck.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('the check of the TZ variable at start', () => {
  it.each([[undefined], [''], ['  '], ['UTC'], ['Etc/UTC'], ['utc']])('says nothing when TZ is %j', (value) => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    expect(warnIfProcessTimezoneIsNotUtc({ TZ: value })).toBe(false);

    expect(warn).not.toHaveBeenCalled();
  });

  it.each([['Europe/Stockholm'], ['America/New_York'], ['CET']])('warns once, naming the zone, when TZ is %s', (value) => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    expect(warnIfProcessTimezoneIsNotUtc({ TZ: value })).toBe(true);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(value);
    expect(String(warn.mock.calls[0][0])).toContain('UTC');
  });
});
