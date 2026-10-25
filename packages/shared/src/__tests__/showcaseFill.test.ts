import { describe, it, expect } from 'vitest';
import { BADGE_SERIES, MAX_SHOWCASE } from '../badges.js';
import { fillShowcase } from '../badgeDiff.js';
import * as shared from '../index.js';

const T0 = '2026-10-11T12:00:00.000Z';
const T1 = '2026-10-12T12:00:00.000Z';

const fresh = (series: string, earned_at = T0) => ({ series, earned_at });

describe('fillShowcase — nya serier fyller lediga platser', () => {
  it('två nya serier med två lediga platser hamnar båda i visningen', () => {
    const next = fillShowcase(['milestoner'], [fresh('speedster'), fresh('precisionist')]);

    expect(next).toEqual(['milestoner', 'speedster', 'precisionist']);
  });

  it('tom visning och en ny serie: serien blir den enda', () => {
    expect(fillShowcase([], [fresh('climber')])).toEqual(['climber']);
  });

  it('samtidiga nya serier läggs till i serieordningen oavsett indataordning', () => {
    const order = BADGE_SERIES.map((s) => s.key as string);
    const [first, second, third] = [order[1], order[4], order[6]];

    expect(fillShowcase([], [fresh(third), fresh(first), fresh(second)])).toEqual([first, second, third]);
  });

  it('fler nya än lediga platser: de nyaste vinner platserna, de äldre får vänta utanför', () => {
    const next = fillShowcase(
      ['milestoner', 'climber'],
      [fresh('early_bird', T0), fresh('night_owl', T1)]
    );

    expect(next).toEqual(['milestoner', 'climber', 'night_owl']);
  });

  it('fler samtidiga nya än lediga platser: serieordningen avgör vilka som kommer med', () => {
    const next = fillShowcase(['milestoner'], [fresh('speedster'), fresh('early_bird'), fresh('night_owl')]);

    expect(next).toEqual(['milestoner', 'early_bird', 'night_owl']);
  });

  it('en ny serie som redan står i visningen läggs inte dit en gång till', () => {
    expect(fillShowcase(['speedster'], [fresh('speedster'), fresh('climber')])).toEqual(['speedster', 'climber']);
  });

  it('okända serier och dubbletter i indata ignoreras', () => {
    expect(fillShowcase([], [fresh('no_such_series'), fresh('climber'), fresh('climber')])).toEqual(['climber']);
  });
});

describe('fillShowcase — det som inte ska ändras', () => {
  it('en full visning ändras inte och ger samma ordning', () => {
    const full = ['milestoner', 'climber', 'earth_trotter'];
    expect(full).toHaveLength(MAX_SHOWCASE);

    expect(fillShowcase(full, [fresh('speedster')])).toEqual(full);
  });

  it('inga nya serier ger visningen oförändrad (en uppgradering är inte en ny serie)', () => {
    expect(fillShowcase(['climber'], [])).toEqual(['climber']);
  });

  it('muterar inte indata', () => {
    const displayed = Object.freeze(['milestoner']);
    const fresher = Object.freeze([Object.freeze(fresh('climber'))]);

    expect(() => fillShowcase(displayed, fresher)).not.toThrow();
    expect(displayed).toEqual(['milestoner']);
  });

  it('exporteras från paketets index', () => {
    expect(shared.fillShowcase).toBe(fillShowcase);
  });
});
