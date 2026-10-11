# Badges Feature — grunden (RUN-126, v0.6.0)

Badges (ADR 009): härledda, återkallbara serier med sex nivåer (Common..Legendary). Grunden är logiken (RUN-126) — API-klient, hooks och ren
modell. Vyerna (tokens/emblem RUN-127, Profile-samling och väljare RUN-128, Runner card RUN-130, Board-rader RUN-131, popup RUN-129, News-rad RUN-132)
byggs ovanpå och lägger sina komponenter under `components/`. Designfacit: `docs/design/badges/spec.md` (§4 vyerna, §6 hur texterna sätts ihop,
§12 där Council-villkoren går före bilderna).

## Struktur

- **api.ts** — `badgesApi`: de fyra endpointsen ovanpå `backendApi.authenticatedRequest` (token, 401, bas-URL), så `backendApi.ts` inte växer. Packar upp
  `{ success, data, meta }` och **kastar** allt annat (react-query gör kastet till felläge). `getGroupBadges` packar `meta.member_count` som `member_count`.
- **hooks/useBadgeQueries.ts** — den ENDA query-definitionen per resurs: `BADGE_QUERY_KEYS`, `useUserBadges`, `useGroupBadges`, `useSaveShowcase`, `useMarkBadgesSeen`.
- **badgeModel.ts** — ren logik: `buildCollection`, `buildRunnerBadges` (Runner card, RUN-130), `buildPopupQueue`, `cleanShowcase`/`toggleShowcase`/`sameShowcase`, `ownedSeriesOf`, `applySeen`/`applyShowcase`
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
- **Inte här:** "Preview on leaderboard" (uppföljning).

## Emblemet och tokens (RUN-127)

- **components/BadgeEmblem.tsx** — `BadgeEmblem({ series, tier, size, ignite?, decorative? })`: glow-wrapper (`.rq-badge`) → ram (`__frame`, nivåns gradient) → Heroic-ring
  (`__ring`, bara Heroic) → mörk kärna (`__core`) → serieikonen (RQIcon, ur `BADGE_SERIES[].icon`). `tier` 1..6 = nivån, `null` (och allt ogiltigt: 0, 7, bråkdelar) = låst
  (`data-tier="locked"`: dämpad ram .12, ikon .28, ingen glöd). `size` `sm`/`md`/`lg` = 28/56/96 px via klass; ikonen 15/24/42 px sätts i CSS ur tokens.
  Etikett: `role="img"` + `aria-label` och `title` = "{Tier} {Serie}" ("Rare Milestoner"), låst "Locked {Serie}". `decorative` = `aria-hidden` utan etikett (Board-grupper och
  News-rader: den omgivande texten/gruppetiketten bär betydelsen). Okänd serie ritas med RQIcon:s reservikon.
- **components/BadgePips.tsx** — sex pips (position, inte framsteg), `role="img"` + "Tier N of 6" / "Locked" (`pipsText` i badgeTier, samma format som `BadgeRow.pipsLabel`), `decorative` när raden redan säger nivån.
- **components/badgeTier.ts** — `tierKey` (data-tier ur `TIER_NAMES`), `isEarnedTier`, `tierName`.
- **badges.css** — enda stilfilen för emblem/pips/chip. Nivå → de lokala `--rq-emblem-*`-variablerna (färg, rgb, gradient), storlek → mått, allt ur `--rq-badge-*` (temafilen sektion 1.34 i
  `index.css` OCH `docs/design/temafil-forslag.css`, ordagrant lika — ett vakttest jämför värdena och mot `claude-design/runquest-badges.js`).
- **Chip:** `<span className="rq-chip rq-chip--status rq-badge-chip" data-tier={tierKey(tier)}>{nivånamn}</span>` (status-receptet, nivåfärg). Låst chip = bara `.rq-chip` (text `--rq-text-4`, .50).
  Designens .45 verifierades mot kortbakgrunden (ca #181818): 4.49:1, alltså under 4.5:1; .50 ger 5.3:1 och är det närmaste tokensteget som klarar kravet (Council 9).
- **Layouttokens** (samlingsrutnät, popupbredd, News-radens ikonkolumn, spec §5) finns INTE än: vakttestet kräver att varje token läses, så RUN-128/129/132 lägger in sina när de bygger dem.

### Runner card: BadgePanel (RUN-130)

- **components/BadgePanel.tsx** — `BadgePanel({ rows, loading?, error? })` (spec F4): den skrivskyddade BADGES-panelen. En rad per intjänad serie: md-emblem (`decorative`, raden läses en gång),
  serienamn, "On display" (bara visade), held-by när modellen har ett värde, nivå-chip (`.rq-chip--status` + `data-tier`). Inga knappar.
- **Data:** `rows` kommer ur `buildRunnerBadges(userBadges, group, viewer)`: bara intjänade serier, visade först (i löparens ordning), sedan högst nivå, sedan serieordning. Samma funktion ger
  `showcase` till minis i Runner cardens hjältekort. Held-by göms när X = N (andras kort) och utelämnas när group-queryn felar.
- **Lägen:** laddar → TrackLoader; `error` (`{ onRetry, retrying }`) → `ErrorState` med Retry; tom `rows` → streckad ruta "No badges yet." (bara ett lyckat, tomt svar).
- **Stil:** `.rq-badge-panel*` ligger i `features/runner/runner.css` tills Profile återanvänder panelen (RUN-128) — då flyttas blocket hit. Placering och datakoppling: `features/runner/README.md`.

### Rörelse (ägarbeslut E1+E2, Rörelse-undantaget i STATE.md)

- **Glöd:** ingen på Common/Uncommon eller låst; statisk från Rare (sm 4 px / md+lg 7 px, @ .45); Legendary 5/10 px @ .60.
- **Tändning** (`ignite`, bara popupen): `rqBadgeIgnite` 0.9 s ease-out. Rare+ går från ingen glöd till nivåns glöd (på wrappern); Common/Uncommon får ett ljusflimmer i ramen
  (`brightness(var(--rq-badge-flash))` → 1, ingen glöd). EN keyframe för alla nivåer: startvärdet kommer ur `--rq-emblem-ignite-from`, slutvärdet är elementets eget statiska filter.
  Låsta serier tänds aldrig.
- **Andning** (Legendary `md`/`lg`, aldrig `sm`): egen keyframe `rqBadgeGlow` i `--rq-dur-glow` (3.2 s), `--rq-badge-breathe-count` (3) cykler, börjar och slutar i den statiska glöden så att den
  står kvar utan hopp. `rqGlowIcon` återanvänds inte: den går 3 till 13 px i `currentColor` och startar/slutar därför inte i Legendarys statiska 10 px @ .60. Topp = `--rq-badge-breathe-max`
  (13 px, full färg). I popupen (`ignite`): tändning, därefter andning från `--rq-badge-ignite-handoff` (1.3 s). Animationerna startar när elementet monteras och startar inte om vid omrendering;
  växlar `ignite` från true till false byter animationen namn och andningen startar om — popupen ska därför låta `ignite` vara satt så länge den visas.
- **`prefers-reduced-motion`:** alla animationer ligger i `no-preference`-blocket och `reduce` har `animation: none !important`: slutläget (statisk glöd, Common/Uncommon utan glöd) visas direkt.
- **Heroic-ringen vid 28 px:** verifierad i 1x och 2x mot Uncommon (`/preview/badges`, sektionen "Heroic ring at mini"; skärmdump `docs/design/badges/reference/f1-built.png`). Vid ring-alfa .55
  och ring2 3 px syntes ringen inte tydligt, så den förhandsgodkända förstärkningen är införd: `--rq-badge-ring` @ .85 och `--rq-badge-ring-core-sm` 3.5 px (ring1 2 px; md/lg-måtten oförändrade,
  ring-alfan är en token för alla storlekar).
- **Board-fallback** (spec §4 F5, Council 12): "Legendary-minis utan glöd" är inte byggd; kritikern avgör om den behövs. Tillägget är då en modifierare som sätter `filter: none` på `.rq-badge[data-tier="legendary"]`.

### Förhandsvisning

`/preview/badges` (`pages/BadgesPreviewPage.tsx`, stil i `pages/preview/badgeSheet.css`): F1-arket med de riktiga komponenterna — sex nivåkort, matrisen 8 × 6, låsta, storlekar, 1:1 på panel,
Heroic-kontrollen och en rörelserad med Replay. Utan inloggning. Designens alternativrad (Heroic amber, Legendary orange) byggs inte (ägarbeslut S1/S2).
