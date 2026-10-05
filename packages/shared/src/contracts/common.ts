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

/** Offset-paginering (`?limit=&offset=`) — meta-blocket (ADR 007 A5). */
export interface OffsetPageMeta {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}
