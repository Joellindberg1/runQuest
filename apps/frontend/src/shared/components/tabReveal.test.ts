import { describe, expect, it } from 'vitest';
import { revealDelta } from './tabReveal';

const ROW = { left: 20, right: 300 };

describe('revealDelta', () => {
  it('flyttar ingenting när fliken redan ligger helt inom raden', () => {
    expect(revealDelta(ROW, { left: 20, right: 120 })).toBe(0);
    expect(revealDelta(ROW, { left: 200, right: 300 })).toBe(0);
  });

  it('flyttar åt höger precis så långt att en delvis skymd flik på högersidan syns helt', () => {
    expect(revealDelta(ROW, { left: 250, right: 352 })).toBe(52);
  });

  it('flyttar åt vänster precis så långt att en delvis skymd flik på vänstersidan syns helt', () => {
    expect(revealDelta(ROW, { left: -30, right: 60 })).toBe(-50);
  });

  it('lägger vänsterkanten mot radens när fliken är bredare än raden', () => {
    expect(revealDelta(ROW, { left: 100, right: 500 })).toBe(80);
  });
});
