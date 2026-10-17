/**
 * POST /api/users/profile-picture: uppladdningen går via backend med service role mot bucketen profile-pictures
 * (bucketens skrivpolicyer är stängda, migration 051, så den här vägen är den enda). Beteendet som ska bestå:
 * lyckad uppladdning, gammal fil rensas, fel typ ger 400, för stor fil ger 413, fel i lagringen ger 500 utan users-uppdatering.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests';
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('../../config/database.js', () => ({
  default: {},
  supabase: { client: {} },
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../../config/database.js';
import { createApp } from '../../app.js';
import { MAX_FILE_SIZE } from '../users.js';
import { createFakeDb, type Row } from './helpers/fakeDb.js';
import { mintToken } from './helpers/http.js';

let server: http.Server;
let base: string;
beforeAll(async () => {
  server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
afterEach(() => { vi.clearAllMocks(); });

const ME = 'user-1';
const BUCKET = 'profile-pictures';
const publicUrl = (name: string) => `https://files.example.test/storage/v1/object/public/${BUCKET}/${name}`;

function use(opts: { previous?: string | null; uploadError?: string } = {}) {
  const users: Row[] = [{ id: ME, profile_picture: opts.previous ?? null }];
  const db = createFakeDb({ users });
  const uploads: Array<{ bucket: string; name: string; size: number; options: Record<string, unknown> }> = [];
  const removed: Array<{ bucket: string; names: string[] }> = [];
  const storage = {
    from: (bucket: string) => ({
      upload: async (name: string, body: Buffer, options: Record<string, unknown>) => {
        uploads.push({ bucket, name, size: body.length, options });
        return { error: opts.uploadError ? { message: opts.uploadError } : null };
      },
      getPublicUrl: (name: string) => ({ data: { publicUrl: publicUrl(name) } }),
      remove: async (names: string[]) => { removed.push({ bucket, names }); return { error: null }; },
    }),
  };
  vi.mocked(getSupabaseClient).mockReturnValue({ ...db.client, storage } as never);
  return { users, uploads, removed };
}

async function upload(body: Buffer, contentType: string | null, token: string | null = mintToken({ user_id: ME })) {
  const res = await fetch(`${base}/api/users/profile-picture`, {
    method: 'POST',
    headers: { ...(contentType ? { 'Content-Type': contentType } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: new Uint8Array(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* ett fel utan JSON-svar */ }
  return { status: res.status, body: json };
}

const image = (bytes = 1024) => Buffer.alloc(bytes, 7);

describe('POST /api/users/profile-picture', () => {
  it('uploads the image to the profile-pictures bucket and saves its public URL on the user', async () => {
    const { users, uploads, removed } = use();
    const res = await upload(image(2048), 'image/png');
    expect(res.status).toBe(200);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({ bucket: BUCKET, size: 2048, options: { contentType: 'image/png' } });
    expect(uploads[0].name).toMatch(new RegExp(`^${ME}-\\d+\\.png$`));
    expect(res.body).toEqual({ success: true, data: { profile_picture: publicUrl(uploads[0].name) } });
    expect(users[0].profile_picture).toBe(publicUrl(uploads[0].name));
    expect(removed).toEqual([]);
  });

  it('removes the previous picture after a successful upload', async () => {
    const { removed } = use({ previous: publicUrl(`${ME}-1.jpg`) });
    const res = await upload(image(), 'image/webp');
    expect(res.status).toBe(200);
    expect(removed).toEqual([{ bucket: BUCKET, names: [`${ME}-1.jpg`] }]);
  });

  it.each(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])('accepts %s', async (type) => {
    use();
    expect((await upload(image(), type)).status).toBe(200);
  });

  it.each(['image/svg+xml', 'image/bmp', 'text/plain', 'application/json', 'application/octet-stream'])(
    'rejects %s with 400 and stores nothing',
    async (type) => {
      const { uploads, users } = use();
      const res = await upload(image(), type);
      expect(res.status).toBe(400);
      expect(uploads).toEqual([]);
      expect(users[0].profile_picture).toBeNull();
    },
  );

  it('rejects an empty body with 400', async () => {
    const { uploads } = use();
    expect((await upload(Buffer.alloc(0), 'image/png')).status).toBe(400);
    expect(uploads).toEqual([]);
  });

  it('accepts a file of exactly the size limit and rejects one byte more with 413', async () => {
    const { uploads } = use();
    expect((await upload(image(MAX_FILE_SIZE), 'image/png')).status).toBe(200);
    expect(uploads).toHaveLength(1);
    const over = await upload(image(MAX_FILE_SIZE + 1), 'image/png');
    expect(over.status).toBe(413);
    expect(uploads).toHaveLength(1);
  });

  it('requires a login', async () => {
    const { uploads } = use();
    expect((await upload(image(), 'image/png', null)).status).toBe(401);
    expect(uploads).toEqual([]);
  });

  it('answers 500 and leaves the user untouched when the storage upload fails', async () => {
    const { users, removed } = use({ previous: publicUrl(`${ME}-1.jpg`), uploadError: 'storage down' });
    const res = await upload(image(), 'image/png');
    expect(res.status).toBe(500);
    expect(users[0].profile_picture).toBe(publicUrl(`${ME}-1.jpg`));
    expect(removed).toEqual([]);
  });
});
