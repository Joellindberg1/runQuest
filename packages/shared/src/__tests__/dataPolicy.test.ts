import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DATA_CONTROLLER,
  DATA_POLICY_SECTIONS,
  DATA_POLICY_VERSION,
  STRAVA_CONSENT_VERSION,
  STRAVA_IMPORTED_FIELDS,
  TERMS_SECTION,
  WAITLIST_CONSENT_LABEL,
  WAITLIST_CONSENT_LINK_TEXT,
  WAITLIST_CONSENT_VERSION,
  WEBHOOK_RETENTION_DONE_DAYS,
  WEBHOOK_RETENTION_FAILED_DAYS,
  getDataPolicy,
  getDataPolicySection,
  getTerms,
  type LegalSection,
} from '../index.js';

// Texten är fastnålad: ändras den utan ny version fäller snapshotvakten. Höj DATA_POLICY_VERSION och uppdatera nålen här.
const PINNED_POLICY = { version: '2026-10-14', sha256: 'ffb03df48b25a38c6a2f76fe22237d8a60f63ad5b47be646d697b53c87bd134a' };

const CONTACT = 'joellindberg23@gmail.com';

const textOf = (section: LegalSection | undefined): string => {
  expect(section, 'the section exists').toBeDefined();
  return section!.paragraphs.join('\n');
};
const policyText = (): string => DATA_POLICY_SECTIONS.map((section) => `${section.title}\n${section.paragraphs.join('\n')}`).join('\n');
const sentencesOf = (text: string): string[] => text.split(/(?<=[.!?])\s+|\n/).map((s) => s.trim()).filter(Boolean);
// Texten får putsas av ägaren i förhandsvisningen: kraven testas som mönster per mening, inte som hela meningar.
const sentencesMatching = (text: string, pattern: RegExp): string[] => sentencesOf(text).filter((sentence) => pattern.test(sentence));
const expectSentence = (text: string, ...patterns: RegExp[]): void => {
  const found = sentencesOf(text).some((sentence) => patterns.every((pattern) => pattern.test(sentence)));
  expect(found, `a sentence matching ${patterns.map(String).join(' and ')}`).toBe(true);
};

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

  it('strava section states no AI, group-only visibility and keeps the contact address for other requests', () => {
    const text = textOf(getDataPolicySection('strava'));
    expect(text).toMatch(/Strava data is not used for AI/);
    expect(text).toMatch(/members of your pack/i);
    expect(text).toMatch(/not public/i);
    expect(text).toContain(CONTACT);
  });

  it('strava section states what is imported and that the start coordinates only look up the weather', () => {
    const text = textOf(getDataPolicySection('strava'));
    for (const field of STRAVA_IMPORTED_FIELDS) expect(text, field.key).toContain(field.label);
    expect(text).toMatch(/Run, TrailRun and VirtualRun/);
    // Knappen Sync now visas bara för en användare: texten lovar ingen manuell synk.
    expect(text).not.toMatch(/sync (by hand|manually)|manual sync|Sync now/i);
    expect(text).toMatch(/Open-Meteo/);
  });

  it('strava section says new runs arrive via Strava webhooks with a backup check at least every 12 hours', () => {
    const text = textOf(getDataPolicySection('strava'));
    expectSentence(text, /webhooks?/i, /new runs/i);
    expectSentence(text, /backup/i, /at least every 12 hours/i);
    // Ingen överdrift: webhooks är en signal, inte ett löfte om tid.
    expect(text).not.toMatch(/instant|immediate|within (a few )?(minutes|seconds)|real[- ]time/i);
  });

  it('strava section states that runs deleted, made private or no longer a run on Strava are removed within 48 hours and that XP, streaks, titles and badges are recalculated', () => {
    const text = textOf(getDataPolicySection('strava'));
    expectSentence(text, /delete/i, /private/i, /no longer a run|stops? being a run|not a run/i, /within 48 hours/i, /removes? it|removed/i);
    expectSentence(text, /XP/, /streaks/, /titles/, /badges/, /recalculated/i);
  });

  it('strava section says event XP that was already awarded is kept', () => {
    const text = textOf(getDataPolicySection('strava'));
    expectSentence(text, /event XP/i, /already (earned|awarded)/i, /kept/i);
  });

  it('strava section describes pause sync: connection and runs stay, no new runs, removals still apply and the gap is filled on resume', () => {
    const text = textOf(getDataPolicySection('strava'));
    expect(text).toContain('"Pause sync"');
    expect(text).toContain('"Turn sync back on"');
    expectSentence(text, /Pause sync/, /connection/i, /runs/i, /stay|keeps|kept|remain/i);
    expectSentence(text, /no new runs/i, /(fetched|imported)/i);
    expectSentence(text, /(delete|remove)/i, /private/i, /still/i, /(removed|apply|applies)/i);
    expectSentence(text, /Turn sync back on/, /during the pause/i, /fetched/i);
  });

  it('strava section describes disconnect: access is revoked at Strava, imported runs are deleted, manual runs and event XP stay, it cannot be undone and reconnecting starts from that day', () => {
    const text = textOf(getDataPolicySection('strava'));
    expect(text).toContain('"Disconnect"');
    expectSentence(text, /Disconnect/, /revokes?/i, /access/i, /at Strava/i);
    expectSentence(text, /Disconnect/, /deletes? all (the )?runs/i, /imported from Strava/i);
    expectSentence(text, /(runs you added by hand|manual runs)/i, /event XP/i, /stay|kept|remain/i);
    expectSentence(text, /cannot be undone/i);
    expectSentence(text, /connect Strava again/i, /not fetched back|does not (fetch|bring)/i, /from that day/i);
    expectSentence(text, /(revoke|revoking)/i, /on Strava/i, /same/i);
  });

  it('strava section says the Strava athlete ID and the consent version and time are stored', () => {
    const text = textOf(getDataPolicySection('strava'));
    expectSentence(text, /Strava athlete ID/, /(stored|stores)/i, /(link|match|connect)/i);
    expectSentence(text, /(version)/i, /(time)/i, /(consent|agreed)/i, /(stored|stores)/i);
  });

  it('dataPolicy no longer says there is no disconnect button, that automatic removal is coming or that runs are imported every 30 minutes', () => {
    const everything = `${policyText()}\n${textOf(TERMS_SECTION)}`;
    expect(everything).not.toMatch(/no disconnect button/i);
    expect(everything).not.toMatch(/coming in a later version|not available yet|is coming/i);
    expect(everything).not.toMatch(/every 30 minutes/i);
    expect(everything).not.toMatch(/Disconnecting Strava|Sync now|sync by hand/i);
    // E-post är inte längre enda raderingsvägen för Strava-data.
    expect(everything).not.toMatch(/To have your Strava tokens deleted, email/i);
    expect(everything).not.toMatch(/ask for those to be removed too/i);
  });

  it('strava section uses the names of the buttons in the app and never the heading of the popup as a button', () => {
    const everything = policyText();
    expect(everything).not.toMatch(/Pause or disconnect/i);
    expect(everything).not.toMatch(/Slå på|Koppla bort|Pausa/);
  });

  it('data section mentions notification settings and read marks and that no one else can see them', () => {
    const text = textOf(getDataPolicySection('data'));
    expectSentence(text, /notification settings/i, /read/i, /per user|your own|you/i);
    expectSentence(text, /read/i, /Pack News/i);
    expectSentence(text, /(other users|no one else|nobody else|only you)/i, /(cannot|can't|not) see|only you|private/i);
  });

  it('processors section says server logs can contain the Strava athlete ID and activity ID of webhook events but never a title, coordinates or a token', () => {
    const text = textOf(getDataPolicySection('processors'));
    expectSentence(text, /log/i, /Strava athlete ID/, /activity ID/, /(event|webhook)/i);
    expectSentence(text, /never/i, /title/i, /coordinates/i, /token/i);
  });

  it('retention section keeps handled webhook events 30 days and failed ones 90 days and drops tokens on disconnect', () => {
    const text = textOf(getDataPolicySection('retention'));
    expect(WEBHOOK_RETENTION_DONE_DAYS).toBe(30);
    expect(WEBHOOK_RETENTION_FAILED_DAYS).toBe(90);
    expectSentence(text, /handled/i, new RegExp(`${WEBHOOK_RETENTION_DONE_DAYS} days`));
    expectSentence(text, /failed/i, new RegExp(`${WEBHOOK_RETENTION_FAILED_DAYS} days`));
    expectSentence(text, /Strava ids/i, /(no|never) .*title/i, /token/i);
    expectSentence(text, /Strava tokens/i, /until you disconnect/i, /(in the app or on Strava)/i);
    expectSentence(text, /read marks/i, /(mark all as read|Mark all read)/i, /cleared/i);
  });

  it('deletion section says Disconnect deletes the Strava runs and tokens in the app and everything else still goes via email', () => {
    const text = textOf(getDataPolicySection('deletion'));
    expectSentence(text, /Disconnect/, /deletes?/i, /Strava runs/i, /tokens/i, /in the app/i);
    expectSentence(text, /account/i, /waitlist/i, /email/i);
    expect(text).toContain(CONTACT);
    expect(text).not.toMatch(/no delete button for accounts, Strava tokens or Strava runs/i);
  });

  it('no sentence in the policy still says that Strava data can be removed only by email', () => {
    for (const sentence of sentencesMatching(policyText(), /Strava/)) {
      expect(sentence, sentence).not.toMatch(/(only|must|have to) .*email/i);
    }
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
      /email address/i, /hashed password/i, /username/i, /profile picture/i, /Supabase/, /Railway/, /Open-Meteo/,
      /local storage/i, /access/i, /correct/i, /delet/i, /pack/i,
    ]) {
      expect(text).toMatch(pattern);
    }
    expect(text).toMatch(/DNS/);
  });

  it('dataPolicy no longer names Google: the typefaces are served from RunQuest itself', () => {
    expect(policyText()).not.toMatch(/Google|fonts\.googleapis|fonts\.gstatic/i);
  });

  it('dataPolicy waitlist section states purpose, legal basis, retention and how to request deletion', () => {
    const text = textOf(getDataPolicySection('waitlist'));
    expect(text).toMatch(/email address/i);
    expect(text).toMatch(/time/i);
    expect(text).toMatch(/version of this text/i);
    expect(text).toMatch(/"landing"/);
    expect(text).toMatch(/IP address in memory for at least 15 minutes, until the server restarts or the entry is replaced/i);
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

  it('the strava consent version is the data policy version', () => {
    expect(STRAVA_CONSENT_VERSION).toBe(DATA_POLICY_VERSION);
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
