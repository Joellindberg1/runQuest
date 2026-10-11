# Badges Feature — grunden (RUN-126, v0.6.0)

Badges (ADR 009): härledda, återkallbara serier med sex nivåer (Common..Legendary). Den här mappen är **bara logikgrunden** — API-klient, hooks och ren
modell. Vyerna (tokens/emblem RUN-127, Profile-samling och väljare RUN-128, Runner card RUN-130, Board-rader RUN-131, popup RUN-129, News-rad RUN-132)
byggs ovanpå och lägger sina komponenter under `components/`. Designfacit: `docs/design/badges/spec.md` (§4 vyerna, §6 hur texterna sätts ihop,
§12 där Council-villkoren går före bilderna).

## Struktur

- **api.ts** — `badgesApi`: de fyra endpointsen ovanpå `backendApi.authenticatedRequest` (token, 401, bas-URL), så `backendApi.ts` inte växer. Packar upp
  `{ success, data, meta }` och **kastar** allt annat (react-query gör kastet till felläge). `getGroupBadges` packar `meta.member_count` som `member_count`.
- **hooks/useBadgeQueries.ts** — den ENDA query-definitionen per resurs: `BADGE_QUERY_KEYS`, `useUserBadges`, `useGroupBadges`, `useSaveShowcase`, `useMarkBadgesSeen`.
- **badgeModel.ts** — ren logik: `buildCollection`, `buildPopupQueue`, `cleanShowcase`/`toggleShowcase`/`sameShowcase`, `ownedSeriesOf`, `applySeen`/`applyShowcase`
  (cache-uppdateringarna), `dismissSeries`/`skipAllSeries`.
- `guards.test.ts` — vakttester (delade typer, en query-definition, inga hårdkodade serienamn/texter). Globben tar med framtida `components/` automatiskt.

## Regler värda att komma ihåg

- **Allt om serierna kommer ur `@runquest/shared`** (`BADGE_SERIES`: namn, ikon, flavors, metricLabel; `TIER_NAMES`; `requirementText`, `tierFlavor`, `MAX_TIER`,
  `MAX_SHOWCASE`). Modellen sätter bara ihop texter; ett vakttest förbjuder serienamn, nycklar, flavors och nivånamn som strängliteraler. En ny serie i shared
  syns här utan kodändring.
- **Texterna (Council 1, 2, 14, 21):**
  - Intjänat kort: `requirement` = kravet för nuvarande tier **utan** `"{Tier} — "`; `flavor` på egen rad; `next` = `"Next: {Tier} — {krav}"` (ingen flavor);
    maxad serie (`maxed`) har ingen `next` — vyn visar "TOP TIER REACHED". `pipsLabel` = `"Tier N of 6"`.
  - Låst kort: `unlock` = `"Unlock: Common — {krav}"`, `metricLabel` som första rad, `pipsLabel` = `"Locked"`; aldrig flavor, `next` eller held-by.
    `requirement` är då Commons krav utan prefix (samma text som i `unlock`) — rendera antingen det ena eller det andra, inte båda.
  - Valfria fält (`flavor`, `next`, `unlock`, `heldBy`) **finns bara när de ska renderas**; modellen skriver aldrig en platshållare och aldrig "undefined".
- **Held-by** = `holders[serie][tier]` av `member_count` ("Held by X of N in your pack"). Visas bara på intjänade kort; X = 1 på mitt eget kort blir
  "Only you hold this in your pack"; på någon annans kort (`viewerId !== ownerId`) göms det när X = N. Saknas `group`, `member_count`, serien eller tiern i
  rutnätet — eller är värdena osammanhängande (X < 1, X > N) — utelämnas raden.
- **Svar från en annan serverversion än klienten** (okänd serie, tier utanför 1..6) ignoreras av modellen i stället för att krascha (`requirementText` kastar
  annars `RangeError`). Utan svar (laddar/fel) är alla rader låsta — vyn väljer skelett/felkort före.
- **Popupkön** (`buildPopupQueue(items, group?)`): en post per serie vars `tier > seen_tier` (högsta tier om serien skulle förekomma flera gånger), i serieordning.
  Rader utan `seen_tier` (andras data) ger ingen post. `kind` = `'earned'` (seen_tier 0) eller `'evolved'` (`fromTier`/`fromTierName`). Avfärdande skickar
  `dismissSeries(entry)` = `[serien]`; "Skip all" skickar `skipAllSeries(queue)`. Kön krymper när `useMarkBadgesSeen` uppdaterar cachen optimistiskt — **"1 of 3"
  måste därför frysas av popupen (antalet vid öppning)**, inte räknas om från den levande kön.
- **Showcase** följer titelvalets mönster (`cleanShowcase`/`toggleShowcase`): max `MAX_SHOWCASE`, bara ägda serier, vald ordning bevaras; en serie jag tappat
  städas bort ur utkastet. Utkastet ligger lokalt i vyn (som `useDisplaySelection`) tills `useSaveShowcase().save(series)` lyckas.
- **Cachen:** `['badges','user',<id>]` per användare (egen och andras blandas aldrig; `seen_tier` finns bara i min) och `['badges','group']` (delad av alla
  Board-rader och held-by). `invalidateAfterRunChange` invaliderar `['badges']` — badges räknas om synkront i samma skrivväg som totalerna (`evaluateBadges` i
  `calculateUserTotals`), så ingen uppföljande hämtning behövs. Användarbytet rensar inget särskilt: nyckeln bär användar-id:t, och gruppens data är densamma för alla i gruppen.
- **Optimistiskt, med återställning:** `useSaveShowcase(userId)` skriver valet i min samling direkt, återställer vid fel (400: max 3 / ej ägd), låter serverns
  sparade val vinna och invaliderar min samling + gruppen (Board-raderna). `useMarkBadgesSeen(userId)` höjer `seen_tier` direkt (kön töms), återställer vid fel och
  invaliderar bara min samling. Båda avbryter pågående omhämtningar av min samling först.
- **Överlappande skrivningar:** varje mutation har en `mutationKey` (`BADGE_QUERY_KEYS.mutation.*`), och `onSuccess`/`onError`/`onSettled` skriver, återställer och invaliderar
  bara när `queryClient.isMutating({ mutationKey }) === 1` (den sista). Annars kan A:s avslut låta en omhämtning läsa servern före B:s POST och lägga tillbaka B i popupkön.
- **Hook-signaturerna tar användar-id** (`useSaveShowcase(userId)`, `useMarkBadgesSeen(userId)`) i stället för att läsa inloggningen själva: hookarna är rena mot
  providers och testas utan auth-kontext. Vyerna har id:t från `useAuth()`.
- **Inte här:** tokens, emblem, komponenter, Runner card-ordningen (visade först, sedan högst nivå, sedan serieordning — RUN-130 bygger den ur `BadgeRow.displayPosition`
  och `tier`), "Preview on leaderboard" (uppföljning).
