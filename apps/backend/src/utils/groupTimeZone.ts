// Backendens ingång till gruppens tidszon (ägarbeslut 2026-10-20). All backendkod som räknar ett dygn för en grupp — boostfönstret,
// eventgränserna, "idag" — hämtar zonen här och skickar den vidare till shared:s kalenderfunktioner (zoneDay, zoneMidnightIso,
// boostWindow, ...). Ingen backendkod anropar en Stockholm-specifik funktion där en grupp är känd.
//
// Tidszon per grupp (RUN-21, `season.timezone` i group_settings) finns inte än: utan källa är varje grupps zon STOCKHOLM_TZ. RUN-21
// anropar setGroupTimeZoneSource en gång vid uppstart med en funktion som läser gruppens inställning, och ingen anropare ändras.
import { groupTimeZone as resolveGroupTimeZone, type GroupTimeZoneSource } from '@runquest/shared';

let source: GroupTimeZoneSource | undefined;

/** Byter källan för gruppernas zoner. Utan argument tillbaka till standardzonen. Testerna skickar en annan zon genom resolvern här. */
export function setGroupTimeZoneSource(next?: GroupTimeZoneSource): void {
  source = next;
}

/** Gruppens IANA-tidszon. Okänd grupp (null) eller en ogiltig zon ger Stockholm. */
export function groupTimeZone(groupId: string | null | undefined): string {
  return resolveGroupTimeZone(groupId, source);
}
