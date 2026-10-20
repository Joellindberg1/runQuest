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

/** Offset-paginering (`?limit=&offset=`) — meta-blocket (ADR 007 A5). */
export interface OffsetPageMeta {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}
