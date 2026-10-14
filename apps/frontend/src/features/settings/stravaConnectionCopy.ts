import { STRAVA_CONSENT_KEY_POINTS } from '@runquest/shared';

// Texterna i "Pause or disconnect" (ADR 010 beslut 7.6) och i det som hör till pausen. Två slags text, medvetet åtskilda:
//
//  - DELAD: meningar som integritetstexten redan säger ordagrant hämtas ur den delade källan (STRAVA_CONSENT_KEY_POINTS), aldrig kopieras hit.
//    Det gäller varningen att bortkopplingen inte går att ångra och att historiken inte kommer tillbaka.
//  - UI-TEXT: korta formuleringar för just den här ytan. De får inte lova mer än integritetstexten: återkallandet hos Strava är ett försök
//    ("asks Strava to revoke…", ADR 010 beslut 7.4.2), aldrig en garanti. stravaConnectionCopy.test.ts prövar att varje UI-mening som
//    integritetstexten också säger står ordagrant i den.

function sharedSentence(pointId: 'disconnect' | 'pause', pattern: RegExp): string {
  const found = STRAVA_CONSENT_KEY_POINTS.find((point) => point.id === pointId)?.sentences.find((sentence) => pattern.test(sentence));
  // Ett tyst tomt stycke vore värre än ett fel: texten i shared har ändrats så att UI:t måste läsas om.
  if (!found) throw new Error(`The shared Strava consent text no longer has a "${pointId}" sentence matching ${pattern}`);
  return found;
}

/** DELAD. "Disconnecting cannot be undone: … your earlier Strava runs are not fetched back and syncing starts from that day." */
export const DISCONNECT_WARNING = sharedSentence('disconnect', /cannot be undone/);

/** UI-TEXT (ordagrant ur integritetstexten, men inte en nyckelmening där): det som gäller under en paus. */
export const STILL_REMOVED_SENTENCE = 'Runs you delete or make private on Strava are still removed here.';
/** UI-TEXT (ordagrant ur integritetstexten): raderingen hänger inte på att Strava svarar. */
export const DELETED_EVEN_IF_NO_ANSWER_SENTENCE = 'The runs and tokens are deleted even if Strava does not answer.';

// ── Valsteget: en mening per val. Den fulla förklaringen och "cannot be undone" hör till bekräftelsen (ägarbeslut 2026-10-14). ──
export const CHOOSE_TITLE = 'Pause or disconnect';
export const CHOOSE_LEAD = 'Two ways to stop new runs from Strava coming in.';
export const PAUSE_CHOICE = {
  title: 'Pause sync',
  text: 'Your connection and runs stay, but no new runs are fetched until you turn sync back on, and runs you delete or make private on Strava are still removed here.',
  action: 'Pause sync',
} as const;
export const DISCONNECT_CHOICE = {
  title: 'Disconnect',
  text: 'Ends the connection and deletes the runs imported from Strava; you confirm on the next step.',
  action: 'Disconnect…',
} as const;

// ── Bekräftelsen ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const CONFIRM_TITLE = 'Disconnect Strava?';
export const KEEP_CONNECTION_ACTION = 'Keep my connection';

export interface DisconnectConfirmation {
  /** Knappens text: antalet när det är känt, annars en ärlig formulering utan siffra. */
  action: string;
  happens: string[];
  stays: string[];
  warning: string;
}

const runsWord = (count: number) => (count === 1 ? 'run' : 'runs');

/**
 * Bekräftelsens innehåll. `stravaRuns` är antalet Stravarundor appen själv känner till (`source === 'strava'`), eller `null` så länge rundorna inte
 * är lästa. `null` ger aldrig "0": knappen säger då "Disconnect and delete all Strava runs", vilket stämmer oavsett antal.
 */
export function buildDisconnectConfirmation(stravaRuns: number | null): DisconnectConfirmation {
  const noRuns = stravaRuns === 0;
  const deleted = stravaRuns === null
    ? 'All runs that came from Strava are deleted, together with your stored Strava tokens.'
    : noRuns
      ? 'No runs here came from Strava, so only your stored Strava tokens are deleted.'
      : `All ${stravaRuns} ${runsWord(stravaRuns)} that came from Strava ${stravaRuns === 1 ? 'is' : 'are'} deleted, together with your stored Strava tokens.`;
  const action = stravaRuns === null ? 'Disconnect and delete all Strava runs' : noRuns ? 'Disconnect' : `Disconnect and delete ${stravaRuns} ${runsWord(stravaRuns)}`;
  return {
    action,
    happens: [
      `RunQuest asks Strava to revoke its access. ${DELETED_EVEN_IF_NO_ANSWER_SENTENCE}`,
      deleted,
      ...(noRuns ? [] : ['Your XP, streak, titles and badges are recalculated without them.']),
    ],
    stays: ['Runs you logged by hand.', 'The XP you earned from events.'],
    warning: DISCONNECT_WARNING,
  };
}

// ── Bekräftelser och fel i kortets och dialogens regioner ───────────────────────────────────────────────────────────────────────
export const PAUSED_STATUS = 'Sync paused. No new runs are fetched until you turn it back on.';
export const RESUMED_STATUS = 'Sync is back on. New runs from the pause are on their way.';
export const DISCONNECTED_STATUS = 'Strava disconnected. RunQuest asked Strava to revoke its access and deleted your Strava runs.';
// Inget "nothing was changed": ett fel mitt i bortkopplingen kan ha raderat en del innan det föll, och bortkopplingen kan köras om.
export const PAUSE_FAILED = "Couldn't pause sync. Try again.";
export const RESUME_FAILED = "Couldn't turn sync back on. Try again.";
export const DISCONNECT_FAILED = "Couldn't disconnect. Try again.";
