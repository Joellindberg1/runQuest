/**
 * RUN-213: smoketest av den RIKTIGA @supabase/supabase-js (ingen mock, inget nätverk).
 *
 * Övriga sviter mockar databasen och fångar därför inte att en supabase-js-uppdatering
 * slutar fungera på den Node-version vi kör. supabase-js >= 2.105.2 kräver inbyggd
 * WebSocket (Node 22) och kastar vid createClient på Node 20 (CI, .nvmrc, Railway),
 * trots att paketets engines säger >=20. Det här testet konstruerar klienten som
 * appen gör och fäller därför direkt på en Node-version som paketet inte stödjer.
 * Bara konstruktion — inga anrop, så ingen uppkoppling sker.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

describe('supabase-js smoke (riktig createClient, dummy-URL och -nyckel)', () => {
  beforeAll(() => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:1';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role-key';
  });

  it('createClient kastar inte på den här Node-versionen', () => {
    expect(() =>
      createClient('http://127.0.0.1:1', 'dummy-service-role-key', {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    ).not.toThrow();
  });

  it('klienten kan bygga en fråga utan att skicka den', () => {
    const client = createClient('http://127.0.0.1:1', 'dummy-service-role-key', {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const query = client.from('users').select('id', { count: 'exact', head: true });
    expect(typeof query.then).toBe('function');
  });

  it('appens getSupabaseClient() konstruerar den riktiga klienten', async () => {
    const { getSupabaseClient } = await import('../database.js');
    const client = getSupabaseClient();
    expect(typeof client.from).toBe('function');
  });
});
