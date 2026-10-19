import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACES_SAMPLE_RATE, MAX_TRACES_SAMPLE_RATE, clampTracesSampleRate, tracesSampleRateOf } from '../tracingRate';

describe('tracing sample rate', () => {
  it('is at most 0.1 whatever the environment says', () => {
    expect(MAX_TRACES_SAMPLE_RATE).toBe(0.1);
    expect(DEFAULT_TRACES_SAMPLE_RATE).toBeLessThanOrEqual(MAX_TRACES_SAMPLE_RATE);
    expect(tracesSampleRateOf(undefined)).toBe(0.1);
    expect(tracesSampleRateOf('')).toBe(0.1);
    expect(tracesSampleRateOf('   ')).toBe(0.1);
    expect(tracesSampleRateOf('not a number')).toBe(0.1);
    expect(tracesSampleRateOf('Infinity')).toBe(0.1);
    expect(tracesSampleRateOf('1')).toBe(0.1);
    expect(tracesSampleRateOf('0.5')).toBe(0.1);
    expect(tracesSampleRateOf('0.1')).toBe(0.1);
    expect(tracesSampleRateOf('0.05')).toBe(0.05);
  });

  it('can be switched off with 0 and never goes below it', () => {
    expect(tracesSampleRateOf('0')).toBe(0);
    expect(tracesSampleRateOf('-0.3')).toBe(0);
    expect(clampTracesSampleRate(-1)).toBe(0);
  });

  it('clamps a number the same way', () => {
    expect(clampTracesSampleRate(1)).toBe(0.1);
    expect(clampTracesSampleRate(0.02)).toBe(0.02);
    expect(clampTracesSampleRate(Number.NaN)).toBe(0.1);
  });
});
