import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultPageviewSender, resetDefaultPageviewSender } from './umamiPageviews';
import { track } from './track';

// Nätverket fejkas: jsdom hämtar inga skript, och window.umami ersätts av en spion. Inget når Umami Cloud. Typerna prövas av tsc (ts-expect-error).
const WEBSITE_ID = 'f69b618e-a134-4cd9-af69-d4479c418de8';
const umamiTrack = vi.fn<(mapper: (props: Record<string, unknown>) => Record<string, unknown>) => void>();

const umamiScripts = () => document.head.querySelectorAll<HTMLScriptElement>('script[data-website-id]');
const scriptLoaded = () => {
  (window as unknown as { umami?: unknown }).umami = { track: umamiTrack };
  umamiScripts()[0]!.dispatchEvent(new Event('load'));
};
const sent = (call: number) => umamiTrack.mock.calls[call]![0]({ website: WEBSITE_ID, url: '/real/address', title: 'Real title', referrer: 'https://example.org/?q=1' });

beforeEach(() => {
  umamiTrack.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetDefaultPageviewSender();
  delete (window as unknown as { umami?: unknown }).umami;
  umamiScripts().forEach((script) => script.remove());
});

describe('track', () => {
  it('sends the event to Umami once the script has loaded, for a build with a website id', () => {
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', WEBSITE_ID);
    track('waitlist-click');
    track('setting-changed', { setting: 'notify.title_taken_from_me' });
    scriptLoaded();
    expect(umamiTrack).toHaveBeenCalledTimes(2);
    expect(sent(0)).toMatchObject({ name: 'waitlist-click' });
    expect(sent(1)).toMatchObject({ name: 'setting-changed', data: { setting: 'notify.title_taken_from_me' } });
  });

  it('sends nothing and loads nothing without a website id', () => {
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', '');
    track('waitlist-click');
    expect(umamiScripts()).toHaveLength(0);
    expect(umamiTrack).not.toHaveBeenCalled();
  });

  it('sends nothing and loads nothing in a staging build, even with a website id', () => {
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', WEBSITE_ID);
    vi.stubEnv('VITE_APP_ENV', 'staging');
    track('waitlist-click');
    expect(umamiScripts()).toHaveLength(0);
    expect(umamiTrack).not.toHaveBeenCalled();
  });

  it('shares one script with the page views', () => {
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', WEBSITE_ID);
    createDefaultPageviewSender().send('/');
    track('film-started');
    createDefaultPageviewSender().send('/login');
    expect(umamiScripts()).toHaveLength(1);
    scriptLoaded();
    expect(umamiTrack).toHaveBeenCalledTimes(3);
  });

  it('drops an event a cast has smuggled past the types', () => {
    vi.stubEnv('VITE_UMAMI_WEBSITE_ID', WEBSITE_ID);
    const loose = track as unknown as (name: string, props?: unknown) => void;
    loose('waitlist-click', { email: 'anna@example.com' });
    loose('run-logged-manual', { distance: 5.2 });
    loose('setting-changed', { setting: 'notify.title_taken_from_me', user_id: '3f2b8c1e-5d4a-4b9e-8c1f-2a7d6e9b0c11' });
    track('film-started');
    scriptLoaded();
    expect(umamiTrack).toHaveBeenCalledTimes(1);
    expect(sent(0)).toMatchObject({ name: 'film-started' });
  });

  it('does not compile for an unknown event, a wrong prop or a missing prop', () => {
    // Raderna körs aldrig; tsc prövar dem. Ett @ts-expect-error utan fel är i sig ett fel.
    const compileOnly = () => {
      // @ts-expect-error not in the fixed event list
      track('page-viewed-by-anna');
      // @ts-expect-error distance is not a prop of any event
      track('run-logged-manual', { distance: 5.2 });
      // @ts-expect-error a free string is not an enumerated value
      track('setting-changed', { setting: 'anna@example.com' });
      // @ts-expect-error the prop is required
      track('setting-changed');
      track('waitlist-click');
    };
    expect(typeof compileOnly).toBe('function');
  });
});
