// Strava-webhookens publika rutt (ADR 010 beslut 2, 3 och 5): GET /api/strava/webhook (prenumerationens verifiering) och
// POST /api/strava/webhook (händelserna). Ingen JWT: Strava har ingen token (undantaget är GET /health för admin, se nedan).
// Strava signerar inte händelserna, så skyddet är lager på lager, och det som bär är ADR 010 beslut 1: händelsen är bara en signal, handlern bygger aldrig på dess innehåll.
//
// Svarsformen dikteras av Strava ({"hub.challenge": …} och ett tomt 200), så ADR 007:s `{ success, data }` gäller INTE här.
// Felsvar använder ändå `{ error }` utan detaljer.
//
// POST, stegen i ordning (billiga kontroller först; databasen läses först för en giltig händelse, högst två läsningar och en
// skrivning inom Stravas 2 s, inga Strava-anrop och inget som väntar på bearbetningen):
//   1. Prenumerations-id: STRAVA_WEBHOOK_SUBSCRIPTION_ID saknas eller är inget heltal -> 200 och händelsen släpps (warn).
//      Annars måste `subscription_id` vara ett heltal (annars 400) och lika med variabeln som TAL (ingen hemlighet, så ingen
//      konstanttidsjämförelse). Olika -> 403 (warn utan brödtext). Det här kommer före resten av formkontrollen.
//   2. Form: object_type/aspect_type är strängar; object_id/owner_id/event_time är positiva heltal (event_time = epoch-sekunder
//      och ett giltigt datum). Fel form -> 400, och buildWebhookDedupeKey (som kastar på fel typ) anropas aldrig med sådant.
//   3. Okänd object_type/aspect_type (Strava kan lägga till nya) -> 200 utan rad (annars omleverans).
//   4. Okänd ägare (findUserByAthleteId) -> 200, ingen rad, warn. Ett databasfel där är INTE "okänd ägare": 500, Strava skickar om.
//   5. Översvämningsskydd: ≥ WEBHOOK_MAX_UNPROCESSED_PER_OWNER obearbetade rader -> 200, inget sparas, warn. Ett fel i räkningen -> 500.
//   6. Lagring: bara vitlistade `updates` (aldrig titeln), upsert på dedupe_key med ignoreDuplicates. Databasfel -> 500. En dubblett -> 200.
// Alla 200-svar ser likadana ut: svaret avslöjar inte om ägaren fanns eller om händelsen sparades.
//
// Ingen IP-gräns (Lead-beslut 2026-10-14): alla händelser kommer från Stravas adresser, så en IP-gräns skulle strypa riktiga
// leveranser och orsaka omleveranser. Skyddet är taket per ägare (steg 5) och att varje händelse verifieras mot Strava.
// Inget användarlås heller: rutten skriver bara till händelsekön, aldrig till `runs`. Låset hör till workern.
//
// Loggar: bara object_type, aspect_type, object_id och owner_id. Aldrig brödtext, titel, verify_token eller token. Felkoder
// loggas, inte databasens felmeddelanden (de kan ta med värden).
import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { getSupabaseClient } from '../config/database.js';
import { authenticateJWT } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { findUserByAthleteId, isValidAthleteId } from '../services/stravaAthlete.js';
import {
  WEBHOOK_ASPECT_TYPES,
  WEBHOOK_BODY_LIMIT,
  WEBHOOK_MAX_EVENT_TIME,
  WEBHOOK_MAX_UNPROCESSED_PER_OWNER,
  WEBHOOK_OBJECT_TYPES,
  type WebhookAspectType,
  type WebhookObjectType,
} from '../services/stravaWebhook/constants.js';
import { buildWebhookDedupeKey, pickWhitelistedUpdates } from '../services/stravaWebhook/dedupeKey.js';
import { readWebhookHealth } from '../services/stravaWebhook/health.js';
import { errorCode } from '../utils/errorCode.js';
import { logger } from '../utils/logger.js';
import type { ApiFailure, StravaWebhookHealthResponse } from '@runquest/shared';

const EVENTS_TABLE = 'strava_webhook_events';
const UNPROCESSED_STATUSES = ['pending', 'processing'];

export interface StravaWebhookOptions {
  /** Anropas när en rad faktiskt lagrats (inte vid dubblett). Standard: ingenting. S11 kopplar in workern här. */
  onEventStored?: () => void | Promise<void>;
}

interface ValidEvent {
  object_type: string;
  aspect_type: string;
  object_id: number;
  owner_id: number;
  subscription_id: number;
  event_time: number;
  updates: unknown;
}

const isPositiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** Miljövariabeln som positivt heltal, eller null om den saknas eller inte är ett (= "inte konfigurerad"). */
function configuredSubscriptionId(): number | null {
  const raw = process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return isPositiveInteger(id) ? id : null;
}

/** Jämför i konstant tid. Olika längd är ett nej (timingSafeEqual kastar annars). */
function sameSecret(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Formkontrollen (steg 2) av allt utom subscription_id, som steg 1 redan prövat. Null = fel form. */
function parseEvent(body: Record<string, unknown>, subscriptionId: number): ValidEvent | null {
  const { object_type, aspect_type, object_id, owner_id, event_time } = body;
  if (typeof object_type !== 'string' || typeof aspect_type !== 'string') return null;
  if (!isPositiveInteger(object_id) || !isValidAthleteId(owner_id) || !isPositiveInteger(event_time)) return null;
  if (event_time > WEBHOOK_MAX_EVENT_TIME) return null; // annars ger toISOString() "+010000-…" och Postgres svarar 22009 (500, omleverans för evigt)
  return { object_type, aspect_type, object_id, owner_id, subscription_id: subscriptionId, event_time, updates: body.updates };
}

const isKnown = <T extends string>(list: readonly T[], value: string): value is T => (list as readonly string[]).includes(value);

export function createStravaWebhookRouter({ onEventStored }: StravaWebhookOptions = {}): express.Router {
  const router = express.Router();

  // ─── GET: prenumerationens verifiering ────────────────────────────────────────
  router.get('/', (req, res): void => {
    const expected = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
    // Svaret nämner inte vad som saknas.
    if (!expected) { res.status(503).json({ error: 'Service unavailable' }); return; }

    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    if (mode !== 'subscribe' || typeof challenge !== 'string' || !sameSecret(token, expected)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    res.status(200).json({ 'hub.challenge': challenge });
  });

  // ─── GET /health: kön i siffror (ADR 010 beslut 11), den enda rutten här med JWT ──────────────────────────────
  // authenticateJWT läser bara Authorization-headern, så den behöver ingen parser före sig. Strava når aldrig den här rutten.
  // requireAdmin betyder i v0.7.0 "vilken gruppadmin som helst", och det finns exakt en (ägaren). Endpointen visar globala
  // räknare, inte gruppdata: flytta den till supportrollen när RUN-267 landar.
  router.get('/health', authenticateJWT, requireAdmin, async (_req, res): Promise<void> => {
    try {
      res.json({ success: true, data: await readWebhookHealth(configuredSubscriptionId() !== null) } satisfies StravaWebhookHealthResponse);
    } catch (error) {
      // Synligt fel i stället för nollor: en hälsokontroll som säger 0 vid databasfel ljuger. Bara felkoden loggas.
      logger.error(`❌ Strava webhook health: could not read the queue (${errorCode(error)})`);
      res.status(500).json({ success: false, error: 'Failed to read webhook health' } satisfies ApiFailure);
    }
  });

  // ─── POST: händelserna ────────────────────────────────────────────────────────
  // Egen gräns (som väntelistan): routern monteras före den globala parsern, så en för stor brödtext stoppas här (413).
  router.post('/', express.json({ limit: WEBHOOK_BODY_LIMIT }), async (req, res): Promise<void> => {
    const accepted = (): void => { res.status(200).json({ received: true }); };

    try {
      // 1. Prenumerations-id
      const configured = configuredSubscriptionId();
      if (configured === null) {
        logger.warn('⚠️ Strava webhook: STRAVA_WEBHOOK_SUBSCRIPTION_ID is not configured, event discarded');
        accepted();
        return;
      }
      const body: unknown = req.body;
      if (typeof body !== 'object' || body === null || Array.isArray(body)) { res.status(400).json({ error: 'Invalid event' }); return; }
      const fields = body as Record<string, unknown>;
      if (!isPositiveInteger(fields.subscription_id)) { res.status(400).json({ error: 'Invalid event' }); return; }
      if (fields.subscription_id !== configured) {
        logger.warn('⚠️ Strava webhook: subscription_id does not match, event rejected');
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      // 2. Form
      const event = parseEvent(fields, configured);
      if (!event) { res.status(400).json({ error: 'Invalid event' }); return; }

      // 3. Okänd typ
      if (!isKnown(WEBHOOK_OBJECT_TYPES, event.object_type) || !isKnown(WEBHOOK_ASPECT_TYPES, event.aspect_type)) {
        accepted();
        return;
      }
      const objectType: WebhookObjectType = event.object_type;
      const aspectType: WebhookAspectType = event.aspect_type;
      const label = `${objectType} ${aspectType} object_id=${event.object_id} owner_id=${event.owner_id}`;

      // 4. Okänd ägare (kastar vid databasfel -> catch nedan -> 500)
      const userId = await findUserByAthleteId(event.owner_id);
      if (!userId) {
        logger.warn(`⚠️ Strava webhook: unknown owner, event discarded (${label})`);
        accepted();
        return;
      }

      // 5. Översvämningsskydd
      const db = getSupabaseClient();
      const { count, error: countError } = await db
        .from(EVENTS_TABLE)
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', event.owner_id)
        .in('status', UNPROCESSED_STATUSES);
      if (countError || typeof count !== 'number') {
        logger.error(`❌ Strava webhook: could not count unprocessed events (${errorCode(countError)}, ${label})`);
        res.status(500).json({ error: 'Failed to store event' });
        return;
      }
      if (count >= WEBHOOK_MAX_UNPROCESSED_PER_OWNER) {
        logger.warn(`⚠️ Strava webhook: owner has ${count} unprocessed events, event not stored (${label})`);
        accepted();
        return;
      }

      // 6. Lagring. event_time går OFÖRÄNDRAD (epoch-sekunder) in i nyckeln och som ISO-tid i timestamptz-kolumnen.
      const updates = pickWhitelistedUpdates(event.updates);
      const { data, error } = await db
        .from(EVENTS_TABLE)
        .upsert(
          {
            dedupe_key: buildWebhookDedupeKey({ object_type: objectType, object_id: event.object_id, aspect_type: aspectType, event_time: event.event_time, updates }),
            object_type: objectType,
            object_id: event.object_id,
            aspect_type: aspectType,
            owner_id: event.owner_id,
            subscription_id: event.subscription_id,
            event_time: new Date(event.event_time * 1000).toISOString(),
            updates,
            user_id: userId,
          },
          { onConflict: 'dedupe_key', ignoreDuplicates: true },
        )
        .select('id'); // med ignoreDuplicates ger PostgREST bara de rader som faktiskt sattes in
      if (error) {
        logger.error(`❌ Strava webhook: could not store event (${errorCode(error)}, ${label})`);
        res.status(500).json({ error: 'Failed to store event' });
        return;
      }

      accepted();
      // Efter svaret, och aldrig ett fel som kan ändra det: workern väcks bara när en rad lagrats (inte vid dubblett).
      if (Array.isArray(data) && data.length > 0) {
        const onFailure = (): void => logger.error('❌ Strava webhook: onEventStored failed');
        try { Promise.resolve(onEventStored?.()).catch(onFailure); } catch { onFailure(); }
      }
    } catch {
      // Ett oväntat fel (till exempel databasfel i ägaruppslaget). Aldrig brödtext eller felmeddelande i loggen.
      logger.error('❌ Strava webhook: unexpected error while handling an event');
      if (!res.headersSent) res.status(500).json({ error: 'Failed to store event' });
    }
  });

  // Fel från body-parsern som JSON i stället för Express HTML-felsida (som väntelistan).
  router.use((err: { type?: string }, _req: Request, res: Response, next: NextFunction): void => {
    if (err?.type === 'entity.too.large') { res.status(413).json({ error: 'Request body too large' }); return; }
    if (err?.type === 'entity.parse.failed') { res.status(400).json({ error: 'Invalid JSON body' }); return; }
    next(err);
  });

  return router;
}

export default createStravaWebhookRouter();
