/**
 * Rena funktioner och listor för Strava-webhookens händelselager (ADR 010 beslut 5 och 6): idempotensnyckeln, vitlistningen
 * av `updates` och listan över utfall. Ingen databas, inga mockar.
 *
 * event_time i nyckeln är Stravas egna epoch-sekunder som heltal (4 jan 2023 = 1672790400), exakt som de står i POST-brödtexten.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WEBHOOK_OUTCOMES,
  WEBHOOK_BACKOFF_MINUTES,
  WEBHOOK_DEAD_AFTER_HOURS,
  LEASE_SECONDS,
  WEBHOOK_CLAIM_BATCH,
} from '../stravaWebhook/constants.js';
import { buildWebhookDedupeKey, pickWhitelistedUpdates, type WebhookEventKeyInput } from '../stravaWebhook/dedupeKey.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const adr = readFileSync(resolve(__dirname, '../../../../../docs/adr/010-strava-webhooks.md'), 'utf8');

const base: WebhookEventKeyInput = {
  object_type: 'activity',
  object_id: 1234567890,
  aspect_type: 'update',
  event_time: 1672790400,
  updates: { private: 'true' },
};

describe('webhook constants', () => {
  it('keeps the retry, 48 h and lease constants from ADR 010', () => {
    expect([...WEBHOOK_BACKOFF_MINUTES]).toEqual([1, 5, 15, 60]);
    expect(WEBHOOK_DEAD_AFTER_HOURS).toBe(48);
    expect(LEASE_SECONDS).toBe(300);
    expect(WEBHOOK_CLAIM_BATCH).toBe(25); // p_max, ADR 010 beslut 6.3
  });
});

describe('webhook outcomes', () => {
  /** ADR 010 beslut 7.1: kolumnen "Resultat" i tabellen över vad Strava svarar. */
  const processingTableResults = (): string => {
    const section = adr.slice(adr.indexOf('### 7. '), adr.indexOf('### 8. '));
    const rows = section.split('\n').filter((line) => line.startsWith('|'));
    const header = rows.findIndex((line) => /Strava svarar\s*\|\s*Resultat/.test(line));
    expect(header, 'tabellen "Strava svarar | Resultat" hittades inte i ADR 010 beslut 7').toBeGreaterThanOrEqual(0);
    return rows.slice(header + 2).map((line) => line.split('|')[2] ?? '').join('\n');
  };
  // Ord i tabellen som står i kodformat men är status, händelsetyp eller kolumn, inte utfall. Ett nytt kodformat-ord i tabellen
  // fäller testet tills det antingen är ett utfall i koden eller står här.
  const NOT_OUTCOMES = new Set(['done', 'delete', 'date', 'start_time', 'run_weather', 'attempts']);

  it('outcome list in code covers every outcome the processing table names', () => {
    const named = [...processingTableResults().matchAll(/`([a-z]+(?:_[a-z]+)*)`/g)].map((m) => m[1]).filter((word) => !NOT_OUTCOMES.has(word));
    // Parsern ska ha hittat tabellens utfall; hittar den inget säger testet ingenting.
    for (const known of ['imported', 'updated', 'noop', 'not_a_run', 'deleted', 'removed_private', 'removed_not_running', 'ignored_paused', 'ignored_not_confirmed']) {
      expect(named, `parsern hittade inte ${known} i tabellen`).toContain(known);
    }
    for (const outcome of named) expect(WEBHOOK_OUTCOMES, `utfallet ${outcome} saknas i koden`).toContain(outcome);

    // Och ADR:ns egen uppräkning ("`outcome` (enum i kod): ...") är exakt listan i koden, varken fler eller färre.
    const enumLine = adr.split('\n').find((line) => line.includes('(enum i kod):'));
    if (!enumLine) throw new Error('ADR 010 beslut 5 saknar uppräkningen "(enum i kod):" av utfall; testet kan inte jämföra listan i koden');
    const listed = [...enumLine.slice(enumLine.indexOf('(enum i kod):')).matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
    expect([...WEBHOOK_OUTCOMES].sort()).toEqual([...listed].sort());
  });
});

describe('buildWebhookDedupeKey', () => {
  it('dedupe key is identical for an identical redelivery', () => {
    const redelivery: WebhookEventKeyInput = { ...base, updates: { private: 'true' } };
    expect(buildWebhookDedupeKey(redelivery)).toBe(buildWebhookDedupeKey(base));
    expect(buildWebhookDedupeKey(base)).toMatch(/^strava:activity:1234567890:update:1672790400:[0-9a-f]{12}$/);
  });

  it('dedupe key has fixed golden values: sha256 over canonical JSON, first 12 hex characters', () => {
    // sha256sum över {"private":"true"} resp. {"authorized":"false","private":"true","type":"Ride"} (nycklarna sorterade).
    expect(buildWebhookDedupeKey(base)).toBe('strava:activity:1234567890:update:1672790400:321a6af0e428');
    expect(buildWebhookDedupeKey({ ...base, updates: { type: 'Ride', private: 'true', authorized: 'false' } })).toBe(
      'strava:activity:1234567890:update:1672790400:4ed63caf7cbf',
    );
  });

  it('dedupe key differs for a different aspect_type, event_time or updates', () => {
    const key = buildWebhookDedupeKey(base);
    expect(buildWebhookDedupeKey({ ...base, aspect_type: 'delete' })).not.toBe(key);
    expect(buildWebhookDedupeKey({ ...base, event_time: base.event_time + 1 })).not.toBe(key);
    expect(buildWebhookDedupeKey({ ...base, updates: { private: 'false' } })).not.toBe(key);
    // Två olika ändringar av samma aktivitet i samma sekund skiljs åt av updates_hash.
    expect(buildWebhookDedupeKey({ ...base, updates: { type: 'Ride' } })).not.toBe(key);
    expect(buildWebhookDedupeKey({ ...base, object_id: base.object_id + 1 })).not.toBe(key);
    expect(buildWebhookDedupeKey({ ...base, object_type: 'athlete' })).not.toBe(key);
  });

  it('dedupe key uses a canonical key order for updates', () => {
    const one = buildWebhookDedupeKey({ ...base, updates: { private: 'true', type: 'Ride', authorized: 'false' } });
    const other = buildWebhookDedupeKey({ ...base, updates: { authorized: 'false', type: 'Ride', private: 'true' } });
    expect(one).toBe(other);
  });

  it('dedupe key ignores the activity title and stored updates never contain a title', () => {
    const withoutTitle = buildWebhookDedupeKey({ ...base, updates: { private: 'true' } });
    const withTitle = buildWebhookDedupeKey({ ...base, updates: { private: 'true', title: 'Morning run with Anna' } });
    expect(withTitle).toBe(withoutTitle);
    expect(withTitle).not.toContain('Anna');
    // Två titeländringar i samma sekund får samma nyckel (ofarligt: titeln läses aldrig).
    expect(buildWebhookDedupeKey({ ...base, updates: { title: 'A' } })).toBe(buildWebhookDedupeKey({ ...base, updates: { title: 'B' } }));
    expect(pickWhitelistedUpdates({ title: 'Morning run with Anna', private: 'true' })).not.toHaveProperty('title');
  });

  it('dedupe key treats missing, empty and title-only updates alike', () => {
    const { updates: _omitted, ...withoutUpdates } = base;
    expect(buildWebhookDedupeKey(withoutUpdates)).toBe(buildWebhookDedupeKey({ ...base, updates: {} }));
    expect(buildWebhookDedupeKey({ ...base, updates: null })).toBe(buildWebhookDedupeKey({ ...base, updates: {} }));
  });

  it('dedupe key refuses an event_time or object_id that is not an integer, so no key with NaN is ever stored', () => {
    expect(() => buildWebhookDedupeKey({ ...base, event_time: Number.NaN })).toThrow(/event_time/);
    expect(() => buildWebhookDedupeKey({ ...base, event_time: 1672790400.5 })).toThrow(/event_time/);
    expect(() => buildWebhookDedupeKey({ ...base, event_time: '1672790400' as unknown as number })).toThrow(/event_time/);
    expect(() => buildWebhookDedupeKey({ ...base, object_id: Number.MAX_SAFE_INTEGER + 2 })).toThrow(/object_id/);
  });
});

describe('pickWhitelistedUpdates', () => {
  it('pickWhitelistedUpdates keeps only private, type and authorized', () => {
    expect(
      pickWhitelistedUpdates({ private: 'true', type: 'Ride', authorized: 'false', title: 'Secret', description: 'x', latlng: [1, 2], token: 'abc' }),
    ).toEqual({ private: 'true', type: 'Ride', authorized: 'false' });
    expect(pickWhitelistedUpdates({ title: 'Only a title' })).toEqual({});
  });

  it('pickWhitelistedUpdates answers an empty object for anything that is not an object, and drops nested values', () => {
    for (const bad of [null, undefined, 'private', 7, true, ['private']]) expect(pickWhitelistedUpdates(bad)).toEqual({});
    expect(pickWhitelistedUpdates({ type: { nested: 'Ride' }, private: ['true'], authorized: null })).toEqual({});
  });

  it('pickWhitelistedUpdates does not read inherited properties', () => {
    const inherited = Object.create({ private: 'true' });
    expect(pickWhitelistedUpdates(inherited)).toEqual({});
  });
});
