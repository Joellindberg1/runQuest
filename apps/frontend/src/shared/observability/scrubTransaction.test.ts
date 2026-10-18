import { describe, expect, it } from 'vitest';
import { INTERACTION_SPAN_NAME, scrubSpanJson, scrubTransaction } from './scrubTransaction';

const RUNNER_ID = '3f2b8c1e-9d4a-4e7b-8a61-5c0d2e9f7a14';
const TOKEN = 'stored-token-value';

/** En sidladdning som Sentry skickar den: rå sökväg, resurs-spans, brödsmulor, väntande element och bildadresser. */
function pageloadTransaction() {
  return {
    type: 'transaction',
    transaction: `/runner/${RUNNER_ID}`,
    transaction_info: { source: 'url' },
    user: { id: 'u1', email: 'anna@example.com' },
    request: {
      url: `https://runquest.dev/runner/${RUNNER_ID}?tab=runs#top`,
      headers: { Referer: 'https://runquest.dev/board?email=anna@example.com', 'User-Agent': 'Mozilla/5.0 (test)', Cookie: 'a=b' },
    },
    contexts: {
      browser: { name: 'Chrome', version: '130' },
      trace: {
        op: 'pageload',
        data: {
          'sentry.op': 'pageload',
          'sentry.origin': 'auto.pageload.browser',
          'sentry.sample_rate': 0.1,
          'sentry.segment.name.source': 'url',
          'sentry.idle_span_finish_reason': 'idleTimeout',
          'performance.timeOrigin': 1792269863.89,
          'performance.activationStart': 0,
          'url.full': `https://runquest.dev/runner/${RUNNER_ID}`,
          'url.path': `/runner/${RUNNER_ID}`,
          'lcp.element': 'img[alt="Anna Andersson"]',
          'lcp.url': `https://cdn.example.com/avatars/${RUNNER_ID}.png`,
          'lcp.id': 'avatar',
          'cls.source.1': 'div.card > h2.anna-andersson',
          hardwareConcurrency: '16',
        },
      },
    },
    measurements: { lcp: { value: 1830, unit: 'millisecond' }, cls: { value: 0.02, unit: '' }, fcp: { value: 900, unit: 'millisecond' }, ttfb: { value: 120, unit: 'millisecond' } },
    spans: [
      { op: 'resource.script', description: 'https://runquest.dev/assets/index-abc.js', data: {}, span_id: 's1' },
      { op: 'http.client', description: `GET https://api.runquest.dev/api/users/${RUNNER_ID}?token=${TOKEN}`, data: {}, span_id: 's2' },
    ],
    breadcrumbs: [{ category: 'fetch', data: { url: `https://api.runquest.dev/api/users/${RUNNER_ID}` } }],
    sdk: { name: 'sentry.javascript.react' },
    environment: 'staging',
  };
}

describe('scrubTransaction', () => {
  it('names the page load after the route, never the path with the id', () => {
    const scrubbed = scrubTransaction(pageloadTransaction(), [])!;
    expect(scrubbed.transaction).toBe('/runner/:id');
    expect(scrubbed.transaction_info).toEqual({ source: 'route' });
    expect(JSON.stringify(scrubbed)).not.toContain(RUNNER_ID);
  });

  it('keeps the web vitals and the browser, and sends no child spans, breadcrumbs or user', () => {
    const scrubbed = scrubTransaction(pageloadTransaction(), [])!;
    expect(scrubbed.measurements).toEqual(pageloadTransaction().measurements);
    expect(scrubbed.contexts?.browser).toEqual({ name: 'Chrome', version: '130' });
    expect(scrubbed.spans).toEqual([]);
    expect(scrubbed.breadcrumbs).toBeUndefined();
    expect(scrubbed.user).toBeUndefined();
  });

  it('keeps only the attributes that say how and when the page loaded', () => {
    const data = (scrubTransaction(pageloadTransaction(), [])!.contexts as { trace: { data: Record<string, unknown> } }).trace.data;
    expect(Object.keys(data).sort()).toEqual([
      'performance.activationStart', 'performance.timeOrigin', 'sentry.idle_span_finish_reason', 'sentry.op', 'sentry.origin', 'sentry.sample_rate', 'sentry.segment.name.source',
    ]);
  });

  it('keeps the address as the route and the user agent, and nothing else about the request', () => {
    const { request } = scrubTransaction(pageloadTransaction(), [])!;
    expect(request).toEqual({ url: 'https://runquest.dev/runner/:id', headers: { 'User-Agent': 'Mozilla/5.0 (test)' } });
  });

  it('masks what the browser has stored, like every other event', () => {
    const event = { ...pageloadTransaction(), request: { url: `https://runquest.dev/board?x=${TOKEN}` }, extra: { note: `seen ${TOKEN}` } };
    expect(JSON.stringify(scrubTransaction(event, [TOKEN]))).not.toContain(TOKEN);
  });

  it('keeps the release and the debug ids that the source maps are matched on, and masks anything else that is not in that form', () => {
    const debugId = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    const event = { ...pageloadTransaction(), release: 'runquest@0.8.0+abcdef1', debug_meta: { images: [{ type: 'sourcemap', debug_id: debugId, code_file: 'https://runquest.dev/assets/index-abc.js' }] } };
    const scrubbed = scrubTransaction(event, [])! as unknown as { release?: string; debug_meta?: unknown };
    expect(scrubbed.release).toBe('runquest@0.8.0+abcdef1');
    expect(scrubbed.debug_meta).toEqual({ images: [{ type: 'sourcemap', debug_id: debugId, code_file: 'https://runquest.dev/assets/index-abc.js' }] });
    expect((scrubTransaction({ ...pageloadTransaction(), release: 'someone@example.com' }, [])! as unknown as { release?: string }).release).toBeUndefined();
  });

  it('drops an event for a stale chunk after a deploy, like every other event', () => {
    const event = { ...pageloadTransaction(), message: 'Failed to fetch dynamically imported module: https://runquest.dev/assets/x.js' };
    expect(scrubTransaction(event, [])).toBeNull();
  });
});

describe('scrubSpanJson', () => {
  const interaction = () => ({
    op: 'ui.interaction.click',
    description: 'button[aria-label="Open Anna Andersson"]',
    origin: 'auto.http.browser.inp',
    span_id: 'a1',
    trace_id: 't1',
    start_timestamp: 10,
    timestamp: 10.3,
    data: {
      'sentry.op': 'ui.interaction.click',
      'sentry.origin': 'auto.http.browser.inp',
      'sentry.exclusive_time': 300,
      'sentry.segment.name': `/runner/${RUNNER_ID}`,
      'sentry.environment': 'staging',
      'browser.web_vital.inp.value': 300,
      'browser.web_vital.inp.interaction_type': 'click',
      'browser.web_vital.inp.target': 'button[aria-label="Open Anna Andersson"]',
      'ui.component_name': 'AnnaCard',
      'user_agent.original': 'Mozilla/5.0 (test)',
      'user.id': 'u1',
      'user.email': 'anna@example.com',
      'user.ip_address': '203.0.113.7',
    },
  });

  it('gives an interaction a fixed name and keeps the value, the type and the user agent', () => {
    const scrubbed = scrubSpanJson(interaction());
    expect(scrubbed.description).toBe(INTERACTION_SPAN_NAME);
    expect(scrubbed.data).toEqual({
      'sentry.op': 'ui.interaction.click',
      'sentry.origin': 'auto.http.browser.inp',
      'sentry.exclusive_time': 300,
      'sentry.segment.name': '/runner/:id',
      'sentry.environment': 'staging',
      'browser.web_vital.inp.value': 300,
      'browser.web_vital.inp.interaction_type': 'click',
      'user_agent.original': 'Mozilla/5.0 (test)',
    });
    expect(scrubbed).toMatchObject({ op: 'ui.interaction.click', span_id: 'a1', trace_id: 't1', start_timestamp: 10, timestamp: 10.3 });
  });

  it('has no element description, component name or user left', () => {
    const json = JSON.stringify(scrubSpanJson(interaction()));
    for (const leaked of ['Anna', 'anna@example.com', '203.0.113.7', 'AnnaCard', RUNNER_ID]) expect(json).not.toContain(leaked);
  });

  it('names an interaction after the page it was reported on when the span has no page name of its own', () => {
    const withoutName = { ...interaction(), data: { ...interaction().data, 'sentry.segment.name': undefined } };
    const segmentName = (span: object) => ((span as { data: Record<string, unknown> }).data)['sentry.segment.name'];
    expect(segmentName(scrubSpanJson(withoutName, '/board'))).toBe('/board');
    expect(segmentName(scrubSpanJson(withoutName))).toBeUndefined();
    expect(segmentName(scrubSpanJson(interaction(), '/board'))).toBe('/runner/:id');
  });

  it('names a page load span by its route and any other span by its type', () => {
    expect(scrubSpanJson({ op: 'pageload', description: `/runner/${RUNNER_ID}`, data: {} }).description).toBe('/runner/:id');
    expect(scrubSpanJson({ op: 'resource.img', description: `https://cdn.example.com/avatars/${RUNNER_ID}.png`, data: {} }).description).toBe('resource.img');
  });

  it('does not change the span it is given', () => {
    const span = interaction();
    scrubSpanJson(span);
    expect(span).toEqual(interaction());
  });
});
