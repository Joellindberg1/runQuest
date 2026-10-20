// API-kontrakt (ADR 007): gemensamma former för NYA endpoints.
// Endast typer — ingen runtime-kod. Importeras av backend-routes och frontendens API-klient.

/** Framgångssvar för nya endpoints: { success: true, data, meta? }. */
export interface ApiSuccess<TData, TMeta = undefined> {
  success: true;
  data: TData;
  meta?: TMeta;
}

/** Felsvar: HTTP-status + { error }. */
export interface ApiError {
  error: string;
}

/** Felsvar med success-flagga: { success: false, error }. Äldre endpoints (titles, recalculate-totals) skickar den formen; nya använder `ApiError`. */
export interface ApiFailure {
  success: false;
  error: string;
}

/**
 * Felsvar från POST/PUT/DELETE /api/runs när servern skrev ändringen men XP-omräkningen föll (500). `written` låter klienten hålla cachen i takt:
 * cachen är inaktuell och ett nytt försök kan dubblera.
 */
export interface WrittenApiError extends ApiError {
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
