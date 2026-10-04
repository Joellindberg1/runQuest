// Offset-paginering enligt ADR 007 A5: ?limit=&offset= (heltal) och meta { total, limit, offset, has_more }.
import type { OffsetPageMeta } from '@runquest/shared';

export interface OffsetPageOptions {
  defaultLimit: number;
  maxLimit: number;
}

export type OffsetPageParse =
  | { ok: true; limit: number; offset: number }
  | { ok: false; error: string };

function parseNonNegativeInt(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

export function parseOffsetPage(
  query: Record<string, unknown>,
  { defaultLimit, maxLimit }: OffsetPageOptions,
): OffsetPageParse {
  let limit = defaultLimit;
  if (query.limit !== undefined) {
    const parsed = parseNonNegativeInt(query.limit);
    if (parsed === null || parsed < 1 || parsed > maxLimit) {
      return { ok: false, error: `limit must be an integer between 1 and ${maxLimit}` };
    }
    limit = parsed;
  }

  let offset = 0;
  if (query.offset !== undefined) {
    const parsed = parseNonNegativeInt(query.offset);
    if (parsed === null) return { ok: false, error: 'offset must be an integer >= 0' };
    offset = parsed;
  }

  return { ok: true, limit, offset };
}

export function buildPageMeta(total: number, limit: number, offset: number): OffsetPageMeta {
  return { total, limit, offset, has_more: offset + limit < total };
}

export interface PagedRows<T> {
  rows: T[];
  total: number;
}

/**
 * Kör en offset-sida med exakt total. PostgREST svarar 416 (PGRST103) när offset ligger bortom
 * sista raden — det är ett normalt läge för en pager (rader kan ha tagits bort mellan anrop), så då
 * returneras en tom sida och totalen hämtas med en separat head-count i stället för att ge 500.
 *
 * `build(head)` ska returnera frågan med filter/sortering och `select(cols, { count: 'exact', head })`.
 */
export async function fetchOffsetPage<T = any>(
  build: (head: boolean) => any,
  limit: number,
  offset: number,
): Promise<PagedRows<T>> {
  const page = await build(false).range(offset, offset + limit - 1);
  if (page.error) {
    const outOfRange = page.error.code === 'PGRST103' || page.status === 416;
    if (!outOfRange) throw page.error;
    const head = await build(true);
    if (head.error) throw head.error;
    return { rows: [], total: head.count ?? 0 };
  }
  const rows = page.data ?? [];
  if (page.count == null && rows.length === 0 && offset > 0) {
    // Vissa PostgREST-lägen svarar 200 + tom lista utan count-header bortom slutet — total hämtas då separat.
    const head = await build(true);
    if (head.error) throw head.error;
    return { rows, total: head.count ?? 0 };
  }
  return { rows, total: page.count ?? 0 };
}
