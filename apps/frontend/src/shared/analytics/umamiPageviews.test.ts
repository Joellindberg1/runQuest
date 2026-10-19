import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UMAMI_DOMAINS, UMAMI_SCRIPT_SRC, createPageviewSender, umamiWebsiteIdOf } from './umamiPageviews';

// Nätverket fejkas: jsdom hämtar inga skript, och window.umami ersätts av en spion. Inget når Umami Cloud.
const WEBSITE_ID = 'f69b618e-a134-4cd9-af69-d4479c418de8';
const ORIGIN = window.location.origin;

type Payload = { website: string; hostname: string; title: string; url: string; referrer: string };
type PayloadMapper = (props: Payload) => Payload;

const realPayload: Payload = { website: WEBSITE_ID, hostname: 'www.runquest.dev', title: 'Anna Andersson', url: '/runner/3f2b8c1e?token=secret', referrer: 'https://www.google.com/search?q=anna+runquest' };
const track = vi.fn<(mapper: PayloadMapper) => void>();

const umamiScripts = () => document.head.querySelectorAll<HTMLScriptElement>('script[data-website-id]');
// Det riktiga skriptet sätter window.umami när det körs, strax före load-händelsen.
const installTracker = () => { (window as unknown as { umami?: unknown }).umami = { track }; };
const scriptLoaded = () => { installTracker(); umamiScripts()[0]!.dispatchEvent(new Event('load')); };
const sentPayload = (call: number): Payload => track.mock.calls[call]![0](realPayload);
const setReadyState = (state: DocumentReadyState) => vi.spyOn(document, 'readyState', 'get').mockReturnValue(state);
const setReferrer = (value: string) => Object.defineProperty(document, 'referrer', { value, configurable: true });

beforeEach(() => {
  track.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as { umami?: unknown }).umami;
  umamiScripts().forEach((script) => script.remove());
  setReferrer('');
  document.cookie.split(';').forEach((cookie) => { document.cookie = `${cookie.split('=')[0]}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`; });
  localStorage.clear();
  sessionStorage.clear();
});

describe('umamiWebsiteIdOf', () => {
  it('returns the website id of a build that has one', () => {
    expect(umamiWebsiteIdOf({ VITE_UMAMI_WEBSITE_ID: WEBSITE_ID })).toBe(WEBSITE_ID);
    expect(umamiWebsiteIdOf({ VITE_UMAMI_WEBSITE_ID: `  ${WEBSITE_ID}  ` })).toBe(WEBSITE_ID);
  });

  it('returns nothing when the variable is missing, empty or not an id, so no script is loaded', () => {
    expect(umamiWebsiteIdOf({})).toBeUndefined();
    expect(umamiWebsiteIdOf({ VITE_UMAMI_WEBSITE_ID: '' })).toBeUndefined();
    expect(umamiWebsiteIdOf({ VITE_UMAMI_WEBSITE_ID: '   ' })).toBeUndefined();
    expect(umamiWebsiteIdOf({ VITE_UMAMI_WEBSITE_ID: 'not-an-id' })).toBeUndefined();
  });

  it('returns nothing on a staging build even if the variable is set by mistake', () => {
    expect(umamiWebsiteIdOf({ VITE_UMAMI_WEBSITE_ID: WEBSITE_ID, VITE_APP_ENV: 'staging' })).toBeUndefined();
  });
});

describe('the Umami loader', () => {
  it('loads nothing and sends nothing without a website id', () => {
    const sender = createPageviewSender(undefined, window);
    sender.send('/board');
    expect(umamiScripts()).toHaveLength(0);
    expect(document.head.querySelector(`script[src="${UMAMI_SCRIPT_SRC}"]`)).toBeNull();
    expect(track).not.toHaveBeenCalled();
  });

  it('loads the script asynchronously and cookie-free, with automatic tracking off and only the production domains allowed', () => {
    createPageviewSender(WEBSITE_ID, window).send('/');
    const [script] = umamiScripts();
    expect(umamiScripts()).toHaveLength(1);
    expect(UMAMI_SCRIPT_SRC).toBe('https://cloud.umami.is/script.js');
    expect(script!.src).toBe('https://cloud.umami.is/script.js');
    expect(script!.async).toBe(true);
    expect(script!.defer).toBe(true);
    expect(script!.dataset.websiteId).toBe(WEBSITE_ID);
    expect(script!.dataset.autoTrack).toBe('false');
    expect(script!.dataset.doNotTrack).toBe('true');
    expect(script!.dataset.domains).toBe(UMAMI_DOMAINS);
    expect(UMAMI_DOMAINS).toBe('www.runquest.dev,runquest.dev');
  });

  it('waits for the page to finish loading before it fetches the script', () => {
    setReadyState('loading');
    createPageviewSender(WEBSITE_ID, window).send('/');
    expect(umamiScripts()).toHaveLength(0);
    window.dispatchEvent(new Event('load'));
    expect(umamiScripts()).toHaveLength(1);
  });

  it('loads the script once however many pages are viewed', () => {
    const sender = createPageviewSender(WEBSITE_ID, window);
    sender.send('/');
    sender.send('/login');
    sender.send('/board');
    expect(umamiScripts()).toHaveLength(1);
  });

  it('holds page views until the script has loaded, then sends them in order', () => {
    const sender = createPageviewSender(WEBSITE_ID, window);
    sender.send('/');
    sender.send('/login');
    expect(track).not.toHaveBeenCalled();
    scriptLoaded();
    expect(track).toHaveBeenCalledTimes(2);
    expect(sentPayload(0).url).toBe('/');
    expect(sentPayload(1).url).toBe('/login');
  });

  it('sends later page views straight away once the script is loaded', () => {
    const sender = createPageviewSender(WEBSITE_ID, window);
    sender.send('/');
    scriptLoaded();
    sender.send('/board');
    expect(track).toHaveBeenCalledTimes(2);
    expect(sentPayload(1).url).toBe('/board');
  });

  it('replaces the address with the normalized one and never sends the real title', () => {
    const sender = createPageviewSender(WEBSITE_ID, window);
    sender.send('/runner/:id');
    scriptLoaded();
    const payload = sentPayload(0);
    expect(payload).toMatchObject({ website: WEBSITE_ID, hostname: 'www.runquest.dev', url: '/runner/:id', title: '/runner/:id' });
    expect(JSON.stringify(payload)).not.toMatch(/3f2b8c1e|token|secret|Anna/);
  });

  it('sends only the origin of an outside referrer on the first page view, and the previous normalized page after that', () => {
    setReferrer('https://www.google.com/search?q=anna+runquest&uid=3f2b8c1e');
    const sender = createPageviewSender(WEBSITE_ID, window);
    sender.send('/');
    sender.send('/login');
    sender.send('/board');
    scriptLoaded();
    expect(sentPayload(0).referrer).toBe('https://www.google.com');
    expect(sentPayload(1).referrer).toBe(`${ORIGIN}/`);
    expect(sentPayload(2).referrer).toBe(`${ORIGIN}/login`);
  });

  it('sends no referrer for a page view that came from the same site or from nowhere', () => {
    setReferrer(`${ORIGIN}/board?week=3f2b8c1e`);
    const sender = createPageviewSender(WEBSITE_ID, window);
    sender.send('/');
    scriptLoaded();
    expect(sentPayload(0).referrer).toBe('');
  });

  it('keeps the utm_ parameters out of the referrer path', () => {
    const sender = createPageviewSender(WEBSITE_ID, window);
    sender.send('/?utm_source=email');
    sender.send('/login');
    scriptLoaded();
    expect(sentPayload(1).referrer).toBe(`${ORIGIN}/`);
  });

  it('survives a blocked script: nothing throws, nothing is sent and the script is not requested again', () => {
    const sender = createPageviewSender(WEBSITE_ID, window);
    sender.send('/');
    installTracker();
    umamiScripts()[0]!.dispatchEvent(new Event('error'));
    expect(() => sender.send('/board')).not.toThrow();
    expect(umamiScripts()).toHaveLength(1);
    expect(track).not.toHaveBeenCalled();
  });

  it('keeps at most 50 page views waiting for the script and drops the oldest', () => {
    const sender = createPageviewSender(WEBSITE_ID, window);
    for (let page = 0; page < 60; page += 1) sender.send(`/p${page}`);
    scriptLoaded();
    expect(track).toHaveBeenCalledTimes(50);
    expect(sentPayload(0).url).toBe('/p10');
    expect(sentPayload(49).url).toBe('/p59');
  });

  it('gives up when the script loads without providing a tracker: nothing is sent, now or later', () => {
    const sender = createPageviewSender(WEBSITE_ID, window);
    sender.send('/');
    umamiScripts()[0]!.dispatchEvent(new Event('load'));
    installTracker();
    sender.send('/board');
    expect(track).not.toHaveBeenCalled();
    expect(umamiScripts()).toHaveLength(1);
  });

  it('survives a tracker that throws', () => {
    const sender = createPageviewSender(WEBSITE_ID, window);
    sender.send('/');
    track.mockImplementation(() => { throw new Error('tracker broke'); });
    expect(() => scriptLoaded()).not.toThrow();
  });

  it('stores nothing in cookies or browser storage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const sender = createPageviewSender(WEBSITE_ID, window);
    sender.send('/');
    sender.send('/login');
    scriptLoaded();
    sender.send('/board');
    expect(document.cookie).toBe('');
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });
});

describe('the Umami loader, events', () => {
  type EventPayload = Payload & { name?: string; data?: Record<string, string> };
  const sentEvent = (call: number): EventPayload => track.mock.calls[call]![0](realPayload) as EventPayload;

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('loads nothing and sends nothing without a website id', () => {
    createPageviewSender(undefined, window).sendEvent('waitlist-click');
    expect(umamiScripts()).toHaveLength(0);
    expect(track).not.toHaveBeenCalled();
  });

  it('shares the one script and the one queue with the page views, and keeps the order', () => {
    const sender = createPageviewSender(WEBSITE_ID, window);
    sender.send('/');
    sender.sendEvent('film-started');
    sender.send('/login');
    expect(umamiScripts()).toHaveLength(1);
    expect(track).not.toHaveBeenCalled();
    scriptLoaded();
    expect(track).toHaveBeenCalledTimes(3);
    expect(sentEvent(0).url).toBe('/');
    expect(sentEvent(0).name).toBeUndefined();
    expect(sentEvent(1).name).toBe('film-started');
    expect(sentEvent(2).url).toBe('/login');
  });

  it('sends an event straight away once the script is loaded, with its name and data', () => {
    const sender = createPageviewSender(WEBSITE_ID, window);
    sender.send('/');
    scriptLoaded();
    sender.sendEvent('setting-changed', { setting: 'notify.title_taken_from_me' });
    expect(track).toHaveBeenCalledTimes(2);
    expect(sentEvent(1)).toMatchObject({ website: WEBSITE_ID, name: 'setting-changed', data: { setting: 'notify.title_taken_from_me' } });
  });

  it('drops an event the guard rejects, and requests no script for it', () => {
    const sender = createPageviewSender(WEBSITE_ID, window);
    const loose = sender.sendEvent as (name: string, props?: unknown) => void;
    loose('page-viewed-by-anna');
    loose('waitlist-click', { email: 'anna@example.com' });
    loose('setting-changed', { setting: 'notify.title_taken_from_me', distance: 5.2 });
    loose('setting-changed', { setting: '3f2b8c1e-5d4a-4b9e-8c1f-2a7d6e9b0c11' });
    expect(umamiScripts()).toHaveLength(0);
    sender.send('/');
    scriptLoaded();
    expect(track).toHaveBeenCalledTimes(1);
    expect(sentEvent(0).name).toBeUndefined();
  });

  it('sends no data field for an event without props', () => {
    const sender = createPageviewSender(WEBSITE_ID, window);
    sender.sendEvent('waitlist-click');
    scriptLoaded();
    expect('data' in sentEvent(0)).toBe(false);
  });

  it('replaces the real address, title and referrer, so an event on a runner page leaves no id or name behind', () => {
    window.history.pushState({}, '', '/runner/3f2b8c1e-9d4a-4e7b-8a61-5c0d2e9f7a14?token=secret');
    setReferrer('https://www.google.com/search?q=anna+runquest');
    const sender = createPageviewSender(WEBSITE_ID, window);
    sender.sendEvent('challenge-accepted');
    scriptLoaded();
    const payload = sentEvent(0);
    expect(payload).toMatchObject({ url: '/runner/:id', title: '/runner/:id', referrer: '', name: 'challenge-accepted' });
    expect(JSON.stringify(payload)).not.toMatch(/3f2b8c1e|token|secret|Anna|google/);
  });

  it('tags an event on the landing page with the landing address', () => {
    window.history.pushState({}, '', '/');
    const sender = createPageviewSender(WEBSITE_ID, window);
    sender.sendEvent('waitlist-joined');
    scriptLoaded();
    expect(sentEvent(0).url).toBe('/');
  });

  it('survives a blocked script and a tracker that throws', () => {
    const blocked = createPageviewSender(WEBSITE_ID, window);
    blocked.sendEvent('film-started');
    installTracker();
    umamiScripts()[0]!.dispatchEvent(new Event('error'));
    expect(() => blocked.sendEvent('film-started')).not.toThrow();
    expect(track).not.toHaveBeenCalled();

    umamiScripts().forEach((script) => script.remove());
    const broken = createPageviewSender(WEBSITE_ID, window);
    broken.sendEvent('film-started');
    track.mockImplementation(() => { throw new Error('tracker broke'); });
    expect(() => scriptLoaded()).not.toThrow();
  });

  it('never throws, not even when the page address cannot be read or the script cannot be added', () => {
    const noLocation = { document, addEventListener: () => {}, get location(): Location { throw new Error('no location'); } } as unknown as Window;
    expect(() => createPageviewSender(WEBSITE_ID, noLocation).sendEvent('waitlist-click')).not.toThrow();

    vi.spyOn(document.head, 'appendChild').mockImplementation(() => { throw new Error('cannot add the script'); });
    // Ett eget skript per sändare: den första som ber om skriptet är den som kastar.
    expect(() => createPageviewSender(WEBSITE_ID, window).sendEvent('waitlist-click')).not.toThrow();
    expect(() => createPageviewSender(WEBSITE_ID, window).send('/')).not.toThrow();
  });

  it('stores nothing in cookies or browser storage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const sender = createPageviewSender(WEBSITE_ID, window);
    sender.sendEvent('film-started');
    scriptLoaded();
    sender.sendEvent('waitlist-click');
    expect(document.cookie).toBe('');
    expect(setItem).not.toHaveBeenCalled();
  });
});
