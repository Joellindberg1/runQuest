import { describe, it, expect } from 'vitest';
import { createFakeDb, expectNoUnexpectedRpc } from './helpers/fakeDb.js';

describe('fakeDb allowedRpc', () => {
  it('lets a registered or allowed rpc through and leaves nothing to report', async () => {
    const db = createFakeDb({}, { allowedRpc: ['allowed_one'], rpc: { registered_one: () => ({ data: 1 }) } });

    await expect(db.client.rpc('registered_one')).resolves.toEqual({ data: 1, error: null });
    await db.client.rpc('allowed_one');

    expect(() => expectNoUnexpectedRpc()).not.toThrow();
  });

  it('makes expectNoUnexpectedRpc fail for an rpc outside the list, even though the call itself answers ok', async () => {
    const db = createFakeDb({}, { allowedRpc: ['allowed_one'] });

    await expect(db.client.rpc('something_else')).resolves.toEqual({ data: null, error: null });

    expect(() => expectNoUnexpectedRpc()).toThrow(/something_else/);
    expect(() => expectNoUnexpectedRpc()).not.toThrow(); // the list is emptied when it is read
  });

  it('does not limit rpc calls when allowedRpc is not given', async () => {
    const db = createFakeDb({});

    await db.client.rpc('anything');

    expect(() => expectNoUnexpectedRpc()).not.toThrow();
  });
});
