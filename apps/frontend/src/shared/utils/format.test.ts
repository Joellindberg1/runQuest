import { describe, expect, it } from 'vitest';
import {
  MONTHS_LONG, MONTHS_SHORT, formatAgo, formatCountdown, formatDayMonth, formatInt, formatKm, formatMultiplier, formatTimes, firstName,
  type AgoStyle, type CountdownStyle,
} from './format';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const NBSP = ' ';

describe('formatInt', () => {
  it('tusental skrivs med hårt mellanslag (U+00A0), som "1 240"', () => {
    expect(formatInt(1240)).toBe(`1${NBSP}240`);
    expect(formatInt(1_234_567)).toBe(`1${NBSP}234${NBSP}567`);
  });

  it('fäller engelsk komma-form: aldrig "1,240" och aldrig ett vanligt mellanslag', () => {
    expect(formatInt(1240)).not.toBe('1,240');
    expect(formatInt(1240)).not.toContain(',');
    expect(formatInt(1240)).not.toContain(' ');
  });

  it('tal under tusen får inget mellanrum, och decimaler avrundas till heltal', () => {
    expect(formatInt(0)).toBe('0');
    expect(formatInt(988)).toBe('988');
    expect(formatInt(1126.4)).toBe(`1${NBSP}126`);
    expect(formatInt(999.5)).toBe(`1${NBSP}000`);
  });

  it('negativa tal behåller minustecknet och grupperas på siffrorna', () => {
    expect(formatInt(-1240)).toBe(`-1${NBSP}240`);
    expect(formatInt(-0.4)).toBe('0');
  });
});

describe('formatKm', () => {
  it('en decimal med punkt som decimaltecken', () => {
    expect(formatKm(8)).toBe('8.0');
    expect(formatKm(38.44)).toBe('38.4');
    expect(formatKm(41.25)).toBe('41.3');
  });

  it('tusental i heltalsdelen skrivs som formatInt, decimalen följer punkten', () => {
    expect(formatKm(1240.46)).toBe(`1${NBSP}240.5`);
    expect(formatKm(1240.46)).not.toContain(',');
  });

  it('antalet decimaler kan anges (sträckan i rundans detalj visar två)', () => {
    expect(formatKm(12.345, 2)).toBe('12.35');
    expect(formatKm(12.3, 0)).toBe('12');
  });

  it('avrundar halv uppåt på det decimaltal som skrivs, inte på det binära värdet (som Intl gjorde)', () => {
    expect(formatKm(0.95)).toBe('1.0');
    expect(formatKm(9.95)).toBe('10.0');
    expect(formatKm(12.35)).toBe('12.4');
    expect(formatKm(1.15)).toBe('1.2');
    expect(formatKm(1000.05)).toBe(`1${NBSP}000.1`);
    expect(formatKm(1.005, 2)).toBe('1.01');
    expect(formatKm(2.5, 0)).toBe('3');
  });

  it('negativa tal avrundas på beloppet, och noll, NaN och oändlighet skrivs som förut', () => {
    expect(formatKm(-12.35)).toBe('-12.4');
    expect(formatKm(-0.04)).toBe('-0.0');
    expect(formatKm(0)).toBe('0.0');
    expect(formatKm(-1240.46)).toBe(`-1${NBSP}240.5`);
    expect(formatKm(Number.NaN)).toBe('NaN');
    expect(formatKm(Number.POSITIVE_INFINITY)).toBe('Infinity');
    expect(formatKm(Number.NEGATIVE_INFINITY)).toBe('-Infinity');
  });

  it('tal som skrivs med exponent (mycket små eller stora) kraschar inte och skrivs som toFixed', () => {
    expect(formatKm(1e-7)).toBe('0.0');
    expect(formatKm(5e-324)).toBe('0.0');
    expect(formatKm(1e21)).toBe('1e+21');
  });
});

describe('formatMultiplier och formatTimes', () => {
  it('multiplikatorn med en decimal: "1.4×" efter, "×1.4" före', () => {
    expect(formatMultiplier(1.4)).toBe('1.4×');
    expect(formatMultiplier(1)).toBe('1.0×');
    expect(formatTimes(1.4)).toBe('×1.4');
    expect(formatTimes(2)).toBe('×2.0');
  });
});

describe('månadsnamn och formatDayMonth', () => {
  it('egna förkortningar i kalenderordning ("Sep", aldrig "Sept") och fullständiga namn', () => {
    expect(MONTHS_SHORT).toHaveLength(12);
    expect(MONTHS_SHORT[8]).toBe('Sep');
    expect(MONTHS_LONG[8]).toBe('September');
    expect(MONTHS_LONG.map((name) => name.slice(0, 3))).toEqual([...MONTHS_SHORT]);
  });

  it('en kalenderdag blir "21 Aug", och ett klockslag efter datumet påverkar inte', () => {
    expect(formatDayMonth('2026-08-21')).toBe('21 Aug');
    expect(formatDayMonth('2026-09-04')).toBe('4 Sep');
    expect(formatDayMonth('2026-12-01T10:00:00Z')).toBe('1 Dec');
  });
});

describe('formatAgo — namngivna stilar, samma text som varje skärm hade', () => {
  const cases: { style: AgoStyle; expected: [number, string][] }[] = [
    { style: 'spelled', expected: [[30_000, 'just now'], [32 * MINUTE, '32 min ago'], [3 * HOUR, '3 h ago'], [2 * DAY, '2 d ago']] },
    { style: 'compact', expected: [[30_000, 'just now'], [5 * MINUTE, '5 m ago'], [7 * HOUR, '7 h ago'], [4 * DAY, '4 d ago']] },
    { style: 'feed', expected: [[30_000, 'now'], [12 * MINUTE, '12m'], [2 * HOUR, '2h'], [3 * DAY, '3d']] },
    {
      style: 'feed-long',
      expected: [[30_000, 'Just now'], [12 * MINUTE, '12m ago'], [2 * HOUR, '2h ago'], [DAY, 'Yesterday'], [3 * DAY, '3 days ago']],
    },
  ];

  it.each(cases)('stil $style', ({ style, expected }) => {
    for (const [ms, text] of expected) expect(formatAgo(ms, style)).toBe(text);
  });

  it('gränserna: 59 s är nyss, exakt 1 min / 1 h / 1 dygn byter enhet', () => {
    expect(formatAgo(59_999, 'spelled')).toBe('just now');
    expect(formatAgo(MINUTE, 'spelled')).toBe('1 min ago');
    expect(formatAgo(HOUR - 1, 'spelled')).toBe('59 min ago');
    expect(formatAgo(HOUR, 'spelled')).toBe('1 h ago');
    expect(formatAgo(DAY - 1, 'spelled')).toBe('23 h ago');
    expect(formatAgo(DAY, 'spelled')).toBe('1 d ago');
  });

  it('stilen "spelled" är standard i Log: 32 min, inte 32 m', () => {
    expect(formatAgo(32 * MINUTE)).toBe('32 min ago');
  });
});

describe('formatCountdown — namngivna stilar', () => {
  const cases: { style: CountdownStyle; expected: [number, string][] }[] = [
    { style: 'hms', expected: [[6 * HOUR + 12 * MINUTE + 5_000, '6h 12m 05s'], [0, '0h 00m 00s'], [-5, '0h 00m 00s']] },
    { style: 'hm', expected: [[6 * HOUR + 12 * MINUTE, '6h 12m'], [2 * HOUR + 40 * MINUTE, '2h 40m'], [25 * MINUTE, '25m'], [-5, '0m']] },
    {
      style: 'coarse',
      expected: [[3 * DAY + 4 * HOUR, '3d 4h'], [6 * HOUR + 14 * MINUTE, '6h 14m'], [14 * MINUTE + 30_000, '14m'], [59_000, '<1m'], [0, '<1m']],
    },
    { style: 'pill', expected: [[30_000, '<1 m'], [28 * MINUTE, '28 m'], [6 * HOUR + 59 * MINUTE, '6h'], [30 * HOUR, '1 d'], [3 * DAY + 5 * HOUR, '3 d']] },
  ];

  it.each(cases)('stil $style', ({ style, expected }) => {
    for (const [ms, text] of expected) expect(formatCountdown(ms, style)).toBe(text);
  });
});

describe('firstName', () => {
  it('förnamnet, utan efternamn och utan ytterligare mellanrum', () => {
    expect(firstName('Daniel Lindblad Lüthje')).toBe('Daniel');
    expect(firstName('  Karl  ')).toBe('Karl');
    expect(firstName('Anna  Maria')).toBe('Anna');
  });

  it('ett enda namn är sig självt, och ett tomt namn ger tomt', () => {
    expect(firstName('Karl')).toBe('Karl');
    expect(firstName('')).toBe('');
  });
});
