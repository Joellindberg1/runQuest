import { describe, expect, it } from 'vitest';
import { runsInWindow, titleWindow } from '../titleWindow.js';

const run = (date: string, distance_km = 5) => ({ date, distance_km });

describe('titleWindow', () => {
  it('starts_on null ger ett fönster utan startdag (hela historiken)', () => {
    expect(titleWindow({ starts_on: null })).toEqual({ from: null });
  });

  it('ett satt starts_on blir fönstrets första dag', () => {
    expect(titleWindow({ starts_on: '2026-10-05' })).toEqual({ from: '2026-10-05' });
  });

  it('ett starts_on som inte är en riktig kalenderdag ger RangeError i stället för ett tyst felaktigt fönster', () => {
    for (const bad of ['2026-13-45', '2026-02-30', 'igår', '', '2026-10-05T10:00:00Z']) {
      expect(() => titleWindow({ starts_on: bad }), bad).toThrow(RangeError);
    }
  });
});

describe('runsInWindow', () => {
  const runs = [run('2026-10-03'), run('2026-10-04'), run('2026-10-05'), run('2026-10-06')];

  it('starts_on null: alla rundor räknas', () => {
    expect(runsInWindow(runs, titleWindow({ starts_on: null }))).toEqual(runs);
  });

  it('starts_on satt: bara rundor från joindagen och framåt, joindagen inräknad', () => {
    expect(runsInWindow(runs, titleWindow({ starts_on: '2026-10-05' })).map((r) => r.date)).toEqual(['2026-10-05', '2026-10-06']);
  });

  it('en runda dagen före joindagen räknas inte', () => {
    expect(runsInWindow([run('2026-10-04')], titleWindow({ starts_on: '2026-10-05' }))).toEqual([]);
  });

  it('gränsen är en kalenderdag och flyttas inte av sommartidsbyte', () => {
    const window = titleWindow({ starts_on: '2026-10-25' }); // hösten 2026: klockan går tillbaka natten mot 25 okt
    expect(runsInWindow([run('2026-10-24'), run('2026-10-25'), run('2026-10-26')], window).map((r) => r.date)).toEqual(['2026-10-25', '2026-10-26']);
    const spring = titleWindow({ starts_on: '2026-03-29' });
    expect(runsInWindow([run('2026-03-28'), run('2026-03-29')], spring).map((r) => r.date)).toEqual(['2026-03-29']);
  });

  it('dagen är run.date: start_time ignoreras, även när tidsstämpeln hamnar på andra sidan gränsen i Stockholm-tid', () => {
    const window = titleWindow({ starts_on: '2026-10-05' });
    // 23:30 den 4:e är 01:30 den 5:e i Stockholm, men rundans dag är fortfarande den 4:e.
    const before = { date: '2026-10-04', distance_km: 5, start_time: '2026-10-04T23:30:00Z' };
    // 00:30 den 5:e är rundans dag den 5:e oavsett hur tidsstämpeln tolkas.
    const onDay = { date: '2026-10-05', distance_km: 5, start_time: '2026-10-05T00:30:00Z' };
    expect(runsInWindow([before, onDay], window)).toEqual([onDay]);
  });

  it('gränsen går över månads- och årsskiften', () => {
    const window = titleWindow({ starts_on: '2027-01-01' });
    expect(runsInWindow([run('2026-12-31'), run('2027-01-01')], window).map((r) => r.date)).toEqual(['2027-01-01']);
  });

  it('behåller radernas övriga fält och ordning, och ändrar inte indatan', () => {
    const input = [{ date: '2026-10-06', distance_km: 7, start_time: '2026-10-06T06:00:00Z' }, { date: '2026-10-05', distance_km: 3 }];
    const snapshot = JSON.stringify(input);
    const out = runsInWindow(input, titleWindow({ starts_on: '2026-10-05' }));
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('en tom lista ger en tom lista', () => {
    expect(runsInWindow([], titleWindow({ starts_on: '2026-10-05' }))).toEqual([]);
  });

  it('en runda med ogiltigt datum i ett fönster med startdag ger RangeError, och släpps igenom utan startdag', () => {
    expect(() => runsInWindow([run('inte-en-dag')], titleWindow({ starts_on: '2026-10-05' }))).toThrow(RangeError);
    expect(runsInWindow([run('inte-en-dag')], titleWindow({ starts_on: null }))).toHaveLength(1);
  });
});
