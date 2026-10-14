import { describe, expect, it } from 'vitest';
import { ME, NICK, challengeWon, levelUp, newsServer } from './news.fixture';

// Fixturen ska bete sig som servern, annars bevisar hooktesterna fel sak: oläst avgörs av isNotifiable ur shared
// och POST /news/read avvisar det parseReadIds avvisar.

describe('newsServer', () => {
  it('avgör oläst som servern: vunnen och förlorad utmaning är olästa, egen level up är läst', async () => {
    const news = newsServer([challengeWon(7, { actor: ME, target: NICK }), challengeWon(6), levelUp(5, 5, { actor: ME }), levelUp(4, 4)], 0);
    const res = await news.getNews({});
    expect(res.success && res.data.items.map((row) => [row.id, row.is_unread])).toEqual([[7, true], [6, true], [5, false], [4, true]]);
  });

  it('POST /news/read kvitterar kända id:n över golvet och räknar om', async () => {
    const news = newsServer([levelUp(3, 3), levelUp(2, 2), levelUp(1, 1)], 1);
    const res = await news.markNewsRead([3, 1, 99]);
    expect(res).toEqual({ success: true, data: { unread_count: 1 } });
    expect(news.server.readIds).toEqual(new Set([3]));
  });

  it.each([
    ['tom lista', []],
    ['fler än 50 id', Array.from({ length: 51 }, (_, index) => index + 1)],
    ['dubbletter', [4, 4]],
    ['noll', [0]],
    ['negativt id', [-3]],
    ['icke-heltal', [1.5]],
  ])('POST /news/read avvisar %s som servern gör (400)', async (_name, ids) => {
    const news = newsServer([levelUp(4, 4)], 0);
    const res = await news.markNewsRead(ids);
    expect(res).toEqual({ success: false, error: 'ids must be 1 to 50 unique positive integers' });
    expect(news.server.readIds.size).toBe(0);
  });

  it('exakt 50 unika id:n går igenom', async () => {
    const news = newsServer([levelUp(4, 4)], 0);
    const res = await news.markNewsRead(Array.from({ length: 50 }, (_, index) => index + 1));
    expect(res.success).toBe(true);
  });
});
