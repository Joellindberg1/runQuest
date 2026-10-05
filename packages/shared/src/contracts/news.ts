// GET /api/news och POST /api/news/seen (ADR 008 beslut 9). Fältstil snake_case.
// Raden är ett FAKTUM (typ + payload), ingen renderad text: klienten renderar ur type + payload
// + vem som tittar ("took … from you" när target är den som tittar). Namn/bild hämtas live via actor/target.
import type { ApiSuccess } from './common.js';
import type { ActivityPayloadMap, ActivityType } from '../activity.js';

export interface NewsUserRef {
  id: string;
  name: string;
  profile_picture: string | null;
}

/** En nyhetsrad, diskriminerad på `type` så att `payload` är typad per händelse. */
export type NewsItem = {
  [T in ActivityType]: {
    id: number;
    type: T;
    /** ISO-8601 UTC — när det hände (dag-gruppering sker i klienten, Stockholm-tid). */
    occurred_at: string;
    payload_version: number;
    /** null = ingen aktör (events) eller en raderad användare ("a former member"). */
    actor: NewsUserRef | null;
    target: NewsUserRef | null;
    payload: ActivityPayloadMap[T];
    is_backfill: boolean;
    /** Oläst för den som frågar: id över vattenmärket, ej backfill, nyare än användaren, ej egen handling. */
    is_unread: boolean;
  };
}[ActivityType];

export interface NewsResponse {
  /** Sorterad på id fallande. */
  items: NewsItem[];
}

export interface NewsMeta {
  /** Räknas över ALLA typer (oberoende av ?type=-filtret). */
  unread_count: number;
  last_seen_id: number | null;
  /** Finns det äldre rader (inom ?before/?after-intervallet) bortom den här sidan? */
  has_more: boolean;
  /** id att skicka som ?before=… för nästa sida; null när has_more är false. */
  next_before: number | null;
}

export type NewsApiResponse = ApiSuccess<NewsResponse, NewsMeta>;

/** Query för GET /api/news. before och after utesluter varandra (båda → 400). */
export interface NewsQuery {
  /** 1–100, default 30. */
  limit?: number;
  before?: number;
  after?: number;
  /** Kommaseparerad lista av ActivityType. */
  type?: string;
}

export interface NewsSeenRequest {
  /** Positivt heltal; utelämnat = senaste raden i gruppen. Vattenmärket sänks aldrig. */
  up_to_id?: number;
}

export interface NewsSeenResponse {
  last_seen_id: number | null;
  unread_count: number;
}

export type NewsSeenApiResponse = ApiSuccess<NewsSeenResponse>;
