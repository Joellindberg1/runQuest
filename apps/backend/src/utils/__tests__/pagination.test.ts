import { describe, it, expect } from 'vitest';
import { buildPageMeta, parseOffsetPage } from '../pagination.js';

const OPTS = { defaultLimit: 20, maxLimit: 50 };

describe('parseOffsetPage', () => {
  it('ger default limit och offset 0 utan parametrar', () => {
    expect(parseOffsetPage({}, OPTS)).toEqual({ ok: true, limit: 20, offset: 0 });
  });

  it('läser heltal ur strängar', () => {
    expect(parseOffsetPage({ limit: '6', offset: '12' }, OPTS)).toEqual({ ok: true, limit: 6, offset: 12 });
  });

  it('tillåter limit == max och offset 0', () => {
    expect(parseOffsetPage({ limit: '50', offset: '0' }, OPTS)).toEqual({ ok: true, limit: 50, offset: 0 });
  });

  it.each([
    ['limit=0', { limit: '0' }],
    ['limit över max', { limit: '51' }],
    ['limit negativ', { limit: '-1' }],
    ['limit decimal', { limit: '2.5' }],
    ['limit text', { limit: 'abc' }],
    ['limit tom', { limit: '' }],
    ['offset negativ', { offset: '-1' }],
    ['offset decimal', { offset: '1.5' }],
    ['offset text', { offset: 'x' }],
    ['limit upprepad', { limit: ['1', '2'] }],
    ['offset upprepad', { offset: ['1', '2'] }],
    ['limit som objekt', { limit: { a: '1' } }],
  ])('avvisar %s', (_name, query) => {
    const result = parseOffsetPage(query as any, OPTS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/limit|offset/);
  });
});

describe('buildPageMeta', () => {
  it('has_more är sant när fler rader finns efter sidan', () => {
    expect(buildPageMeta(25, 10, 0)).toEqual({ total: 25, limit: 10, offset: 0, has_more: true });
    expect(buildPageMeta(25, 10, 10)).toEqual({ total: 25, limit: 10, offset: 10, has_more: true });
  });

  it('has_more är falskt på sista sidan och bortom slutet', () => {
    expect(buildPageMeta(25, 10, 20).has_more).toBe(false);
    expect(buildPageMeta(20, 10, 10).has_more).toBe(false);
    expect(buildPageMeta(25, 10, 100).has_more).toBe(false);
    expect(buildPageMeta(0, 10, 0)).toEqual({ total: 0, limit: 10, offset: 0, has_more: false });
  });
});
