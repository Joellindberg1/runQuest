# Badges Feature (v0.6.0)

Badges (ADR 009): härledda, återkallbara serier med sex nivåer (Common..Legendary). Allt är byggt i v0.6.0: grunden (RUN-126: API-klient, hooks och ren modell) och vyerna ovanpå —
emblem/tokens (RUN-127), Profile-samling och News-emblem (RUN-128), väljaren för visade badges (RUN-129; ersatt av badges-sidan i RUN-150), Runner card (RUN-130), Board-raderna (RUN-131) och uppgraderingspopupen (RUN-132).
Komponenterna ligger under `components/`; `BadgeMinis` (ritar de visade badgesen) används av Profile, Runner card och Board (layouten för Board bor i `features/leaderboard/board.css`, se dess README).
Designfacit: `docs/design/badges/spec.md` (§4 vyerna, §6 hur texterna sätts ihop, §12 där Council-villkoren går före bilderna).

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
  (`data-tier="locked"`: dämpad ram .12, ikon .28, ingen glöd). `size` `sm`/`cp`/`md`/`lg` = 28/44/56/96 px via klass (`cp` = compact, 44 × 49, v2, för profilens sammanfattning och Runner card; glöden är `-sm`-glöden eftersom bredden är under 56); ikonen 15/20/24/42 px sätts i CSS ur tokens.
  Etikett: `role="img"` + `aria-label` och `title` = "{Tier} {Serie}" ("Rare Milestoner"), låst "Locked {Serie}". `decorative` = `aria-hidden` utan etikett (Board-grupper och
  News-rader: den omgivande texten/gruppetiketten bär betydelsen). Okänd serie ritas med RQIcon:s reservikon.
- **components/BadgePips.tsx** — sex pips (position, inte framsteg), `role="img"` + "Tier N of 6" / "Locked" (`pipsText` i badgeTier, samma format som `BadgeRow.pipsLabel`), `decorative` när raden redan säger nivån.
- **components/badgeTier.ts** — `tierKey` (data-tier ur `TIER_NAMES`), `isEarnedTier`, `tierName`.
- **badges.css** — enda stilfilen för emblem/pips/chip. Nivå → de lokala `--rq-emblem-*`-variablerna (färg, rgb, gradient), storlek → mått, allt ur `--rq-badge-*` (temafilen sektion 1.34 i
  `index.css` OCH `docs/design/temafil-forslag.css`, ordagrant lika — ett vakttest jämför värdena och mot `claude-design/runquest-badges.js`).
- **Chip:** `<span className="rq-chip rq-chip--status rq-badge-chip" data-tier={tierKey(tier)}>{nivånamn}</span>` (status-receptet, nivåfärg). Låst chip = bara `.rq-chip` (text `--rq-text-4`, .50).
  v2 (RUN-146, dämpade nivåfärger): kortbakgrunden är `--rq-panel` över `--rq-bg-shell` plus `--rq-row-soft` ≈ (28.9, 31.5, 29.7). Med status-chippets tint .10 hamnar Heroic på 4.48:1 (och Rare på 4.55), alltså under 4.5:1. Nivåchippet har därför en egen bakgrundstint, `--rq-badge-chip-tint` .06 (regeln `.rq-chip.rq-badge-chip[data-tier]` i badges.css; övriga status-chip är orörda): Common 5.55, Uncommon 6.02, Rare 4.83, Heroic 4.74, Epic 5.08, Legendary 8.40 (uppmätt i skärmdump av `/preview/badges`, sektionen "Tier chips on a collection card": 5.71 / 6.16 / 4.93 / 4.83 / 5.19 / 8.66). `guards.test.ts` räknar kontrasten ur tokens för alla sex nivåer och fäller testet om en färg- eller tintändring går under 4.5:1.
  Designens .45 verifierades mot kortbakgrunden (ca #181818): 4.49:1, alltså under 4.5:1; .50 ger 5.3:1 och är det närmaste tokensteget som klarar kravet (Council 9).
- **Layouttokens** (spec §5): vakttestet kräver att varje token läses, så varje story lägger in sina när den bygger dem. Inlagda: skelettets takt `--rq-dur-badge-skel`/`--rq-badge-skel-stagger`.
  News-radens ikonkolumn heter `--rq-news-row-icon-badge-w` (30 px mobil, 34 desktop; avsnitt 1.28, läses av `news.css` — inte `--rq-badge-*`, eftersom badges-vakten bara läser `badges.css`). Popupbredden kommer med RUN-129.

### Runner card: BadgePanel (RUN-130, omarbetad i RUN-152, spec F11)

- **components/BadgePanel.tsx** — `BadgePanel({ rows, loading?, error? })`: den kompakta, skrivskyddade BADGES-panelen. Rubrik (`.rq-title` "BADGES", ingen ikon) + räknare "{N} of {BADGE_SERIES.length} series" och intjänade serier som
  `<ul aria-label="Earned badges">` med ett `BadgeEmblemDetail` (44 px, `cp`) per `<li>` i ett `flex-wrap` (`gap --rq-sp-8`). Panelen bär bara rubrik, räknare och emblemknappar: nivå, krav, "On display" och held-by
  ligger i emblemets popover (L4 — ingen information hänger på en tooltip). Låsta serier visas inte i panelen; ingen chip, held-by eller "On display" i raden (V2.9 #9). Raderna byggs med `buildRunnerBadges`, så
  held-by får rätt viewer (göms vid X = N på andras kort, utelämnas när group-queryn felar).
- **Data:** `rows` kommer ur `buildRunnerBadges(userBadges, group, viewer)`: bara intjänade serier, visade först (i löparens ordning), sedan högst nivå, sedan serieordning. Samma funktion ger
  `showcase` till minis i Runner cardens hjältekort (oförändrade).
- **Lägen:** laddar → TrackLoader; `error` (`{ onRetry, retrying }`) → `ErrorState` med Retry; tom `rows` → streckad ruta "No badges yet." (bara ett lyckat, tomt svar). Räknaren visas bara med emblem.
- **Stil:** `.rq-badge-panel*` (`__head`, `__title`, `__aside`, `__grid`, `__item`, `__empty`, `__loading`) bor i `badges.css`. Raden (`__row`/`__text`/`__nameline`/`__display`/`__held`) är borttagen i RUN-152.
  Placering och datakoppling: `features/runner/README.md`.

### Profilen: sammanfattningen (RUN-151, spec v2 F10) — ersätter samlingskortet (RUN-128)

`BadgeCollection` (profilens BADGES-kort med remsa och rutnät), dess stående `BadgeSeriesCard`-gren, CSS (`.rq-badge-collection*`, `.rq-badge-display*`, `.rq-badge-grid`, `.rq-badge-card__id`, `.rq-badge-skel-list`, `.rq-badge-empty__minis`) och token `--rq-badge-grid-cols` är borttagna. Profilen väljer ingenting; den visar och länkar.

- **components/BadgeSummary.tsx** — `BadgeSummary({ rows, loading?, error?, isDesktop })`: rubrikrad, intjänade serier som 44 px-emblem sorterade på nivå (`buildBadgeSummary(rows)`, högst nivå först, lika nivå i serieordning) i `<ul aria-label="Earned badges">`,
  och under en hårlinje (`--rq-line-2`) de låsta i `<ul aria-label="Locked badges">` följda av "Locked · n left" (mobil) / "Locked · n series left" (desktop); inga låsta → raden och hårlinjen utelämnas. Varje emblem är en `BadgeEmblemDetail` (popover med nivå, krav, held-by).
  **Mobil:** ingen kortyta, rubriken är eyebrow-`h2` "Badges · N of 8 series" (`.rq-eyebrow`). **Desktop:** `.rq-card`, Bebas-guld `h2` "BADGES" (`.rq-title`, ingen ikon) + "N of 8 series". Bägge: `<Link to={paths.badges}>` "All badges →" (`.rq-btn--ghost .rq-btn--compact`, längst till höger,
  tryckyta `--rq-badge-pick-hit`) — mobilens enda ingång till `/badges` (O5). Ingen procent, ingen global siffra (O2), inga väljar- eller Edit-element.
- **Tillstånd (F10.5):** laddar → en rad fem `cp`-stora skelettblock (`.rq-badge-skel__shape--cp` i `.rq-badge-skel-row`, `role="status"` "Loading badges"; pulsen i `no-preference`-blocket, stilla block under reduced-motion), rubriken utan räknare; fel (bara utan äldre data) → `ErrorState`
  ("Couldn't load your badges" / "Your runs are safe." / Retry) i stället för raderna, rubriken och länken kvar; inga intjänade → streckad ruta (`.rq-badge-summary__empty`) "No badges yet. Log a run to start collecting." och en låst rad med alla åtta. Gruppens fel utelämnar bara held-by i popovern.
- **Placering och data:** `ProfileScreen` äger badge-queryerna och renderar sammanfattningen på EN plats åt gången — desktop sist i `.rq-profile__main` (efter statflikarna), mobil i `.rq-profile__side` mellan MY TITLES och RUN HISTORY. Se `features/profile/README.md`.
- **Hjältekortet (F10.6, Q8):** `ProfileHero` ritar `BadgeMinis` efter `<h1>` i `.rq-badge-nameline` (min-height `--rq-badge-h-sm`) bara på desktop; mobilens hjältekort har inga minis och inget omslag, bara `<h1>`. Runner card och Board behåller sina minis.
- **components/BadgeSeriesCard.tsx** — badges-sidans liggande kort (se avsnittet om `/badges`). Det stående kortet (v1 F2) användes bara av `BadgeCollection` och togs bort tillsammans med den; `layout`-propen försvann (kortet har en enda form).
- **components/BadgeChip.tsx** — nivå-chippet: intjänat = `.rq-chip .rq-chip--status .rq-badge-chip` + `data-tier`; **låst = bara `.rq-chip`** ("Locked", text `--rq-text-4`). Chip-logiken bor på ETT ställe och har test. `BadgePanel` (Runner card), kortet och popovern använder samma `BadgeChip`.
- **Vakter:** `seriesIcons.test.ts` (varje `BADGE_SERIES[].icon` finns i `RQ_ICON_NAMES`), `badgeCollectionCss.test.ts` (skelettets rörelse i no-preference-blocket, samlingskortets CSS och `--rq-badge-grid-cols` borta, sammanfattningens CSS, panel-CSS), `BadgeSummary.test.tsx`, `features/profile/components/ProfileBadges.test.tsx` (placering, hjältekort, tillstånd).

### Rörelse (ägarbeslut E1+E2, Rörelse-undantaget i STATE.md)

- **Glöd:** ingen på Common/Uncommon eller låst; statisk från Rare (sm och cp 3 px / md+lg 5 px, @ .30); Legendary 4/7 px @ .35 (v2, RUN-146: svagare glöd och dämpade nivåfärgerna ur `runquest-badges.js`; v1 var 4/7 px @ .45 och 5/10 px @ .60).
- **Tändning** (`ignite`, bara popupen): `rqBadgeIgnite` 0.9 s ease-out. Rare+ går från ingen glöd till nivåns glöd (på wrappern); Common/Uncommon får ett ljusflimmer i ramen
  (`brightness(var(--rq-badge-flash))` → 1, ingen glöd). EN keyframe för alla nivåer: startvärdet kommer ur `--rq-emblem-ignite-from`, slutvärdet är elementets eget statiska filter.
  Låsta serier tänds aldrig.
- **Andning** (Legendary `md`/`lg`, aldrig `sm` eller `cp`; topp `--rq-badge-breathe-max` 13 px oförändrad mot den svagare statiska glöden, bedömd i RUN-146): egen keyframe `rqBadgeGlow` i `--rq-dur-glow` (3.2 s), `--rq-badge-breathe-count` (3) cykler, börjar och slutar i den statiska glöden så att den
  står kvar utan hopp. `rqGlowIcon` återanvänds inte: den går 3 till 13 px i `currentColor` och startar/slutar därför inte i Legendarys statiska 7 px @ .35. Topp = `--rq-badge-breathe-max`
  (13 px, full färg). I popupen (`ignite`): tändning, därefter andning från `--rq-badge-ignite-handoff` (1.3 s). Animationerna startar när elementet monteras och startar inte om vid omrendering;
  växlar `ignite` från true till false byter animationen namn och andningen startar om — popupen ska därför låta `ignite` vara satt så länge den visas.
- **`prefers-reduced-motion`:** alla animationer ligger i `no-preference`-blocket och `reduce` har `animation: none !important`: slutläget (statisk glöd, Common/Uncommon utan glöd) visas direkt.
- **Heroic-ringen vid 28 px:** verifierad i 1x och 2x mot Uncommon (`/preview/badges`, sektionen "Heroic ring at mini"; skärmdump `docs/design/badges/reference/f1-built.png`). Vid ring-alfa .55
  och ring2 3 px syntes ringen inte tydligt, så den förhandsgodkända förstärkningen är införd: `--rq-badge-ring` @ .85 och `--rq-badge-ring-core-sm` 3.5 px (ring1 2 px; md/lg-måtten oförändrade,
  ring-alfan är en token för alla storlekar).
- **Board-fallback** (spec §4 F5, Council 12): "Legendary-minis utan glöd" är inte byggd; kritikern avgör om den behövs. Tillägget är då en modifierare som sätter `filter: none` på `.rq-badge[data-tier="legendary"]`.

### Uppgraderingspopupen (RUN-132, spec F6, Council 4, 19–22)

- **components/BadgeUpgradeHost.tsx** — monteras EN gång i `AppShell` (båda varianterna; en rad, ingen tour-ankare rörd), alltså aldrig på `/`, `/login` eller landningen. Drivs av `useUserBadges(<jag>)` → `buildPopupQueue`
  (`tier > seen_tier`, en post per serie). Tom kö = ingenting renderas och varken gruppen eller onboarding-statusen hämtas av värden. Med poster monteras en *session* som hämtar gruppen (held-by) och visar första posten.
  **Popupen väntar på gruppen** (så held-by finns när den öppnas), men högst `GROUP_WAIT_MS` (2 s): ett segt eller hängande svar ger popupen utan held-by, och ett fel utelämnar held-by direkt.
  Ett oväntat svar (utan `items`) ger ingen popup och kraschar inte skalet (värden är globalt monterad).
- **Kön och "1 of 3":** värden (`UserUpgrades`, per användare) håller mängden avfärdade `serie:tier` för hela appsessionen. Den ligger i värden och inte i sessionen, så en serie inte kommer tillbaka ens om
  POST /badges/seen felar (5xx: hooken återställer cachen, kön kommer tillbaka i datat, men den avfärdade serien visas inte igen förrän appen öppnas på nytt). Det kompletterar `isMutating`-gaten i hooken.
  Sessionen håller räknarna `done`/`total`: `total` är antalet vid öppning (kön krymper optimistiskt) och växer bara om en ny serie tillkommer; sessionen avslutas när kön är tom och nästa börjar från noll. Avfärdande = `markSeen(dismissSeries(entry))`, "Skip all" = `markSeen(skipAllSeries(pending))`.
- **Väntan (Council 22):** `useWaitsForOnboarding` = (a) onboarding-statusen laddas, (b) `useOnboardingQueue().currentItem` är `onboarding_v1` eller en "What's new"-slug (allt som inte börjar på `tour_`, samma regel som `FeatureTour`),
  eller (c) `document.body` har klassen `driver-active` (driver.js sätter den medan en tour — första inloggningens eller en sidtour — körs; MutationObserver). Under väntan renderas ingen dialog; när väntan är över visas den
  (och tändningen spelas då). Sidtourer väntar inte på något och blockerar inte (annars hade en oläst tour på en sida du aldrig besöker hindrat popupen för alltid). Går onboarding-statusen inte att hämta blockeras ingenting.
  **En sidtour kan dra bort popupen och visa den igen:** startar en sidtour (t.ex. 600 ms efter att sidan monterats) medan popupen redan visas sätts `driver-active`, dialogen avmonteras och visas på nytt när touren är klar —
  samma post, ny tändning, räknaren oförändrad (den ligger i sessionen, som överlever).
- **Dubbelklicksskydd (`DISMISS_GUARD_MS`, 350 ms):** efter att en ny post blivit aktuell ignoreras avfärdande (Got it, ✕, Escape, scrim, Skip all); `event.detail > 1` (dubbelklick) och `repeat` på tangent (hållen Enter/Escape)
  avfärdar aldrig. Annars hade ett dubbelklick eller en hållen tangent avfärdat nästa badge osedd. Testerna fakear bara `Date` (`vi.useFakeTimers({ toFake: ['Date'] })`) och går förbi skyddet med `passGuard()`.
- **Ingen permanent ring:** `badgeUpgradeCss.test.ts` läser `badges.css` och kräver att knapparna (`.rq-badge-popup__btn`/`__close`) varken har outline, box-shadow eller `--rq-focus-ring` utanför `:focus-visible`.
- **components/BadgeUpgradeDialog.tsx** — ren presentation: Radix Dialog (`.rq-scrim`/`.rq-modal` från skalet, därför får `app-shell.css` inte saknas där den renderas), `aria-modal="true"`, `aria-labelledby` = serienamnet (Radix `Dialog.Title`),
  fokus till "Got it" vid öppning, tillbaka till det som hade fokus före vid stängning (Radix har ingen Trigger här, så dialogen lämnar själv tillbaka fokus), fokusfälla, Escape/scrim/✕/"Got it" = `onDismiss`.
  Innehåll: eyebrow ("Badge earned"/"Badge evolved", i kö + " · 1 of 3" i `aria-live="polite"`), lg-emblem med `ignite` (evolved: gammalt sm + → + nytt lg), serienamn, nivårad (bara evolved, nya nivåns färg), `BadgeChip`,
  kravtext (`Dialog.Description`), flavor på egen rad, held-by, "Got it" (enda fyllda guldknappen, ingen permanent ring) och i kö "Skip all" (ghost; döljs på sista platsen). Ingen "View badges" och ingen belöningstext.
- **Tändning:** emblemet har `key={serie-tier}` — CSS-animationen startar bara när elementet monteras, så nästa badge i kön måste vara ett nytt element. `ignite` är satt så länge popupen visas (växlar den av startar Legendary-andningen om).
- **Tokens:** `--rq-badge-popup-w` (mobil 340, desktop 400 i desktop-skalan) och `--rq-badge-popup-target` (knappmål: mobil 44, desktop 24 — Council 19), i båda temafilerna. Popup-reglerna ligger i eget block sist i `badges.css`;
  nivåraden återanvänder `--rq-emblem-c` genom att `.rq-badge-popup__tierline` ligger i nivå→färg-listorna överst.
- Skärmdumpar mot F6: `docs/design/badges/reference/f6-built-*.png` (t200 = ca 0.3 s efter öppning, mitt i tändningen).

### Badge-design v2: byggstenarna (RUN-149, spec "v2" F9, F10, F11)

Bara byggstenarna — sidan (`BadgesScreen`, RUN-150, byggd), profilens sammanfattning (RUN-151) och Runner card-panelen (RUN-152) bygger på dem. `ShowcasePicker` är borta sedan RUN-150 och `BadgeCollection` sedan RUN-151.

- **`buildBadgeSummary(rows)`** (badgeModel.ts) — ren funktion över `buildCollection`-raderna: `{ earned, locked, earnedCount, lockedCount, total }`. `earned` på nivå (högst först, lika nivå i BADGE_SERIES-ordning, ingen visad-först),
  `locked` i serieordning. Serieordningen läses ur BADGE_SERIES, inte ur radernas ordning in. Raderna är samma objekt (inga kopior).
- **`useShowcaseDraft(rows, userId)`** (hooks/useShowcaseDraft.ts) — utkastet för visade badges, logiken ur den gamla väljaren (RUN-129, borttagen) utan UI. Returnerar `{ draft, saved, dirty, full, status, saving, announcement, positionOf, toggle, save }`.
  Tillstånd i en ren reducer (`picked: string[] | null`, null = följ det sparade): flera växlingar i samma tick komponeras i ordning (inga förlorade klick, inga dubbletter, max `MAX_SHOWCASE`), och en växling i samma tick som `save()` ignoreras.
  `draft` städas mot det jag äger vid varje rendering; en omhämtning mitt i ett utkast rör inget utkast men räknar om `dirty`. `save()` avvisas aldrig: lyckat → `picked = null` + `status 'saved'`, fel → `status 'error'` och utkastet kvar (RETRY = `save()` igen).
  `saving` = en spara pågår (ref-spärr mot dubbelklick). Statusen går tillbaka till `idle` vid nästa ändring. Hooken anropar `useSaveShowcase` — aldrig `badgesApi` direkt (vakttestet).
- **`BadgeSeriesCard`** — `row` + `toggle: ShowcaseToggle` (`{ position, full, saving, limitId, onToggle }`): badges-sidans liggande kort och kortets enda form (den stående grenen och `layout`-propen togs bort i RUN-151 när `BadgeCollection` försvann). Innehållsreglerna
  (krav utan prefix, flavor på egen rad, Next/TOP TIER, held-by bara intjänade) kommer ur modellen; tre rutnätsområden ritar layouten. Växlaren är `<button aria-pressed>`: Show / `On display — N` / fullt (aria-disabled + `aria-describedby={limitId}` mot den SYNLIGA meningen
  som sidan äger) / sparar (alla aria-disabled, den valda behåller guldet) / låst (aria-hidden-ruta, ingen knapp). Kortet dimmas aldrig (ingen opacity i badges.css). `data-display="true"` när `position` är satt.
- **`BadgeEmblemDetail({ row })`** — 44 px (`cp`) dekorativt emblem i en `<button>` med namnet "{Tier} {Serie}" ("Locked {Serie}") som öppnar en Radix-popover (`.rq-popover.rq-badge-detail`, `aria-label` = serienamnet): "On display" (intjänad och i sparade valet — `row.displayPosition`), namn + chip, pips, krav, flavor, held-by; låst: Locked-chip, måttetikett, "Unlock: …". Ingen Next, ingen global siffra.
  `.rq-popover` kommer från `app-shell.css`, så komponenten ritas inom skalet (`/preview/badges` importerar den själv).
- **Tokens (1.34, båda temafilerna):** `--rq-badge-page-card-min` (300/240 px), `--rq-badge-page-gap` (`--rq-sp-8`/`--rq-sp-12`), `--rq-badge-card-areas` (mobil `"emblem who" "emblem body"`, desktop `"emblem who" "body body"`), `--rq-badge-detail-w` (280 px), `--rq-z-popover-over-modal` (67: popovern ritas över Runner card-modalen, `.rq-scrim` 65 / `.rq-modal` 66; läses av skalets `.rq-popover--over-modal` i app-shell.css som komponenten lägger på, så badges-CSS har aldrig z-index; skalets andra popovers behåller 60). CSS: `.rq-badge-page-grid` (rutnätet), `.rq-badge-card--landscape`, `.rq-badge-toggle`, `.rq-badge-detail*` — sist i badges.css.
- **Vakter:** `noGlobalStats.test.ts` (inga "globally", "has it", `%` eller "in pack" i featurens kod), `badgeCollectionCss.test.ts` (token- och rutnätsregler för de nya blocken). `/preview/badges` visar varje växlarläge, ett levande utkast och emblemknapparna med påhittad data.

### Badges-sidan `/badges` (RUN-150, spec v2 F9) — ersätter väljaren (RUN-129)

Den separata väljaren är borttagen (`ShowcasePicker`, `ShowcaseSlots`, `showcasePickerId`, CSS `.rq-badge-pick*`/`.rq-badge-slot*`/`.rq-badge-textlink`, token `--rq-badge-pick-clear`). Valet görs bara här (O3), med Show / On display-knappar direkt på korten. Profilen har ingen ingång till valet (ingen Edit-knapp, ingen uppmaning), bara "All badges →" i sammanfattningen (RUN-151).

- **`pages/BadgesPage.tsx`** — tunn: `<BadgesScreen />`.
- **`components/BadgesScreen.tsx`** — datahämtning (`useUserBadges(user.id)` + `useGroupBadges(!!user)` → `buildCollection`), `useShowcaseDraft(rows, user.id)`, sidhuvud, remsa och rutnät. Sidhuvudet: `h1.rq-display.rq-badges__title`; mobil: tillbaka-länk `‹` (`aria-label="Back to profile"`, tryckyta `--rq-badge-pick-hit`) och "N of 8 series unlocked" under rubriken;
  desktop: ingressen ("Eight series, six tiers. …", talen som ord räknade ur `BADGE_SERIES.length` och `MAX_TIER`) och räknaren i mono till höger. **Brytpunkten läses före allt som beror på den:** `isDesktop === false` ritar länken, `=== true` ingressen; `undefined` (matchMedia inte läst) ritar varken eller (test fäller mutationen `!isDesktop`).
  Räknaren utelämnas under laddning och fel.
- **`components/BadgeDisplayStrip.tsx`** — ON DISPLAY-remsan (`role="group" aria-label="On display"`): etikett, `BadgeMinis` med UTKASTET (inte serverns val), hjälptext (desktop) eller uppmaning (mobil, tomt utkast), **SAVE DISPLAY** (`.rq-btn--secondary`, sidans enda guldknapp) och tre permanenta statusbehållare:
  `aria-live="polite"` (den synliga meningen "3 of 3 on display — remove one first." med id = `limitId`, plus en `sr-only`-rad med senaste ändringen), `role="status"` (sparat, grön kant) och `role="alert"` (fel, röd kant + RETRY).
  SAVE DISPLAY är `aria-disabled` (aldrig `disabled`) när inget är osparat (`SAVED`) och medan sparandet pågår (`SAVING…`); klicket spärras i hanteraren. RETRY fokuserar SAVE DISPLAY innan sparandet startar (felraden försvinner då), och sparar om.
- **Rutnätet:** I normalläget står en `sr-only` h2 "Your badges" före rutnätet (hierarkin h1 → h2 → h3, som i tomläget). `<ul aria-label="Badge series" className="rq-badge-page-grid">` med åtta `BadgeSeriesCard` i `BADGE_SERIES`-ordning (låsta också). `toggle` = `{ position: positionOf(serie), full, saving, limitId, onToggle }` ur samma utkast som remsan.
  Kolumnerna är `auto-fill` ur `--rq-badge-page-card-min` (300 px mobil / 240 px desktop): uppmätt 1 kolumn på 402, 4 på 1440 med sidonav, 3 på 1280 och 2 på 1024 (antagande Q4, godtaget). Mobilskalet ger 1 kolumn även vid ca 640–715 px (rutnätsbredden är då under 2 × 300 px + glappet): en följd av token-minimumet och Q4, inte 2 kolumner som F9.9 säger för 640+.
- **Tillstånd (F9.8):** laddar → tre skelettkort (`.rq-badge-skel` i `.rq-badge-page-grid`, `role="status"` + "Loading badges"), ingen remsa, ingen räknare; fel (`isError && !data`) → `ErrorState` ("Couldn't load your badges" / Retry = `refetch`) i stället för remsa + rutnät;
  inga intjänade → streckad ruta ("No badges yet" / "Log a run to start collecting.", utan minis) i stället för remsan, därunder åtta låsta kort, ingen SAVE DISPLAY; gruppen felar → held-by utelämnas, allt annat oförändrat.
  Spec F9.3 nämner även "Earn your first badge to put it on display." för tomläget, men F9.8 och manifestet ersätter remsan med rutan: meningen ritas inte (rutan säger redan att inget är intjänat).
- **CSS** — eget block sist i `badges.css` ("Badges-sidan"): `.rq-badges*` (sidhuvud, rytm `--rq-gap-stack`), `.rq-badge-strip*` (remsan), `.rq-badge-note` (sparat/fel, 3 px tillståndskant `--rq-up`/`--rq-down`), `.rq-badge-retry`. Ingen opacity; sammansatta selektorer där `.rq-btn`/`.rq-back` överstyrs.
  `--rq-badge-pick-hit` (namnet historiskt) behålls: växlare, SAVE DISPLAY, RETRY och tillbaka-länken läser den. `--rq-badge-grid-cols` och `.rq-badge-grid` togs bort i RUN-151.

### Förhandsvisning

`/preview/badges` (`pages/BadgesPreviewPage.tsx`, stil i `pages/preview/badgeSheet.css`): F1-arket med de riktiga komponenterna — sex nivåkort, matrisen 8 × 6, låsta, storlekar, 1:1 på panel,
Heroic-kontrollen och en rörelserad med Replay. Utan inloggning. Designens alternativrad (Heroic amber, Legendary orange) byggs inte (ägarbeslut S1/S2).
