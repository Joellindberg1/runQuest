# Badges — designdokument (Jira RUN-2, S1, spår: design-ny)

**Ändringslogg**

- **2026-10-11 (kväll): v2, ägarens omritning (badge-design v2 i Claude Design) inarbetad som toppavsnitt `## v2 …` nedan.** Ägarbeslut 1–5 och Lead-besluten för konflikterna med Council-villkoren är en del av spec:en. v2 gäller FÖRE v1 där de krockar (krocktabell: V2.9). Avsnitt 0–13 är oförändrade och gäller för allt v2 inte nämner.
- **2026-10-11: Design Council + ägarbeslut inarbetade.** Council (alla fem röster: godkänt med villkor, 25 villkor) och ägarens beslut (E1/E2 Rörelse-undantaget i STATE.md, F3/F4 desktop = mobilpanelen i 340 px-kolumn, Night Owl nivå 6 = "23:30–00:29") är nu en del av spec:en. Där en referensbild (f1–f8) och ett villkor säger olika saker gäller VILLKORET; avsnitt 12 listar varje sådan krock. Gäller bygget RUN-127 och framåt (byggordning: avsnitt 13).
- 2026-10-11: första versionen (efter Claude Design-retur, före Council).

Designern 2026-10-11. Underlag: ADR 009 (godkänd 2026-10-11), ägarens Claude Design-retur (export 2026-10-11, se avsnitt 0), Design Councils dom (2026-10-11), STATE.md (Designspråk, Rörelse), `docs/design/designsprak-forslag.md`, `docs/design/temafil-forslag.css`, `packages/shared/src/badges.ts`.

**Status: facit finns (beslut 25/38) och Design Council har dömt: GODKÄNT MED ÄNDRINGAR.** Referensbilderna är sanningen om layout och uttryck; villkoren i den här filen går före bilden där de uttryckligen ändrar den (avsnitt 12). Alla åtta vyer är KLARA. F3 och F4 saknar egen desktopbild; ägaren har godtagit noteringen "samma panel som mobil i 340 px sidokolumn" (avsnitt 10). Ingenting här ändrar kod, `index.css` eller `temafil-forslag.css`: tokens skrivs in i RUN-127.

> **v2-tillägg (2026-10-11 kväll):** v1 ovan är byggd i v0.6.0 (RUN-127–132). v2 ersätter v1:s F2 (samlingen i profilen), F3 (väljaren), F4 (Runner card-panelen), F5:s minis-/ribbon-placering, S4 (placeringar), glöd-/färgtabellerna i §3 och tokenblocket i §5. Läs det nya avsnittet `## v2` först.

Det levande projektet: https://claude.ai/design/p/23754cb4-e3ec-4cd3-8cd8-4be2f0167208?file=RunQuest+Badge+System.dc.html

---

## v2 (ägarens omritning 2026-10-11) — gäller före v1 där de krockar

**Status: KLAR att bygga. Ej dömd av Design Council** (Lead avgör om v2 går som helhet till Council: de nya avvikelserna står i V2.10). Facit är ägarens HTML-export (beslut 38: "HTML-exporten och/eller skärmdumpar"); ingen ny PNG är renderad av Designern, se V2.12. Ingen backend, inget API och ingen ADR ändras: `GET /api/badges/user/:id`, `GET /api/badges/group`, `PUT /api/badges/showcase` och `POST /api/badges/seen` är oförändrade. ADR 009 står kvar (ingen global percentil, allt gruppavgränsat).

### V2.0 Beslut och företräde

**Ägarbeslut 2026-10-11 (gäller, ifrågasätts inte):**

| # | Beslut |
|---|---|
| O1 | v2 går in i v0.6.0. |
| O2 | INGEN global procent. "N% globally" och "Global — N% has it" stryks överallt (kort, tooltips, popover). Räknaren är bara "Held by X of N in your pack" (ADR 009, gruppavgränsad). |
| O3 | Show / On display-knappar direkt på korten på badges-sidan ERSÄTTER den separata väljaren (`ShowcasePicker`, RUN-129). Badges-sidan är det enda stället där man väljer. Profilen visar en kompakt rad plus "All badges →". |
| O4 | De dämpade nivåfärgerna och den svagare glöden ur `runquest-badges.js` gäller exakt (Heroic `#d97070`, Legendary `#e3c23e` …). Den nya 44 px-storleken gäller. |
| O5 | Badges-sidan har egen route `/badges`. Desktop: sidonav YOU → Badges (ikon `shield`). Mobil: "All badges →" på profilen (mobilnaven ändras inte). |

**Lead-beslut för konflikterna (Council-tillgänglighet behålls där designen krockar):**

| # | Beslut |
|---|---|
| L1 | Held-by visas INTE på låsta kort (Council 1). |
| L2 | Kravtexten har inget nivåprefix; flavor på egen rad på intjänade kort (Council 2). |
| L3 | Vid 3 av 3: läsbar text "3 of 3 on display — remove one first."; övriga knappar `aria-disabled`; det är knappen som dimmas, inte kortet (Council 17). |
| L4 | Nivån måste synas utan tooltip (Council 5/14): på kompakta rutnät via tryck/klick-popover (F10/F11, motivering i F10.4). |
| L5 | Legendary andas bara i md/lg (56/96), aldrig i 44 px eller sm (STATE-undantaget). Tändning (`ignite`) gäller bara i popupen. |
| L6 | "Tre storlekar" blir fyra: 28/44/56/96 (formulering: V2.11). |
| L7 | Ägarens nya placeringar gäller och ersätter S4/340 px där designen säger annat (profil, Runner card, Board). |
| L8 | Vimpeln (svalstjärt) ersätter skölden som utmaningstecken; den får aldrig stå i samma behållare/rad som minis (F12.4). |
| L9 | "in your pack" överallt. `shield` används både för Badges och Admin (OK). Mobilprofilens hjältekort följer designen: **inga minis där** — de tas bort (F10.6). |

**Företräde när källor krockar:** O1–O5 > L1–L9 > Council-villkoren (manifestet och v1 §12) > ägarens v2-design (HTML, V2.1) > v1. Designens hex, glöd och mått gäller exakt (O4). Designens layout gäller utom där ett villkor ovan kräver annat; varje sådan krock står i V2.9.

### V2.1 Facit — var designen ligger (radreferenser)

Filerna är ägarens byte-exakta exporter (2026-10-11). Radnumren gäller dessa kopior; de ska in i repot under `docs/design/claude-design/` i byggsteg 1 (V2.13) med repots filnamn nedan, och radnumren är då oförändrade. Kopiorna ligger tills vidare i `…/scratchpad/design-delta/design/` (`app-full.html`, `web-full.html`, `badge-system.dc.html`, `runquest-badges.js`). Obs: repots nuvarande `RunQuest Web Prototype.dc.html` är avkapad (markör `…[+18977 bytes truncated` på rad 3045) och måste ersättas av den hela kopian.

| Repo-filnamn | Scratch-kopia | Avser |
|---|---|---|
| `runquest-badges.js` | `runquest-badges.js` | **Källa för färg, mått, glöd och vimpel.** Nivåfärger `TIERS` 14–21 (gradienter 15–20); `SIZES` 24–29; glöd i `emblem()` 38–47 och `emblemNode()` 130–143 (glödrader 136–137); `chip()` 59–64; `pips()` 66–70; `pennant()` 106–128; `minis()` 145–152. |
| `RunQuest App Prototype.dc.html` | `app-full.html` | Mobil. |
| `RunQuest Web Prototype.dc.html` | `web-full.html` | Desktop. |
| `RunQuest Badge System.dc.html` | `badge-system.dc.html` | Vimpeln: 305, 327, 351–368, 573, 639–643, 678–688. Övrigt oförändrat sedan v1. |

| Vy | Mobil (`app-full.html`) | Desktop (`web-full.html`) |
|---|---|---|
| F9 Badges-sidan, mall | 1282–1321 (sidhuvud 1284–1290, remsa 1293–1297, kort 1299–1316) | 567–603 (sidhuvud 568–575, remsa 576–581, rutnät 582, kort 584–599) |
| F9 data: `badgePage()` (kortstil, växlarlägen, `onToggle`) | 1613–1645 (kortkant 1629, växlartext 1631, växlarstil 1632–1636, toggle 1637–1642) | 1719–1751 (kortkant 1735, växlartext 1737, växlarstil 1738–1742) |
| F9 spara-knappen | 3232–3235 | 3336–3340 (`goBadges` 3340) |
| F10 Profil, sammanfattning | 1480–1489 (efter MY TITLES 1463–1478, före RUN HISTORY 1491); data `profBadges` 1653–1660, `profLocked` 1646–1652 | 502–515 (huvudkolumnen efter statflikarna 432–500; MY TITLES i 340 px-kolumnen från 518); data 1708–1715, 1752–1758 |
| F10 hjältekort (minis) | **inga minis** (1371) | 387 (`heroBadgeMinis`) |
| F11 Runner card, panel | 494–502 (efter TITLES HELD 478–492, före Head to head 504–514); data 3224–3231; hjältens minis 432 | 1639–1651 (BADGES) + 1653–1663 (Head to head) i nedre rutnätet `1fr 340px` (1639); data 1953–1971; hjältens minis 1563 |
| F12 Board | podium 222; rest-rad 276–285 (minis 278, högerkolumn 281–285, vimplar 284); data 2788–2808 | podium 190; rest-rad 243–246 (minis i sub-raden), 261–264 (Last run + vimplar) |
| F12 vimpeln | `ribbon()` 1663 → `pennant()` | `ribbon()` 1761 |
| F14 navigering | `backMap` 1713 (`badges: 'you'`); skärmlista 3376 | `navYou` 1854–1858 (Badges, `shield`, mellan Profile och Log Runs) |

### V2.2 Storleksord (fyra storlekar)

| Designens namn | Kodens suffix | Bredd × höjd | Ikon | Används i |
|---|---|---|---|---|
| mini | `sm` | 28 × 31 | 15 | hjältens namnrad, Board, ON DISPLAY-remsan på badges-sidan, News, popupens "gamla nivå" |
| small | **`cp`** (compact, NY) | **44 × 49** | **20** | profilens sammanfattning (F10), Runner card-panelen (F11) |
| medium | `md` | 56 × 63 | 24 | kort på badges-sidan (F9), skeleton |
| large | `lg` | 96 × 108 | 42 | popupen |

Suffixet `cp` väljs eftersom `sm` redan betyder designens "mini" i koden och `ml` redan betyder "md + lg" i glödtokens. Höjd = `round(bredd × 1.12)`: 49. Komponenten: `BadgeSize = 'sm' | 'cp' | 'md' | 'lg'`.

---

### F9 — Badges-sidan (`/badges`) · mobil + desktop

Ny helsida, enda stället där man väljer vilka badges som visas (O3). Ersätter profilens samling (v1 F2) och väljaren (v1 F3).

**F9.1 Komponentträd och filer** (`apps/frontend/src/features/badges/…`)

```
pages/BadgesPage.tsx                       tunn: <BadgesScreen />
components/BadgesScreen.tsx                NY. Datahämtning, sidhuvud, remsa, rutnät, tillstånd
  ├─ BadgeDisplayStrip.tsx                 NY. ON DISPLAY-remsan + SAVE DISPLAY + statusrader
  ├─ BadgeSeriesCard.tsx                   ÄNDRAS: liggande kort + växlare (F9.5)
  │    ├─ BadgeEmblem (md)                 oförändrad
  │    ├─ BadgeChip, BadgePips             oförändrade
  │    └─ växlaren (knappen)               del av kortet
  └─ ErrorState / skeleton / tomruta       återanvänds (F8)
hooks/useShowcaseDraft.ts                  NY. Utkast + spara (logiken ur ShowcasePicker)
badgeModel.ts                              oförändrad här (buildCollection, toggleShowcase, cleanShowcase, sameShowcase)
```

`BadgesScreen` hämtar `useUserBadges(user.id)` och `useGroupBadges(!!user)` och bygger `rows = buildCollection(userBadges.data, groupBadges.data, { viewerId: user.id, ownerId: user.id })`. Ett gruppfel utelämnar bara held-by-raden (som i v1). `useShowcaseDraft(rows, userId)` ligger i en egen hook-fil och anropar `useSaveShowcase`; den får inte anropa `badgesApi` eller skriva query-nycklar (vakttestet i `guards.test.ts`).

**F9.2 Sidhuvud**

| | Mobil (< 1024) | Desktop (≥ 1024) |
|---|---|---|
| Ram | I innehållet (inte en egen sticky list som i prototypen; skalet har redan sin topprad, jfr `NewsScreen`). Vänster: tillbaka-länk `‹` till `paths.profile` (`<Link className="rq-back" aria-label="Back to profile">`, glyfen `aria-hidden`, tryckyta ≥ `--rq-badge-pick-hit`). | Ingen tillbaka-länk (sidonavens aktiva rad bär orienteringen). |
| Rubrik | `<h1 className="rq-display">BADGES</h1>` (Bebas; token `--rq-fs-display`, 26 px — designens 21 snappas till tokenstegen). Under: "{N} of {BADGE_SERIES.length} series unlocked" i `--rq-fs-label`, versaler, `--rq-ls-tab`, `--rq-text-4`. | `h1` BADGES (`--rq-fs-display` 34). Under: "Eight series, six tiers. Anyone can hold a badge — you see your best tier per series." (`--rq-fs-meta`, `--rq-text-3`). Höger, i linje med rubriken: samma "{N} of 8 series unlocked" i `--rq-font-mono`, `--rq-fs-label`, `--rq-ls-label`, versaler, `--rq-text-4`. |

N = antal intjänade serier. Under laddning och fel utelämnas räknaren (inget "0 of 8"). "Eight"/"six" skrivs som ord i copyn; ett test kräver att de motsvarar `BADGE_SERIES.length` och `MAX_TIER` (så texten inte driftar).

**F9.3 ON DISPLAY-remsan** (`BadgeDisplayStrip`, `role="group" aria-label="On display"`)

- Yta: `--rq-panel`, kant `--rq-hair solid rgb(var(--rq-gold-rgb) / var(--rq-edge-soft))` (designens .26 snappas till `--rq-edge-soft` .30). Guldkanten är rollguld, inte Legendary.
- Innehåll i en flex-rad som får radbrytas: etikett "On display" (`--rq-font-mono`, `--rq-fs-eyebrow`, `--rq-ls-chip`, versaler, `--rq-text-3`) · `BadgeMinis` med UTKASTET i vald ordning (sm-emblem, `role="img"` "Badges: …", se F9.7) · desktop: hjälptexten "Shown on your Board card and next to your name — pick up to 3 below." (`--rq-fs-meta`, `--rq-text-3`) · längst till höger SAVE DISPLAY.
- Tomt utkast: inga minis (ingen platshållare). Mobil visar då "Pick up to {MAX_SHOWCASE} badges to show on the Board." (`--rq-fs-meta`, `--rq-text-3`); desktop har redan hjälptexten. Inget intjänat alls: "Earn your first badge to put it on display." (båda) och SAVE DISPLAY är `aria-disabled`.
- **SAVE DISPLAY** = `.rq-btn.rq-btn--secondary.rq-btn--compact` (guld-hårlinje; den enda "guldknappen" på sidan, sekundär som på Titles). Alltid `aria-disabled` (inte `disabled`, så fokus aldrig faller till body) när den inte kan tryckas; klicket spärras i hanteraren. Tryckyta ≥ `--rq-badge-pick-hit`. Etiketter:

| Läge | Villkor | Etikett | `aria-disabled` |
|---|---|---|---|
| Osparat | utkast ≠ sparat | `SAVE DISPLAY` | nej |
| Sparar | mutation pågår | `SAVING…` | ja |
| Rent | utkast = sparat (inkl. efter lyckad spara) | `SAVED` (designens grå läge; text `--rq-text-4`, kant `--rq-line-4`) | ja |

- Under remsan, som egna rader med `--rq-sp-8` mellanrum (permanenta behållare så att live-regioner finns före texten):
  1. `aria-live="polite"`: vid utkast = 3: `<p id=…>3 of 3 on display — remove one first.</p>` (synlig hela tiden så länge det gäller, `--rq-fs-meta`, `--rq-text-2`), plus en `sr-only`-rad med senaste ändringen ("{Serie} added to display, position N." / "{Serie} removed from display.").
  2. `role="status"`: efter lyckad spara "Saved — your Board card is updated." (panelrad med 3 px vänsterkant `--rq-up`, samma recept som `.rq-badge-pick__note`). Försvinner när utkastet ändras.
  3. `role="alert"`: vid fel "Could not save. Your pick is still here — try again." + textlänken RETRY (kant `--rq-down`). Semantisk röd, aldrig nivåfärg.

**F9.4 Rutnät**

`<ul aria-label="Badge series">` med åtta `<li>` i `BADGE_SERIES`-ordning (låsta också), ett `BadgeSeriesCard` per serie. Layout i F9.9.

**F9.5 Kortet (`BadgeSeriesCard` v2)**

Anatomi (ett CSS-grid per kort, områden ur `--rq-badge-card-areas`, kolumner `auto minmax(0, 1fr)`, `column-gap --rq-sp-12`, padding `--rq-pad-card`, bakgrund `--rq-row-soft`):

```
mobil     [ emblem md ][ who: NAMN  CHIP         ]      desktop   [ emblem md ][ who: NAMN       ]
          [           ][      pips                ]                [           ][      CHIP       ]
          [           ][ body: krav                ]                [           ][      pips       ]
          [           ][      flavor               ]                [ body: krav (hela bredden)    ]
          [           ][      Next / TOP TIER      ]                [       flavor                 ]
          [           ][ held-by …      [ växlare ] ]                [       Next / TOP TIER        ]
                                                                    [ held-by …        [ växlare ] ]
```

- **Mobil:** `who` = namn och chip på samma rad (`flex-wrap`), pips under. Emblemet spänner över `who` + `body`. **Desktop:** `who` = namn, chip under, pips under det; `body` spänner under emblemet över hela kortets bredd. Mönstret: `--rq-badge-card-areas` = `"emblem who" "emblem body"` (mobil) / `"emblem who" "body body"` (desktop).
- **Text (v1-reglerna gäller, L1/L2):** serienamn versaler (`.rq-name`, `--rq-text-1`); `BadgeChip`; `BadgePips` ("Tier N of 6", ej dekorativ på intjänade). *Intjänat:* kravtext UTAN nivåprefix (`--rq-fs-meta`, `--rq-text-2`) → flavor på egen rad, citerad kursiv, Barlow Condensed, `--rq-fs-body`, `--rq-text-1` → `"Next: {Tier} — {krav}"` (`--rq-fs-meta`, `--rq-text-3`) eller guld versal "TOP TIER REACHED" → held-by (`--rq-font-mono`, `--rq-fs-eyebrow`, `--rq-text-4`, "Held by X of N in your pack" / "Only you hold this in your pack", utelämnas utan platshållare). *Låst:* streckad kant, Locked-chip, tomma pips (dekorativa), måttetiketten, `"Unlock: Common — {krav}"`; **aldrig** held-by, flavor eller Next. Allt kommer färdigt ur `BadgeRow`; kortet skriver aldrig en platshållare eller "undefined".
- Designens textfärger (.55/.40/.35 vid 9–13 px) underskrider Council 9 och snappas till tokenstegen ovan; designens 9 px mobil-held-by blir `--rq-fs-eyebrow` 11 px.
- **Kantstyrkor:** vald (i utkastet): guldkant `rgb(var(--rq-gold-rgb) / var(--rq-edge-soft))` (designens .35 → .30), `data-display="true"`. Låst: streckad `--rq-line-5`. Övriga: `--rq-line-3`. Kortet dimmas aldrig (L3).
- Kortets enda interaktiva element är växlaren (nästa avsnitt). Själva kortet är inte klickbart.

**F9.6 Växlaren** (`<button type="button">` med `aria-pressed`; mål ≥ `--rq-badge-pick-hit`, mobil 44 / desktop 24)

| Läge | Villkor | Synlig text | Attribut | Utseende (tokens) |
|---|---|---|---|---|
| Show | intjänad, ej i utkastet, utkast < 3, ej sparar | `Show` | `aria-pressed="false"` | kant `--rq-line-5`, text `--rq-text-3`, hover `--rq-line-hover` / `--rq-text-2` |
| On display — N | i utkastet (N = plats 1–3) | `On display — N` | `aria-pressed="true"` | tint `--rq-tint-status`, kant `--rq-edge-status`, text `--rq-gold-text` (guldrecept som v1:s väljare) |
| Fullt (L3) | intjänad, ej i utkastet, utkast = 3 | `Show` (kvar) | `aria-pressed="false"` `aria-disabled="true"` `aria-describedby={id på 3-av-3-raden}` | **knappen** dimmas: bakgrund `--rq-fill-1`, kant transparent, text `--rq-text-5`, `cursor: not-allowed`. Kortet och texten dimmas inte. |
| Sparar | mutation pågår | oförändrad | alla växlare `aria-disabled="true"`, klick ignoreras | icke-valda dimmas som "Fullt"; valda behåller guldutseendet |
| Låst | ej intjänad | `Locked` | **ingen knapp**: `<span aria-hidden="true">`, streckad kant | text `--rq-text-5`; chippet "Locked" och kortet bär betydelsen |

Knappens tillgängliga namn: osynlig text "{Serie}: " före den synliga texten (`sr-only`), så namnet är unikt och innehåller den synliga texten ("Climber: Show"). Ett aria-disabled-läge ligger kvar i tabbordningen så att skälet kan läsas. Designens "3 of 3" / "3 of 3 on display" som knapptext byts mot den synliga meningen i remsan (L3).

**F9.7 Utkast och spara** (`useShowcaseDraft`; logiken ur `ShowcasePicker`, utan UI)

- Tillstånd: `picked: string[] | null`. `null` = "följ det sparade" (inget utkast). Utkastet `draft = cleanShowcase(picked ?? saved, owned)` beräknas vid varje rendering, så en serie som försvunnit (nedgradering) varken syns eller skickas. `saved` = serierna med `displayPosition` i sparad ordning. `dirty = !sameShowcase(draft, saved)`. `full = draft.length >= MAX_SHOWCASE`.
- Växling: `toggleShowcase(draft, owned, series)` (lägger sist, max 3, bara ägda). **Ingen omsortering**: ta bort och lägg till igen; platsnumret = ordningen. Ignoreras medan sparar pågår.
- Spara: `await save(draft)` (hooken `useSaveShowcase` skriver optimistiskt, återställer vid fel, låter serverns värde vinna och invaliderar min samling + gruppen, så Board-minis, hjältekort och Runner card följer med). Lyckat → `picked = null` (följ sparat), status `saved`. Fel → status `error`, `picked` kvar (utkastet bevaras; hooken återställer samlingen, inte utkastet).
- RETRY flyttar fokus till SAVE DISPLAY innan felraden försvinner och sparar om (som v1).
- Bekräftelsen försvinner vid nästa ändring. Utkastet kastas när man lämnar sidan (ingen "osparade ändringar"-dialog; öppen fråga Q3).
- Utkastet styr kortens `aria-pressed`, `data-display`, "On display — N" och remsans minis, inte serverns `displayPosition`.

**F9.8 Tillstånd** (alla ska finnas; F8-ytorna återanvänds)

| Tillstånd | Villkor | Visas |
|---|---|---|
| Laddar | `userBadges.isLoading` | Sidhuvud utan räknare. Ingen remsa. Tre skelettkort (`.rq-badge-skel`, 56 × 63-sköld + tre streck, `rqSkel` 1.6 s, stagger .2 s) i samma rutnät, `role="status"` + `sr-only` "Loading badges". Reduced-motion: stilla block. |
| Fel | `isError && !data` | `ErrorState` "Couldn't load your badges" / "Your runs are safe." / Retry (`refetch`) i stället för remsa + rutnät. Sidhuvudet kvar utan räknare. En misslyckad bakgrundsomhämtning låter gamla data stå kvar. |
| Tomt | lyckat svar, 0 intjänade | Streckad F8-ruta ("No badges yet" / "Log a run to start collecting.", utan de åtta minisen) i stället för remsan, därunder åtta låsta kort (krav synliga). SAVE DISPLAY visas inte. |
| Normal | ≥ 1 intjänad | Remsa + rutnät. |
| Sparar | mutation pågår | SAVE DISPLAY = `SAVING…`; växlare enligt F9.6. |
| Sparat | efter lyckad spara | Etikett `SAVED`; `role="status"`-raden F9.3. |
| Fel vid sparning | mutation fel | `role="alert"`-raden + RETRY; utkastet kvar; etikett `SAVE DISPLAY` (osparat). |
| Gruppen felar | `groupBadges.isError` | Held-by utelämnas på alla kort; allt annat oförändrat. |

**F9.9 Responsiv layout**

- Rutnätet: `grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--rq-badge-page-card-min)), 1fr))`, `gap: var(--rq-badge-page-gap)`. Tokens: `--rq-badge-page-card-min` mobil **300px** / desktop **240px**; `--rq-badge-page-gap` mobil `var(--rq-sp-8)` / desktop `var(--rq-sp-12)`.
- Resultat: telefon (≈ 390–402) **1 kolumn**; 1440 **4 kolumner** (designen, kort ≈ 270 px); 1280 → 3, 1024 → 2 (designen visar bara 402 och 1440; mellanbredderna är ett antagande, Q4). Mobilskalet på 640+ ger 2 kolumner.
- Sidans vertikala rytm: `--rq-gap-stack` mellan sidhuvud, remsa, statusrader och rutnät.
- Bytet mobil/desktop (kortets områden, texten i sidhuvudet) följer skalets brytpunkt (`useIsDesktop`, ≥ 1024); kortets områden styrs av token, inte av JS.

**F9.10 Tillgänglighet** (Council 5, 9, 14, 17 gäller sidan)

- Landmärken: en `<h1>`; remsan `role="group"` med etikett; listan `<ul aria-label="Badge series">`; kortrubrik `<h3>` (serienamnet).
- Växlare: se F9.6 (`aria-pressed`, `aria-disabled` + `aria-describedby`, unikt namn). Mål ≥ 44 px mobil / ≥ 24 px desktop.
- Live-regioner (`aria-live="polite"`, `role="status"`, `role="alert"`) finns som permanenta behållare innan texten monteras.
- Fokus: inget auto-fokus vid sidladdning. Växlaren behåller fokus vid växling (elementet avmonteras inte). RETRY → SAVE DISPLAY. Efter att fel-/tomläge byts mot innehåll tappas inget fokus (inget fokuserat element ersätts).
- Nivå aldrig av färg ensam: chip + "Tier N of 6" + Heroic-ring på varje kort.
- All informationstext ≥ 4.5:1 och ≥ 11 px; ingen opacity-dimning av text; undantag: avaktiverade kontroller (växlare i läge Fullt/Sparar, "Locked"-rutan, SAVED-knappen).
- Chip-kontrast med de nya färgerna (DELTA: Rare 4.95, Heroic 4.84 mot #181818). Mot den faktiska kortbakgrunden (panel + `--rq-row-soft`, ≈ #1b1d1c) beräknar Designern ≈ 4.6:1 för Rare och Heroic: över 4.5 men med liten marginal. **Byggaren mäter i skärmdump; under 4.5:1 → eskalera till Designern** (ingen egen färgjustering).

**F9.11 Rörelse**

Inga nya animationer. Legendary `md`-emblem på korten andas tre cykler när de monteras (STATE-undantaget; L5), sedan statisk glöd; `cp` och `sm` är statiska; ingen tändning. `prefers-reduced-motion: reduce`: ingen andning, statisk glöd (befintlig CSS). Skelettet är den enda loopen.

**F9.12 Acceptans (kritikern)**

- Inga strängar "globally", "%", "has it" någonstans i `features/badges/` (test).
- Låst kort: ingen held-by, ingen flavor, ingen Next. Intjänat kort: kravraden börjar inte med ett nivånamn; flavor i egen `<p>`.
- 3/3: synlig mening finns, övriga växlare `aria-disabled` + `aria-describedby`, kortet saknar dimning (ingen `opacity` i badges.css).
- Spara-flödet i alla sex lägen enligt F9.8, inkl. RETRY-fokus.
- 402 och 1440 px: skärmdumpar mot radreferenserna i V2.1 sparas som `docs/design/badges/reference/v2-f9-built-*.png`.

---

### F10 — Profilens kompakta sammanfattning (`BadgeSummary`)

Ersätter `BadgeCollection` + `ShowcasePicker` på profilen. Profilen väljer ingenting längre; den visar och länkar.

**F10.1 Placering (ersätter S4)**

- **Mobil:** i flödet *efter MY TITLES, före RUN HISTORY* (`app-full.html` 1480–1489). Ordning: hjältekort · Frodo · statflikar · MY TITLES · **BADGES** · RUN HISTORY.
- **Desktop:** i huvudkolumnen *efter statflikarna* (`web-full.html` 502–515); MY TITLES och RUN HISTORY ligger kvar i 340 px-kolumnen.
- Implementation i `ProfileScreen`: `BadgeSummary` renderas på EN plats åt gången — `{isDesktop && summary}` sist i `.rq-profile__main`, `{!isDesktop && summary}` mellan `TitlesPanel` och `RunHistory` i `.rq-profile__side` (mobilens kolumn staplar main → side). `pickerOpen`, `editRef`, `closePicker` och bägge väljarplatserna tas bort.

**F10.2 Anatomi**

| | Mobil | Desktop |
|---|---|---|
| Ram | **Ingen kortyta** (som designen, 1480): ett vanligt block i kolumnen. | `.rq-card` (`--rq-pad-card`). |
| Rubrik | Eyebrow "Badges · {N} of {8} series" (`--rq-fs-eyebrow`, versaler, `--rq-ls-label`, `--rq-text-eyebrow`; ingen sköld/ikon). | Bebas guld "BADGES" (`.rq-title`, ingen ikon) + "{N} of 8 series" (`--rq-fs-label`, versaler, `--rq-text-4`). |
| Länk | **"All badges →"** längst till höger i rubrikraden (tillägg mot designen, O5: mobil saknar annars ingång). | "All badges →" längst till höger (`web-full.html` 506). |
| Länkstil | `<Link to={paths.badges} className="rq-btn rq-btn--ghost rq-btn--compact">`, tryckyta ≥ `--rq-badge-pick-hit`. Ghost = hårlinjekant; inte en guldknapp. | samma |

**F10.3 Innehåll**

- Rad 1: intjänade serier som `cp`-emblem (44 px), **sorterade på nivå fallande**, lika nivå i serieordning (`buildBadgeSummary(rows)`, ny ren funktion i `badgeModel.ts`, ger `{ earned, locked }`). `flex-wrap`, `gap --rq-sp-8` (designens 8/9). Ingen visad-först-sortering här (designen sorterar på nivå).
- Under en hårlinje (`border-top: --rq-hair solid --rq-line-2`, `padding-top`/`margin-top --rq-sp-8`): de låsta som `cp`-emblem (låst utseende) + texten "Locked · {n} left" (mobil) / "Locked · {n} series left" (desktop) i `--rq-fs-eyebrow`/`--rq-fs-label`, versaler, `--rq-text-4` (designens .30 snappas för 4.5:1). n = antal låsta. Inga låsta → raden och hårlinjen utelämnas.
- Varje emblem är en `BadgeEmblemDetail` (F10.4). Raderna är `<ul aria-label="Earned badges">` resp. `<ul aria-label="Locked badges">` med `<li>` per emblem.
- Inga procent, ingen global siffra någonstans (O2).

**F10.4 Nivån utan tooltip — popover per emblem (L4)** (`components/BadgeEmblemDetail.tsx`, delas med F11)

*Val:* tryck/klick-popover i stället för synlig text under varje emblem. *Motiv:* (1) närmast designen — den ritar nakna 44 px-emblem med detaljerna i `title`; en popover är samma information med samma täta utseende, men nåbar med tryck och tangentbord; (2) text under varje emblem ("LEGENDARY") gör varje cell ≈ 72 px bred och cellerna högre, så en rad med 5 + 3 emblem bryts till flera rader och sammanfattningen slutar vara kompakt; (3) chip per emblem har samma problem; (4) Council 5 godtog redan `sm`-minis där nivån bärs av `aria-label` + Heroic-ring + position; popovern gör att den fulla nivåtexten alltid är ett tryck bort. *Restrisk:* en seende användare som inte trycker ser bara färg + ring + sorteringsordning (samma som Board-minis). Council bekräftar (V2.10).

- Utlösaren: `<button type="button">` med det **dekorativa** `cp`-emblemet inuti (`BadgeEmblem decorative`). `aria-label` = "{Nivå} {Serie}" ("Rare Milestoner"), låst "Locked {Serie}" (samma sträng som emblemets egen etikett). Ingen `title` (dubbelläsning). Radix Popover ger `aria-haspopup="dialog"`, `aria-expanded`, `aria-controls`. Tryckyta = emblemet (44 × 49, uppfyller 44 px); hover: kant `--rq-line-hover` (emblemet får en tunn ram runt knappen, inget glödbyte).
- Innehållet (`.rq-popover`, `role="dialog"` via Radix, `aria-label` = serienamnet, bredd `--rq-badge-detail-w`, `sideOffset` 8 som `AvatarMenu`):
  1. Intjänad *och* i sparade valet: eyebrow "On display" (mono, `--rq-fs-eyebrow`, `--rq-gold-text`). (Ersätter "On display"-markören som v1:s Runner card-rad hade.)
  2. Serienamn (`.rq-name`) + `BadgeChip` på samma rad.
  3. `BadgePips` ("Tier N of 6", ej dekorativ).
  4. Kravtext (utan nivåprefix, `--rq-text-2`).
  5. Flavor på egen rad (citerad kursiv, Barlow Condensed, `--rq-fs-body`, `--rq-text-1`).
  6. Held-by (mono, `--rq-fs-eyebrow`, `--rq-text-4`) när `row.heldBy` finns (modellens regler: aldrig på låsta, X = N göms på andras kort).
  7. *Låst:* Locked-chip, måttetiketten, `"Unlock: Common — {krav}"`; ingen flavor, ingen held-by.
  Ingen Next-rad (kompakt; den finns på badges-sidan). Ingen global siffra. Ingen animation.
- Beteende: tryck/Enter/Space öppnar; Esc, tryck utanför eller ett nytt tryck stänger; fokus flyttar in i innehållet vid öppning och tillbaka till knappen vid stängning (Radix); en öppen popover åt gången. Kantkollision hanteras av Radix (`collisionPadding` = en konstant på samma nivå som `AvatarMenu`).

**F10.5 Tillstånd**

| | |
|---|---|
| Laddar | En rad med fem `cp`-stora skelettblock (`.rq-badge-skel__shape` i `--rq-badge-w-cp`/`--rq-badge-h-cp`, samma pulsning) + `role="status"` "Loading badges". Rubriken visas utan räknare. |
| Fel | `ErrorState` ("Couldn't load your badges" / "Your runs are safe." / Retry) i stället för rader; rubriken kvar. Ett badgefel fäller aldrig resten av profilen. |
| Tomt (0 intjänade) | Streckad ruta med "No badges yet. Log a run to start collecting." i stället för rad 1; låsta raden visar alla åtta ("Locked · 8 left"). |
| Gruppen felar | Popovern utelämnar held-by. |

**F10.6 Hjältekort (L9)**

Mobilprofilens hjältekort har **inga minis** i designen (`app-full.html` 1371) och tas bort: `ProfileHero` ritar inte `.rq-badge-nameline`-omslaget på mobil, bara `<h1>` (ingen `min-height`-reserv). **Desktop behåller** minis efter namnet (`web-full.html` 387) i `.rq-badge-nameline` med reserven. `showcase` skickas bara till desktop (`isDesktop ? showcase : undefined`). Runner card och Board behåller sina minis (mobil och desktop). Designern bedömer att mobilnavet kvarstår oförändrat (O5).

**F10.7 Acceptans:** DOM-ordning mobil = hjälte · Frodo · stats · titles · badges · history; desktop badges sist i `main`. Länken når `/badges`. Popovern öppnas med tangentbord och återför fokus. Inga väljar-/Edit-element finns kvar.

---

### F11 — Runner card, kompakt panel (`BadgePanel` omarbetad)

**F11.1 Placering (ersätter S4/F4/340 px-kolumnen)**

- **Mobil:** *efter TITLES, före Head to head* (`app-full.html` 494–502).
- **Desktop (modalen 860 px):** i ett nytt **nedre rutnät `1fr 340px`** under raden statflikar | titlar: BADGES till vänster, Head to head till höger (`web-full.html` 1639–1663). Det ersätter den gamla BADGE SHELF i sidokolumnen. 340 px kontrolleras (samma `--rq-runner-split-cols` som raden ovanför).
- Implementation i `RunnerCard`: en enda DOM-ordning för båda bredderna, utan `isDesktop`-villkor för panelen: `hero · journey · .rq-runner__split(StatsPanel | .rq-runner__side(TitlesPanel)) · .rq-runner__lower(BadgePanel | HeadToHeadPanel)`. `.rq-runner__lower` = `display: grid; grid-template-columns: var(--rq-runner-split-cols); gap: var(--rq-gap-stack); align-items: start`; `HeadToHeadPanel` `align-self: stretch` på desktop (designen 1653). Mobil staplar stats · titles · badges · h2h. Utan `me` (ingen H2H) tar panelen första kolumnen ensam. `wide`-variabeln i `RunnerCard` och panelens plats i `.rq-runner__side` tas bort.

**F11.2 Panelen**

- `.rq-card`, huvud: `.rq-title` "BADGES" (Bebas guld, **ingen sköld-ikon**, designen har ingen) + aside "{N} of {8} series" (`--rq-fs-eyebrow`, versaler, `--rq-text-4`).
- Kropp: intjänade serier som `cp`-emblem i en `flex-wrap` med `gap --rq-sp-8`, **ordning oförändrad** (`buildRunnerBadges`: löparens visade först i hens ordning, sedan högst nivå, sedan serieordning; exempel Karl: speedster 5, milestoner 3, night 2, streak 4, earth 2, climber 1). Varje emblem är `BadgeEmblemDetail` (F10.4) — detaljer, nivå och held-by ligger i popovern, inte i panelen. Chip, held-by och "On display" i raden **försvinner** från panelen (designen, fråga F8/F9 i DELTA besvarad genom popovern).
- Held-by i popovern följer v1 (Council 1): göms på andras kort när X = N, alltid utelämnad utan data. Betraktar jag mig själv gäller "Only you hold this".
- Tomläge (lyckat, 0 intjänade): streckad ruta "No badges yet." (båda bredderna). Laddar: `TrackLoader` som förut. Fel: `ErrorState` "Couldn't load badges" med Retry som förut.
- Hjältekortets minis (tre `sm`) oförändrade, mobil och desktop (`app-full.html` 432, `web-full.html` 1563).

**F11.3 Acceptans:** ordningen i DOM och i skärmdump (402 och modal 860) enligt F11.1; panelen innehåller bara emblem-knappar, rubrik och räknare; ingen `.rq-badge-panel__row`/chip i panelen.

---

### F12 — Board: placeringar och vimpel

Bara Season (som v1). Ingen ny data. Tokens: **`--rq-board-minis-inset`** (NY, sektion 1.20 i båda temafilerna): mobil `28px`, desktop `46px` (desktopvärdet i `@media (min-width: 1024px)`-blocket, avsnitt 2).

**F12.1 Podium**

- Minis ligger **högerställda** på namnraden: `margin-left: auto; margin-right: var(--rq-board-minis-inset)` så att de går fria från spöksiffran (`app-full.html` 222, `web-full.html` 190).
- Ordningen på namnraden är oförändrad (namn, delta, minis) och Council 11 gäller: ≥ 8 px mellan deltan och första minin (flex-glappet `--rq-sp-8` räcker eftersom `auto` bara kan öka det). Desktop: rad 1 = "Lvl N" + delta, rad 2 = namn + minis. Reserven `min-height: var(--rq-badge-h-sm)` (Council 10) kvar.

**F12.2 Rest-rader, mobil (`RestList`)**

- Minis på sub-raden efter distansen (oförändrat läge, `app-full.html` 278).
- **Vimplarna står alltid i högra kolumnen under ETA** (`app-full.html` 284), oavsett om raden har minis. Ändring i `SeasonRest.tsx`: ta bort vimplarna ur sub-raden; rendera `<div className="rq-board-cell-ribbons"><ChallengeRibbons/></div>` i högerkolumnen när `ChallengeRibbons` har något att rita (ingen tom behållare). Villkoret `hasMinis && tokensLeft > 0` utgår.

**F12.3 Rest-tabell, desktop (`RestTable`)**

- **Minis flyttar från namnraden till sub-raden** efter "Lvl N · X km" (`web-full.html` 243–246, avstånd `--rq-sp-8`). `RunnerName` står ensam på namnraden; `.rq-board-namerow` och `data-minis`-reglerna för tabellen utgår (podiets `data-minis` kvar).
- **Vimplarna flyttar från sub-raden till Last run-kolumnen under tiden** (`web-full.html` 261–264): cellen blir en kolumn (`display: flex; flex-direction: column; align-items: flex-end; gap: var(--rq-sp-4)`) med texten och `ChallengeRibbons`.
- `min-height: var(--rq-badge-h-sm)` på sub-raden för ALLA rest-rader, både mobil (`.rq-board-sub--list`) och desktop, så raderna inte hoppar när `GET /api/badges/group` landar (Council 10).

**F12.4 Vimpeln (L8)**

`ChallengeRibbons` (`BoardParts.tsx` 61–75) byter form; färger, storlek (22 × 27, `--rq-board-ribbon-w/-h`), antal, `viewBox="0 0 26 32"`, stroke och tokens oförändrade:

| | Före (sköld) | Efter (vimpel med svalstjärt) |
|---|---|---|
| `<path d>` | `M1.5 1.5 H24.5 V21 L13 30.5 L1.5 21 Z` | `M1.5 1.5 H24.5 V30.5 L13 23.5 L1.5 30.5 Z` |
| `<text y>` | `17` | `16.5` |

Konstanterna `PENNANT_PATH` och `PENNANT_TEXT_Y` bor i `BoardParts.tsx`. Geometrin är SVG-data, inte stil. **Sök i hela `apps/frontend/src` efter `M1.5 1.5 H24.5 V21`** (Duels, preview-sidor, tester); alla som ritar utmaningstecknet ska använda samma komponent/konstant. Källa: `runquest-badges.js` 106–128. Tecknet förblir ikonlöst och dämpat (Council 8).

*Kontroll "aldrig på samma rad som minis":* podium mobil/desktop: minis på namnraden, vimplar i foten — olika rader. Rest mobil: minis i mitten-cellens sub-rad, vimplar i högerkolumnens cell. Rest desktop: minis i Runner-cellens sub-rad, vimplar i Last run-cellen — olika celler, ≥ 1 kolumn emellan. Regeln operationaliseras som: **ingen gemensam behållare** (flex-rad/cell/`rq-board-sub`/`rq-board-nameline*`) innehåller både `.rq-badge-minis` och `.rq-ribbons` (test). Obs: i tabellraderna hamnar de visuellt på ungefär samma höjd i olika kolumner (designens val); Q2 frågar om det räcker.

**F12.5 Acceptans:** DOM-test per placering ovan; inget element med både `.rq-badge-minis` och `.rq-ribbons` som ättlingar förutom raden/kortet självt; podiets minis har `margin-right` ur token; stavningen "Challenges to send" och vimplarnas `aria-label` oförändrade.

---

### F13 — Färger, glöd och storlekar (tokens)

**Hårt krav:** `guards.test.ts` jämför tokens ordagrant mot `docs/design/claude-design/runquest-badges.js`. Den nya designfilen och tokens (`apps/frontend/src/index.css` sektion 1.34 OCH `docs/design/temafil-forslag.css` sektion 1.34, ordagrant lika) måste in i **samma commit** som testuppdateringen, annars faller vakttestet.

**F13.1 Nivåfärger** (ersätter raderna 566–583 i `index.css` och 577–594 i `temafil-forslag.css`; facit: `runquest-badges.js` 15–20)

```css
--rq-badge-common-rgb:     157 157 157;
--rq-badge-common:         #9d9d9d;
--rq-badge-common-grad:    linear-gradient(145deg, #b1b1b1, #5e5e5e);
--rq-badge-uncommon-rgb:   73 184 120;
--rq-badge-uncommon:       #49b878;
--rq-badge-uncommon-grad:  linear-gradient(145deg, #71c795, #1d5c38);
--rq-badge-rare-rgb:       95 147 217;
--rq-badge-rare:           #5f93d9;
--rq-badge-rare-grad:      linear-gradient(145deg, #86abdf, #27477f);
--rq-badge-heroic-rgb:     217 112 112;
--rq-badge-heroic:         #d97070;
--rq-badge-heroic-grad:    linear-gradient(145deg, #dd9494, #7e2a2a);
--rq-badge-epic-rgb:       173 131 217;
--rq-badge-epic:           #ad83d9;
--rq-badge-epic-grad:      linear-gradient(145deg, #c3a5e0, #55307a);
--rq-badge-legendary-rgb:  227 194 62;
--rq-badge-legendary:      #e3c23e;
--rq-badge-legendary-grad: linear-gradient(145deg, #edd98f, #e3c23e 45%, #7c661f);
```

Gamla värden (utgår): `#a8a8a8 / #4ade80 / #60a5fa / #f87171 / #c084fc / #ffd700` och deras gradienter. Legendary (`#e3c23e`) och rollguldet `--rq-gold` (`#ffd700`) är nu två olika färger; det stärker Council 6 (Legendary fyller aldrig ytor). Nivåfärgerna förblir egna literaler (inga alias). Alternativen (amber, orange) byggs inte (`ALT` i filen ignoreras; testet förbjuder `#fbbf24`/`#ff9a1f` i temafilen).

**F13.2 Storlekar** (lägg `cp` till; `sm`/`md`/`lg` oförändrade; facit `runquest-badges.js` 24–29)

```css
--rq-badge-w-cp:        44px;
--rq-badge-h-cp:        49px;     /* round(44 × 1.12) */
--rq-badge-icon-cp:     20px;     /* ikonsteg 15/20/24/42 gäller bara inuti emblemet (Council 7) */
--rq-badge-core-cp:     2.5px;
--rq-badge-ring-cp:     3.5px;    /* Heroic: ringens inset */
--rq-badge-ring-core-cp: 4.5px;   /* Heroic: kärnans inset */
```

`badges.css`: ny klass `.rq-badge--cp` (mappar `--rq-emblem-w/-h/-icon/-core/-ring/-ring-core` på `-cp`-tokens och glödvariablerna på **`-sm`-glöden**, eftersom 44 < 56, jfr `S.w >= 56` i filen). `BadgeEmblem`: `size: 'sm' | 'cp' | 'md' | 'lg'`. Heroic-ringens förstärkning vid 28 px (v1 §3: `--rq-badge-ring` alfa .85, `--rq-badge-ring-core-sm` 3.5 px) står kvar oförändrad; `cp` använder designens 3.5/4.5 utan egen förstärkning, men Heroic-ringen verifieras också vid 44 px i 1x/2x (skärmdump i PR:en).

**F13.3 Glöd** (ersätter `--rq-badge-glow-*`; facit `runquest-badges.js` 41–47, 136–137: alfa `4d` = .30, `59` = .35)

| Token | Före | **Efter** | Gäller |
|---|---|---|---|
| `--rq-badge-glow-sm` | 4px | **3px** | Rare/Heroic/Epic i `sm` och `cp` (bredd < 56) |
| `--rq-badge-glow-ml` | 7px | **5px** | Rare/Heroic/Epic i `md`/`lg` |
| `--rq-badge-glow-alpha` | .45 | **.30** | Rare/Heroic/Epic |
| `--rq-badge-glow-leg-sm` | 5px | **4px** | Legendary i `sm` och `cp` |
| `--rq-badge-glow-leg-ml` | 10px | **7px** | Legendary i `md`/`lg` |
| `--rq-badge-glow-leg-alpha` | .60 | **.35** | Legendary |

Andningens topp `--rq-badge-breathe-max` **13px oförändrad** (designens `rqGlow` toppar i 13 px). Keyframen börjar och slutar i den nya, svagare statiska glöden (7 px @ .35), så rörelsen blir relativt större än förut; byggaren bekräftar i skärmdump att det inte blir för kraftigt (Q6). Council 12-fallbacken (Legendary-minis utan glöd på Board) blir troligen överflödig men ligger kvar som kritikerns val.

**F13.4 Nya och borttagna tokens** (sektion 1.34 om inget annat anges; båda temafilerna identiska)

| Token | Mobil | Desktop (`@media (min-width: 1024px)`) | Läses av |
|---|---|---|---|
| `--rq-badge-page-card-min` NY | `300px` | `240px` | badges-sidans rutnät |
| `--rq-badge-page-gap` NY | `var(--rq-sp-8)` | `var(--rq-sp-12)` | badges-sidans rutnät |
| `--rq-badge-card-areas` NY | `"emblem who" "emblem body"` | `"emblem who" "body body"` | liggande kort |
| `--rq-badge-detail-w` NY | `280px` | — | emblem-popovern |
| `--rq-board-minis-inset` NY (sektion **1.20**) | `28px` | `46px` | `board.css` (podiets minis) |
| `--rq-badge-pick-hit` BEHÅLLS (namnet historiskt; kommentaren uppdateras) | `44px` | `24px` | växlare, SAVE DISPLAY, RETRY, "All badges →", tillbaka-länken |
| `--rq-badge-pick-clear` **TAS BORT** | — | — | (rullningsluft för väljarpanelen, finns inte längre) |
| `--rq-badge-grid-cols` **TAS BORT** | — | — | (2/4-kolumners samlingsrutnätet ersätts av `--rq-badge-page-*`) |

Övriga `--rq-badge-*` (storlekar `sm/md/lg`, `clip`, `core`, `ring`, `locked-*`, `pip*`, `breathe-*`, `flash`, `ignite-*`, `skel-*`, `popup-*`) oförändrade. `--rq-titles-pos` är Titles och rörs inte. Vakttestet kräver att varje deklarerad `--rq-badge-*`-token läses av `badges.css` och tvärtom — beskär efter det som byggs.

**F13.5 Vad `guards.test.ts` måste ändras till** (samma commit)

1. Storlekstestet (rad 277–293): regex `(mini|small|medium|large)`, `toHaveLength(4)`, suffixkartan `{ mini: 'sm', small: 'cp', medium: 'md', large: 'lg' }`; `h = round(w × 1.12)` (49 för `cp`); `ring2` för `cp` är 4.5 (ingen förstärkning; förstärkningen 3.5 gäller bara `sm`).
2. Glödtestet (rad 238–245): `--rq-badge-glow-alpha` `.30` och `--rq-badge-glow-leg-alpha` `.35`. Lägg till ett test som läser glödbredderna ur `runquest-badges.js` (`S.w >= 56 ? 7 : 4` för Legendary, `5 : 3` för Rare+; alfa ur `59`/`4d` → .35/.30) och jämför mot `-sm`/`-ml`-tokens.
3. Färgtestet (rad 265–275) fungerar oförändrat mot den nya filen (regexen läser `mk('Name', '#hex', 'linear-gradient(…)')`).
4. Andningstestet (rad 189–199) får kompletteras: `cp` får aldrig stå i en andningsselektor.
5. `badgeCollectionCss.test.ts` rad 58–: rutnätstestet byts från `--rq-badge-grid-cols` till `--rq-badge-page-card-min`/`-gap`.

**F13.6 Rörelse och färgregler (oförändrade, sammanfattade)** Tändning bara i popupen; Legendary andas tre cykler på `md`/`lg` i `--rq-dur-glow` (aldrig `sm`/`cp`); reduced-motion: slutläge direkt. Nivåfärger bara på emblem/chip/pips/nivårad, aldrig status/varning; Heroic-röd används inte som semantisk röd; RETRY och fel förblir `--rq-down`.

---

### F14 — Navigering och route

| Del | Ändring |
|---|---|
| `paths.ts` | `badges: '/badges'` (efter `profile`). |
| `routes.tsx` | `<Route path={paths.badges} element={<BadgesPage />} />` inne i `RequireAuth → AppShell`, bredvid profile. Eager import som `ProfilePage` (ingen lazy; sidan delar feature-bunt med Board). Oinloggad → `/login` med `next` som övriga skyddade routes. |
| `activeNav.ts` | `NavDestination` får `'badges'`; `FIRST_SEGMENT_TO_DESTINATION.badges = 'badges'`; `DESTINATION_TO_TAB.badges = 'you'` (bottenbarens You-flik lyser; `backMap badges:'you'`, `app-full.html` 1713). `activeSideNavItemFor('/badges')` returnerar `'badges'` (ingen specialregel). |
| `SideNav.tsx` | Grupp YOU får raden `{ label: 'Badges', icon: 'shield', destination: 'badges', to: paths.badges }` **mellan Profile och Log Runs** (`web-full.html` 1854–1858). Ingen `tourAnchor`. `shield` finns redan i `runquest-icons.js`/`RQIconName`; inga nya ikoner. |
| Avatarmenyn | Ingen Badges-rad. `shield` används även av Admin (L9, OK). |
| Mobil ingång | "All badges →" på profilens BADGES-block (F10.2). Bottenbaren ändras inte. Tillbaka-länken `‹` på sidan går till `paths.profile` (designens `backMap`). |
| Desktop ingång | Sidonav YOU → Badges, och "All badges →" på profilen. |
| Tester | `activeNav.test.ts` (destination, flik, sidonavsrad), `SideNav`-test (rad + `aria-current="page"` på `/badges`), `routes.test.tsx` (route + auth-redirect), `ProfileScreen`-test (länken). |

Inga djuplänkar, inga query-parametrar. Mobilnavet (fem flikar) är oförändrat.

---

### V2.7 Vad som tas bort och vad som återanvänds

**Tas bort** (filer, och deras `.test.tsx`):

| Fil/del | Ersätts av |
|---|---|
| `components/ShowcasePicker.tsx` (+ test) | växlare på korten + `BadgeDisplayStrip` + `useShowcaseDraft` |
| `components/ShowcaseSlots.tsx` | remsans minis (platspanelen med ✕ finns inte längre) |
| `components/showcasePickerId.ts` | — |
| `components/BadgeCollection.tsx` (+ test) | `BadgesScreen` (sida) och `BadgeSummary` (profil). Skelett/tomläge/felkort flyttas dit. |
| `ProfileScreen`: `pickerOpen`, `editRef`, `closePicker`, `picker`, `{!isDesktop && picker}`, `{isDesktop && picker}` | — |
| `BadgePanel`: raderna (`.rq-badge-panel__list/__row/__text/__nameline/__name/__display/__held`), `HEAD_ICON_SIZE`, `shield` i huvudet | emblemrad med `BadgeEmblemDetail` |
| `BadgeCollection`: `shield` i huvudet, "Edit"/"Edit display", `.rq-badge-display__edit`, `__names` | — |
| CSS i `badges.css`: `.rq-badge-slots`, `.rq-badge-slot*`, `.rq-badge-pick` (panelen), `__head/__title/__count`, `.rq-badge-textlink`, `.rq-badge-grid` | `.rq-badge-page-*` |
| Tokens: `--rq-badge-pick-clear`, `--rq-badge-grid-cols` | F13.4 |
| Copy: "ON DISPLAY"-platspanelen, "Empty slot", "Remove … from display", "Close", "Edit", "Preview on leaderboard"-noteringen | — |
| Spec/README: `features/badges/README.md` avsnitten RUN-128/RUN-129; `features/profile/README.md` väljarplatsen | uppdatera i byggsteg 8 |

**Återanvänds oförändrat:** `api.ts`, `hooks/useBadgeQueries.ts` (inkl. `useSaveShowcase` med optimistik och återställning), `badgeModel.ts` (`buildCollection`, `buildRunnerBadges`, `buildPopupQueue`, `toggleShowcase`, `cleanShowcase`, `sameShowcase`, `applyShowcase`, `applySeen`), `BadgeEmblem` (+ `cp`), `BadgeChip`, `BadgePips`, `BadgeMinis`, `badgeTier.ts`, popupen (`BadgeUpgradeDialog`/`Host`), News-raden, `ErrorState`, `TrackLoader`, skelettklasserna `.rq-badge-skel*`, `.rq-badge-empty*`, `.rq-badge-display*` (omstylad), `.rq-badge-pick__toggle` (blir `.rq-badge-toggle`), `.rq-badge-pick__note`/`__retry` (blir `.rq-badge-note`/`.rq-badge-retry`), `/preview/badges`-arket (får `cp` i storleksraden).

**Ny/ändras:** `BadgesPage`, `BadgesScreen`, `BadgeDisplayStrip`, `BadgeSeriesCard` (liggande + växlare), `BadgeEmblemDetail`, `BadgeSummary`, `BadgePanel` (kompakt), `useShowcaseDraft`, `buildBadgeSummary`, `PodiumCard`/`SeasonRest`/`BoardParts` (F12), `ProfileScreen`/`ProfileHero` (F10), `RunnerCard` (F11), `paths`/`routes`/`activeNav`/`SideNav` (F14).

### V2.8 Copy (engelskt UI, en-GB; inga serienamn eller nivånamn som literaler)

Sida: "BADGES"; "{N} of {8} series unlocked"; "Eight series, six tiers. Anyone can hold a badge — you see your best tier per series." (desktop) · Remsa: "On display"; "Shown on your Board card and next to your name — pick up to 3 below." (desktop); "Pick up to {MAX_SHOWCASE} badges to show on the Board." (mobil, tomt utkast); "Earn your first badge to put it on display." · Knappar: "SAVE DISPLAY" / "SAVING…" / "SAVED"; "Show" / "On display — N" / "Locked" · Rader: "3 of 3 on display — remove one first."; "Saved — your Board card is updated."; "Could not save. Your pick is still here — try again." + "RETRY"; "{Serie} added to display, position N."; "{Serie} removed from display." · Tillstånd: "No badges yet" + "Log a run to start collecting."; "Couldn't load your badges" + "Your runs are safe."; "Loading badges" · Profil: "Badges · {N} of 8 series" (mobil) / "BADGES" + "{N} of 8 series" (desktop); "All badges →"; "Locked · {n} left" (mobil) / "Locked · {n} series left" (desktop) · Runner card: "BADGES"; "{N} of 8 series"; "No badges yet." · Popover: "On display"; allt övrigt ur modellen. **Stryks:** "N% globally", "Global — N% has it", "Group — … in your pack"-tooltipraden, "in pack".

---

### V2.9 Krocktabell: design mot villkor mot vad som byggs

| # | Design (v2-HTML) | Villkor/beslut | Byggs |
|---|---|---|---|
| 1 | "Held by 5 of 6 in pack · 18% globally" / "Global — 18% has it" (`app` 1628, `web` 1734, tooltips 1657, 1712) | O2 (ingen global procent), ADR 009 | Bara "Held by X of N in your pack"; all global text stryks. |
| 2 | Held-by på låsta kort (Night Owl, Speedster; `app` 1616) | L1, Council 1 | Ingen held-by på låsta kort, varken på sidan eller i popovern. |
| 3 | Kravrad `"{Tier} — {krav}"`, ingen flavor på sidan (`app` 1626) | L2, Council 2 | Krav utan prefix; flavor på egen rad på intjänade kort; "Next:"/"Unlock:" behåller nivånamn. |
| 4 | Växlare per kort (`<span onClick>`), ingen separat väljare | O3 (ersätter v1 F3/Q2/Council 16–18-"ingen växlare på samlingskorten") | `<button aria-pressed>` per kort; Council 17:s a11y-krav flyttas till kortet. |
| 5 | Vid 3/3 knapptexten "3 of 3" / "3 of 3 on display", dämpad och inert | L3, Council 17 | Knappen visar "Show", `aria-disabled` + `aria-describedby`, dimmas; synlig mening "3 of 3 on display — remove one first." i remsan. Kortet dimmas inte. |
| 6 | Växlartext .22/.30 alfa, 9–11 px; held 9 px mono; line2 .40; "SAVED" .35 | Council 9 (≥ 4.5:1, ≥ 11 px) | Tokenstegen i F9.5: `--rq-text-2/3/4`, `--rq-fs-eyebrow` 11 px. Avaktiverade kontroller får vara dimmade. |
| 7 | "Locked"-växlare som ruta på låst kort | Council 18 (v1: låst rad inert) | `aria-hidden`-ruta, ingen knapp. |
| 8 | Nivå/krav bara i `title` på 44 px-emblem (profil, Runner card) | L4, Council 5/14 | `BadgeEmblemDetail`: knapp + popover (F10.4). |
| 9 | Runner card: chip, held-by och "On display" försvinner ur panelen | Council 1, 14 | Flyttar in i popovern; panelen är bara emblem. |
| 10 | Legendary statisk på sidan (`emblemNode` animerar aldrig) | L5, STATE Rörelse-undantaget | `md` andas tre cykler; `cp`/`sm` statiska; ingen tändning. |
| 11 | Mobilprofilens hjälte utan minis (`app` 1371) | L9 (följ designen) | Minis tas bort på mobilprofilen; desktop behåller. |
| 12 | Mobil saknar ingång till sidan | O5 | "All badges →" på mobilprofilen. |
| 13 | Profilens BADGES på mobil utan kort | — | Följer designen (ingen kortyta), plus länken. |
| 14 | Sidhuvud som egen sticky list med `‹` (prototypen saknar skalets topprad) | Skalet har redan topprad | Sidhuvud i innehållet, `‹` bara på mobil. |
| 15 | Spara: bara SAVE DISPLAY / SAVED | v1 F3 sparlägen (Council 17) | Sex lägen: osparat, sparar, sparat, fel + RETRY, rent, tomt (F9.3, F9.8). |
| 16 | Remsa .26, vald-kort .35 guldkant | Tokens | `--rq-edge-soft` (.30) för bägge. |
| 17 | Utmaningstecknet svalstjärt | v1 S3/Council 8 ("platt, dämpad, ikonlös guldsköld"; aldrig på samma rad som minis) | Formen byts (ägar-/designbeslut), ikonlöshet och dämpning kvar; "samma rad" operationaliserad i F12.4. |
| 18 | Vimplar i högerkolumn/Last run, minis på sub-rad/podium högerställt | v1 S4 Board (minis inline efter namn; v1 F5) | Designens placeringar (F12), ersätter v1:s. Council 10/11/13 behålls. |
| 19 | Profil under titlar/statistik; Runner card efter TITLES / nedre rutnät | v1 S4 (under hjältekortet; 340 px-kolumnen ovanför TITLES) | Designens placeringar (F10.1, F11.1), ägarbeslut. |
| 20 | Nya hex och glöd | v1 S1/S2 (`#f87171`, `#ffd700`), §3 glödtabell, §5 tokenblock | O4: F13. v1-värdena är historik. |
| 21 | Fjärde storleken 44 px/ikon 20 | STATE "tre storlekar", Council 7 (ikonsteg 15/24/42) | L6: fyra storlekar, ikonsteg 15/20/24/42 bara inuti emblemet (V2.11). |
| 22 | Panelrubriker utan `shield` (profil desktop, Runner card) | Council 7 (shield i `--rq-icon-md`) | Ingen ikon i panelhuvudena; undantaget behövs inte längre. `shield` finns i sidonav (`ICON_NAV`) och Admin. |
| 23 | Rubrik 21 px mobil | Tokenstegen | `--rq-fs-display` (26). |
| 24 | Designens 12/13/14 px-avstånd | Spacing-tokens | Närmaste `--rq-sp-*` (8/12/14); 9 → 8, 13 → 12. |
| 25 | Kort med 4 kolumner (`web` 582) | Okänd bredd < 1440 | `auto-fill` med `--rq-badge-page-card-min` (F9.9). |

### V2.10 Det som Design Council bör döma (nya avvikelser i v2)

1. Fjärde storleken `cp` och ikonsteget 20.
2. Nivån på 44 px-emblem via popover (L4), inte synlig text (Q1).
3. Den dämpade paletten (O4) inkl. kontrasten Rare/Heroic-chip (F9.10).
4. Vimpeln och operationaliseringen av "aldrig på samma rad" (F12.4, Q2).
5. Minis högerställda på podiet (`--rq-board-minis-inset`).
6. Växlare på kort (O3) mot Council 16–18, med a11y-kraven portade (F9.6).
7. En guldknapp per vy: SAVE DISPLAY (hårlinje) plus guldmarkerade valda kort/växlare (precedent: Titles `DisplayPanel`).

### V2.11 Förslag till STATE.md (Lead skriver, beslut 21–22)

Byt Badges-raden i Designspråk (nuvarande: "kronsköld i tre storlekar (28/56/96 px, höjd ×1.12, ikon 15/24/42 …") mot:

> *Badges (ADR 009, Design Council 2026-10-11, omritning v2 2026-10-11): kronsköld i fyra storlekar (28/44/56/96 px, höjd ×1.12 avrundad, ikon 15/20/24/42 — ikonstegsundantag bara inuti emblemet; 28 = mini på rader/Board/News, 44 = kompakt i sammanfattningar, 56 = samlingskort, 96 = popup), sex dämpade nivåfärger som tokens --rq-badge-* (Common silver, Uncommon grön, Rare blå, Heroic röd + hairline-ring, Epic lila, Legendary guld #e3c23e — skild från rollguldet #ffd700); glöd svag (3/5 px @ .30, Legendary 4/7 px @ .35). Nivåfärger bara på emblem/chip/pips/nivårad, aldrig status- eller varningsfärg; Legendary-guld fyller aldrig ytor; nivån bärs aldrig av färg ensam (chip, pips, aria-label; på 44 px-emblem via tryck-popover). Utmaningstecknet är en vimpel med svalstjärt. Räknare = "Held by X of N in your pack", aldrig procent. Val av visade badges görs bara på /badges (knapp per kort); profilen visar en kompakt rad och "All badges →". Spec: docs/design/badges/spec.md (avsnitt "v2").*

Rörelse-undantaget är oförändrat (Legendary-andning bara md/lg). Lägg också `/badges` i Kritiska flöden 9 (samling → "Badges-sidan") när v2 är byggd. `designsprak-forslag.md` regel 10: ikonstegsundantaget blir 15/20/24/42; panelrubrikens `shield`-undantag utgår.

### V2.12 Status per vy (beslut 54)

| ID | Vy | Referens | Status |
|---|---|---|---|
| F9 | Badges-sidan mobil (402) | HTML-export `app-full.html` 1282–1321 + 1613–1645 | **KLAR** (normalläget är ritat; tillstånden laddar/tomt/fel återanvänder `reference/f8.png`, sparlägena `reference/f3.png`) |
| F9 | Badges-sidan desktop (1440) | HTML-export `web-full.html` 567–603 + 1719–1751 | **KLAR** (som ovan; bredder 1024–1439 är antagande, Q4) |
| F10 | Profil, sammanfattning mobil | `app-full.html` 1480–1489 | **KLAR** (länken "All badges →" och popovern är Designerns tillägg, V2.9 #8/#12) |
| F10 | Profil, sammanfattning desktop | `web-full.html` 502–515 | **KLAR** (popovern: samma tillägg) |
| F11 | Runner card, panel mobil | `app-full.html` 494–502 | **KLAR** |
| F11 | Runner card, panel + nedre rutnät desktop | `web-full.html` 1639–1663 | **KLAR** |
| F12 | Board Season mobil (podium, rest, vimplar) | `app-full.html` 222, 276–285 | **KLAR** |
| F12 | Board Season desktop | `web-full.html` 190, 243–246, 261–264 | **KLAR** |
| F12 | Vimpeln | `runquest-badges.js` 106–128, `badge-system.dc.html` 305, 351–368 | **KLAR** |
| F13 | Tokens (färg, glöd, storlekar) | `runquest-badges.js` 14–47 | **KLAR** (inget att rita) |
| F14 | Navigering och route | `web-full.html` 1854–1858, `app-full.html` 1713 | **KLAR** |
| F6 | Uppgraderingspopup | `reference/f6.png` + nya färger via tokens | **KLAR** (ingen layoutändring) |
| F7 | News-rad | `reference/f7.png` + nya färger | **KLAR** (ingen layoutändring) |
| F8 | Tillstånd | `reference/f8.png` | **KLAR** (återanvänds av F9/F10) |
| F1 | Emblem-ark `/preview/badges` | `reference/f1.png` | **KLAR** (får `cp`-storlek och nya färger) |

Ingen vy är BLOCKERAD. Ingen vy är utelämnad. v2 saknar egna PNG-referenser; ägarens HTML-export är facit och byggaren sparar skärmdumpar (402 och 1440, plus Runner card-modal 860) som `docs/design/badges/reference/v2-*-built.png`.

### V2.13 Byggordning

| Steg | Innehåll | Beroende | Anmärkning |
|---|---|---|---|
| 1 | **Designkälla + tokens + emblem `cp` + vakttest.** Kopiera de fyra designfilerna (V2.1) till `docs/design/claude-design/`; skriv F13 i `index.css` OCH `temafil-forslag.css`; `BadgeEmblem` `cp` + `.rq-badge--cp`; uppdatera `guards.test.ts` och `badgeCollectionCss.test.ts`; `/preview/badges` får `cp`; v1 §3/§5-hänvisningar. | — | **EN commit** (vakttestet jämför mot designfilen). Ta inte bort `--rq-badge-grid-cols`/`pick-clear` än om gamla komponenter fortfarande läser dem; de tas bort i steg 8. |
| 2 | F12: vimpel + Board-placeringar + `--rq-board-minis-inset`. | 1 (färger) — delvis oberoende | Egen PR/commit; `BoardParts`, `PodiumCard`, `SeasonRest`, `board.css`, tester, `leaderboard/README`. |
| 3 | F14: `paths`, `routes`, `activeNav`, `SideNav`, `BadgesPage` (tom skärm tills steg 5). | — | Kan gå parallellt med 2. |
| 4 | Modell och byggstenar: `buildBadgeSummary`, `useShowcaseDraft`, `BadgeSeriesCard` liggande + växlare, `BadgeEmblemDetail`, `--rq-badge-page-*`/`-card-areas`/`-detail-w`. | 1 | Tester först (logik och a11y). |
| 5 | F9: `BadgesScreen` + `BadgeDisplayStrip` + tillstånd; ta bort `ShowcasePicker`/`ShowcaseSlots`/`showcasePickerId`. | 3, 4 | Skärmdumpar 402/1440. |
| 6 | F10: `BadgeSummary`, `ProfileScreen`-placering, `ProfileHero` utan mobilminis; ta bort `BadgeCollection`. | 4, 5 (länkmålet) | `ProfileBadges.test` skrivs om. |
| 7 | F11: kompakt `BadgePanel`, `RunnerCard`-ordning och `.rq-runner__lower`. | 4 | `RunnerCard.test` + `BadgePanel.test`. |
| 8 | Städning: ta bort `--rq-badge-grid-cols`, `--rq-badge-pick-clear`, död CSS (V2.7), uppdatera README:er (`badges`, `profile`, `runner`, `leaderboard`), `docs/design/claude-design/README.md` (exportdatum), STATE-text (Lead), spec-referenser. | 1–7 | Full svit + tsc + eslint. |

Kritikerna granskar mot: F9.12, F10.7, F11.3, F12.5, F13.5, F14 och krocktabellen V2.9. Deploy-kritikern: ingen migration, inget API; bara frontend + designfiler.

### V2.14 Öppna frågor (Designerns antaganden, flaggade)

- **Q1** Nivån på 44 px-emblem: popover vald (F10.4). Council bekräftar eller kräver synlig text.
- **Q2** Vimpel och minis hamnar i samma tabellrad men olika celler på Board-rest (designens val). Operationaliserat som "ingen gemensam behållare". Räcker det?
- **Q3** Osparat utkast kastas när man lämnar `/badges`; ingen sticky remsa på mobil (SAVE DISPLAY kan ligga utanför bild när man växlat längre ned). Designen anger inget; rekommendation: lämna så, utvärdera efter preview.
- **Q4** Bredder 1024–1439 på badges-sidan (`auto-fill`, 240 px) och mobil 640+ är antaganden; designen visar bara 402 och 1440.
- **Q5** Suffixet `cp` för 44 px är Designerns val; byt namn i en enda sökning om Lead föredrar annat.
- **Q6** Andningens topp 13 px mot den svagare statiska glöden; bekräftas i skärmdump.
- **Q7** Chip-kontrast Rare/Heroic ≈ 4.6:1 mot faktisk kortbakgrund (liten marginal); mäts av byggaren.
- **Q8** Mobilprofilen tappar minis medan mobil Runner card och Board behåller dem (följer designen, L9).

---

## 0. Facit — var sanningen ligger

| Vy | Referensbild | Källa i `docs/design/claude-design/` |
|---|---|---|
| F1 Emblem-ark | `reference/f1.png` | `RunQuest Components.dc.html` sektion 05 BADGES (uppdaterad) + `runquest-badges.js` |
| F2 Profil: samlingen | `reference/f2.png` (mobil 402 + desktop 1440, inkl. sidokolumn-alternativ) | `RunQuest Badge System.dc.html` |
| F3 Showcase-väljare | `reference/f3.png` | samma |
| F4 Runner card | `reference/f4.png` | samma |
| F5 Board Season | `reference/f5.png` (mobil + desktop) | samma |
| F6 Uppgraderingspopup | `reference/f6.png` (fem varianter) | samma |
| F7 News-rad | `reference/f7.png` (mobilflöde + desktop bell-popover) | samma |
| F8 Tillstånd | `reference/f8.png` | samma |

Exporten är en ögonblicksbild 2026-10-11. `runquest-badges.js` är källan för tierfärger, gradienter, emblemgeometri, storlekar, chip-/pips-recept samt serier med kravtexter och flavor-namn. Vid avvikelse mellan den här filen och källan: den här filen vinner där den uttryckligen anger ett Council-villkor/ägarbeslut; i övrigt vinner källan.

---

## 1. Fasta beslut (ADR 009 och tidigare ägarbeslut — ifrågasätts inte här)

| Beslut | Källa |
|---|---|
| Sex nivåer: Common, Uncommon, Rare, Heroic, Epic, Legendary | ADR 009 beslut 1 |
| Åtta serier: Milestoner, Earth Trotter, Climber, Streak Keeper, Early Bird, Night Owl, Speedster, Precisionist. Socialite och Weathered Soul visas inte (inte heller som "coming soon") | ADR 009 beslut 8; F1 visar åtta |
| En rad/kort per serie = bästa nivån just nu | ADR 009 beslut 1 |
| Ingen global percentil. Räknaren är "Held by X of N in your pack" (X = på din nivå eller högre, ADR `holders`) | ADR 009 beslut 7; Council 1 |
| Ingen belöning vid nivåhöjning. Popupknappen är "Got it" | ADR 009 beslut 5 |
| Upp till 3 visade serier; syns på Board (endast Season) och Runner card; profilen visar hela samlingen + väljaren | ADR 009 beslut 4 |
| Låst serie visar kravet för första nivån ("Unlock: Common — …"); inget framsteg lagras, inga progressbars | ADR 009 beslut 1, 4 |
| Popup: en per serie (högsta nya nivå), kö vid flera, väntar tills changelog-popup/onboarding är stängd | ADR 009 beslut 5; Council 22 |
| News: `badge_earned` under Levels; "earned" första gången, "evolved" vid uppgradering | ADR 009 beslut 5 |
| Badges är återkallbara; inget "lost badge"-meddelande i v0.6.0 | ADR 009 beslut 2 |
| Allt är gruppavgränsat | ADR 009 beslut 9 |

---

## 2. Ägarens beslut på smakfrågorna

Där designen visar två alternativ står vilket som är PRIMÄRT; alternativet byggs inte.

| Fråga | Beslut | Belägg |
|---|---|---|
| **S1 Heroic** | **Röd (#f87171) är primär.** Amber är alternativ och byggs inte. | F1 rad 2 |
| **S1 icke-färgmarkör** | **Heroic får en hairline-ring** (vit) mellan ram och kärna: fjärde emblemlagret. Dessutom 4 av 6 pips och nivånamn i chip/tooltip. Uncommon har ingen ring och 2 pips. Ringens läsbarhet vid `sm` verifieras och förstärks vid behov, se avsnitt 3 ("Heroic-ring vid sm"). | F1; Council 5 |
| **S2 Legendary** | **Guld (#ffd700) är primär.** Orange byggs inte. **Andas på `md`/`lg` i tempot `--rq-dur-glow` 3.2 s, TRE cykler och sedan statisk glöd; aldrig på `sm`.** Statisk glöd är slutläget och fallbacken. | F1; ägarbeslut E1+E2 (2026-10-11), Council 3; STATE.md Rörelse |
| **S2 tändning** | **Engångs-"tändning" 0.9 s ease-out när popupen öppnas, för ALLA nivåer.** Common/Uncommon: ljusflimmer i ramen, ingen glöd. Rare/Heroic/Epic: glöden tänds (0 → nivåns glöd). Legendary: tänds, därefter andning från 1.3 s. Ingen studs, inga konfetti. | F6; Council 4; STATE.md Rörelse |
| **S3 Form** | **Kronsköld** (polygon 50% 0, 100% 14%, 100% 60%, 50% 100%, 0 60%, 0 14%). Utmaningstecknet förblir en platt, dämpad, ikonlös guldsköld och står aldrig på samma rad som badge-minis. | F1; F5; Council 8 |
| **S4 Placering, profil** | **Mobil: BADGES-kortet direkt under hjältekortet.** **Desktop: huvudkolumnen under hjältekortet är PRIMÄR**; sidokolumnsalternativet byggs inte. | F2 |
| **S4 Placering, Board** | **Minis inline i befintlig rad**, ingen egen rad. Podiekort: på namnraden efter namn + delta, med ≥ 8 px mellan deltan och första minin. Rest-rader mobil: på `sub`-raden efter "Lvl N · X km". Desktop: efter namnet i löparcellen. Löpare utan showcase: ingenting (ingen platshållare). | F5; Council 11, 13 |
| **S4 Placering, Runner card** | Mobil: BADGES-panel direkt under hjältekortet. **Desktop (ägarbeslut, godtagen notering): exakt samma panel som mobil, i 340 px-sidokolumnen ovanför TITLES; kontrollera exakt 340 px.** Hjältekortets namnrad får de tre minis. | F4; Council 16 |
| **S4 Spara/redigera** | **Explicit "Save display"** (guld-hårlinje, sekundärknapp, som Titles `DisplayPanel`), inget autospar. Ingång: "Edit" (mobil) / "Edit display" (desktop) i ON DISPLAY-remsan. Väljaren är **samma panel på mobil och desktop (340 px)**: en rad per serie med växlare, ingen växlare på samlingskorten (desktop-noteringen "toggle sits on each collection card" i F3 gäller INTE). Se avsnitt 4 (F3) för uppbyggnad och byggordning. Ingen omsortering: ta bort och lägg till igen. | F3; ägarbeslut; Council 16–18 |
| **S5 Flavor** | **Flavor-namn per tier på EGEN RAD:** citerad kursiv, full textfärg, ≥ 14 px, Barlow Condensed (inte Bebas), på intjänade samlingskort och i popupen. Inte på låsta kort och inte i "Next:"-raden. | F2/F6 (rad/placering ändras); Council 2 |
| **S5 "The" före serienamn** | **Bort**: "Milestoner", "Climber" osv. | Alla bilder |
| **S5 Kortets täthet** | Mobil: lodrätt kort (emblem `md` överst, namn, chip, pips, kravrad, flavor, nästa-rad, held-by om intjänat). Desktop: emblem till vänster, namn + chip + pips till höger, text under. Streckad kant på låsta kort. | F2 |
| **Popupvarianter** | `Badge earned` (ny), `Badge evolved` (gammal nivå som `sm` + pil + ny `lg`, nivåraden "UNCOMMON → RARE" i nya nivåns färg), kö: eyebrow "BADGE EARNED · 1 OF 3" + ghost-knappen "Skip all". **"View badges" utgår.** **"Got it" är den enda fyllda guldknappen.** Bredd 400 px desktop, 340 px mobil. | F6; Council 6, 21 |
| **News-raden** | `sm`-emblem (nya nivån) ersätter `zap` i ikonkolumnen, **`aria-hidden`** (radens text bär betydelsen); kantens färg förblir Levels-grön; Levels-filterchippet behåller `zap`. Texter: "Karl earned Streak Keeper — Common." / "You evolved Milestoner from Uncommon to Rare." | F7; Council 23 |

### 2.1 Följdbeslut

- **B1 flavor:** alla 48 ingår (avsnitt 6). Earth Trotter tier 6 heter "Five Thousand" efter trösklar v2 (tidigare "Ten Thousand").
- **B2 "Held by" på låsta kort: AVGJORD av Council 1 — raden visas INTE på något låst kort** (bilden F2 visar den på låst Night Owl/Speedster; den ritas inte). Held-by visas bara på intjänade kort och i popupen, se F2/F4/F6. Därmed faller Q1:s fråga om vad talet betyder för en låst serie.
- **B4 "Counts Strava runs":** byggs inte.
- **B5 Speedster-text:** "A 5 km run under 35:00".
- **B7 layoutskift på Board:** inline + `min-height` på `sub`-raden, se avvikelse 9.
- **Alternativen** (Heroic amber, Legendary orange) tas inte med i tokens.

---

## 3. Emblemet (ur `runquest-badges.js`, med Council-ändringar)

Fem lager, byggda på ett CSS-`clip-path`; ikonen är RQIcon, aldrig egen `<svg>`.

1. **glow** (yttre wrapper): `filter: drop-shadow`, och `color` = nivåns färg.
2. **frame**: kronskölden, bakgrund = nivåns gradient (låst: `rgb(ink / .12)`).
3. **ring** (endast Heroic): samma sköld, `inset: ring1`, bakgrund `rgb(ink / .55)` (se "Heroic-ring vid sm"). Övriga nivåer: transparent.
4. **core**: samma sköld, `inset` = `core` (Heroic: `ring2`), fyllning `#1c1c1c`, ikonen centrerad.
5. **ikon**: serieikon i nivåns färg (låst: `rgb(ink / .28)`), samma ikon på alla sex nivåer.

| Storlek | Bredd × höjd | Ikon | core-inset | Heroic ring1 / ring2 | Används i |
|---|---|---|---|---|---|
| `mini` (sm) | 28 × 31 | 15 | 2 | 2 / 3 (se nedan) | hjältens namnrad, Board, ON DISPLAY-remsan, picker-rader, News, Runner card hero, bell-popover |
| `medium` (md) | 56 × 63 | 24 | 3 | 4 / 5.5 | samlingskort, Runner card-lista, F8 skeleton/tomläge |
| `large` (lg) | 96 × 108 | 42 | 5 | 7 / 9 | popupen, F1 |

Höjd = bredd × 1.12, avrundad (31 / 63 / 108).

> **v2:** fjärde storleken `cp` (44 × 49, ikon 20, core 2.5, ring 3.5 / 4.5) tillkommer, glöden och nivåfärgerna i tabellerna nedan ersätts av F13. Se `## v2`, F13.

**Ikonstege (Council 7):** 15 / 24 / 42 px gäller ENDAST inuti emblemet. Panelrubrikens `shield` (BADGES-rubriken, F2/F4) byggs i `--rq-icon-md` (17 px), inte 16/18 som bilden. Allt annat följer ikonsteget 15/17/21. Rad om undantaget läggs in i `designsprak-forslag.md` regel 10 (RUN-127/Lead).

**Glöd (drop-shadow, `sm` / `md` + `lg`):**

| Nivå | Glöd (statisk) | Rörelse |
|---|---|---|
| Common | ingen | Tändning i popup: ljusflimmer i ramen (se nedan). Ingen glöd. |
| Uncommon | ingen | samma som Common |
| Rare, Heroic, Epic | 4 px / 7 px, nivåfärg @ .45 | Tändning i popup: glöd 0 → nivåns glöd, 0.9 s ease-out. Ingen loop. |
| Legendary | 5 px / 10 px, nivåfärg @ .60 | `md`/`lg`: andning **3 cykler** i tempot `--rq-dur-glow` (3.2 s), sedan statisk glöd. `sm`: statisk, aldrig andning. I popupen: tändning 0.9 s, andning startar vid 1.3 s. |

**Rörelseregler (ägarbeslut E1+E2, Council 3–4; undantag nedtecknat i STATE.md Rörelse):**

- **Tändning** (`rqBadgeIgnite`, `--rq-dur-badge-ignite` 0.9 s, ease-out, `both`): bara i uppgraderingspopupen, alla nivåer, ett varv.
  - Common/Uncommon: ramen (lager 2) går från förhöjd ljushet till normal (`filter: brightness(var(--rq-badge-flash))` → `1`). Ingen drop-shadow.
  - Rare/Heroic/Epic: `drop-shadow(0 0 0 transparent)` → nivåns egen glöd.
  - Legendary: som Rare+, därefter övergång till andning.
- **Andning** (Legendary `md`/`lg`, aldrig `sm`): `animation-duration: var(--rq-dur-glow)` (3.2 s), `animation-iteration-count: var(--rq-badge-breathe-count)` (3), `ease-in-out`. Keyframen börjar OCH slutar i den statiska glöden (`0%, 100%` = nivåns statiska glöd, `50%` = `--rq-badge-breathe-max`), så att glöden efter tredje cykeln står kvar utan hopp (`animation-fill-mode: both`). Återanvänd `rqGlowIcon` om dess amplitud verifieras lika (verifieras i RUN-127); annars egen keyframe `rqBadgeGlow` med samma 3.2 s-tempo. Andningen startar när emblemet monteras (i popupen med `animation-delay: var(--rq-badge-ignite-handoff)` 1.3 s); den startar inte om vid omrendering. Tokenen `--rq-dur-badge-breathe` (2.6 s) och `infinite` utgår.
- **`prefers-reduced-motion: reduce`:** ingen tändning och ingen andning (`animation: none`). Slutläget visas direkt: Rare+ statisk glöd i nivåns värde, Legendary statisk glöd 5/10 px @ .60, Common/Uncommon ingen glöd. Gäller popup, samling, Runner card och allt annat där emblemet ritas.
- Ingen studs, inga konfetti, ingen annan rörelse på emblem.

**Heroic-ring vid `sm` (Council 5):** vid 28 px är ringen bara ca 1 px (ring1 2 px, ring2 3 px). I RUN-127: verifiera i 1x och 2x mot Uncommon (skärmdump i PR:en). Syns ringen inte tydligt är FÖRSTÄRKNINGEN FÖRHANDSGODKÄND (ingen ny fråga): ring-alfa **.85** (`--rq-badge-ring`: `rgb(var(--rq-ink-rgb) / .85)`), `ring1` 2 px, `ring2` **3.5 px** (`--rq-badge-ring-core-sm: 3.5px`). `md`/`lg` oförändrade.

**Låst (tier 0):** ram `rgb(ink / .12)`, ikon `rgb(ink / .28)`, ingen glöd, tomma pips, chip "Locked". Låst-chippets text (.45) måste verifieras ≥ 4.5:1 (Council 9); höj annars till närmaste token som klarar kravet.

**Nivå får aldrig bäras av färg ensam (Council 5, 14):**
- `md`/`lg`: chip med nivånamn.
- `sm`: `role="img"` + `aria-label="Rare Milestoner"` (och `title`). På Board och i News gäller ändå grupp-/aria-hidden-reglerna nedan.
- Pips (sex, överallt): `role="img"` / visuellt dold text med textmotsvarighet **"Tier N of 6"** (låst: "Tier 0 of 6" eller "Locked").
- Heroic-ring.

**Nivå-chip (status-receptet):** tint .10 / kant .45 / text i full nivåfärg, versaler. **Pips:** sex kvadrater, 6 px, gap 3 px; fyllda t.o.m. aktuell nivå i nivåfärg, resten `rgb(ink / .12)`. Position, aldrig framsteg.

**Färgregler (Council 6, gäller byggarna, ej STATE):**
- Heroic-röd används ENDAST i emblem, chip, pips och nivårad. Aldrig som status/varning.
- Nivåfärger är aldrig status-/varningsfärger (felkort, sparfel, `streak_broken`, RETRY förblir semantisk röd, platt text/kant).
- Rare-blå är inte alias för `--rq-tier-minor`; prefixet är `--rq-badge-*`.
- Legendary-guld fyller aldrig ytor (bara emblemmaterial, chip och text); ON DISPLAY-remsans guldtint är rollguld, inte Legendary.
- "Got it" är den enda fyllda guldknappen i popupen.

| Serie (`series`) | Visningsnamn | RQIcon | Måttetikett (låst kort, rad 1) |
|---|---|---|---|
| `milestoner` | Milestoner | `flag` | Longest single run |
| `earth_trotter` | Earth Trotter | `globe` | Total distance |
| `climber` | Climber | `mountain` | Total elevation gain |
| `streak_keeper` | Streak Keeper | `flame` | Longest run streak |
| `early_bird` | Early Bird | `sun` | Early starts |
| `night_owl` | Night Owl | `moon` | Late starts |
| `speedster` | Speedster | `zap` | Fastest 5 km |
| `precisionist` | Precisionist | `target` | Exact finishes |

Panelrubrikens ikon är `shield` (finns i `runquest-icons.js`), renderad i `--rq-icon-md`.

---

## 4. Ramar F1–F8

Viewport: mobil 402, desktop 1440. Mörkt tema; ljust är förberett men inte ritat. **Bilderna visar designen FÖRE Council; villkorsändringarna nedan gäller framför bilden, se avsnitt 12.**

### F1 — Emblem-ark · `reference/f1.png` · KLAR

Komponentarket (Components, sektion 05, ankare `#badges`). Sex nivåer med chip/pips/glödlägen, Heroic röd + amber (alt), Legendary guld + orange (alt) + statisk fallback, matris 8 × 6 på `md`, låst-rad, storlekar mini/md/lg, 1:1-mini på panel och podiekort, anatomi (fem delar), färgblindskontroll Uncommon vs Heroic. Ritas inte: hover/fokus, deuteranopi-simulering, ljust tema. Notera: bildens legendary-"BREATHES"-etikett avser nu 3 cykler (avsnitt 3).

### F2 — Profil: samlingen · `reference/f2.png` · KLAR (mobil + desktop)

> **Ersatt av v2 F9 (sidan) och F10 (profilens sammanfattning).** Korttexternas regler (nedan) gäller fortfarande för kortet på `/badges`.

- **Hjältekort:** namn + tre `sm`-minis efter namnet.
- **BADGES-kort:** rubrik (Bebas guld, `shield` i `--rq-icon-md`) + "5 of 8 series"; **ON DISPLAY-remsa** (minis + "Edit" / desktop: namnen + "Edit display"); rutnät med åtta kort, **2 kolumner mobil, 4 kolumner desktop**.
- **Kort (intjänat), uppifrån:** emblem `md`, serienamn (versaler), nivå-chip, pips (+ "Tier N of 6"), **kravtext utan nivåprefix** ("A single run of 21.1 km", i `--rq-text-2`, sekundär), **flavor på egen rad** (`"Half Marathon"`: citerad kursiv, full textfärg, ≥ 14 px, Barlow Condensed), `"Next: {Nästa nivå} — {kravtext}"` (behåller nivånamn), **held-by** (mono, `--rq-fs-eyebrow` 11 px, ≥ 4.5:1). **Max:** guld versal "TOP TIER REACHED" i stället för Next-raden.
- **Kort (låst):** streckad kant, "Locked"-chip, tomma pips, måttetiketten, `"Unlock: Common — {kravtext}"` (behåller nivånamn). **Ingen held-by, ingen flavor.**
- **Held-by (endast intjänade kort):** "Held by X of N in your pack" där X = medlemmar på din nivå eller högre; X = 1 och betraktaren håller serien → "Only you hold this in your pack". Utelämnas utan platshållare när uppgift saknas.
- **Textregler:** all informationstext ≥ 4.5:1 och ≥ 11 px; ingen opacity-dimning av text (Council 9).
- **Alternativ (byggs inte):** kompakt sidolista ovanför MY TITLES.
- Flavor visas på ALLA intjänade kort (bilden visar den bara på tre; exemplet, inte regeln).

### F3 — Showcase-väljare · `reference/f3.png` · KLAR (mobil bild; desktop = samma panel, 340 px)

> **Ersatt av v2 F9 (växlare på korten, O3).** Sparlägena, a11y-kraven (Council 17) och byggordningens poster (rader, Save, platser) lever vidare i F9.3, F9.6 och F9.7; platspanelen med ✕ och panelen som sådan byggs inte längre.

Panelen byggs EN gång och används oförändrad på mobil och desktop (desktop: 340 px-sidokolumn i Titles-layouten; kontrollera exakt 340 px). Växlare sitter på raderna i väljaren, inte på samlingskorten.

**Byggordning (Council 18):** (1) en rad per serie med växlare, (2) "Save display" + sparlägen, (3) ON DISPLAY-platspanelen (platserna 1–3 med ✕). **"Preview on leaderboard" skjuts till uppföljning och byggs inte nu** (bilden visar den; den ritas inte i RUN-128:s första leverans).

- **Rad:** `sm`-emblem, serienamn, nivå, växlare "Show" / "On display — N" / "Locked". Låsta serier: streckad rad med texten "Locked — cannot be selected" och växlare "Locked".
- **Växlaren:** `<button aria-pressed>`; mål ≥ 24 px (44 px på mobil). Vid 3/3: övriga växlare `aria-disabled="true"` och den SYNLIGA texten **"3 of 3 on display — remove one first."** visas i panelen (inte bara tooltip). Det är växlaren som dimmas, inte raden eller texten (Council 17; bildens rad-`opacity .75` utgår).
- **Platspanel:** platsmarkör 19 px (`--rq-titles-pos`), ✕ med `aria-label` ("Remove Streak Keeper from display"), mål ≥ 24 px (44 px mobil). Statusändringar i `aria-live="polite"`.
- **Sparlägen:** osparat → "SAVE DISPLAY"; sparar → "SAVING…" avstängd; sparat → grön kant "Saved — your Board card is updated." (`role="status"`); fel → röd kant "Could not save. Your pick is still here — try again." + RETRY (`role="alert"`). Semantisk röd/grön, aldrig nivåfärg.

### F4 — Runner card · `reference/f4.png` · KLAR (mobil bild; desktop = samma panel, 340 px)

> **Ersatt av v2 F11 (kompakt panel, ny placering).**

Mobil: hjältekort (namn + tre minis, CHALLENGE = enda guldknappen) och BADGES-panel: bara intjänade serier, en rad per serie med `md`-emblem, namn, gulltonad "ON DISPLAY", **held-by**, nivå-chip till höger. **Desktop (ägarbeslut): exakt samma panel i 340 px-sidokolumnen ovanför TITLES; hjältekortets namnrad får de tre minis.** Ordning: visade först, sedan högst nivå, sedan serieordning. Tomläge: streckad ruta "No badges yet."

Held-by på Runner card (Council 1): visas inte för serier betraktade löparen inte har intjänat (de listas inte ändå) och visas inte när X = N (alla i gruppen är på nivån eller högre). Se avsnitt 12 (krock med bilden).

### F5 — Board, Season · `reference/f5.png` · KLAR (mobil + desktop)

> **Minis-/ribbon-placeringen och utmaningstecknet ersätts av v2 F12.** Council-villkoren 10–13 nedan gäller fortfarande.

Mobil: podiekort med minis på namnraden efter namn + delta; rest-rader med minis på `sub`-raden; rad utan showcase: inget. Desktop: tabell med minis efter namnet; rad 6 med längsta namnet + tre minis (namnet ellipsiserar, minis krymper inte). Hela raden öppnar Runner card. Bara Season-vyn.

Council-villkor:
- **Radhöjd (10):** `sub`-raden får `min-height: var(--rq-badge-h-sm)` på ALLA rest-rader (med och utan minis) så att raderna inte hoppar när `GET /api/badges/group` landar.
- **Delta och minis (11):** ≥ 8 px mellan deltan ("▼ 1"/"▲ 1") och första minin; ordning på namnraden: namn, delta, minis.
- **Dominans (12):** rank och namn ska dominera raden. Godkänd fallback om kritikern finner minis för dominanta: **Legendary-minis utan glöd på Board** (statisk, ingen drop-shadow; ramen bär ändå guld).
- **Utmaningstecken (8):** utmaningsskölden är ikonlös/dämpad och står aldrig på samma rad som badge-minis.
- **Tillgänglighet (13):** minis-gruppen är ETT element med `role="img"` + `aria-label="Badges: Rare Milestoner, Epic Climber"`; varje mini inuti är `aria-hidden`. Ingen platshållare utan showcase. Minis är dekorativa (raden öppnar Runner card).

### F6 — Uppgraderingspopup · `reference/f6.png` · KLAR (desktop 400 px + mobil 340 px)

Varianter: earned, evolved, evolved Legendary ("Only you hold this in your pack"), kö (Early Bird, "1 OF 3"), mobil. Uppbyggnad uppifrån: ✕, eyebrow (mono, guld), emblem `lg` (evolved: gammalt `sm` + `→` + nytt `lg`), serienamn (Bebas 28, vit), nivårad i nya nivåns färg (endast evolved), chip, **kravtext** (sekundär, `--rq-text-2`), **flavor på egen rad** (`"Half Marathon"`: citerad kursiv, full textfärg, ≥ 14 px, Barlow Condensed), held-by (mono, `--rq-fs-eyebrow`; X på din nivå eller högre), "GOT IT". Panel: `--rq-popover`, hårlinje, `--rq-shadow-pop`.

Council-villkor:
- **Knappar:** "Got it" (enda fyllda guldknappen) + i kön "Skip all" (ghost; markerar alla sedda). **"View badges" tas bort.** Knappmål ≥ 24 px.
- **Got it utan permanent ring (20):** ingen guldring @ .35 med offset; bara `--rq-focus-ring` på `:focus-visible`.
- **Dialog-semantik (19):** `role="dialog"`, `aria-modal="true"`, `aria-labelledby` (serienamnet). Fokus flyttas till "Got it" vid öppning och tillbaka till utlösaren vid stängning; fokusfälla; **Escape = Got it** och kön går vidare; "1 of 3" i `aria-live="polite"`.
- **Väntan (22):** popupen väntar tills changelog-popup/onboarding är stängd.
- **Rörelse:** tändning/andning enligt avsnitt 3; reduced-motion: statiskt slutläge.

### F7 — News `badge_earned` · `reference/f7.png` · KLAR (mobilflöde + desktop bell-popover)

Rad: 3 px grön vänsterkant (Levels, oförändrad), `sm`-emblem i ikonkolumnen (30 px), **`aria-hidden`** på emblemet (Council 23), typrad "Badge earned" / "Badge evolved" i grön versal, tid till höger, text under. Oläst = grön tint (.06). Popovern: "THE PACK NEWS", filterchips Levels (valt, `zap`) / Titles / Challenges. Desktops helsides-News ritas inte separat.

### F8 — Tillstånd · `reference/f8.png` · KLAR

Kolumnbredd 330 px (panelnivå). Skeleton: tre kort med skölds-block 56 × 63 + tre streck, pulserande (`rqSkel` 1.6 s, stagger .2 s). Inga badges än: streckad ruta, "NO BADGES YET" (Bebas), "Log a run to start collecting.", åtta låsta minis. Fel: rött kantkort "COULDN'T LOAD YOUR BADGES" / "Your runs are safe." / RETRY. Held-by saknas: raden utelämnas utan platshållare. Board vid badgefel: ingenting. F8-rutan "NEW TOKENS · DEVIATIONS": se avsnitt 5 och 7.

---

## 5. Tokenförslag (skrivs INTE nu — RUN-127)

> **v2:** nivåfärgerna, glöden och storlekarna i blocket nedan är ersatta av F13 (nya hex, svagare glöd, `cp`); layouttokens `--rq-badge-grid-cols` och `--rq-badge-pick-clear` tas bort. Blocket står kvar som historik över v1.

Skrivs som sektion 1.34 i `docs/design/temafil-forslag.css` och speglas ordagrant i `apps/frontend/src/index.css`. Prefixet är `--rq-badge-*`, inte `--rq-tier-*` (finns redan för utmaningar). Likaså `--rq-popup-w` → `--rq-badge-popup-w`, `--rq-pip` → `--rq-badge-pip`.

Värdena är `runquest-badges.js` ordagrant, med Council-ändringarna markerade (ÄNDRAD / UTGÅR / NY). Nivåfärgerna är emblemmaterial och definieras som egna literaler, inte alias till `--rq-up`/`--rq-down`/`--rq-gold`. Vakttestet kräver att varje deklarerad token läses och varje läst deklareras; beskär efter byggets faktiska konsumenter.

```css
/* ── 1.34 Badges (RUN-2) ──────────────────────────────────────────────────────
   Per nivå: -rgb (alfa-recept), solid (text, ikon, ram), -grad (ramens gradient).
   Heroic = röd (ägarbeslut S1), Legendary = guld (S2). Alternativen (amber, orange) är inte tokens. */
--rq-badge-common-rgb:     168 168 168;   --rq-badge-common:     #a8a8a8;
--rq-badge-common-grad:    linear-gradient(145deg, #c2c2c2, #636363);
--rq-badge-uncommon-rgb:   74 222 128;    --rq-badge-uncommon:   #4ade80;
--rq-badge-uncommon-grad:  linear-gradient(145deg, #86efac, #166534);
--rq-badge-rare-rgb:       96 165 250;    --rq-badge-rare:       #60a5fa;
--rq-badge-rare-grad:      linear-gradient(145deg, #93c5fd, #1e40af);
--rq-badge-heroic-rgb:     248 113 113;   --rq-badge-heroic:     #f87171;
--rq-badge-heroic-grad:    linear-gradient(145deg, #fca5a5, #991b1b);
--rq-badge-epic-rgb:       192 132 252;   --rq-badge-epic:       #c084fc;
--rq-badge-epic-grad:      linear-gradient(145deg, #d8b4fe, #6b21a8);
--rq-badge-legendary-rgb:  255 215 0;     --rq-badge-legendary:  #ffd700;
--rq-badge-legendary-grad: linear-gradient(145deg, #fff2a8, #ffd700 45%, #8a6d1c);

/* Form och mått: kronsköld, höjd = bredd × 1.12 (avrundad: 31 / 63 / 108) */
--rq-badge-clip:     polygon(50% 0%, 100% 14%, 100% 60%, 50% 100%, 0% 60%, 0% 14%);
--rq-badge-w-sm:     28px;   --rq-badge-h-sm:  31px;   --rq-badge-icon-sm: 15px;   /* ikonerna 15/24/42 gäller bara inuti emblemet (Council 7) */
--rq-badge-w-md:     56px;   --rq-badge-h-md:  63px;   --rq-badge-icon-md: 24px;
--rq-badge-w-lg:     96px;   --rq-badge-h-lg: 108px;   --rq-badge-icon-lg: 42px;
--rq-badge-core-sm:  2px;    --rq-badge-core-md: 3px;  --rq-badge-core-lg: 5px;      /* kärnans inset (ramtjocklek) */
--rq-badge-ring-sm:  2px;    --rq-badge-ring-md: 4px;  --rq-badge-ring-lg: 7px;      /* Heroic: ringens inset */
--rq-badge-ring-core-sm: 3px; --rq-badge-ring-core-md: 5.5px; --rq-badge-ring-core-lg: 9px;  /* Heroic: kärnans inset. sm -> 3.5px och ring-alfa -> .85 om verifieringen vid 28 px kräver det (förhandsgodkänt, Council 5) */
--rq-badge-core:     #1c1c1c;                       /* kärnans fyllning */
--rq-badge-ring:     rgb(var(--rq-ink-rgb) / .55);  /* Heroic hairline-ring. -> / .85 vid behov (Council 5) */
--rq-badge-locked-frame: var(--rq-line-4);          /* låst: ram .12 */
--rq-badge-locked-icon:  var(--rq-text-5);          /* låst: ikon .28 */
--rq-badge-pip:      6px;    --rq-badge-pip-gap: 3px;   /* tom pip = --rq-line-4 (.12) */

/* Glöd (drop-shadow-parametrar; recept: 0 0 <blur> rgb(<nivå>-rgb / <alfa>)) */
--rq-badge-glow-sm:        4px;    --rq-badge-glow-ml:        7px;    --rq-badge-glow-alpha: .45;       /* Rare, Heroic, Epic */
--rq-badge-glow-leg-sm:    5px;    --rq-badge-glow-leg-ml:   10px;    --rq-badge-glow-leg-alpha: .60;   /* Legendary (statisk; Board-fallback: ingen glöd) */
--rq-badge-breathe-max:    13px;                                                                         /* andningens topp (md/lg); keyframen börjar/slutar i den statiska glöden */
--rq-badge-breathe-count:  3;                                                                            /* NY: antal andningscykler, sedan statisk glöd (E2) */
--rq-badge-flash:          1.6;                                                                          /* NY: ramens ljusflimmer-ljushet (Common/Uncommon, tändning); startvärde, justeras mot bilden i RUN-127 */
/* UTGÅR: --rq-dur-badge-breathe (2.6s) och --rq-badge-breathe-min (3px). Andningen använder befintliga --rq-dur-glow (3.2s). */
--rq-dur-badge-ignite:     .9s;    /* rqBadgeIgnite, engångs, ease-out, alla nivåer i popupen */
--rq-badge-ignite-handoff: 1.3s;   /* Legendary i popupen: andningen startar här */

/* Layout (mobil = standard; desktop skriver över i avsnitt 2) */
--rq-badge-grid-cols:    repeat(2, minmax(0, 1fr));   /* samlingen i profilen (desktop 4) */
--rq-badge-popup-w:      340px;                        /* uppgraderingspopupen (desktop 400px; krymper till 95 % av skärmen) */
--rq-badge-news-icon-w:  30px;                         /* News-radens ikonkolumn när den bär ett sm-emblem (idag --rq-news-row-cols 26px) */
```

Återanvänds i stället för nya tokens: platsmarkören 19 px i väljaren = `--rq-titles-pos`; popupens panel = `--rq-popover`, kant `--rq-line-4`, skugga `--rq-shadow-pop`; held-by-mono och eyebrows = `--rq-font-mono`; chip = `.rq-chip--status`; skeleton = `.rq-skel-block`; kravtext = `--rq-text-2`; fokus = `--rq-focus-ring`; andningens tempo = `--rq-dur-glow`. Nivå-mappning utan hex i komponent-CSS: `[data-tier="rare"] { --rq-badge-c: var(--rq-badge-rare); --rq-badge-c-rgb: var(--rq-badge-rare-rgb); --rq-badge-grad: var(--rq-badge-rare-grad); }` för sex nivåer.

Typsteg (Council 1, 2, 9): källan använder literaler. Buildern snappar till `--rq-fs-*`/`--rq-ls-*`: chip → `--rq-fs-chip`; held-by → `--rq-fs-eyebrow` (11 px, kontrast ≥ 4.5:1, ingen opacity-dimning); flavor → Barlow Condensed, första `--rq-fs-*`-steg ≥ 14 px; kravtext → steg ≥ 11 px i `--rq-text-2`. Keyframes: `rqBadgeIgnite` (alla nivåer; ljusflimmer för Common/Uncommon, glöd 0 → nivån för Rare+) och, om `rqGlowIcon`-amplituden inte räcker, `rqBadgeGlow` (3.2 s, start/slut = statisk glöd, topp `--rq-badge-breathe-max`).

---

## 6. Copy: `packages/shared/src/badges.ts` (trösklar v2)

**Uppdaterad 2026-10-11 efter trösklar v2 (ägarbeslut, RUN-135; ADR 009 beslut 3).** Copyn från designen infördes i RUN-134. Därefter bytte RUN-135 trösklarna och gav varje serie en enda mätning. Därför är `badges.ts` nu facit för krav- och flavor-text. `runquest-badges.js` och f1–f8 visar fortfarande de gamla trösklarna, men de används bara som referens för det visuella. Tiernamnen och serienycklarna är oförändrade.

| Serie | Kravtext (`requirementText`, tier 1 … 6) | Måttetikett (låst kort, rad 1) |
|---|---|---|
| Milestoner | "A single run of 5 km" … 10 / 21.1 / 30 / 42.2 / 50 km | "Longest single run" |
| Earth Trotter | "100 km total distance" … 300 / 1,000 / 2,000 / 3,000 / 5,000 | "Total distance" |
| Climber | "500 m of elevation gain" … 1,345 / 4,808 / 8,848 / 17,696 / 26,544 | "Total elevation gain" |
| Streak Keeper | "7 days in a row" … 14 / 50 / 100 / 365 / 730 | "Longest run streak" |
| Early Bird | "5 runs started 04:00–06:59" … 20 / 50 / 100 / 200 / 300 (samma fönster i alla tiers) | "Early starts" |
| Night Owl | "5 runs started 21:00–03:59" … 20 / 50 / 100 / 200 / 300 (samma fönster i alla tiers) | "Late starts" |
| Speedster | "A 5 km run under 35:00" … 30 / 25 / 22 / 20 / 18 | "Fastest 5 km" |
| Precisionist | "5 runs on an exact whole km" … 20 / 50 / 100 / 200 / 300 (bara Strava-rundor) | "Exact finishes" |

Ägarbeslutet "Night Owl nivå 6 = 23:30–00:29" (Q3) gällde det gamla tier 6-fönstret och upphör med v2. Där finns ett enda fönster, 21:00–03:59.

**Flavor-namn (`tierFlavor`, 1 → 6).** Ändrade mot designen där tröskeln flyttats:

| Serie | Common | Uncommon | Rare | Heroic | Epic | Legendary |
|---|---|---|---|---|---|---|
| Milestoner | First Five | Double Digits | Half Marathon | The Long Haul | Marathon | Ultra |
| Earth Trotter | Off the Mark | Road Worn | Four Figures | The Long Way | Coast to Coast to Coast | Five Thousand |
| Climber | Foothills | Ben Nevis | Mont Blanc | Everest | Everest, Twice | Everest, Thrice |
| Streak Keeper | Full Week | Fortnight | Fifty Straight | The Hundred | A Full Year | Two Full Years |
| Early Bird | First Light | Dawn Patrol | Sunrise Regular | Morning Fixture | Before the Birds | The Dark Hours |
| Night Owl | Lights Out | Street-lamp Pace | Closing Time | Nocturnal | Past Midnight | The Midnight Run |
| Speedster | Moving | Brisk | Quick | Fast | Sub-20 | Flying |
| Precisionist | On the Nose | Measured | Calibrated | Clockwork | Surgical | Atomic Clock |

**Sammansättning (frontendens ansvar, inte shared), ÄNDRAD av Council 2:**
- Intjänat kort: **kravtext utan nivåprefix** (`"{krav}"`), därunder flavor på egen rad (`"{flavor}"`, citerad kursiv). Tidigare `"{Tier} — {krav}"` utgår.
- Nästa: `"Next: {Tier} — {krav}"` (behåller nivånamn; ingen flavor).
- Låst: `"Unlock: Common — {krav}"` (behåller nivånamn; ingen flavor).
- Popup: kravtext på en rad och flavor `"{flavor}"` på EGEN rad (inte längre `{krav} — "{flavor}".` på en rad).

---

## 7. Avvikelser från designspråket — Design Councils utfall (beslut 15d)

Alla fem röster: godkänt med villkor. Villkoren gäller manifest för RUN-127/128/129/130/131/132/122.

| # | Avvikelse | Utfall | Villkor |
|---|---|---|---|
| 1 | **Rörelse (regel 8), Legendary-andning** | **GODKÄND MED VILLKOR** (ägarbeslut E1+E2 2026-10-11; undantaget står i STATE.md Rörelse) | Tempo `--rq-dur-glow` 3.2 s (2.6 s-token utgår); TRE cykler sedan statisk glöd (ingen `infinite`); bara `md`/`lg`, aldrig `sm`; `rqGlowIcon` återanvänds om amplitud lika, annars `rqBadgeGlow`; av under `prefers-reduced-motion` (slutläge statisk glöd). Tändning 0.9 s i popupen för alla nivåer är en del av samma undantag. (Council 3, 4) |
| 2 | **Ikonstege (regel 10)** | **GODKÄND MED VILLKOR** | 15/24/42 px bara inuti emblemet; panelrubrikens `shield` i `--rq-icon-md`; undantaget skrivs som rad i `designsprak-forslag.md` regel 10. (Council 7) |
| 3 | **Färg (regel 3), nya accentfamiljer** | **GODKÄND MED VILLKOR** | Nivåfärger bara som emblemmaterial/chip/pips/nivårad, aldrig status/varning; Rare-blå ej alias för `--rq-tier-minor`; prefix `--rq-badge-*`. (Council 6) |
| 4 | **Heroic-röd intill röda semantiska element** | **GODKÄND MED VILLKOR** | Heroic-röd bara i emblem, chip, pips, nivårad; ≥ 8 px mellan delta och minis på Board; ring, pips och nivånamn i klartext kvarstår. (Council 6, 11) |
| 5 | **Guld (en guldknapp per vy)** | **GODKÄND MED VILLKOR** | Legendary-guld fyller aldrig ytor; "Got it" enda fyllda guldknappen i popupen; Board: kritikern granskar att rank/namn dominerar, godkänd fallback = Legendary-minis utan glöd. (Council 6, 12) |
| 6 | **Heroic-ringen vid `sm`** | **GODKÄND MED VILLKOR** | Verifiera 28 px 1x/2x mot Uncommon (skärmdump i RUN-127). Syns den inte: alfa .85, ring1 2, ring2 3.5 (förhandsgodkänt). (Council 5) |
| 7 | **Kronsköld mot utmaningsskölden** | **GODKÄND MED VILLKOR** | Utmaningstecknet ikonlöst/dämpat; aldrig på samma rad som badge-minis. (Council 8) |
| 8 | **Ny komponent, gradient mot platta ytor** | **GODKÄND** | Följer Components-förlagan. |
| 9 | **F5 mobil: radhöjd** | **GODKÄND (förslaget antaget)** | `sub`-raden `min-height: var(--rq-badge-h-sm)` på ALLA rest-rader. (Council 10) |
| 10 | **F6 "Got it"-ring** | **GODKÄND (förslaget antaget)** | Ingen permanent ring; bara `--rq-focus-ring` på `:focus-visible`. (Council 20) |
| 11 | **Literaler utanför typ-/spärrskalan** | **GODKÄND MED VILLKOR** | Snappa till `--rq-fs-*`/`--rq-ls-*`; held-by `--rq-fs-eyebrow` 11 px ≥ 4.5:1; all informationstext ≥ 4.5:1 och ≥ 11 px; ingen opacity-dimning av text; låst-chippets text (.45) verifieras; flavor ≥ 14 px Barlow Condensed. (Council 1, 2, 9) |
| 12 | **Tokennamn** | **GODKÄND** | `--rq-badge-*`. (Council 6) |
| 13 | **Held-by på låsta kort (Q1) kontra ADR 009 beslut 7** | **GODKÄND MED ÄNDRING** | Held-by göms på ALLA låsta kort (utelämnas utan platshållare); räknaren = på din nivå eller högre; kvar på intjänade kort och i popupen; Runner card: göms på icke-intjänade och när X = N. (Council 1) |

> **v2:** nya avvikelser (fjärde storleken, nivå via popover, dämpad palett, vimpel, växlare på kort) listas i V2.10 och väntar på Councils dom.

---

## 8. Frågor — status

- **Q1 AVGJORD.** Held-by visas inte på låsta kort; på intjänade kort = medlemmar på din nivå eller högre (ADR `holders`). Inget "≥ tier 1"-antal behövs. Bildens siffror är platshållare.
- **Q2 AVGJORD (ägarbeslut).** Väljaren är samma panel på mobil och desktop (340 px-sidokolumn), växlare på raderna i väljaren, inte på samlingskorten. Inline som `DisplayPanel` på Titles. Ingång: "Edit" / "Edit display" i ON DISPLAY-remsan. **ERSATT 2026-10-11 kväll av ägarbeslut O3 (v2): växlare på korten på `/badges`, ingen separat väljare.**
- **Q3 AVGJORD (ägarbeslut).** Night Owl nivå 6 = "23:30–00:29". Upphävd av trösklar v2 (2026-10-11): Night Owl har ett fönster, 21:00–03:59, i alla tiers.
- **Q4 AVGJORD.** Flavor visas på alla intjänade kort och i popupen, på egen rad.
- **B3.** Nedgradering/radering sker tyst (ingen vy). Oförändrat.
- **B6.** Showcase-ordning = arrayordning (platsnummer 1/2/3 vänster→höger). Oförändrat.
- **Kvar för Council-uppföljning:** inga (v1). v2-frågor: V2.14.

---

## 9. Vad i Components som ersatts

`RunQuest Components.dc.html` sektion 05 BADGES är omskriven enligt ADR 009. Den gamla "Mastery flash", "FLAUNT IT" och "pct" är borta. Sektion 04 "CHIPS, BADGES, STATUS" (klockans räknarbadge) är orörd. Ankaret `#badges` behålls. Obs: Components-exporten visar fortfarande pre-Council-uttrycket (2.6 s-andning, "View badges" i F6 m.m.); den här filen gäller före exporten där de skiljer sig (avsnitt 12).

---

## 10. Status per vy (beslut 54)

| ID | Vy | Referensbild | Mobil | Desktop | Status |
|---|---|---|---|---|---|
| F1 | Emblem-ark | `reference/f1.png` | n/a | ja | **KLAR** |
| F2 | Profil: samlingen | `reference/f2.png` | ja | ja | **KLAR** (Council-ändringar: avsnitt 12) |
| F3 | Showcase-väljare | `reference/f3.png` | ja | samma panel i 340 px-kolumn | **KLAR.** Desktop saknar egen bild; ägaren har godtagit noteringen "samma panel som mobil i 340 px sidokolumn" (Council 16). Builder ritar ingen egen desktopvariant. |
| F4 | Runner card | `reference/f4.png` | ja | samma panel i 340 px-kolumn | **KLAR.** Som F3: godtagen notering, exakt 340 px. |
| F5 | Board Season | `reference/f5.png` | ja | ja | **KLAR** (radhöjd, delta-avstånd: avsnitt 4) |
| F6 | Uppgraderingspopup | `reference/f6.png` | ja (340) | ja (400) | **KLAR** (utan "View badges", utan Got it-ring, flavor på egen rad) |
| F7 | News-rad + bell-popover | `reference/f7.png` | ja | ja | **KLAR** |
| F8 | Tomma, laddar- och fellägen | `reference/f8.png` | ja (330) | ja | **KLAR** |

Alla åtta vyer är KLARA att bygga. Byggaren får inte improvisera fram en desktopvariant av F3/F4; panelen är densamma.

> **v2:** F2, F3, F4 och F5:s placeringar är ersatta av F9–F12; status för v2-vyerna står i V2.12.

---

## 11. Förslag till STATE.md (Lead skriver, beslut 21–22)

**INFÖRT** (Rörelse-undantaget, STATE.md rad 92, ägarbeslut 2026-10-11): *"Undantag badges: engångständning 0.9 s i nivåhöjnings-popupen (alla nivåer; Common/Uncommon som ljusflimmer i ramen) och Legendary-andning på md/lg i tempot --rq-dur-glow 3.2 s, tre cykler och sedan statisk glöd, aldrig på sm; båda av under prefers-reduced-motion."* Texten här är uppdaterad så att den matchar den.

**EJ FUNNET i STATE.md vid kontroll 2026-10-11 (Lead avgör om det ska in):** övriga designspråk-raden för badges: *"Badges: åtta serier × sex nivåer (Common…Legendary), flavor-namn per tier. Emblem = kronsköld i CSS (`clip-path`) + RQIcon, aldrig egen `<svg>`; fyra lager (glow, ram, Heroic-ring, kärna); tokens `--rq-badge-*`. Nivån bärs alltid av namn + pips (+ Heroic-ring), aldrig bara färg. Heroic röd, Legendary guld. Räknare = 'held by X of N in your pack' (på din nivå eller högre, endast på intjänade kort), aldrig procent. Ingen belöning, popupknapp 'Got it'."* (Rörelse-meningen i det tidigare förslaget är ersatt av den införda texten ovan.)

> **v2:** STATE.md-raden för badges har sedan skrivits in (tre storlekar). Den ska ersättas av texten i V2.11 (fyra storlekar).

---

## 12. Krockar mellan Council-villkor och referensbilderna (byggaren: VILLKORET gäller)

| Bild | Vad bilden visar | Vad som byggs |
|---|---|---|
| F2 (mobil + desktop) | Held-by på låsta kort (Night Owl "3 of 6", Speedster "1 of 6") | Ingen held-by på låsta kort |
| F2 | Flavor liten/dämpad kursiv under kravtexten; kravtext med `"{Tier} — "`-prefix | Flavor egen rad, full textfärg, ≥ 14 px Barlow Condensed; kravtext utan nivåprefix, `--rq-text-2` |
| F2/F4 | Held-by 10 px dämpad mono | 11 px (`--rq-fs-eyebrow`), ≥ 4.5:1 |
| F2/F4 | Panelrubrikens `shield` 16/18 px | `--rq-icon-md` (17 px) |
| F4 | Held-by på varje rad, inklusive "Held by 6 of 6" (Earth Trotter) | Göms när X = N. **Tolkning:** Council 1 skriver "Runner card göms på icke-intjänade och X=N"; "icke-intjänade" listas inte ändå på Runner card, så X = N är den praktiska ändringen. Lead/kritiker kan bekräfta tolkningen |
| F3 | "Preview on leaderboard"-blocket | Byggs inte nu (uppföljning) |
| F3 | Rad med `opacity .75` vid 3/3; disabled-info bara som tooltip | Dimma växlaren, inte raden; SYNLIG text "3 of 3 on display — remove one first." |
| F3 desktop-text | "toggle sits on each collection card" | Gäller inte: samma väljarpanel som mobil, 340 px |
| F5 (podie rad 2) | "▼ 1" nästan i kontakt med första minin (ca 6 px) | ≥ 8 px |
| F5 mobil | Rest-rader med minis ca 15 px högre än raden utan | `min-height` på alla rest-rader |
| F5 | Legendary-mini med glöd (rad 2) | Behåll glöd; fallback utan glöd om kritikern anser att minis dominerar |
| F5 | Utmaningsskölden står på podiets `sub`-rad, minis på namnraden (olika rader) | Behåll: olika rader uppfyller "aldrig på samma rad" |
| F6 | Flavor inbakad i brödtexten (`A single run of 21.1 km — "Half Marathon".`) | Egen rad (se F6) |
| F6 | "View badges" i kö-varianten | Utgår |
| F6 | Permanent guldring (2 px, @ .35) runt "GOT IT" | Ingen; bara `--rq-focus-ring` på `:focus-visible` |
| F6/F1 | Legendary andas "loopande" (bildtext "BREATHES"/"IGNITES, THEN BREATHES") | Tre cykler på 3.2 s, sedan statisk glöd; ej `infinite`, ej 2.6 s |
| F6 | Common-popupen visar en platt ram utan tändning | Common/Uncommon tänds som ljusflimmer i ramen (syns inte i stillbild; flimrets styrka är designerns antagande, `--rq-badge-flash` 1.6, justeras mot upplevelsen i RUN-127) |
| F7 | (ingen krock) | Emblem `aria-hidden` tillkommer |

> **v2:** krockarna mellan v2-designen och villkoren står i V2.9.

---

## 13. Byggordning (Council 24)

RUN-127 (tokens, emblem) → RUN-131 + RUN-130 → RUN-128 → RUN-132 → RUN-129; RUN-122 (`badge_earned` i händelsekontraktet) när som helst.

> **v2:** byggordningen för omritningen står i V2.13.

#### V2.14 — Leads avgörande (2026-10-11)
Q1 (vimpel/minis, Council 8): designens separata celler godtas; kravet är ingen gemensam behållare (DOM-test). Q2 (nivå via popover på 44 px): godtas — nåbar med tryck och tangentbord, nivån bärs inte av färg ensam. Q3: utkastet kastas vid sidbyte, remsan inte sticky — utvärderas i preview. Q4: mellanbredderna godtas. Q5/Q6: byggaren mäter i skärmdump/kontrastberäkning; under 4.5:1 → tillbaka till Designern. Q8: mobilhjälten utan minis enligt designen (ägarbeslut: följ designen). Design Council körs inte separat för v2 (ägarens egen omritning; Council-villkoren är inbyggda i krocktabellen V2.9 och kritikerna granskar mot dem).
