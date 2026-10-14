/**
 * fakeDb måste svara på upsert som PostgREST, annars bevisar route-tester ingenting om vad koden läser tillbaka:
 * utan .select() är svaret return=minimal (data null); med ignoreDuplicates + .select() kommer bara de nyinsatta raderna;
 * utan ignoreDuplicates (merge) + .select() kommer både insatta och uppdaterade rader.
 */
import { describe, it, expect } from 'vitest';
import { createFakeDb } from './helpers/fakeDb.js';

const fresh = () => {
  const tables = { t: [{ k: 'a', v: 1 }] };
  return { tables, client: createFakeDb(tables).client };
};

describe('fakeDb upsert', () => {
  it('returns no data without select, as PostgREST return=minimal', async () => {
    const { tables, client } = fresh();
    const res = await client.from('t').upsert({ k: 'b', v: 2 }, { onConflict: 'k', ignoreDuplicates: true });
    expect(res).toEqual({ data: null, error: null, count: null });
    expect(tables.t).toHaveLength(2); // skrivningen skedde ändå
  });

  it('returns only newly inserted rows with ignoreDuplicates and select', async () => {
    const { tables, client } = fresh();
    const dup = await client.from('t').upsert({ k: 'a', v: 9 }, { onConflict: 'k', ignoreDuplicates: true }).select('k');
    expect(dup.data).toEqual([]);
    expect(tables.t[0].v).toBe(1); // DO NOTHING: den gamla raden är orörd

    const mixed = await client.from('t').upsert([{ k: 'a', v: 9 }, { k: 'c', v: 3 }], { onConflict: 'k', ignoreDuplicates: true }).select('k');
    expect(mixed.data).toEqual([{ k: 'c', v: 3 }]);
  });

  it('returns inserted and updated rows when merging with select', async () => {
    const { tables, client } = fresh();
    const res = await client.from('t').upsert([{ k: 'a', v: 9 }, { k: 'c', v: 3 }], { onConflict: 'k' }).select('k');
    expect(res.data).toEqual([{ k: 'a', v: 9 }, { k: 'c', v: 3 }]);
    expect(tables.t[0].v).toBe(9);
  });
});
