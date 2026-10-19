/**
 * A fake of the Supabase management API for the staging script tests. The scripts get this as their `fetchImpl`, so no test makes a real
 * request. Every call is recorded (ref, path, method, parsed body, Authorization header). A request nobody configured answers HTTP 500, which
 * fails the test that caused it.
 */
export interface RecordedCall {
  ref: string;
  path: string;
  method: string;
  body: Record<string, unknown> | undefined;
  authorization: string;
}

export interface FakeAnswer {
  status?: number;
  body: unknown;
}

export type FakeHandler = (call: RecordedCall) => FakeAnswer | undefined;

export interface FakeManagementApi {
  fetchImpl: typeof fetch;
  calls: RecordedCall[];
  /** The calls that were not a plain read: a POST to /database/migrations, or a query whose SQL is not a SELECT. */
  writes: () => RecordedCall[];
  callsTo: (ref: string) => RecordedCall[];
}

const URL_SHAPE = /^https:\/\/api\.supabase\.com\/v1\/projects\/([a-z0-9]+)(\/.*)$/;

/**
 * Deliberately stricter than the guard under test, and independent of it: a statement counts as a read only when it starts with SELECT/WITH,
 * contains no semicolon anywhere (not even inside a literal) and no write keyword anywhere in the raw text. A read that merely mentions a
 * keyword in a string would be counted as a write here, which is the safe direction for a test that asserts "no writes".
 */
export const isSelect = (sql: unknown): boolean =>
  typeof sql === 'string' &&
  /^\s*(select|with)\b/i.test(sql) &&
  !sql.includes(';') &&
  !/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|into|begin|commit|call|do|execute|set|merge|lock)\b/i.test(sql);

export function createFakeManagementApi(handler: FakeHandler): FakeManagementApi {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const match = URL_SHAPE.exec(url);
    if (!match) return new Response(`unexpected url ${url}`, { status: 500 });
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: RecordedCall = {
      ref: match[1],
      path: match[2],
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined,
      authorization: headers.Authorization ?? '',
    };
    calls.push(call);
    const answer = handler(call);
    if (!answer) return new Response(`no fake answer for ${call.method} ${call.path}`, { status: 500 });
    return new Response(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }) as typeof fetch;
  // A call counts as a write unless it is a GET or a query that isSelect accepts. This holds for the read-only endpoint too: the test must not
  // lean on the server refusing a write, only on the script not sending one.
  const writes = () => calls.filter((c) => !(c.method === 'GET' || (c.path.startsWith('/database/query') && isSelect(c.body?.query))));
  return { fetchImpl, calls, writes, callsTo: (ref) => calls.filter((c) => c.ref === ref) };
}
