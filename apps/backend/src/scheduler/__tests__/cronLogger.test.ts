/**
 * node-cron 4 logs a failed job, a missed tick and a failed start through its own logger, to console, with the whole Error (and, for
 * three messages, the error's text inside the string). A Supabase or Strava error can carry row values, a Strava id or a url in its
 * message, so the scheduler runs node-cron with the app's logger: fixed text and errorCode, never message, stack, details or cause.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import cron from 'node-cron';
import { logger, setErrorSink } from '../../utils/logger.js';
import { cronLogger, installCronLogger } from '../cronLogger.js';

const SECRET = 'postgres://svc:hunter2-SECRET@db.example/prod';
const STRAVA_ID = 'strava_athlete_9876543210';

function leakyError(): Error & { code: string; details: string } {
  const error = new Error(`insert failed for ${STRAVA_ID} via ${SECRET}`, { cause: new Error(`cause ${SECRET}`) });
  return Object.assign(error, { code: '23505', details: `Key (athlete)=(${STRAVA_ID}) already exists`, hint: SECRET });
}

let written: string[];
let reported: unknown[][];

/** Everything that reached a console method or the error sink, as one string per call. */
function capture(): void {
  written = [];
  reported = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      written.push(args.map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack}` : typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
    });
  }
  setErrorSink((message, args) => { reported.push([message, ...args]); });
}

const everything = () => JSON.stringify([written, reported, ...reported.flat().map((item) => (item instanceof Error ? item.message : item))]);

beforeEach(() => {
  capture();
  vi.stubEnv('NODE_ENV', 'test');
});
afterEach(() => {
  setErrorSink(null);
  cron.setLogger(undefined as never);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the logger given to node-cron', () => {
  it('logs an Error passed as the message by its code only', () => {
    cronLogger.error(leakyError());

    expect(everything()).not.toContain(STRAVA_ID);
    expect(everything()).not.toContain('SECRET');
    expect(everything()).not.toContain('hunter2');
    expect(written.join('\n')).toContain('23505');
  });

  it('logs the Error passed beside a fixed message by its code only', () => {
    cronLogger.error('Task failed with error!', leakyError());

    expect(everything()).not.toContain(STRAVA_ID);
    expect(everything()).not.toContain('SECRET');
    expect(written.join('\n')).toContain('Task failed with error!');
    expect(written.join('\n')).toContain('23505');
  });

  it('drops the error text node-cron builds into the start, stop and destroy messages', () => {
    cronLogger.error(`Failed to start scheduled task: ${leakyError().message}`);
    cronLogger.error(`Error stopping task "nightly" during shutdown: ${leakyError().message}`);
    cronLogger.error(`Error destroying task "nightly" during shutdown: ${leakyError().message}`);
    cronLogger.error(`Some message from a later node-cron: ${leakyError().message}`);

    expect(everything()).not.toContain(STRAVA_ID);
    expect(everything()).not.toContain('SECRET');
    expect(written.join('\n')).toContain('Failed to start scheduled task');
    expect(written.join('\n')).toContain('Error stopping task');
    expect(written.join('\n')).toContain('Error destroying task');
  });

  it('logs a missed execution as a warning with the time and no object', () => {
    const when = new Date('2026-10-20T10:05:00.000Z');

    cronLogger.warn(`missed execution at ${when}! Possible blocking IO or high CPU user at the same process used by node-cron.`);

    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(written.join('\n')).toContain('missed an execution');
    expect(written.join('\n')).toContain('2026-10-20T10:05:00.000Z');
  });

  it('logs an overlap as a warning and an unknown warning, info or debug text as fixed text', () => {
    cronLogger.warn('task still running, new execution blocked by overlap prevention!');
    cronLogger.warn(`something new with ${SECRET}`);
    cronLogger.info(`started ${SECRET}`);
    cronLogger.debug(`daemon ${SECRET}`, leakyError());

    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(everything()).not.toContain('SECRET');
    expect(everything()).not.toContain(STRAVA_ID);
  });
});

describe('a job that throws inside the real node-cron', () => {
  const runOneTick = async (job: () => unknown) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T10:00:30.000Z'));
    const task = cron.schedule('* * * * *', job);
    await vi.advanceTimersByTimeAsync(60 * 1000);
    await task.stop();
  };

  it.each([
    ['rejects', async () => { throw leakyError(); }],
    ['throws synchronously', () => { throw leakyError(); }],
  ])('keeps the error text out of console and the error sink when the job %s', async (_how, job) => {
    installCronLogger();

    await runOneTick(job);

    expect(written.length).toBeGreaterThan(0);
    expect(everything()).not.toContain(STRAVA_ID);
    expect(everything()).not.toContain('SECRET');
    expect(everything()).not.toContain('hunter2');
    expect(written.join('\n')).toContain('23505');
  });

  it('would leak the error text through node-cron if the app logger were not installed', async () => {
    await runOneTick(async () => { throw leakyError(); });

    expect(everything()).toContain(STRAVA_ID);
  });

  it('uses the app logger for the error line', async () => {
    const errorSpy = vi.spyOn(logger, 'error');
    installCronLogger();

    await runOneTick(async () => { throw leakyError(); });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain('23505');
    expect(errorSpy.mock.calls[0]).toHaveLength(1);
  });
});
