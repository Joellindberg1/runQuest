// Händelserna som webbanalysen (Umami) får ta emot, och vakten som släpper igenom exakt dem och inget annat.
//
// Stravas API-policy 5.4 förbjuder analys på Strava-data, och ägarbeslutet i epic RUN-19 går längre: ingen rundata, inga distanser eller
// tider, inga namn, ingen e-post, inga id:n och inget användar-id som händelsedata. Därför är en händelse ett FASTA namn med en tillåtelselista
// per prop: bara små uppräknade värden (strängar som står i registret nedan), aldrig fria strängar eller tal. En ny händelse eller ett nytt värde
// kräver en ändring HÄR, i en granskad diff, och aldrig i anropsplatsen.
//
// Två lager, samma lista: typerna (AnalyticsEventName, AnalyticsProps) gör fel namn och fel nycklar till kompileringsfel, och
// sanitizeAnalyticsEvent gör samma sak vid körning för det som ändå slinker in (en cast, data utifrån). Vakten avvisar HELA händelsen vid första
// avvikelsen: en halv händelse med en nyckel borttagen ger vilseledande siffror, och en otillåten nyckel är ett fel hos anroparen som ska synas
// i testerna, inte döljas.
//
// Namnen är kebab-case (`waitlist-click`): det är Umamis egen konvention i dokumentationen (`signup-button`), den läses rakt av i
// händelsevyn och trattbyggaren, och namnet går aldrig ihop med propnycklarna, som är enstaka gemena ord (`setting`).
import { NOTIFICATION_KINDS } from './notifications.js';

/** Inställningsnycklarna en `setting-changed` får nämna: användarinställningarna i registret (en per notisslag). Bara NYCKELN, aldrig värdet. */
const SETTING_KEYS = NOTIFICATION_KINDS.map((kind) => kind.key);

/**
 * Registret: händelsenamn -> prop -> de tillåtna värdena. En händelse utan props har `{}`. Alla props är obligatoriska.
 *
 * - `setting-changed` skickar vilken inställning som ändrades (registerns nyckel) men aldrig vad den sattes till. Värdet är användarens
 *   personliga val och blir, när gruppinställningar och enumvärden kommer (ADR 012), något som kan peka ut en grupps regler. Att räkna vilka
 *   inställningar som rörs räcker för att se vad som används; riktningen (på/av) kan läggas till senare som en uppräknad prop om ägaren vill.
 * - `strava-connected` bär inget: bara att det hände. Aldrig athlete-id, aldrig vad som importerades.
 * - `run-logged-manual` bär inget: ingen distans, inget datum, ingen tid. Importerade Stravarundor kan klienten inte ens se som en händelse.
 */
export const ANALYTICS_EVENTS = {
  // Landningen
  'film-started': {},
  'waitlist-click': {},
  'waitlist-joined': {},
  'login-click': {},
  // Appen
  'challenge-accepted': {},
  'notifications-opened': {},
  'setting-changed': { setting: SETTING_KEYS },
  'strava-connected': {},
  'run-logged-manual': {},
} as const satisfies Record<string, Record<string, readonly string[]>>;

type AnalyticsEventDefinitions = typeof ANALYTICS_EVENTS;

export type AnalyticsEventName = keyof AnalyticsEventDefinitions;

/** En inställningsnyckel som `setting-changed` får nämna. */
export type AnalyticsSettingKey = AnalyticsProps<'setting-changed'>['setting'];

/** Är nyckeln en av registrets? Smalnar en `string` (nyckeln i en sparad patch) till typen `track` kräver; en okänd nyckel skickas aldrig. */
export function isAnalyticsSettingKey(key: string): key is AnalyticsSettingKey {
  return (SETTING_KEYS as readonly string[]).includes(key);
}

export const ANALYTICS_EVENT_NAMES = Object.keys(ANALYTICS_EVENTS) as AnalyticsEventName[];

/** Propsen för en händelse, med varje värde begränsat till tillåtelselistans värden. En händelse utan props tar inga alls. */
export type AnalyticsProps<E extends AnalyticsEventName> = keyof AnalyticsEventDefinitions[E] extends never
  ? Record<string, never>
  : { [K in keyof AnalyticsEventDefinitions[E]]: AnalyticsEventDefinitions[E][K] extends readonly (infer V)[] ? V : never };

/** Argumenten efter händelsenamnet: inga för en händelse utan props, annars propsobjektet. */
export type AnalyticsTrackArgs<E extends AnalyticsEventName> = keyof AnalyticsEventDefinitions[E] extends never ? [] : [props: AnalyticsProps<E>];

export interface SanitizedAnalyticsEvent {
  name: AnalyticsEventName;
  /** Saknas för en händelse utan props. Alltid ett nytt objekt med bara registrets nycklar och värden. */
  data?: Record<string, string>;
}

const hasOwn = (target: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(target, key);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/**
 * Prövar en händelse mot registret. Ger den rena händelsen, eller `null` om något avviker: okänt namn, en prop som inte finns för händelsen,
 * ett värde som inte står i tillåtelselistan (fri sträng, tal, id, e-post, objekt), en prop som saknas, eller propsen inte är ett vanligt objekt.
 * Läser bara egna nycklar, så en förgiftad prototyp ändrar ingenting.
 */
export function sanitizeAnalyticsEvent(name: unknown, props?: unknown): SanitizedAnalyticsEvent | null {
  if (typeof name !== 'string' || !hasOwn(ANALYTICS_EVENTS, name)) return null;
  const eventName = name as AnalyticsEventName;
  const allowed: Readonly<Record<string, readonly string[]>> = ANALYTICS_EVENTS[eventName];
  const allowedKeys = Object.keys(allowed);

  if (props === undefined) return allowedKeys.length === 0 ? { name: eventName } : null;
  if (!isPlainObject(props)) return null;

  // Reflect.ownKeys: även symboler och icke-uppräkningsbara nycklar räknas, så inget kan gömmas där.
  const given = Reflect.ownKeys(props);
  if (given.length !== allowedKeys.length) return null;

  const data: Record<string, string> = {};
  for (const key of allowedKeys) {
    if (!hasOwn(props, key)) return null;
    const value = props[key];
    if (typeof value !== 'string' || !allowed[key].includes(value)) return null;
    data[key] = value;
  }
  // Längderna är lika och varje tillåten nyckel finns, så inga andra nycklar kan finnas.
  return allowedKeys.length === 0 ? { name: eventName } : { name: eventName, data };
}
