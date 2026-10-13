import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DATA_CONTROLLER,
  DATA_POLICY_SECTIONS,
  DATA_POLICY_VERSION,
  STRAVA_IMPORTED_FIELDS,
  TERMS_SECTION,
  WAITLIST_CONSENT_LABEL,
  WAITLIST_CONSENT_LINK_TEXT,
  WAITLIST_CONSENT_VERSION,
  getDataPolicy,
  getDataPolicySection,
  getTerms,
  type LegalSection,
} from '../index.js';

// Texten är fastnålad: ändras den utan ny version fäller snapshotvakten. Höj DATA_POLICY_VERSION och uppdatera nålen här.
const PINNED_POLICY = { version: '2026-10-13', sha256: 'a32aa42720607a7a33c8ab234c55c84463e3f85c4b8d147e2846e996896de398' };

const CONTACT = 'joellindberg23@gmail.com';

const textOf = (section: LegalSection | undefined): string => {
  expect(section, 'the section exists').toBeDefined();
  return section!.paragraphs.join('\n');
};
const policyText = (): string => DATA_POLICY_SECTIONS.map((section) => `${section.title}\n${section.paragraphs.join('\n')}`).join('\n');
const sentencesOf = (text: string): string[] => text.split(/(?<=[.!?])\s+|\n/).map((s) => s.trim()).filter(Boolean);

describe('dataPolicy', () => {
  it('exposes a strava section, a deletion section and a waitlist section', () => {
    for (const id of ['strava', 'deletion', 'waitlist']) {
      const section = DATA_POLICY_SECTIONS.find((candidate) => candidate.id === id);
      expect(section, id).toBeDefined();
      expect(section!.title.length).toBeGreaterThan(0);
      expect(section!.paragraphs.length).toBeGreaterThan(0);
      expect(getDataPolicySection(id)).toBe(section);
    }
    expect(TERMS_SECTION.id).toBe('terms');
    expect(getDataPolicySection('terms')).toBe(TERMS_SECTION);
    expect(getDataPolicySection('no-such-section')).toBeUndefined();
  });

  it('uses stable ids, plain-text paragraphs and no duplicates', () => {
    const ids = [...DATA_POLICY_SECTIONS, TERMS_SECTION].map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of [...DATA_POLICY_SECTIONS, TERMS_SECTION]) {
      expect(section.id).toMatch(/^[a-z0-9-]+$/);
      for (const paragraph of section.paragraphs) {
        expect(paragraph.trim()).toBe(paragraph);
        expect(paragraph.length).toBeGreaterThan(0);
        expect(paragraph).not.toMatch(/<\/?[a-z][^>]*>/i);
        expect(paragraph).not.toMatch(/\*\*|^#|\]\(/m);
      }
    }
  });

  it('strava section states no AI, group-only visibility and removal on request via the contact address', () => {
    const text = textOf(getDataPolicySection('strava'));
    expect(text).toMatch(/Strava data is not used for AI/);
    expect(text).toMatch(/members of your pack/i);
    expect(text).toMatch(/not public/i);
    expect(text).toContain(CONTACT);
    expect(text).toMatch(/(delete|make) .*private/i);
    expect(text).toMatch(/removed|deleted/i);
    // Ingen frånkopplingsknapp finns i UI:t: tokens raderas på begäran och importerade rundor ligger kvar.
    expect(text).toMatch(/no disconnect button/i);
    expect(text).toMatch(/Strava tokens deleted/i);
    expect(text).not.toMatch(/Disconnecting Strava in Settings/);
    expect(text).toMatch(/already imported (runs )?stay/i);
  });

  it('strava section states what is imported, the 30-minute sync and that automatic deletion via Strava is coming', () => {
    const text = textOf(getDataPolicySection('strava'));
    for (const field of STRAVA_IMPORTED_FIELDS) expect(text, field.key).toContain(field.label);
    expect(text).toMatch(/Run, TrailRun and VirtualRun/);
    expect(text).toMatch(/every 30 minutes/);
    expect(text).toMatch(/automatically every 30 minutes/);
    // Knappen Sync now visas bara för en användare: texten lovar ingen manuell synk.
    expect(text).not.toMatch(/by hand|manually|Sync now/i);
    expect(text).toMatch(/Open-Meteo/);
    const automatic = sentencesOf(text).filter((sentence) => /automatic (removal|deletion)/i.test(sentence));
    expect(automatic.length).toBeGreaterThan(0);
    for (const sentence of automatic) expect(sentence).toMatch(/not (available )?yet|coming/i);
  });

  it('strava section does not promise 48 h deletion, automatic removal or a pause button', () => {
    const everything = `${policyText()}\n${textOf(TERMS_SECTION)}`;
    expect(everything).not.toMatch(/48\s*(h\b|hours?)/i);
    expect(everything).not.toMatch(/pause/i);
    expect(everything).not.toMatch(/within (a )?(day|two days|24)/i);
    // Allt som nämner automatisk borttagning ska säga att den inte finns än.
    for (const sentence of sentencesOf(everything).filter((s) => /automatic (removal|deletion)/i.test(s))) {
      expect(sentence).toMatch(/not (available )?yet|coming/i);
    }
  });

  it('dataPolicy never mentions a disconnect button or a manual sync, and keeps tokens until deletion is requested', () => {
    expect(policyText()).not.toMatch(/Disconnecting Strava|disconnect Strava|Sync now|sync by hand/i);
    expect(textOf(getDataPolicySection('retention'))).toMatch(/Strava tokens are kept until you ask for them to be deleted/);
    expect(textOf(getDataPolicySection('deletion'))).toMatch(/Strava tokens/);
  });

  it('every imported field is listed once with a plain label', () => {
    const keys = STRAVA_IMPORTED_FIELDS.map((field) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const field of STRAVA_IMPORTED_FIELDS) {
      expect(field.key).toMatch(/^[a-z_]+$/);
      expect(field.label.length).toBeGreaterThan(0);
    }
  });

  it('dataPolicy names the controller and the contact address', () => {
    expect(DATA_CONTROLLER).toEqual({ name: 'Joel Lindberg', email: CONTACT });
    const text = policyText();
    expect(text).toContain('Joel Lindberg');
    expect(text).toContain(CONTACT);
    expect(text).toMatch(/data controller/i);
  });

  it('dataPolicy covers the whole service: what is stored, third parties, storage, retention and rights', () => {
    const text = policyText();
    for (const pattern of [
      /email address/i, /hashed password/i, /username/i, /profile picture/i, /Supabase/, /Railway/, /Open-Meteo/, /Google Fonts/,
      /local storage/i, /access/i, /correct/i, /delet/i, /pack/i,
    ]) {
      expect(text).toMatch(pattern);
    }
    expect(text).toMatch(/DNS/);
  });

  it('dataPolicy waitlist section states purpose, legal basis, retention and how to request deletion', () => {
    const text = textOf(getDataPolicySection('waitlist'));
    expect(text).toMatch(/email address/i);
    expect(text).toMatch(/time/i);
    expect(text).toMatch(/version of this text/i);
    expect(text).toMatch(/"landing"/);
    expect(text).toMatch(/IP address in memory for 15 minutes/i);
    expect(text).toMatch(/server log/i);
    expect(text).toMatch(/invit/i);
    expect(text).toMatch(/consent/i);
    expect(text).toMatch(/until (the|your) invitation has been sent or until you ask/i);
    expect(text).toContain(CONTACT);
    expect(text).toMatch(/No email is sent to the waitlist/i);
  });

  it('dataPolicy states that no web analytics or trackers are used', () => {
    expect(policyText()).toMatch(/no web analytics, advertising or tracking tools/i);
    expect(policyText()).toMatch(/no cookies/i);
  });

  it('terms section says as is, no warranty, private hobby project and gives the contact address', () => {
    const text = textOf(TERMS_SECTION);
    expect(text).toMatch(/as is/i);
    expect(text).toMatch(/no warranty/i);
    expect(text).toMatch(/private hobby project/i);
    expect(text).toContain(CONTACT);
  });

  it('getDataPolicy and getTerms return the locked shape with the shared version and controller', () => {
    expect(getDataPolicy()).toEqual({ version: DATA_POLICY_VERSION, controller: DATA_CONTROLLER, sections: DATA_POLICY_SECTIONS });
    expect(getTerms()).toEqual({ version: DATA_POLICY_VERSION, controller: DATA_CONTROLLER, sections: [TERMS_SECTION] });
    expect(getDataPolicy().sections.some((section) => section.id === 'terms')).toBe(false);
  });

  it('the waitlist consent version is the data policy version', () => {
    expect(WAITLIST_CONSENT_VERSION).toBe(DATA_POLICY_VERSION);
  });

  it('DATA_POLICY_VERSION has the date format and is never a draft marker', () => {
    expect(DATA_POLICY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}(\.\d+)?$/);
    expect(DATA_POLICY_VERSION.startsWith('draft')).toBe(false);
    expect(DATA_POLICY_VERSION).not.toBe('skeleton');
  });

  it('dataPolicy says what the server logs can contain and that the title board shows gender', () => {
    const processors = textOf(getDataPolicySection('processors'));
    for (const pattern of [/usernames/, /IP addresses/, /date, distance, Strava activity ID and type/, /start coordinates/]) expect(processors).toMatch(pattern);
    expect(textOf(getDataPolicySection('data'))).toMatch(/with name, gender, profile picture and score/);
  });

  it('DATA_POLICY_VERSION changes when any section text changes', () => {
    const digest = createHash('sha256').update(JSON.stringify({
      controller: DATA_CONTROLLER,
      sections: DATA_POLICY_SECTIONS,
      terms: TERMS_SECTION,
      consent: { label: WAITLIST_CONSENT_LABEL, linkText: WAITLIST_CONSENT_LINK_TEXT },
    })).digest('hex');
    const textChanged = digest !== PINNED_POLICY.sha256;
    if (textChanged && DATA_POLICY_VERSION === PINNED_POLICY.version) {
      expect.fail(
        `The legal text changed but DATA_POLICY_VERSION is still ${DATA_POLICY_VERSION}. Raise the version in packages/shared/src/legal/dataPolicy.ts, `
          + `then update PINNED_POLICY in this test to { version: '<new version>', sha256: '${digest}' }.`,
      );
    }
    expect(
      { version: DATA_POLICY_VERSION, sha256: digest },
      'The version or the text changed: update PINNED_POLICY in this test to the values shown here.',
    ).toEqual(PINNED_POLICY);
  });
});
