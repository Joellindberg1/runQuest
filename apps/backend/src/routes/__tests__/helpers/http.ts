import http from 'node:http';
import jwt from 'jsonwebtoken';
import type express from 'express';

export const TEST_JWT_SECRET = 'test-jwt-secret-for-integration-tests';

export function mintToken(claims: { user_id?: string; group_id?: string | null } = {}): string {
  return jwt.sign(
    {
      user_id: claims.user_id ?? 'user-1',
      name: 'TestUser',
      email: 'test@example.com',
      ...(claims.group_id === null ? {} : { group_id: claims.group_id ?? 'group-1' }),
    },
    process.env.JWT_SECRET ?? TEST_JWT_SECRET,
    { expiresIn: '1h' },
  );
}

export interface TestServer {
  request(method: string, path: string, opts?: { token?: string; body?: unknown }): Promise<{ status: number; body: any }>;
  close(): Promise<void>;
}

export function startServer(app: express.Express | http.RequestListener): Promise<TestServer> {
  return new Promise((resolveStart) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolveStart({
        request: (method, path, opts = {}) =>
          new Promise((resolve, reject) => {
            const payload = opts.body === undefined ? '' : JSON.stringify(opts.body);
            const req = http.request(
              {
                hostname: '127.0.0.1',
                port,
                path,
                method,
                headers: {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(payload),
                  ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
                },
              },
              (res) => {
                let raw = '';
                res.on('data', (c) => { raw += c; });
                res.on('end', () => {
                  try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) }); }
                  catch { resolve({ status: res.statusCode ?? 0, body: raw }); }
                });
              },
            );
            req.on('error', reject);
            if (payload) req.write(payload);
            req.end();
          }),
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
