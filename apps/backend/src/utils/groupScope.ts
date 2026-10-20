// Gruppavgränsning, fail-closed (ADR 007 A6, ADR 012 beslut 5): en token utan group_id får tom data, aldrig alla gruppers rader.
// Det här är det enda stället i routes som läser gruppen ur token (req.user.group_id); övriga routes går via hjälparna nedan.
// Ett villkorligt gruppfilter (`if (groupId) query = query.eq('group_id', groupId)`) är förbjudet i routes;
// scripts/ci-guards.mjs (regel 6) fäller bygget om det dyker upp igen.
//
// Vilken väg som läser vad (ADR 012, anteckningen "Var gruppen kommer ifrån"):
//   token (JWT)  groupIdOrRespondEmpty, groupIdOrRespondForbidden, tokenGroupId (här). Inaktuell efter join tills ny inloggning.
//   färskt       actingGroupForWriteOrRespond (utils/groupAccess.ts, ur group_members) för skrivningar av gruppinställningar,
//                readUserGroupId (services/userGroupId.ts, ur users.group_id) för tjänster utan request.
import type { Request, Response } from 'express';
import { fail, ok } from './respond.js';

/**
 * Anroparens grupp ur token, eller undefined (ingen grupp, tom grupp eller ingen användare). Svarar aldrig.
 * Bara för rutter där en användare utan grupp inte ska få det tomma svaret, till exempel anroparens egna data, tidszonen eller ett id som
 * ska ge samma 404 som ett id som inte finns. Gruppen får aldrig bli ett villkorligt filter (regel 6): läsningar använder groupIdOrRespondEmpty.
 */
export function tokenGroupId(req: Request): string | undefined {
  return req.user?.group_id || undefined;
}

/**
 * Anroparens grupp ur JWT, eller null efter att ha svarat 200 med `emptyBody` (utan att röra databasen). Utan `emptyBody` svaras
 * `{ success: true, data: [] }`, den form auth- och challenges-listorna använder. Ge rutten dess egen tomma form (samma som ett riktigt svar
 * utan rader) som `emptyBody`.
 * Handlern ska avsluta när den får null:
 *
 *   const groupId = groupIdOrRespondEmpty(req, res);
 *   if (!groupId) return;
 */
export function groupIdOrRespondEmpty(req: Request, res: Response, emptyBody?: unknown): string | null {
  const groupId = tokenGroupId(req);
  if (groupId) return groupId;
  if (emptyBody === undefined) ok(res, []);
  else res.json(emptyBody);
  return null;
}

/**
 * Admin-skrivningar: gruppen admin agerar i, eller null efter att ha svarat 403 (utan att röra databasen).
 * Skrivningar svarar inte "tomt" som läsningarna: en admin utan grupp ska få veta att det inte går, och inget får skrivas.
 * Det här är det enda stället som avgör vilken grupp en admin agerar i (i dag gruppen i token).
 *
 *   const groupId = groupIdOrRespondForbidden(req, res);
 *   if (!groupId) return;
 */
export function groupIdOrRespondForbidden(req: Request, res: Response): string | null {
  const groupId = tokenGroupId(req);
  if (groupId) return groupId;
  fail(res, 403, 'Admin must belong to a group', 'group_required');
  return null;
}
