import { describe, expect, it } from 'vitest';
import {
  boostText, durationLongText, firstName, formatDayMonth, formatMetricValue, formatMetricWithUnit, hoursUntilStart, metricLabel, metricUnit,
  stakeOf, startsInText, tierLabel, timeLeft,
} from './duelsFormat';
import { NOW } from './duels.fixture';

describe('mått och nivåer', () => {
  it('etiketter och enheter följer designen', () => {
    expect(metricLabel('km')).toBe('Most km');
    expect(metricLabel('runs')).toBe('Most runs');
    expect(metricLabel('total_xp')).toBe('Most XP');
    expect(metricUnit('total_xp')).toBe('xp');
    expect(tierLabel('legendary')).toBe('Legendary');
  });

  it('värden: km med en decimal, runs och XP som heltal i en-GB', () => {
    expect(formatMetricValue('km', 38.44)).toBe('38.4');
    expect(formatMetricValue('km', 5)).toBe('5.0');
    expect(formatMetricValue('runs', 5)).toBe('5');
    expect(formatMetricValue('total_xp', 1820.4)).toBe('1,820');
    expect(formatMetricValue('km', null)).toBe('—');
  });

  it('värde med enhet för löptext, "1 run" i singular', () => {
    expect(formatMetricWithUnit('km', 12.1)).toBe('12.1 km');
    expect(formatMetricWithUnit('runs', 1)).toBe('1 run');
    expect(formatMetricWithUnit('runs', 4)).toBe('4 runs');
    expect(formatMetricWithUnit('total_xp', 214)).toBe('214 XP');
  });

  it('förnamn och längd', () => {
    expect(firstName('Daniel Lindblad Lüthje')).toBe('Daniel');
    expect(firstName('  Karl  ')).toBe('Karl');
    expect(durationLongText(1)).toBe('1 day');
    expect(durationLongText(7)).toBe('7 days');
  });
});

describe('insatser', () => {
  it('boost: plus/minus-tecken, avklippta decimaler, dagar eller rundor', () => {
    expect(boostText(0.15, 5)).toBe('+0.15× / 5 d');
    expect(boostText(0.5, 14, 'multiplier_days')).toBe('+0.5× / 14 d');
    expect(boostText(-0.07, 5)).toBe('−0.07× / 5 d');
    expect(boostText(0.25, 3, 'multiplier_runs')).toBe('+0.25× / 3 runs');
    expect(boostText(0.25, 1, 'multiplier_runs')).toBe('+0.25× / 1 run');
  });

  it('en insats med straff: vinst grön, förlust röd, kort form utan längd', () => {
    const stake = stakeOf({ winner_delta: 0.25, winner_duration: 10, loser_delta: -0.12, loser_duration: 10 });
    expect(stake).toEqual({
      win: '+0.25× / 10 d',
      lose: '−0.12× / 10 d',
      loseTone: 'down',
      summary: '+0.25× win · −0.12× loss',
    });
  });

  it('inget straff (delta 0) läses "No penalty" i dämpad ton', () => {
    const stake = stakeOf({ winner_delta: 0.5, winner_duration: 14, loser_delta: 0, loser_duration: 0 });
    expect(stake.lose).toBe('No penalty');
    expect(stake.loseTone).toBe('muted');
    expect(stake.summary).toBe('+0.5× win · no penalty');
  });
});

describe('tider (Stockholm-kalenderdagar, now = 4 okt 12:00)', () => {
  it('formatDayMonth använder egna månadsnamn ("Sep", inte "Sept")', () => {
    expect(formatDayMonth('2026-08-21T01:00:00Z')).toBe('21 Aug');
    expect(formatDayMonth('2026-09-03T10:00:00Z')).toBe('3 Sep');
    expect(formatDayMonth(null)).toBeNull();
  });

  it('timeLeft: dagar kvar, imorgon, idag, avgörs', () => {
    expect(timeLeft('2026-10-13', NOW)).toEqual({ text: '9 d left', tone: 'neutral' });
    expect(timeLeft('2026-10-05', NOW)).toEqual({ text: 'ends tomorrow', tone: 'duel' });
    expect(timeLeft('2026-10-04', NOW)).toEqual({ text: 'ends today', tone: 'down' });
    expect(timeLeft('2026-10-03', NOW)).toEqual({ text: 'settling', tone: 'neutral' });
    expect(timeLeft(undefined, NOW)).toBeNull();
  });

  it('en kalenderdag räknas i Stockholm-tid, inte UTC (23:30 UTC är redan nästa dag)', () => {
    const lateUtc = new Date('2026-10-04T22:30:00Z'); // 5 okt 00:30 i Stockholm
    expect(timeLeft('2026-10-05', lateUtc)?.text).toBe('ends today');
  });

  it('startar-om: timmar inom ett dygn, annars dagar; null när redan startad', () => {
    expect(hoursUntilStart('2026-10-05', NOW)).toBe(12);
    expect(startsInText('2026-10-05', NOW)).toBe('starts in 12 h');
    expect(startsInText('2026-10-07', NOW)).toBe('starts in 3 d');
    expect(startsInText('2026-10-04', NOW)).toBeNull();
    expect(startsInText(undefined, NOW)).toBeNull();
  });
});
