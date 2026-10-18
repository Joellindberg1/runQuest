// Gruppbehörighet för skrivningar (ADR 012 beslut 6.4). Det här är det enda stället som avgör VILKEN grupp en användare får skriva i.
//
// Gruppen kommer ur användarens aktiva medlemskap i group_members, läst färskt per anrop (getActiveMembership i utils/membership.ts), och
// ges bara om rollen får skriva inställningar enligt groupRoleCan. Den läses aldrig ur JWT (inaktuell efter join), URL, body eller header,
// så en admin kan inte rikta en skrivning mot en annan grupp: IDOR är omöjlig genom konstruktion, eftersom anroparen inte kan ange en grupp.
// users.is_admin används inte här (ADR 012 beslut 2.6).
//
// Fail-closed: saknat medlemskap, fel roll, okänd roll och databasfel ger alla "nekad", och anroparen skriver då ingenting.
//
// SÖMMEN FÖR SUPPORTROLLEN (RUN-267): här, och bara här, läggs en uttrycklig supportroll till (roll + vald grupp + auditlogg). Den får
// aldrig härledas ur "användaren saknar grupp"; ett saknat medlemskap betyder tom behörighet, inte mer. Tills dess finns ingen annan väg.
import type { Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { groupRoleCan } from '@runquest/shared';
import { logger } from './logger.js';
import { errorCode } from './errorCode.js';
import { getActiveMembership } from './membership.js';

export type ActingGroupDenial =
  /** Inget aktivt medlemskap, eller en roll som inte får skriva. Samma svar för båda: ingen ledtråd om vilken grupp som finns. */
  | 'forbidden'
  /** Medlemskapet kunde inte läsas (databasfel, okänd roll). Nekad, men ett serverfel i stället för ett nej. */
  | 'unavailable';

export type ActingGroupForWrite =
  | { allowed: true; groupId: string }
  | { allowed: false; reason: ActingGroupDenial };

/**
 * Gruppen `userId` får skriva i, eller ett nej. Tar bara användarens id (identiteten ur den verifierade token), aldrig en grupp:
 * det går alltså inte att fråga "får jag skriva i grupp X". Kastar aldrig.
 */
export async function resolveActingGroupForWrite(userId: string, db?: SupabaseClient): Promise<ActingGroupForWrite> {
  let membership;
  try {
    membership = await getActiveMembership(userId, db);
  } catch (error) {
    logger.error(`❌ Could not read membership for write access (${errorCode(error)})`);
    return { allowed: false, reason: 'unavailable' };
  }
  if (!membership || !groupRoleCan(membership.role, 'settings.write')) return { allowed: false, reason: 'forbidden' };
  return { allowed: true, groupId: membership.group_id };
}

/**
 * Route-formen av resolveActingGroupForWrite: gruppen att skriva i, eller null efter att ha svarat (utan att skriva något):
 *   403 { error: 'Forbidden' }             ingen token-användare, inget aktivt medlemskap eller en roll utan skrivrätt (ett och samma svar)
 *   500 { error: 'Internal server error' } medlemskapet kunde inte läsas
 * Handlern ska avsluta när den får null:
 *
 *   const groupId = await actingGroupForWriteOrRespond(req, res);
 *   if (!groupId) return;
 */
export async function actingGroupForWriteOrRespond(req: Request, res: Response, db?: SupabaseClient): Promise<string | null> {
  const userId = req.user?.user_id;
  const acting: ActingGroupForWrite = userId ? await resolveActingGroupForWrite(userId, db) : { allowed: false, reason: 'forbidden' };
  if (acting.allowed) return acting.groupId;
  if (acting.reason === 'unavailable') res.status(500).json({ error: 'Internal server error' });
  else res.status(403).json({ error: 'Forbidden' });
  return null;
}
