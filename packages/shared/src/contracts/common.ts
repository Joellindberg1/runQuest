// API-kontrakt (ADR 007 och Addendum 2026-10-20): gemensamma former för svar och fel.
// Endast typer — ingen runtime-kod (felkoderna som konstanter ligger i errors.ts). Importeras av backend-routes och frontendens API-klient.
import type { ApiErrorCode } from './errors.js';

/** Framgångssvar: { success: true, data, meta? }. `data` finns alltid (`null` när åtgärden inte har någon nyttolast). */
export interface ApiSuccess<TData, TMeta = undefined> {
  success: true;
  data: TData;
  meta?: TMeta;
}

/**
 * Felsvar: HTTP-status + { success: false, error, code }. `error` är en fast engelsk text för visning och loggar, aldrig för logik; `code` är det klienten och
 * supporten grenar på (katalogen i errors.ts). `data` bär bara räknare, i de två felsvaren från POST /titles/reprocess-all.
 * `written` finns kvar under dubbelsvarsfönstret (steg 1) bredvid koden `recalc_failed_after_write` och tas bort i steg 2.
 */
export interface ApiError<TData = undefined> {
  success: false;
  error: string;
  code: ApiErrorCode;
  data?: TData;
  written?: true;
}

/**
 * Felsvar från POST/PUT/DELETE /api/runs när servern skrev ändringen men XP-omräkningen föll (500, kod `recalc_failed_after_write`). `written` låter en klient från
 * före steg 1 hålla cachen i takt: cachen är inaktuell och ett nytt försök kan dubblera. Tas bort i steg 2 (RUN-364).
 */
export interface WrittenApiError extends ApiError {
  code: 'recalc_failed_after_write';
  written: true;
}

/**
 * Steg 1 av kuvertbytet (ADR 007 Addendum 2026-10-20, expand): ett svar med nyttolast utanför `data` bär `data` BREDVID de gamla nycklarna, så att en gammal och en
 * ny klient läser samma svar. `TLegacy` är den gamla formen (utan `success`), `TData` det som ligger i `data`. Tas bort i steg 2 (contract, RUN-364):
 * då är svaret bara `ApiSuccess<TData>`.
 */
export type DualEnvelope<TLegacy extends object, TData = TLegacy, TMeta = undefined> = TLegacy & { success: true; data: TData; meta?: TMeta };

/** Offset-paginering (`?limit=&offset=`) — meta-blocket (ADR 007 A5). */
export interface OffsetPageMeta {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}
