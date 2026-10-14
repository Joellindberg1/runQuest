// Gemensam källa för integritetstext och villkor (RUN-201): /legal (RUN-204), väntelistans samtycke (RUN-211) och
// Strava-samtycket (RUN-180, v0.7.0) läser härifrån. Signaturen är låst mellan RUN-201 och RUN-204.
//
// Texten beskriver v0.7.0 (RUN-93, ADR 010 beslut 7, 11, 12 och 14, ADR 011 beslut 13.5): webhooks, borttagning inom 48 h, "Disconnect" och
// "Pause sync". Den når main först med v0.7.0-releasen. Varje påstående ska gå att peka mot kod eller ett ägarbeslut; ändras beteendet
// ändras texten OCH DATA_POLICY_VERSION (snapshotvakten i dataPolicy.test.ts). Knappnamnen är appens egna ("Disconnect", "Pause sync",
// "Turn sync back on"); "Pause or disconnect" är popupens rubrik och används inte som knappnamn.
// Språk: engelska, klartext. Ingen HTML och ingen markdown i styckena.

import { WEBHOOK_RETENTION_DONE_DAYS, WEBHOOK_RETENTION_FAILED_DAYS } from '../rules.js';

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
export const DATA_POLICY_VERSION = '2026-10-14';

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
      'Legal basis: these details, including runs imported from Strava, are needed to provide the game you joined (performance of a contract). The waitlist is the exception and is based on your consent (see the Waitlist section).',
      'Account: your username, your email address and a hashed password (the password itself is never stored). Accounts are created by the administrator; there is no public sign-up. An account can also hold a gender, which the title standings use.',
      'Runs: the date and distance of each run, whether it was on a treadmill, and the XP, level and streak worked out from them. Runs come from Strava (see the Strava section) or are added by hand in the app.',
      'Profile picture: if you upload one, the file is stored in Supabase Storage in a public bucket. Anyone who has the address of the picture can open it.',
      'Pack data: the pack you belong to and what happens in it: challenges between members, events, badges, titles and a news feed of pack activity such as level-ups and title changes.',
      'Notifications: your notification settings (what the bell counts) and which Pack News rows you have read are stored per user. They are private to you: other users cannot see them.',
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
      'Your Strava athlete ID is stored too, only to link the events Strava sends to your RunQuest account. When you connect, RunQuest also stores the version of this text you agreed to and the time you agreed.',
      'New runs arrive through Strava webhooks: Strava tells RunQuest when one of your activities is created, changed or deleted, and RunQuest then fetches that activity from Strava. As a backup, RunQuest also checks Strava for new runs at least every 12 hours.',
      'Strava data is not used for AI. It is not used to train, fine-tune or prompt any AI model, and it is not sent to any AI service.',
      'Who sees your runs: the members of your pack, in the app. Your runs are not public.',
      'If you delete an activity on Strava, make it private or change it so that it is no longer a run, RunQuest removes it here within 48 hours. Your XP, streaks, titles and badges are then recalculated without it, so they can go down. Event XP that you have already earned is kept. If the activity later becomes a public run again, it is imported again.',
      'Strava runs are read-only in the app, so a single run cannot be deleted there; delete the activity on Strava or use "Disconnect".',
      'The "Disconnect" button in Settings revokes RunQuest\'s access at Strava and deletes all runs that were imported from Strava, together with your stored Strava tokens. Runs you added by hand and event XP you have already earned stay. Your XP, streaks, titles and badges are recalculated. Disconnecting cannot be undone: if you connect Strava again, your earlier Strava runs are not fetched back and syncing starts from that day.',
      'If you revoke RunQuest\'s access on Strava instead, in your Strava settings, the result is the same: the runs imported from Strava and the tokens are deleted here.',
      'The "Pause sync" button in Settings keeps your Strava connection and your runs, but no new runs are fetched while sync is paused. Runs you delete or make private on Strava are still removed here, and revoking access on Strava still works. When you choose "Turn sync back on", what happened during the pause is fetched.',
      `For any other request about your Strava data, email ${CONTACT}.`,
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
      'To limit repeated attempts, the server keeps your IP address in memory for at least 15 minutes, until the server restarts or the entry is replaced. It is not stored with your signup, but it can be written to the server log if you are blocked.',
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
      'For the events Strava sends about your activities, the log entry for the event itself holds only your Strava athlete ID and the activity ID, with the type of object and of change (object_type, aspect_type, object_id and owner_id), never a title, coordinates or a token. When you disconnect, the log also gets a line with your user ID and the version and time of your consent.',
      'Supabase provides the database and the file storage for profile pictures. All stored data described on this page, including the waitlist, lives there.',
      'Strava is where your runs come from. Strava\'s own terms and privacy policy apply to your data there.',
      'Open-Meteo receives the start coordinates and time of a run and returns the weather.',
      'Vercel provides DNS for runquest.dev, which turns the domain name into an address. It does not host RunQuest.',
    ],
  },
  {
    id: 'retention',
    title: 'How long data is kept',
    paragraphs: [
      'Account, run and pack data is kept as long as your account exists.',
      'Strava tokens are kept until you disconnect (in the app or on Strava) or ask for them to be deleted. Your Strava athlete ID and the record of your consent are kept with them. Connecting Strava again replaces them.',
      `RunQuest keeps a journal of the events Strava sends, so that each event is handled once. It holds Strava IDs, the type of event and times, and no title, no coordinates and no token. Events that were handled are kept ${WEBHOOK_RETENTION_DONE_DAYS} days, and events that failed are kept ${WEBHOOK_RETENTION_FAILED_DAYS} days.`,
      'Notification settings are kept as long as your account exists. The read marks for Pack News rows are cleared when you mark all as read.',
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
      'The "Disconnect" button in Settings deletes your Strava runs and your Strava tokens directly in the app, and revokes the access at Strava.',
      `Everything else is deleted by hand on request. To have your whole account or your waitlist entry deleted, email ${CONTACT}. There is no delete button for accounts in the app yet.`,
      'Runs you added by hand can be deleted in the app. Runs imported from Strava are read-only there: they are removed by "Disconnect", or when you delete the activity on Strava.',
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
