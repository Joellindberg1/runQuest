// Gemensam källa för integritetstext och villkor (RUN-201): /legal (RUN-204), väntelistans samtycke (RUN-211) och
// Strava-samtycket (RUN-180, v0.7.0) läser härifrån. Signaturen är låst mellan RUN-201 och RUN-204.
//
// Texten beskriver DAGENS beteende (v0.6.2), inte det ADR 010 beslut 12 kräver från v0.7.0 (RUN-93). Varje påstående ska gå att
// peka mot kod eller ett ägarbeslut; ändras beteendet ändras texten OCH DATA_POLICY_VERSION (snapshotvakten i dataPolicy.test.ts).
// Språk: engelska, klartext. Ingen HTML och ingen markdown i styckena.

export interface LegalSection {
  /** Stabil nyckel. Obligatoriska: 'strava', 'deletion', 'waitlist' (integritet) och 'terms' (villkor). Övriga väljer RUN-201. Bara [a-z0-9-]. */
  readonly id: string;
  readonly title: string;
  /** Stycken i klartext på engelska. Ingen HTML och ingen markdown. E-postadressen får stå som text. */
  readonly paragraphs: readonly string[];
}

export interface DataController {
  readonly name: string;
  readonly email: string;
}

export interface LegalDocument {
  readonly version: string;
  readonly controller: DataController;
  readonly sections: readonly LegalSection[];
}

/** Version av integritetstexten, 'YYYY-MM-DD[.N]'. Höjs vid varje innehållsändring. Väntelistans samtyckesversion är samma värde. */
export const DATA_POLICY_VERSION = '2026-10-13';

/** Personuppgiftsansvarig (ägarbeslut 2026-10-13, publik visning godkänd av ägaren). */
export const DATA_CONTROLLER: DataController = {
  name: 'Joel Lindberg',
  email: 'joellindberg23@gmail.com',
};

const CONTACT = DATA_CONTROLLER.email;

export interface StravaImportedField {
  /** Nyckeln i insert-anropet och i extractExtendedFields (apps/backend/src/routes/strava.ts); backendtestet jämför listorna. */
  readonly key: string;
  /** Hur fältet heter i texten. Flera nycklar kan dela etikett (start_lat och start_lng). */
  readonly label: string;
}

/**
 * Allt som Strava-importen sparar per runda, i takt med strava.ts. Strava-avsnittet byggs ur listan, så texten och listan kan inte glida isär;
 * apps/backend/src/__tests__/dataPolicyStravaFields.test.ts fäller om koden får ett fält som saknas här.
 */
export const STRAVA_IMPORTED_FIELDS: readonly StravaImportedField[] = [
  { key: 'date', label: 'date' },
  { key: 'distance', label: 'distance' },
  { key: 'external_id', label: 'Strava activity ID' },
  { key: 'start_time', label: 'start time (local clock)' },
  { key: 'moving_time', label: 'moving time' },
  { key: 'total_elevation_gain', label: 'elevation gain' },
  { key: 'sport_type', label: 'sport type' },
  { key: 'avg_heartrate', label: 'average heart rate' },
  { key: 'max_heartrate', label: 'maximum heart rate' },
  { key: 'suffer_score', label: 'relative effort' },
  { key: 'start_lat', label: 'start coordinates' },
  { key: 'start_lng', label: 'start coordinates' },
  { key: 'pace_std_dev', label: 'pace variation' },
  { key: 'is_treadmill', label: 'whether it was on a treadmill' },
];

const joinList = (items: readonly string[]): string => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

const importedFieldLabels = joinList([...new Set(STRAVA_IMPORTED_FIELDS.map((field) => field.label))]);

/** Texten vid väntelistans samtyckesbock. Länken till integritetstexten läggs till av formuläret (WAITLIST_CONSENT_LINK_TEXT). */
export const WAITLIST_CONSENT_LABEL = 'I agree that RunQuest stores my email address to invite me to the beta.';
export const WAITLIST_CONSENT_LINK_TEXT = 'Read the privacy policy';

/** Integritetsavsnitten i visningsordning, utan 'terms'. */
export const DATA_POLICY_SECTIONS: readonly LegalSection[] = [
  {
    id: 'controller',
    title: 'Who is responsible',
    paragraphs: [
      `RunQuest is run by ${DATA_CONTROLLER.name}, who is the data controller for the personal data described on this page.`,
      `Questions, requests to see, correct or delete your data, and anything else about privacy: email ${CONTACT}.`,
    ],
  },
  {
    id: 'data',
    title: 'What is stored',
    paragraphs: [
      'Everything below is used to run the game: to log you in, to work out XP, levels, streaks, titles and badges, and to show them to your pack.',
      'Account: your username, your email address and a hashed password (the password itself is never stored). Accounts are created by the administrator; there is no public sign-up. An account can also hold a gender, which the title standings use.',
      'Runs: the date and distance of each run, whether it was on a treadmill, and the XP, level and streak worked out from them. Runs come from Strava (see the Strava section) or are added by hand in the app.',
      'Profile picture: if you upload one, the file is stored in Supabase Storage in a public bucket. Anyone who has the address of the picture can open it.',
      'Pack data: the pack you belong to and what happens in it: challenges between members, events, badges, titles and a news feed of pack activity such as level-ups and title changes.',
      'Who sees what: members of your pack can see your username, profile picture, level, XP, streaks, runs, titles and badges. Logged-in users can also see who holds each title, with name, gender, profile picture and score. The administrator has access to all data in the database.',
    ],
  },
  {
    id: 'strava',
    title: 'Strava',
    paragraphs: [
      'Connecting Strava is optional and you do it yourself in Settings. RunQuest asks Strava for read-only access to your activities (the activity:read permission).',
      `Only running activities are imported (Run, TrailRun and VirtualRun). From each run RunQuest stores: ${importedFieldLabels}. The Strava activity ID is kept so that the same run is never imported twice.`,
      'RunQuest does not store the activity name, description, photos or route. Heart rate and relative effort are stored but are not used or shown anywhere in the app today. The start coordinates are used only to look up the weather at the start from Open-Meteo (see the Weather section) and are not shown in the app.',
      'RunQuest also stores your Strava access and refresh tokens, which it needs to read your activities. They are used for nothing else.',
      'New runs are imported automatically every 30 minutes.',
      'Strava data is not used for AI. It is not used to train, fine-tune or prompt any AI model, and it is not sent to any AI service.',
      'Who sees your runs: the members of your pack, in the app. Your runs are not public.',
      `If you delete an activity on Strava or make it private, or if you want your Strava runs removed from RunQuest, email ${CONTACT} and they will be deleted. Strava runs are read-only in the app, so they cannot be deleted there.`,
      `There is no disconnect button in the app. To have your Strava tokens deleted, email ${CONTACT}; no new runs are imported after that. Connecting Strava again replaces the stored tokens. Runs that are already imported stay until you ask for them to be removed.`,
      'Automatic removal when you delete an activity or revoke access on Strava is not available yet. It is coming in a later version.',
    ],
  },
  {
    id: 'weather',
    title: 'Weather',
    paragraphs: [
      'For Strava runs that have a start location (treadmill runs are skipped), RunQuest asks Open-Meteo for the weather at that place and hour, such as temperature, wind and rain, and stores it with the run. It is used for the weather titles and shown on the run.',
      'The request to Open-Meteo contains the start coordinates and the time. It does not contain your name or any account details.',
    ],
  },
  {
    id: 'waitlist',
    title: 'Waitlist',
    paragraphs: [
      'If you join the waitlist, RunQuest stores your email address, the time you signed up, the version of this text you agreed to and a fixed label for where you signed up ("landing"). Nothing else is saved with it: no IP address, browser details or referrer.',
      'Purpose: to invite you to RunQuest. Legal basis: your consent, which you give by ticking the box. You can withdraw it at any time.',
      'The entry is kept until the invitation has been sent or until you ask for it to be deleted. Only the administrator can see the waitlist.',
      `To have your entry deleted, email ${CONTACT}.`,
      'To limit repeated attempts, the server keeps your IP address in memory for 15 minutes. It is not stored with your signup, but it can be written to the server log if you are blocked.',
      'No email is sent to the waitlist at the moment, not even a confirmation.',
    ],
  },
  {
    id: 'cookies',
    title: 'Cookies, storage and tracking',
    paragraphs: [
      'RunQuest sets no cookies.',
      "When you log in, a login token and basic account details (id, username, email and admin status) are kept in your browser's local storage so that you stay logged in. This storage is strictly necessary for logging in and is removed when you log out. A timestamp in session storage stops the page from reloading in a loop after an update.",
      'RunQuest uses no web analytics, advertising or tracking tools.',
    ],
  },
  {
    id: 'processors',
    title: 'Who else handles data',
    paragraphs: [
      'RunQuest uses the services below. They handle data on its behalf or, in the case of Strava, are where the data comes from.',
      "Railway hosts the app and the server. Server logs are kept there. They can contain usernames and IP addresses and, for imported runs, the date, distance, Strava activity ID and type. If an import fails, the logged details can also include the run's start coordinates.",
      'Supabase provides the database and the file storage for profile pictures. All stored data described on this page, including the waitlist, lives there.',
      'Strava is where your runs come from. Strava\'s own terms and privacy policy apply to your data there.',
      'Open-Meteo receives the start coordinates and time of a run and returns the weather.',
      'Vercel provides DNS for runquest.dev, which turns the domain name into an address. It does not host RunQuest.',
      'Google Fonts: the pages load their typefaces from Google (fonts.googleapis.com and fonts.gstatic.com). Your browser therefore sends your IP address and browser details to Google when a page loads.',
    ],
  },
  {
    id: 'retention',
    title: 'How long data is kept',
    paragraphs: [
      'Account, run and pack data is kept as long as your account exists.',
      'Strava tokens are kept until you ask for them to be deleted. Connecting Strava again replaces them.',
      'Waitlist entries are kept as described in the Waitlist section.',
      'Server logs are kept by the hosting provider under its own rules.',
    ],
  },
  {
    id: 'rights',
    title: 'Your rights',
    paragraphs: [
      'You have the right to ask for access to your data, to have it corrected and to have it deleted. You can also ask to limit how it is used, object to its use, and withdraw consent at any time, for example for the waitlist.',
      `Email ${CONTACT} to use any of these rights. You can also complain to your national data protection authority (in Sweden, IMY).`,
    ],
  },
  {
    id: 'deletion',
    title: 'Deleting your data',
    paragraphs: [
      `To have your data deleted, email ${CONTACT} and say what you want removed: your whole account, your Strava runs, or your waitlist entry.`,
      'Deletion is done by hand. There is no delete button for accounts, Strava tokens or Strava runs in the app yet.',
      'Runs you added by hand can be deleted in the app. Runs imported from Strava are read-only there, so ask by email to have them removed. Deleting your Strava tokens does not delete your imported runs; ask for those to be removed too.',
      'Uploading a new profile picture deletes the previous file.',
    ],
  },
];

export const TERMS_SECTION: LegalSection = {
  id: 'terms',
  title: 'Terms of use',
  paragraphs: [
    `RunQuest is a private hobby project run by ${DATA_CONTROLLER.name}. It is provided as is, with no warranty of any kind: it may change, be unavailable or be shut down at any time.`,
    `Questions, and requests to have your data deleted, go to ${CONTACT}.`,
  ],
};

export function getDataPolicySection(id: string): LegalSection | undefined {
  if (id === TERMS_SECTION.id) return TERMS_SECTION;
  return DATA_POLICY_SECTIONS.find((section) => section.id === id);
}

export function getDataPolicy(): LegalDocument {
  return { version: DATA_POLICY_VERSION, controller: DATA_CONTROLLER, sections: DATA_POLICY_SECTIONS };
}

export function getTerms(): LegalDocument {
  return { version: DATA_POLICY_VERSION, controller: DATA_CONTROLLER, sections: [TERMS_SECTION] };
}
