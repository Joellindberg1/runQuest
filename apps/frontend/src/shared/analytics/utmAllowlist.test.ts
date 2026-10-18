import { describe, expect, it } from 'vitest';
import { UTM_ALLOWLIST, allowedUtmQuery } from './utmAllowlist';

const UUID = '3f2b8c1e-9d4a-4e7b-8a61-5c0d2e9f7a14';
// Ett test-läge där kampanjtaggar finns, eftersom listorna för utm_campaign och utm_content börjar tomma.
const WITH_CAMPAIGNS = { ...UTM_ALLOWLIST, utm_campaign: ['launch'], utm_content: ['hero'] };

describe('allowedUtmQuery', () => {
  it('lets a listed value through', () => {
    expect(allowedUtmQuery('?utm_source=instagram&utm_medium=social')).toBe('?utm_source=instagram&utm_medium=social');
    expect(allowedUtmQuery('?utm_source=qr')).toBe('?utm_source=qr');
  });

  it('allows exactly the sources and mediums the owner decided on, and no campaign or content tags yet', () => {
    expect(UTM_ALLOWLIST.utm_source).toEqual(['instagram', 'facebook', 'messenger', 'whatsapp', 'sms', 'email', 'linkedin', 'x', 'reddit', 'strava', 'qr']);
    expect(UTM_ALLOWLIST.utm_medium).toEqual(['social', 'referral', 'email', 'sms', 'qr', 'organic']);
    expect(UTM_ALLOWLIST.utm_campaign).toEqual([]);
    expect(UTM_ALLOWLIST.utm_content).toEqual([]);
    for (const source of UTM_ALLOWLIST.utm_source!) expect(allowedUtmQuery(`?utm_source=${source}`)).toBe(`?utm_source=${source}`);
    for (const medium of UTM_ALLOWLIST.utm_medium!) expect(allowedUtmQuery(`?utm_medium=${medium}`)).toBe(`?utm_medium=${medium}`);
  });

  it('lets a listed campaign and content tag through once they are added to the list', () => {
    expect(allowedUtmQuery('?utm_campaign=launch&utm_content=hero', WITH_CAMPAIGNS)).toBe('?utm_campaign=launch&utm_content=hero');
    expect(allowedUtmQuery('?utm_campaign=launch&utm_content=hero')).toBe('');
  });

  it('sends the list value, not the visitor string, and compares without regard to case', () => {
    expect(allowedUtmQuery('?utm_source=INSTAGRAM&utm_medium=Social')).toBe('?utm_source=instagram&utm_medium=social');
    expect(allowedUtmQuery('?utm_campaign=LaUnCh', { utm_campaign: ['Launch'] })).toBe('?utm_campaign=Launch');
    expect(allowedUtmQuery('?utm_source=%20email%20')).toBe('?utm_source=email');
  });

  it('never carries utm_term', () => {
    expect(allowedUtmQuery('?utm_term=run&utm_source=sms')).toBe('?utm_source=sms');
    expect(Object.keys(UTM_ALLOWLIST)).not.toContain('utm_term');
  });

  it('strips values that could carry an id, a name or a token, however they are written', () => {
    const disguised = [
      UUID,
      UUID.replace(/-/g, ''),
      UUID.replace(/-/g, '_'),
      UUID.replace(/-/g, '.'),
      '12345678',
      'Anna.Andersson',
      'anna-andersson',
      'eyJFAKE.eyJFAKE.FAKE_not_a_real_token',
      'instagram.anna',
      'instagram%2Fanna',
      'instagramx',
      '<script>',
      '',
    ];
    for (const value of disguised) {
      expect(allowedUtmQuery(`?utm_source=${value}&utm_medium=${value}`, WITH_CAMPAIGNS), value).toBe('');
      expect(allowedUtmQuery(`?utm_campaign=${value}&utm_content=${value}`, WITH_CAMPAIGNS), value).toBe('');
    }
  });

  it('strips parameters that are not on the list and ignores a fragment', () => {
    expect(allowedUtmQuery('?fbclid=abc&utm_id=123&ref=anna&utm_source=reddit#top')).toBe('?utm_source=reddit');
    expect(allowedUtmQuery('')).toBe('');
  });
});
