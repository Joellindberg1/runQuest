/**
 * Kritiska larm som Sentry-händelser, på ett ställe: captureLoggedError. Rader med prefixet "🚨 KRITISK" blir `fatal` med taggarna
 * alert=critical och source=<kod>. De riktiga källorna (worker, prenumerationskontroll, token-skrivning, utmaningsreparation) har
 * egna tester i sina testfiler; här testas regeln själv. Ingen riktig Sentry: fejkad transport.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../../utils/logger.js';
import { CriticalAlert } from '../../utils/criticalAlert.js';
import { startFakeSentry, type FakeSentry } from './helpers/fakeSentry.js';

let sentry: FakeSentry;
beforeEach(() => {
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation(() => {});
  sentry = startFakeSentry();
});
afterEach(async () => {
  await sentry.stop();
  vi.restoreAllMocks();
});

describe('critical alerts in sentry', () => {
  it('critical log lines reach sentry', async () => {
    logger.error('🚨 KRITISKT: Strava-webhook event dead after 48 h without being processed: activity create.', new CriticalAlert('webhook_dead'));
    const sent = await sentry.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0].level).toBe('fatal');
    expect(sent[0].tags).toMatchObject({ alert: 'critical', source: 'webhook_dead' });
    expect(sent[0].message).toContain('KRITISKT');
  });

  it('a critical line without a source code still becomes a fatal event with source unknown', async () => {
    logger.error('🚨 KRITISKT: something nobody gave a source code');
    const sent = await sentry.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ level: 'fatal', tags: { alert: 'critical', source: 'unknown' } });
  });

  it('the older spelling KRITISK is a critical alert too', async () => {
    logger.error('🚨 KRITISK: challenge c1 is completed WITHOUT boosts', { boostError: { message: 'x' } }, new CriticalAlert('challenge_repair'));
    const sent = await sentry.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ level: 'fatal', tags: { alert: 'critical', source: 'challenge_repair' } });
  });

  it('a critical line that carries an Error is one fatal exception event with the same tags', async () => {
    logger.error('🚨 KRITISKT: could not save', new Error('write failed'), new CriticalAlert('token_write'));
    const sent = await sentry.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0].exception.values[0].value).toBe('write failed');
    expect(sent[0]).toMatchObject({ level: 'fatal', tags: { alert: 'critical', source: 'token_write' } });
  });

  it('puts our own user id on the tags when the alert knows it, and nothing else about the user', async () => {
    logger.error('🚨 KRITISKT: kunde inte spara roterad Strava-token', new CriticalAlert('token_write', { userId: 'user-1' }));
    const sent = await sentry.flush();

    expect(sent[0].tags).toEqual(expect.objectContaining({ alert: 'critical', source: 'token_write', user_id: 'user-1' }));
    expect(Object.keys(sent[0].tags).sort()).toEqual(['alert', 'source', 'user_id']);
  });

  it('every critical line is sent, also when the same alarm repeats in a row', async () => {
    // Samma anropsställe två gånger (som nattkontrollen två nätter): SDK:ts repeat-filter slår annars ihop dem.
    for (let night = 0; night < 2; night++) {
      logger.error('🚨 KRITISKT: Strava-webhook: the subscription is missing.', new CriticalAlert('subscription_missing'));
    }
    const sent = await sentry.flush();

    expect(sent).toHaveLength(2);
  });

  it('is not hidden by the filter for expired client tokens', async () => {
    logger.error('🚨 KRITISKT: odd one', Object.assign(new Error('jwt expired'), { name: 'TokenExpiredError' }), new CriticalAlert('token_write'));
    const sent = await sentry.flush();

    expect(sent).toHaveLength(1);
  });

  it('a single critical logger.error call becomes exactly one event', async () => {
    logger.error('🚨 KRITISKT: Strava-webhook: the subscription is missing.', new CriticalAlert('subscription_missing'));
    expect(await sentry.flush()).toHaveLength(1);
  });

  it('an ordinary error line stays at level error and carries no alert tag', async () => {
    logger.error('❌ Error in group history endpoint (PGRST301)');
    logger.error('❌ Another one', new Error('x'));
    const sent = await sentry.flush();

    expect(sent).toHaveLength(2);
    for (const event of sent) {
      expect(event.level).toBe('error');
      expect(event.tags ?? {}).not.toHaveProperty('alert');
    }
  });

  it('an ordinary error line is still removed by the repeat filter', async () => {
    for (let round = 0; round < 2; round++) logger.error('❌ same line twice');
    expect(await sentry.flush()).toHaveLength(1);
  });

  it('keeps the console line and the source code in the log context', () => {
    logger.error('🚨 KRITISKT: x', new CriticalAlert('webhook_dead'));
    expect(console.error).toHaveBeenCalledWith('🚨 KRITISKT: x', expect.objectContaining({ source: 'webhook_dead' }));
  });
});
