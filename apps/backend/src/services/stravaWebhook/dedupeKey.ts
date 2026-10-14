// Idempotensnyckeln för en Strava-webhook-händelse och vitlistningen av `updates` (ADR 010 beslut 5).
import { createHash } from 'node:crypto';
import { WEBHOOK_UPDATE_KEYS, type WebhookAspectType, type WebhookObjectType, type WebhookUpdateKey } from './constants.js';

/** De lagrade `updates`: bara vitlistade nycklar, bara enkla värden (Strava skickar `private: "true"`, `type: "Ride"`). */
export type WhitelistedUpdates = Partial<Record<WebhookUpdateKey, string | number | boolean>>;

/**
 * Det nyckeln byggs av. Fälten är Stravas egna, rakt ur POST-brödtexten:
 * `event_time` är epoch-SEKUNDER som heltal (inte millisekunder, inte ISO-sträng), `object_id` ett heltal.
 * `updates` tas emot som det är och vitlistas här; rutten behöver alltså inte rensa den först.
 */
export interface WebhookEventKeyInput {
  object_type: WebhookObjectType;
  object_id: number;
  aspect_type: WebhookAspectType;
  event_time: number;
  updates?: unknown;
}

/**
 * Släpper bara igenom `private`, `type` och `authorized`, och bara om värdet är sträng, tal eller boolean. Allt annat
 * (titel, beskrivning, koordinater, token, nästlade värden) kastas. Läser bara egna egenskaper. Allt som inte är ett
 * vanligt objekt ger `{}`.
 */
export function pickWhitelistedUpdates(updates: unknown): WhitelistedUpdates {
  const picked: WhitelistedUpdates = {};
  if (typeof updates !== 'object' || updates === null || Array.isArray(updates)) return picked;

  for (const key of WEBHOOK_UPDATE_KEYS) {
    if (!Object.hasOwn(updates, key)) continue;
    const value = (updates as Record<string, unknown>)[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') picked[key] = value;
  }
  return picked;
}

/** Kanonisk JSON för de vitlistade `updates`: nycklarna sorterade, inga blanksteg. Samma innehåll ger alltid samma text. */
function canonicalJson(updates: WhitelistedUpdates): string {
  const entries = (Object.keys(updates) as WebhookUpdateKey[]).sort().map((key) => `${JSON.stringify(key)}:${JSON.stringify(updates[key])}`);
  return `{${entries.join(',')}}`;
}

function requireInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`buildWebhookDedupeKey: ${field} must be a safe integer, got ${String(value)}`);
  }
  return value;
}

/**
 * `strava:<object_type>:<object_id>:<aspect_type>:<event_time>:<updates_hash>`, där updates_hash är de första 12 hex-tecknen av
 * sha256 över de vitlistade `updates` som kanonisk JSON (sorterade nycklar).
 *
 * - En omleverans (samma brödtext) ger samma nyckel. Två olika ändringar i samma sekund (`private` och `type`) skiljs åt av hashen.
 * - `owner_id` ingår inte: `object_id` är globalt unikt hos Strava.
 * - `event_time` skrivs som Stravas epoch-sekunder, decimalt (till exempel 1672790400). Webhook-rutten bygger nyckeln av den råa
 *   brödtexten och ska alltså skicka in `event_time` oförändrat; en ISO-sträng eller ett tal med decimaler kastar ett fel
 *   hellre än att ge en nyckel som aldrig matchar en omleverans.
 * - Titeln ingår aldrig: den vitlistas bort före hashen.
 */
export function buildWebhookDedupeKey(event: WebhookEventKeyInput): string {
  const objectId = requireInteger(event.object_id, 'object_id');
  const eventTime = requireInteger(event.event_time, 'event_time');
  const updatesHash = createHash('sha256').update(canonicalJson(pickWhitelistedUpdates(event.updates))).digest('hex').slice(0, 12);
  return `strava:${event.object_type}:${objectId}:${event.aspect_type}:${eventTime}:${updatesHash}`;
}
