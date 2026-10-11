# Badges — designdokument (Jira RUN-2, S1, spår: design-ny)

**Ändringslogg**

- **2026-10-11: Design Council + ägarbeslut inarbetade.** Council (alla fem röster: godkänt med villkor, 25 villkor) och ägarens beslut (E1/E2 Rörelse-undantaget i STATE.md, F3/F4 desktop = mobilpanelen i 340 px-kolumn, Night Owl nivå 6 = "23:30–00:29") är nu en del av spec:en. Där en referensbild (f1–f8) och ett villkor säger olika saker gäller VILLKORET; avsnitt 12 listar varje sådan krock. Gäller bygget RUN-127 och framåt (byggordning: avsnitt 13).
- 2026-10-11: första versionen (efter Claude Design-retur, före Council).

Designern 2026-10-11. Underlag: ADR 009 (godkänd 2026-10-11), ägarens Claude Design-retur (export 2026-10-11, se avsnitt 0), Design Councils dom (2026-10-11), STATE.md (Designspråk, Rörelse), `docs/design/designsprak-forslag.md`, `docs/design/temafil-forslag.css`, `packages/shared/src/badges.ts`.

**Status: facit finns (beslut 25/38) och Design Council har dömt: GODKÄNT MED ÄNDRINGAR.** Referensbilderna är sanningen om layout och uttryck; villkoren i den här filen går före bilden där de uttryckligen ändrar den (avsnitt 12). Alla åtta vyer är KLARA. F3 och F4 saknar egen desktopbild; ägaren har godtagit noteringen "samma panel som mobil i 340 px sidokolumn" (avsnitt 10). Ingenting här ändrar kod, `index.css` eller `temafil-forslag.css`: tokens skrivs in i RUN-127.

Det levande projektet: https://claude.ai/design/p/23754cb4-e3ec-4cd3-8cd8-4be2f0167208?file=RunQuest+Badge+System.dc.html

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

- **Hjältekort:** namn + tre `sm`-minis efter namnet.
- **BADGES-kort:** rubrik (Bebas guld, `shield` i `--rq-icon-md`) + "5 of 8 series"; **ON DISPLAY-remsa** (minis + "Edit" / desktop: namnen + "Edit display"); rutnät med åtta kort, **2 kolumner mobil, 4 kolumner desktop**.
- **Kort (intjänat), uppifrån:** emblem `md`, serienamn (versaler), nivå-chip, pips (+ "Tier N of 6"), **kravtext utan nivåprefix** ("A single run of 21.1 km", i `--rq-text-2`, sekundär), **flavor på egen rad** (`"Half Marathon"`: citerad kursiv, full textfärg, ≥ 14 px, Barlow Condensed), `"Next: {Nästa nivå} — {kravtext}"` (behåller nivånamn), **held-by** (mono, `--rq-fs-eyebrow` 11 px, ≥ 4.5:1). **Max:** guld versal "TOP TIER REACHED" i stället för Next-raden.
- **Kort (låst):** streckad kant, "Locked"-chip, tomma pips, måttetiketten, `"Unlock: Common — {kravtext}"` (behåller nivånamn). **Ingen held-by, ingen flavor.**
- **Held-by (endast intjänade kort):** "Held by X of N in your pack" där X = medlemmar på din nivå eller högre; X = 1 och betraktaren håller serien → "Only you hold this in your pack". Utelämnas utan platshållare när uppgift saknas.
- **Textregler:** all informationstext ≥ 4.5:1 och ≥ 11 px; ingen opacity-dimning av text (Council 9).
- **Alternativ (byggs inte):** kompakt sidolista ovanför MY TITLES.
- Flavor visas på ALLA intjänade kort (bilden visar den bara på tre; exemplet, inte regeln).

### F3 — Showcase-väljare · `reference/f3.png` · KLAR (mobil bild; desktop = samma panel, 340 px)

Panelen byggs EN gång och används oförändrad på mobil och desktop (desktop: 340 px-sidokolumn i Titles-layouten; kontrollera exakt 340 px). Växlare sitter på raderna i väljaren, inte på samlingskorten.

**Byggordning (Council 18):** (1) en rad per serie med växlare, (2) "Save display" + sparlägen, (3) ON DISPLAY-platspanelen (platserna 1–3 med ✕). **"Preview on leaderboard" skjuts till uppföljning och byggs inte nu** (bilden visar den; den ritas inte i RUN-128:s första leverans).

- **Rad:** `sm`-emblem, serienamn, nivå, växlare "Show" / "On display — N" / "Locked". Låsta serier: streckad rad med texten "Locked — cannot be selected" och växlare "Locked".
- **Växlaren:** `<button aria-pressed>`; mål ≥ 24 px (44 px på mobil). Vid 3/3: övriga växlare `aria-disabled="true"` och den SYNLIGA texten **"3 of 3 on display — remove one first."** visas i panelen (inte bara tooltip). Det är växlaren som dimmas, inte raden eller texten (Council 17; bildens rad-`opacity .75` utgår).
- **Platspanel:** platsmarkör 19 px (`--rq-titles-pos`), ✕ med `aria-label` ("Remove Streak Keeper from display"), mål ≥ 24 px (44 px mobil). Statusändringar i `aria-live="polite"`.
- **Sparlägen:** osparat → "SAVE DISPLAY"; sparar → "SAVING…" avstängd; sparat → grön kant "Saved — your Board card is updated." (`role="status"`); fel → röd kant "Could not save. Your pick is still here — try again." + RETRY (`role="alert"`). Semantisk röd/grön, aldrig nivåfärg.

### F4 — Runner card · `reference/f4.png` · KLAR (mobil bild; desktop = samma panel, 340 px)

Mobil: hjältekort (namn + tre minis, CHALLENGE = enda guldknappen) och BADGES-panel: bara intjänade serier, en rad per serie med `md`-emblem, namn, gulltonad "ON DISPLAY", **held-by**, nivå-chip till höger. **Desktop (ägarbeslut): exakt samma panel i 340 px-sidokolumnen ovanför TITLES; hjältekortets namnrad får de tre minis.** Ordning: visade först, sedan högst nivå, sedan serieordning. Tomläge: streckad ruta "No badges yet."

Held-by på Runner card (Council 1): visas inte för serier betraktade löparen inte har intjänat (de listas inte ändå) och visas inte när X = N (alla i gruppen är på nivån eller högre). Se avsnitt 12 (krock med bilden).

### F5 — Board, Season · `reference/f5.png` · KLAR (mobil + desktop)

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

---

## 8. Frågor — status

- **Q1 AVGJORD.** Held-by visas inte på låsta kort; på intjänade kort = medlemmar på din nivå eller högre (ADR `holders`). Inget "≥ tier 1"-antal behövs. Bildens siffror är platshållare.
- **Q2 AVGJORD (ägarbeslut).** Väljaren är samma panel på mobil och desktop (340 px-sidokolumn), växlare på raderna i väljaren, inte på samlingskorten. Inline som `DisplayPanel` på Titles. Ingång: "Edit" / "Edit display" i ON DISPLAY-remsan.
- **Q3 AVGJORD (ägarbeslut).** Night Owl nivå 6 = "23:30–00:29". Upphävd av trösklar v2 (2026-10-11): Night Owl har ett fönster, 21:00–03:59, i alla tiers.
- **Q4 AVGJORD.** Flavor visas på alla intjänade kort och i popupen, på egen rad.
- **B3.** Nedgradering/radering sker tyst (ingen vy). Oförändrat.
- **B6.** Showcase-ordning = arrayordning (platsnummer 1/2/3 vänster→höger). Oförändrat.
- **Kvar för Council-uppföljning:** inga.

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

---

## 11. Förslag till STATE.md (Lead skriver, beslut 21–22)

**INFÖRT** (Rörelse-undantaget, STATE.md rad 92, ägarbeslut 2026-10-11): *"Undantag badges: engångständning 0.9 s i nivåhöjnings-popupen (alla nivåer; Common/Uncommon som ljusflimmer i ramen) och Legendary-andning på md/lg i tempot --rq-dur-glow 3.2 s, tre cykler och sedan statisk glöd, aldrig på sm; båda av under prefers-reduced-motion."* Texten här är uppdaterad så att den matchar den.

**EJ FUNNET i STATE.md vid kontroll 2026-10-11 (Lead avgör om det ska in):** övriga designspråk-raden för badges: *"Badges: åtta serier × sex nivåer (Common…Legendary), flavor-namn per tier. Emblem = kronsköld i CSS (`clip-path`) + RQIcon, aldrig egen `<svg>`; fyra lager (glow, ram, Heroic-ring, kärna); tokens `--rq-badge-*`. Nivån bärs alltid av namn + pips (+ Heroic-ring), aldrig bara färg. Heroic röd, Legendary guld. Räknare = 'held by X of N in your pack' (på din nivå eller högre, endast på intjänade kort), aldrig procent. Ingen belöning, popupknapp 'Got it'."* (Rörelse-meningen i det tidigare förslaget är ersatt av den införda texten ovan.)

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

---

## 13. Byggordning (Council 24)

RUN-127 (tokens, emblem) → RUN-131 + RUN-130 → RUN-128 → RUN-132 → RUN-129; RUN-122 (`badge_earned` i händelsekontraktet) när som helst.
