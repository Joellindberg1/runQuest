/**
 * fakeDb måste tolka .or() som PostgREST, annars bevisar ett route-test ingenting om filtret som skickas:
 * kommatecken inuti citat och klamrar ska inte dela villkoret, `and(...)` får ligga inuti `or(...)`,
 * och `cs` är jsonb-innehåll (@>), inte strängjämförelse. Ett okänt villkor ska fälla testet, aldrig tyst matcha eller tyst utebli.
 */
import { describe, it, expect } from 'vitest';
import { createFakeDb, type Row } from './helpers/fakeDb.js';

const rows: Row[] = [
  { id: 1, type: 'a', owner: 'x', payload: { ids: ['u1', 'u2'], note: 'plain' } },
  { id: 2, type: 'b', owner: 'y', payload: { ids: ['u2'] } },
  { id: 3, type: 'a', owner: 'z', payload: { ids: [], note: 'say "hi", ok' } },
  { id: 4, type: 'a', owner: 'w', payload: null },
  { id: 5, type: 'a', owner: 'v', payload: { nested: { ids: ['u1'] } } },
];

const ids = async (expr: string): Promise<number[]> => {
  const { client } = createFakeDb({ t: rows.map((r) => ({ ...r })) });
  const res: any = await client.from('t').select('*').or(expr);
  return res.data.map((r: Row) => r.id);
};

// PostgREST-citering: omslut med " och escapa " och \ med backslash.
const quoted = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

describe('fakeDb or(): PostgREST-tolkning', () => {
  it('cs matchar jsonb-innehåll: en lista innehåller sina element, inte bara exakt lika', async () => {
    expect(await ids(`payload.cs.${quoted('{"ids":["u1"]}')}`)).toEqual([1]);
    expect(await ids(`payload.cs.${quoted('{"ids":["u2"]}')}`)).toEqual([1, 2]);
    expect(await ids(`payload.cs.${quoted('{"ids":["u1","u2"]}')}`)).toEqual([1]);
    expect(await ids(`payload.cs.${quoted('{"ids":["u9"]}')}`)).toEqual([]);
  });

  it('cs följer Postgres: nyckeln måste ligga på samma nivå, och en saknad payload (null) matchar aldrig', async () => {
    // rad 5 har ids bara under "nested", rad 4 saknar payload
    expect(await ids(`payload.cs.${quoted('{"ids":[]}')}`)).toEqual([1, 2, 3]);
    expect(await ids(`payload.cs.${quoted('{"nested":{"ids":["u1"]}}')}`)).toEqual([5]);
  });

  it('cs läser även en oquotad jsonb-literal med kommatecken inuti klamrarna', async () => {
    expect(await ids('owner.eq.y,payload.cs.{"ids":["u1","u2"]}')).toEqual([1, 2]);
  });

  it('ett citerat värde med kommatecken, citattecken och backslash delar inte villkoret och avcitatas som PostgREST', async () => {
    expect(await ids(`payload.cs.${quoted('{"note":"say \\"hi\\", ok"}')}`)).toEqual([3]);
    expect(await ids('owner.eq."x",owner.eq."y"')).toEqual([1, 2]);
  });

  it('and(...) inuti or(...): villkoren inom and gäller tillsammans, grenarna i or var för sig', async () => {
    expect(await ids(`owner.eq.y,and(type.eq.a,payload.cs.${quoted('{"ids":["u1"]}')})`)).toEqual([1, 2]);
    expect(await ids(`owner.eq.z,and(type.eq.b,payload.cs.${quoted('{"ids":["u1"]}')})`)).toEqual([3]);
  });

  it('ett kommatecken inuti ett citerat värde utanför klamrar delar inte villkoret', async () => {
    const { client } = createFakeDb({ t: [{ id: 1, owner: 'a,b' }, { id: 2, owner: 'a' }, { id: 3, owner: 'b' }] });
    const res: any = await client.from('t').select('*').or('owner.eq."a,b"');
    expect(res.data.map((r: Row) => r.id)).toEqual([1]);
  });

  it('en nästlad or(...) inuti and(...) är en or, inte en and', async () => {
    // type a: rad 1 (x), 3 (z), 4 (w), 5 (v). x eller y bland dem: bara rad 1. Som and skulle ingen rad matcha.
    expect(await ids('and(type.eq.a,or(owner.eq.x,owner.eq.y))')).toEqual([1]);
    expect(await ids('and(type.eq.a,or(owner.eq.x,owner.eq.z))')).toEqual([1, 3]);
  });

  it('and(...) respekterar parenteser och citat i värden (kommatecken inuti and delar inte yttre or)', async () => {
    expect(await ids(`and(type.eq.a,payload.cs.${quoted('{"note":"say \\"hi\\", ok"}')}),owner.eq.y`)).toEqual([2, 3]);
  });

  it('befintliga operatorer är oförändrade: eq, lt, gt och is.null', async () => {
    expect(await ids('owner.eq.x,owner.eq.v')).toEqual([1, 5]);
    expect(await ids('id.lt.2,id.gt.4')).toEqual([1, 5]);
    expect(await ids('payload.is.null')).toEqual([4]);
  });

  it('ett okänt villkor eller en trasig cs-literal kastar i stället för att tyst matcha eller utebli', async () => {
    await expect(ids('owner.like.x')).rejects.toThrow(/fakeDb/);
    await expect(ids('payload.cs.notjson')).rejects.toThrow(/fakeDb/);
  });
});
