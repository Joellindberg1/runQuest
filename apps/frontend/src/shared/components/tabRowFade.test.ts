import { describe, expect, it } from 'vitest';
import { fadeClearance, scrollEdges } from './tabRowFade';

// En flikrad som scrollar i sidled när flikarna inte ryms (Board: fyra flikar på 320 px). Kantfaden visas bara åt det håll det finns mer att scrolla mot, och den
// valda fliken ska aldrig ligga under fadens zon (annars tonas dess text ut). Geometrin kommer ur webbläsaren; här prövas räkneregeln.

describe('scrollEdges', () => {
  it('has no edge when every tab fits in the row', () => {
    expect(scrollEdges({ scrollLeft: 0, clientWidth: 400, scrollWidth: 400 })).toEqual({ start: false, end: false });
  });

  it('has an edge at the end only while the row is scrolled to the start', () => {
    expect(scrollEdges({ scrollLeft: 0, clientWidth: 282, scrollWidth: 430 })).toEqual({ start: false, end: true });
  });

  it('has edges at both ends in the middle', () => {
    expect(scrollEdges({ scrollLeft: 70, clientWidth: 282, scrollWidth: 430 })).toEqual({ start: true, end: true });
  });

  it('has an edge at the start only when scrolled all the way to the end, also with a fractional scroll position', () => {
    expect(scrollEdges({ scrollLeft: 148, clientWidth: 282, scrollWidth: 430 })).toEqual({ start: true, end: false });
    expect(scrollEdges({ scrollLeft: 147.6, clientWidth: 282, scrollWidth: 430 })).toEqual({ start: true, end: false });
  });
});

describe('fadeClearance', () => {
  const row = { left: 20, right: 302 };
  const both = { start: true, end: true };

  it('leaves a tab that is clear of both fades where it is', () => {
    expect(fadeClearance(row, { left: 60, right: 180 }, 24, both)).toBe(0);
  });

  it('moves a tab under the end fade (scrollLeft increases) just far enough to clear it', () => {
    expect(fadeClearance(row, { left: 190, right: 300 }, 24, both)).toBe(22);
  });

  it('moves a tab under the start fade (scrollLeft decreases) just far enough to clear it', () => {
    expect(fadeClearance(row, { left: 22, right: 140 }, 24, both)).toBe(-22);
  });

  it('ignores a fade that is not drawn, so the first and the last tab can sit flush with the edge', () => {
    expect(fadeClearance(row, { left: 20, right: 140 }, 24, { start: false, end: true })).toBe(0);
    expect(fadeClearance(row, { left: 190, right: 302 }, 24, { start: true, end: false })).toBe(0);
  });

  it('does nothing when there is no clearance to keep', () => {
    expect(fadeClearance(row, { left: 190, right: 302 }, 0, both)).toBe(0);
    expect(fadeClearance(row, { left: 190, right: 302 }, Number.NaN, both)).toBe(0);
  });
});
