// Gruppavgränsning, fail-closed (ADR 007 A6): en token utan group_id får tom data, aldrig alla gruppers rader.
// Ett villkorligt gruppfilter (`if (groupId) query = query.eq('group_id', groupId)`) är förbjudet i routes;
// scripts/ci-guards.mjs (regel 6) fäller bygget om det dyker upp igen.
import type { Request, Response } from 'express';

/** Svarsformen {success,data} med tom lista, den som auth- och challenges-listorna redan använder. */
const EMPTY_LIST = { success: true, data: [] } as const;

/**
 * Anroparens grupp ur JWT, eller null efter att ha svarat 200 med `emptyBody` (utan att röra databasen).
 * Handlern ska avsluta när den får null:
 *
 *   const groupId = groupIdOrRespondEmpty(req, res);
 *   if (!groupId) return;
 */
export function groupIdOrRespondEmpty(req: Request, res: Response, emptyBody: unknown = EMPTY_LIST): string | null {
  const groupId = req.user?.group_id;
  if (groupId) return groupId;
  res.json(emptyBody);
  return null;
}
