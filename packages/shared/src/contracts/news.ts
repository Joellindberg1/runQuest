// GET /api/news, POST /api/news/seen och POST /api/news/read (ADR 008 beslut 9, ADR 011 beslut 4). Fältstil snake_case.
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
    /**
     * Oläst för den som frågar (ADR 011 beslut 4, `isNotifiable` i shared): id över golvet och inte kvitterad i
     * news_read, ej backfill, nyare än användaren, ett notisslag (inte egen handling, inte okänd typ) och slaget är
     * påslaget. En vunnen eller oavgjord utmaning är oläst även när betraktaren är aktör. Raden returneras alltid,
     * även när slaget är avstängt; då är bara flaggan false.
     */
    is_unread: boolean;
  };
}[ActivityType];

export interface NewsResponse {
  /** Sorterad på id fallande. */
  items: NewsItem[];
}

export interface NewsMeta {
  /**
   * Antal olästa notiser i gruppen enligt samma predikat som `is_unread`, mätt vid 500 (klockan visar "99+" över 99).
   * Räknas över ALLA typer, oberoende av ?type=-filtret, men bara slag som är påslagna för användaren.
   */
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
  /**
   * Vyfilter "Involves me" (ADR 011 beslut 9), skilt från notisslagen: bara rader där anroparen är `actor` eller `target`,
   * samt `event_closed` där `payload.entrant_ids` innehåller anroparen. Kombineras (AND) med type/before/after/limit och gäller
   * serverns paginering (`has_more`/`next_before` beskriver det filtrerade flödet). `meta.unread_count` påverkas inte.
   * Enda giltiga värdet är `me`; allt annat (även tomt) ger 400.
   */
  involves?: 'me';
}

export interface NewsSeenRequest {
  /** Positivt heltal; utelämnat = senaste raden i gruppen. Vattenmärket sänks aldrig. */
  up_to_id?: number;
}

export interface NewsSeenResponse {
  last_seen_id: number | null;
  /** Kvarvarande olästa efter höjningen, samma räkning som `NewsMeta.unread_count` (mättad vid 500). */
  unread_count: number;
}

export type NewsSeenApiResponse = ApiSuccess<NewsSeenResponse>;

/**
 * POST /api/news/read (ADR 011 beslut 4): kvittera enskilda rader. Kontraktet är generiskt, en lista id:n, så att klientens
 * buntade läs-gester (högst var 300 ms) går i ett anrop.
 */
export interface NewsReadRequest {
  /** 1–50 unika positiva heltal, annars 400. Id:n utanför anroparens grupp eller på/under golvet ignoreras tyst. */
  ids: number[];
}

export interface NewsReadResponse {
  /** Olästa efter kvitteringen, samma räkning som `NewsMeta.unread_count` i `GET /api/news` direkt efter skrivningen (mättad vid 500). */
  unread_count: number;
}

export type NewsReadApiResponse = ApiSuccess<NewsReadResponse>;
