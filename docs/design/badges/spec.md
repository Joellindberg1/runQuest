# Badges — designdokument (Jira RUN-2, S1, spår: design-ny)

Designern 2026-10-11. Underlag: ADR 009 (godkänd 2026-10-11), ägarens Claude Design-retur (export 2026-10-11, se avsnitt 0), STATE.md (Designspråk), `docs/design/designsprak-forslag.md`, `docs/design/temafil-forslag.css`, `packages/shared/src/badges.ts`.

**Status: facit finns (beslut 25/38). Referensbilderna är sanningen; den här filen är berättelsen runt dem.** Sex av åtta vyer är helt KLARA (F1, F2, F5, F6, F7, F8). F3 och F4 är klara på mobil men saknar desktopbild (bara textnotering i designen), se avsnitt 10. Allt som tidigare stod som "förslag/ÖPPEN" och som designen nu avgjort är ersatt av beslutet nedan. Ingenting här ändrar kod, `index.css` eller `temafil-forslag.css`: tokens skrivs in i RUN-127 efter Council.

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

Exporten är en ögonblicksbild 2026-10-11. `runquest-badges.js` är enda källan för tierfärger, gradienter, emblemgeometri, storlekar, chip-/pips-recept samt serier med kravtexter och flavor-namn. Vid avvikelse mellan den här filen och källan: källan vinner, öppna projektet.

---

## 1. Fasta beslut (ADR 009 och tidigare ägarbeslut — ifrågasätts inte här)

| Beslut | Källa |
|---|---|
| Sex nivåer: Common, Uncommon, Rare, Heroic, Epic, Legendary | ADR 009 beslut 1 |
| Åtta serier: Milestoner, Earth Trotter, Climber, Streak Keeper, Early Bird, Night Owl, Speedster, Precisionist. Socialite och Weathered Soul visas inte (inte heller som "coming soon") | ADR 009 beslut 8; F1 visar åtta |
| En rad/kort per serie = bästa nivån just nu | ADR 009 beslut 1 |
| Ingen global percentil. Räknaren är "Held by X of N in your pack" | ADR 009 beslut 7; F2, F4, F6 |
| Ingen belöning vid nivåhöjning. Popupknappen är "Got it" | ADR 009 beslut 5; F6 |
| Upp till 3 visade serier; syns på Board (endast Season) och Runner card; profilen visar hela samlingen + väljaren | ADR 009 beslut 4; F2–F5 |
| Låst serie visar kravet för första nivån ("Unlock: Common — …"); inget framsteg lagras, inga progressbars | ADR 009 beslut 1, 4; F2 |
| Popup: en per serie (högsta nya nivå), kö vid flera, väntar tills changelog-popup/onboarding är stängd | ADR 009 beslut 5 |
| News: `badge_earned` under Levels; "earned" första gången, "evolved" vid uppgradering | ADR 009 beslut 5; F7 |
| Badges är återkallbara; inget "lost badge"-meddelande i v0.6.0 | ADR 009 beslut 2 |
| Allt är gruppavgränsat | ADR 009 beslut 9 |

---

## 2. Ägarens beslut på smakfrågorna (utlästa ur facit)

Där designen visar två alternativ står vilket som är PRIMÄRT enligt bildtexterna; alternativet byggs inte.

| Fråga | Beslut | Belägg |
|---|---|---|
| **S1 Heroic** | **Röd (#f87171) är primär.** Amber (#fbbf24) är alternativ och byggs inte. | F1 rad 2: "HEROIC – RED (PRIMARY)" / "HEROIC – AMBER (ALTERNATIVE)". Källan: `heroicAmber` default `false`. |
| **S1 icke-färgmarkör** | **Heroic får en hairline-ring** (vit, .55) mellan ram och kärna: fjärde emblemlagret. Dessutom 4 av 6 pips och nivånamn i chip/tooltip. Uncommon har ingen ring och 2 pips. | F1 anatomi (3), F1 "COLOUR-BLIND CHECK · UNCOMMON VS HEROIC", F1 skala "GLOW + HAIRLINE RING"; F8 avvikelse (1). Källan: `ring`-lagret, `heroicRing`. |
| **S2 Legendary** | **Guld (#ffd700) är primär.** Orange (#ff9a1f) är alternativ och byggs inte. **Andas på `md`/`lg`, aldrig på `sm`.** Statisk glöd är fallback ("LEGENDARY – STATIC FALLBACK"). | F1 rad 2 "GOLD (PRIMARY)", "ORANGE (ALTERNATIVE)", "STATIC FALLBACK"; F1 skala "BREATHES · M/L ONLY"; F1 storlekar "LEGENDARY NEVER BREATHES AT MINI". Källan: `legendaryOrange` default `false`, `breathe` default `true`. |
| **S2 rörelse i övrigt** | Engångs-"tändning" 0.9 s ease-out när popupen öppnas, för alla nivåer (syns bara från Rare, där en glöd finns). Legendary tänds och går sedan över i andning (andningen startar 1.3 s in). Ingen studs, inga konfetti. | F6 rubrik "IGNITE ONCE (0.9 S EASE-OUT), NO BOUNCE, NO CONFETTI"; F6 caption "LEGENDARY · IGNITES, THEN BREATHES". |
| **S3 Form** | **Kronsköld** (polygon 50% 0, 100% 14%, 100% 60%, 50% 100%, 0 60%, 0 14%). Skiljs från utmaningsskölden på Board genom att utmaningstecknet förblir en platt, dämpad guldsköld utan ikon. | F1 hela arket; F5 caption "FLAT SHIELD = CHALLENGE TOKEN, CREST = BADGE". |
| **S4 Placering, profil** | **Mobil: BADGES-kortet direkt under hjältekortet.** **Desktop: i huvudkolumnen under hjältekortet är PRIMÄR**; sidokolumnen ovanför MY TITLES (kompakt lista: emblem, namn, chip) är alternativ och byggs inte. | F2 captions "MOBILE 402 · UNDER THE HERO CARD", "DESKTOP 1440 · MAIN COLUMN PLACEMENT (PRIMARY) + SIDE-COLUMN ALTERNATIVE". |
| **S4 Placering, Board** | **Minis inline i befintlig rad**, ingen egen rad. Podiekort: på namnraden efter namn + delta. Rest-rader mobil: på `sub`-raden efter "Lvl N · X km". Desktop: efter namnet i löparcellen. Löpare utan showcase: ingenting. | F5 captions och bild. |
| **S4 Placering, Runner card** | Mobil: BADGES-panel direkt under hjältekortet. Desktop (endast text i designen): samma panel i 340 px-sidokolumnen ovanför TITLES; hjältekortets namnrad får de tre minis. | F4 bild + text "DESKTOP PLACEMENT". Se F4 desktop i avsnitt 10. |
| **S4 Spara/redigera** | **Explicit "Save display"** (guld-hårlinje, sekundärknapp, som Titles `DisplayPanel`), inget autospar. Ingången är länken "Edit" (mobil) / "Edit display" (desktop) i ON DISPLAY-remsan på profilen. Väljaren: tre numrerade platser (guldfylld kvadrat 1/2/3, ✕ för att ta bort), "Preview on leaderboard" (rad "4 JOEL LINDBERG" + minis), därunder en rad per serie med växlare "Show" / "On display — N" / "Locked". Vid 3/3 dämpas övriga växlare (rad `opacity .75`, tooltip "3 of 3 on display — remove one first."). Låsta serier: streckad rad, "Locked — cannot be selected". Ingen omsortering: ta bort och lägg till igen. | F3 hela bilden. |
| **S5 Flavor** | **Flavor-namn visas per tier**: kursiv, citerad rad under kravtexten på intjänade samlingskort ("Half Marathon") och i popupens brödtext (`A single run of 21.1 km — "Half Marathon".`). Visas inte på låsta kort eller i "Next:"-raden. | F2 kort, F6 brödtext. Källan: `fl` per tier (48 st). |
| **S5 "The" före serienamn** | **Bort**: "Milestoner", "Climber" osv. | Alla bilder; källan `SERIES[].name`. |
| **S5 Kortets täthet** | Mobil: lodrätt kort (emblem `md` överst, sedan namn, chip, pips, kravrad, flavor, nästa-rad, held-by). Desktop: emblem till vänster, namn + chip + pips till höger, text under. Streckad kant på låsta kort. | F2. |
| **Popupvarianter** | `Badge earned` (ny: ingen gammal nivå), `Badge evolved` (gammal nivå som `sm` + pil + ny `lg`, nivåraden "UNCOMMON → RARE" i nya nivåns färg), kö: eyebrow "BADGE EARNED · 1 OF 3" + ghost-knappen "Skip all" + tyst länk "View badges". **"Got it" är alltid den enda guldknappen.** Bredd 400 px desktop, 340 px mobil. | F6 fem varianter. |
| **News-raden** | `sm`-emblem (nya nivån) ersätter `zap` i ikonkolumnen; kantens färg förblir Levels-grön; Levels-filterchippet behåller `zap`. Alternativet (kvar `zap`, rad 3) byggs inte. Texter: "Karl earned Streak Keeper — Common." / "You evolved Milestoner from Uncommon to Rare." | F7 caption "ROW 3 = ALTERNATIVE KEEPING THE ZAP", "MINI EMBLEM REPLACES THE ZAP IN THE ICON COLUMN". |

### 2.1 Följdbeslut som designen avgjorde åt oss (ersätter tidigare B-frågor)

- **B1 flavor:** ja, alla 48 ingår (se avsnitt 6). Earth Trotter tier 6 heter "Ten Thousand".
- **B2 "Held by" på låsta kort:** designen VISAR raden på låsta kort när någon i gruppen håller serien ("Held by 3 of 6 in your pack" på låst Night Owl) och utelämnar den när ingen gör det ("Held by 0" skrivs aldrig ut, F8). Det avgör inte vad talet betyder för en låst serie, se öppen fråga Q1.
- **B4 "Counts Strava runs":** ingen vy visar någon sådan hint. Den byggs inte.
- **B5 Speedster-text:** "A 5 km run under 35:00" (ingen split-lögn).
- **B7 layoutskift på Board:** designen väljer inline; se avvikelse 9 om radhöjden på mobil.
- **Alternativen** (`ALT` i källan: Heroic amber, Legendary orange) tas inte med i tokens.

---

## 3. Emblemet (ur `runquest-badges.js`)

Fem lager, byggda på ett CSS-`clip-path`; ikonen är RQIcon, aldrig egen `<svg>`.

1. **glow** (yttre wrapper): `filter: drop-shadow`, och `color` = nivåns färg när den andas.
2. **frame**: kronskölden, bakgrund = nivåns gradient (låst: `rgb(ink / .12)`).
3. **ring** (endast Heroic): samma sköld, `inset: ring1`, bakgrund `rgb(ink / .55)`. Övriga nivåer: transparent.
4. **core**: samma sköld, `inset` = `core` (Heroic: `ring2`), fyllning `#1c1c1c`, ikonen centrerad.
5. **ikon**: serieikon i nivåns färg (låst: `rgb(ink / .28)`), samma ikon på alla sex nivåer.

| Storlek | Bredd × höjd | Ikon | core-inset | Heroic ring1 / ring2 | Används i |
|---|---|---|---|---|---|
| `mini` (sm) | 28 × 31 | 15 | 2 | 2 / 3 | hjältens namnrad, Board, ON DISPLAY-remsan, picker-rader, News, Runner card hero, bell-popover |
| `medium` (md) | 56 × 63 | 24 | 3 | 4 / 5.5 | samlingskort, Runner card-lista, F8 skeleton/tomläge |
| `large` (lg) | 96 × 108 | 42 | 5 | 7 / 9 | popupen, F1 |

Höjd = bredd × 1.12, avrundad (31 / 63 / 108). Ikonen är RQIcon 15 / 24 / 42 px.

**Glöd (drop-shadow, `sm` / `md` + `lg`):**

| Nivå | Glöd | Rörelse |
|---|---|---|
| Common | ingen | ingen |
| Uncommon | ingen | ingen |
| Rare, Heroic, Epic | 4 px / 7 px, nivåfärg @ .45 | ingen |
| Legendary | 5 px / 10 px, nivåfärg @ .60 | `md`/`lg`: `rqGlow` 2.6 s ease-in-out infinite (drop-shadow 3 px → 13 px, `currentColor`); `sm`: statisk |
| Alla, i popupen | — | `rqIgnite` 0.9 s ease-out both (från glöd 0 till nivåns egen); Legendary: därefter `rqGlow` 2.6 s med 1.3 s fördröjning |

**Låst (tier 0):** ram `rgb(ink / .12)`, ikon `rgb(ink / .28)`, ingen glöd, tomma pips, tooltip "Locked".

**Nivå får aldrig bäras av färg ensam:** chip med nivånamn på `md`/`lg`, `title` + `aria-label` ("Rare Milestoner") på `sm`, sex pips överallt, Heroic-ring.

**Nivå-chip (status-receptet):** tint .10 / kant .45 / text i full nivåfärg, versaler. Låst: tint .05 / kant .18 / text .45, texten "Locked". **Pips:** sex kvadrater, 6 px, gap 3 px; fyllda t.o.m. aktuell nivå i nivåfärg, resten `rgb(ink / .12)`. Position, aldrig framsteg.

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

Panelrubrikens ikon är `shield` (finns i `runquest-icons.js`).

---

## 4. Ramar F1–F8

Viewport: mobil 402, desktop 1440. Mörkt tema; ljust är förberett men inte ritat.

### F1 — Emblem-ark · `reference/f1.png` · KLAR

Komponentarket (Components, sektion 05, ankare `#badges`; bildens flikrad visar COLORS … ICONS). Innehåll: sex nivåer med chip/pips/glödlägen, Heroic röd + amber (alt) och Legendary guld + orange (alt) + statisk fallback, matris 8 × 6 på `md`, låst-rad för alla åtta, storlekar mini/md/lg för alla sex nivåer, 1:1-mini på panel och podiekort ("JOEL LINDBERG" / "KARL PERSSON" med tre minis), anatomi (fem delar), färgblindskontroll Uncommon vs Heroic. Mobil: ej tillämpligt (komponentark). Ritas inte: hover/fokus på emblem, deuteranopi-simulering (paret visas i dämpat läge), ljust tema.

### F2 — Profil: samlingen · `reference/f2.png` · KLAR (mobil + desktop)

- **Hjältekort:** namn + tre `sm`-minis efter namnet, i mobil och desktop.
- **BADGES-kort:** rubrik (Bebas guld, shield-ikon) + "5 of 8 series"; **ON DISPLAY-remsa** (guld-tint, minis + "Edit" / desktop: minis, namnen "Streak Keeper · Early Bird · Milestoner" och "Edit display"); rutnät med åtta kort, **2 kolumner mobil, 4 kolumner desktop**.
- **Kort (intjänat):** emblem `md`, serienamn (versaler), nivå-chip, pips, `"{Nivå} — {kravtext}"`, flavor (kursiv, citerad), `"Next: {Nästa nivå} — {kravtext}"`, held-by (mono). **Max:** guld versal "TOP TIER REACHED" i stället för Next-raden. **Låst:** streckad kant, "Locked"-chip, tomma pips, måttetiketten, `"Unlock: Common — {kravtext}"`, held-by om > 0.
- **Held-by:** "Held by X of N in your pack"; X = 1 och betraktaren håller serien → "Only you hold this in your pack".
- **Alternativ (byggs inte):** kompakt lista i sidokolumnen ovanför MY TITLES (bildens nedre högra panel).
- **Tillstånd som ritas i bilden:** blandat (Rare, Uncommon, Common, Legendary-max, Heroic, tre låsta). Resten i F8.
- Anm: flavorn syns bara på tre kort i bilden (Milestoner, Climber, Streak Keeper); det är exemplet, inte regeln. Antagande (flaggat, Q4): flavor visas på alla intjänade kort, eftersom alla 48 finns i källan.

### F3 — Showcase-väljare · `reference/f3.png` · KLAR för mobil; desktop saknar egen bild (se avsnitt 10)

Mobil: ON DISPLAY-panel (3/3 med platserna 1–3, ✕), "Preview on leaderboard", "SAVE DISPLAY", därunder åtta rader med växlare. Högerspalten ritar tomplats (streckad, platsnummer i kontur-ruta), sparlägen (osparat → "SAVE DISPLAY"; sparar → "SAVING…" avstängd; sparat: grön kant "Saved — your Board card is updated."; fel: röd kant "Could not save. Your pick is still here — try again." + RETRY; disabled-tooltip). Desktop: bara texten "Desktop uses the same panel at 340 px in the Titles layout · toggle sits on each collection card". Obs: den texten och mobilbilden beskriver två olika växlarplaceringar (rader i väljaren resp. på varje samlingskort); se Q2.

### F4 — Runner card · `reference/f4.png` · KLAR för mobil; desktop saknar egen bild (se avsnitt 10)

Mobil: hjältekort (namn + tre minis, "#1 in the group · Lvl 24 · The Double Trouble", CHALLENGE = enda guldknappen) och BADGES-panel ("6 of 8 series"): bara intjänade serier, en rad per serie med `md`-emblem, namn, gulltonad "ON DISPLAY" efter namnet, held-by (mono), nivå-chip till höger. Ordning: visade först, sedan högst nivå, sedan serieordning. Tomläge: streckad ruta "No badges yet." Desktop: texten "Same BADGES panel in the 340 px side column, above TITLES. Hero line gets the 3 minis after the name, exactly as in F2 desktop."

### F5 — Board, Season · `reference/f5.png` · KLAR (mobil + desktop)

Mobil: podiekort med minis på namnraden efter namn + delta; rest-rader med minis på `sub`-raden; rad utan showcase (Adam Einstein): inget. Desktop: tabell med minis efter namnet; rad 6 med längsta namnet + tre minis (namnet ellipsiserar, minis krymper inte). Hela raden öppnar Runner card; minis är dekorativa (`title` + `aria-label` på gruppen). Bara Season-vyn. Se avvikelse 9 om radhöjd.

### F6 — Uppgraderingspopup · `reference/f6.png` · KLAR (desktop 400 px + mobil 340 px)

Fem varianter: earned (Night Owl, Common), evolved (Milestoner Uncommon→Rare, gammal nivå som `sm`), evolved Legendary (Streak Keeper Epic→Legendary, "Only you hold this in your pack"), kö (Early Bird, "1 OF 3", Skip all + View badges), mobil (340 px i 402-skärm). Uppbyggnad uppifrån: ✕ (uppe till höger), eyebrow (mono, guld), emblem `lg` (evolved: gammalt `sm` + `→` + nytt `lg`), serienamn (Bebas 28, vit), nivårad i nya nivåns färg (endast evolved), chip, brödtext (`{kravtext} — "{flavor}".`, max 280 px), held-by (mono), "GOT IT" (guldfylld, 2 px ring i guld @ .35, offset 2). Panel: `rgba(20,20,20,.98)` (= `--rq-popover`), hårlinje, `0 24px 60px` skugga.

### F7 — News `badge_earned` · `reference/f7.png` · KLAR (mobilflöde + desktop bell-popover)

Rad: 3 px grön vänsterkant (Levels), `sm`-emblem i ikonkolumnen (30 px bred kolumn i designen), typrad "Badge earned" / "Badge evolved" i grön versal, tid till höger, text under. Oläst = grön tint (.06), läst = grundton. Popovern: "THE PACK NEWS" med ✕, filterchips Levels (valt, `zap`) / Titles / Challenges, samma rader. Desktops helsides-News ritas inte separat; raden är densamma som i popovern.

### F8 — Tillstånd · `reference/f8.png` · KLAR

Kolumnbredd 330 px (panelnivå, oberoende av viewport). Skeleton: tre kort med skölds-block 56 × 63 + tre streck, pulserande (`rqSkel` 1.6 s, stagger .2 s) i stället för spinner. Inga badges än: streckad ruta, "NO BADGES YET" (Bebas), "Log a run to start collecting.", åtta låsta minis. Fel: rött kantkort "COULDN'T LOAD YOUR BADGES" / "Your runs are safe." / RETRY. Held-by saknas: raden utelämnas utan platshållare. Board vid badgefel: ingenting. Samt F8-rutan "NEW TOKENS · DEVIATIONS" (se avsnitt 5 och 7).

---

## 5. Tokenförslag (skrivs INTE nu — RUN-127 efter Council)

Skrivs som sektion 1.34 i `docs/design/temafil-forslag.css` och speglas ordagrant i `apps/frontend/src/index.css`. Prefixet är `--rq-badge-*`, inte `--rq-tier-*` som F8-rutan föreslår: `--rq-tier-minor/major/legendary` finns redan för utmaningar och `--rq-tier-legendary` (#ffd700) skulle krocka i namn. Likaså `--rq-popup-w` → `--rq-badge-popup-w`, `--rq-pip` → `--rq-badge-pip`.

Värdena är `runquest-badges.js` ordagrant. Nivåfärgerna är emblemmaterial och definieras som egna literaler, inte alias till `--rq-up`/`--rq-down`/`--rq-gold`, så att de inte följer med om ljust tema binder om rollfärgerna. (Ljust tema är inte ritat; det är en förberedelse, ingen avvikelse.) Vakttestet kräver att varje deklarerad token läses och varje läst deklareras; beskär efter byggets faktiska konsumenter.

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
--rq-badge-w-sm:     28px;   --rq-badge-h-sm:  31px;   --rq-badge-icon-sm: 15px;
--rq-badge-w-md:     56px;   --rq-badge-h-md:  63px;   --rq-badge-icon-md: 24px;
--rq-badge-w-lg:     96px;   --rq-badge-h-lg: 108px;   --rq-badge-icon-lg: 42px;
--rq-badge-core-sm:  2px;    --rq-badge-core-md: 3px;  --rq-badge-core-lg: 5px;      /* kärnans inset (ramtjocklek) */
--rq-badge-ring-sm:  2px;    --rq-badge-ring-md: 4px;  --rq-badge-ring-lg: 7px;      /* Heroic: ringens inset */
--rq-badge-ring-core-sm: 3px; --rq-badge-ring-core-md: 5.5px; --rq-badge-ring-core-lg: 9px;  /* Heroic: kärnans inset */
--rq-badge-core:     #1c1c1c;                       /* kärnans fyllning */
--rq-badge-ring:     rgb(var(--rq-ink-rgb) / .55);  /* Heroic hairline-ring */
--rq-badge-locked-frame: var(--rq-line-4);          /* låst: ram .12 */
--rq-badge-locked-icon:  var(--rq-text-5);          /* låst: ikon .28 */
--rq-badge-pip:      6px;    --rq-badge-pip-gap: 3px;   /* tom pip = --rq-line-4 (.12) */

/* Glöd (drop-shadow-parametrar; recept: 0 0 <blur> rgb(<nivå>-rgb / <alfa>)) */
--rq-badge-glow-sm:        4px;    --rq-badge-glow-ml:        7px;    --rq-badge-glow-alpha: .45;       /* Rare, Heroic, Epic */
--rq-badge-glow-leg-sm:    5px;    --rq-badge-glow-leg-ml:   10px;    --rq-badge-glow-leg-alpha: .60;   /* Legendary */
--rq-badge-breathe-min:    3px;    --rq-badge-breathe-max:   13px;                                      /* rqGlow (Legendary md/lg) */
--rq-dur-badge-breathe:    2.6s;   /* rqGlow, loop; podium #1-glöden är --rq-dur-glow 3.2s och en annan sak */
--rq-dur-badge-ignite:     .9s;    /* rqIgnite, engångs, ease-out */
--rq-badge-ignite-handoff: 1.3s;   /* Legendary i popupen: andningen startar här */

/* Layout (mobil = standard; desktop skriver över i avsnitt 2) */
--rq-badge-grid-cols:    repeat(2, minmax(0, 1fr));   /* samlingen i profilen (desktop 4) */
--rq-badge-popup-w:      340px;                        /* uppgraderingspopupen (desktop 400px; krymper till 95 % av skärmen) */
--rq-badge-news-icon-w:  30px;                         /* News-radens ikonkolumn när den bär ett sm-emblem (idag --rq-news-row-cols 26px) */
```

Återanvänds i stället för nya tokens: platsmarkören 19 px i väljaren = `--rq-titles-pos`; popupens panel = `--rq-popover`, kant `--rq-line-4`, skugga `--rq-shadow-pop`; held-by-mono och eyebrows = `--rq-font-mono`; chip = `.rq-chip--status` (tint `--rq-tint-status`, kant `--rq-edge-status`); skeleton = befintliga `.rq-skel-block`. Nivå-mappning utan hex i komponent-CSS: `[data-tier="rare"] { --rq-badge-c: var(--rq-badge-rare); --rq-badge-c-rgb: var(--rq-badge-rare-rgb); --rq-badge-grad: var(--rq-badge-rare-grad); }` för sex nivåer.

Typsteg: källan använder literaler (chip 11 px/.16em, held-by 10–11 px mono/.10em, flavor 12–13 px kursiv). Buildern snappar till `--rq-fs-*`/`--rq-ls-*` (chip → `--rq-fs-chip`, held-by → `--rq-fs-eyebrow`), se avvikelse 11. Nya keyframes behövs: `rqBadgeGlow` (drop-shadow 3 → 13 px, `currentColor`) och `rqBadgeIgnite` (från `drop-shadow(0 0 0 transparent)`). Befintliga `rqGlowIcon` (3.2 s) återanvänds bara om dess amplitud verifieras lika i RUN-127.

---

## 6. Copy: designen (`runquest-badges.js`) mot `packages/shared/src/badges.ts`

Designen är facit för copy. Tiernamnen (Common…Legendary) är identiska. Serienycklar (`earth_trotter` osv.) påverkas inte; källans nycklar (`earth`, `streak`, …) är bara designprojektets egna.

| Serie / tier | Kod idag (`requirementText`) | Design (facit) |
|---|---|---|
| Milestoner 1–6 | "Run 5 km in a single run" … "Run 50 km in a single run" | "A single run of 5 km" … "A single run of 50 km" |
| Earth Trotter 1–6 | "Run 100 km in total" | "100 km total distance" (1,000 / 10,000 med tusenavgränsare som idag) |
| Climber, namn | "The Climber" | "Climber" |
| Climber 1–6 | "Climb 500 m in total" | "500 m of elevation gain" |
| Streak Keeper 1–6 | "Reach a 3-day streak" | "3 days in a row" |
| Early Bird 1–4 | "Start 5 runs between 04:00 and 06:59" | "5 runs started 04:00–06:59" |
| Early Bird 5–6 | "Start 50 runs between 04:00 and 05:59" | "50 runs started 04:00–05:59" |
| Night Owl 1–4 | "Start 5 runs between 21:00 and 03:59" | "5 runs started 21:00–03:59" |
| Night Owl 5 | "Start 25 runs between 22:30 and 03:59" | "25 runs started 22:30–03:59" |
| Night Owl 6 | "Start 10 runs between 23:30 and **00:29**" | "10 runs started 23:30–**00:30**" (se Q3) |
| Speedster 1–6 | "A 5 km run **in** under 35:00" | "A 5 km run under 35:00" |
| Precisionist 1–4 | "Finish 3 runs on an exact whole km" | "3 runs on an exact whole km" |
| Precisionist 5 | "Run exactly 21.10 km in a single run" | "One run of exactly 21.10 km" |
| Precisionist 6 | "Run exactly 10.00 km, 21.10 km and 42.20 km (one run each)" | "One run each of exactly 10.00, 21.10 and 42.20 km" |
| Måttetikett per serie (låst kort rad 1) | finns inte | "Longest single run", "Total distance", "Total elevation gain", "Longest run streak", "Early starts", "Late starts", "Fastest 5 km", "Exact finishes" |
| Flavor per tier (`fl`) | finns inte | 48 namn, se tabellen nedan |

**Flavor-namn (designen, 1 → 6):**

| Serie | Common | Uncommon | Rare | Heroic | Epic | Legendary |
|---|---|---|---|---|---|---|
| Milestoner | First Five | Double Digits | Half Marathon | The Long Haul | Marathon | Ultra |
| Earth Trotter | Off the Mark | Road Worn | Four Figures | The Long Way | Coast to Coast to Coast | Ten Thousand |
| Climber | Foothills | Ben Nevis | Mont Blanc | Kilimanjaro | Everest | Everest, Twice |
| Streak Keeper | Long Weekend | Full Week | Fortnight | Calendar Month | Two Months | The Hundred |
| Early Bird | First Light | Dawn Patrol | Sunrise Regular | Morning Fixture | Before the Birds | The Dark Hours |
| Night Owl | Lights Out | Street-lamp Pace | Closing Time | Nocturnal | Past Midnight | The Midnight Run |
| Speedster | Moving | Brisk | Quick | Fast | Sub-20 | Flying |
| Precisionist | On the Nose | Measured | Calibrated | Clockwork | The Half, Exactly | The Full Set |

**Sammansättning (frontendens ansvar, inte shared):** kort `"{Tier} — {krav}"`, nästa `"Next: {Tier} — {krav}"`, låst `"Unlock: Common — {krav}"`, popup `"{krav} — "{flavor}"."`.

**Förslag (liten story/fix, Lead skapar; Designern ändrar inte koden):** i `badges.ts` (1) skriv om alla `requirement`-funktioner enligt kolumnen Design; (2) byt `name: 'The Climber'` till `'Climber'`; (3) lägg till `flavors: readonly [string x6]` och `metricLabel: string` i `BadgeSeriesDef` samt en `tierFlavor(series, tier)` bredvid `requirementText`; (4) uppdatera enhetstesterna för kravtexter (snapshot/fixturer); (5) ingen ändring i motor, mått eller DB (texterna lagras inte). Beslut Q3 (Night Owl-fönstrets slutminut) måste tas innan texten ändras.

---

## 7. Avvikelser från designspråket (eskaleras till Design Council, beslut 15d)

1. **Rörelse (regel 8), Legendary-andning.** `md`/`lg` loopar en glöd (2.6 s) på en nivå som inte är en "levande sak" i regelns mening; syns i F2 (Legendary-kort), F4, F6. Argument: samma ställning som podium #1-glöden; `sm` är statisk; `prefers-reduced-motion` hanteras globalt; statisk fallback finns i F1. Ägaren har valt andning som primär. Council avgör om den får stå eller om fallbacken blir standard. Dessutom går andningen (2.6 s) i annan takt än podium #1 (3.2 s).
2. **Ikonstege (regel 10).** Emblemikonen är 15 / 24 / 42 px, inte 15 / 17 / 21. Argument: ikonen skalar med emblemet; `sm` ligger på stegets minimum. Dessutom ritas panelrubrikens `shield` i 16 och 18 px (F2/F4): bygg i `--rq-icon-md` (17 px), ingen avvikelse.
3. **Färg (regel 3).** Två nya accentfamiljer (Epic lila, Rare blå som ligger nära `--rq-tier-minor` och löpbandsblått) och en ny betydelse för Heroic-röd. Mildring: nivåfärgen finns bara som emblemmaterial och status-chip, aldrig som varnings-/statusfärg; nivån bärs också av namn, pips och (Heroic) ring.
4. **Heroic-röd intill röda semantiska element.** Konkret i designen: F5 rad 2, "JOEL LINDBERG" följs av den röda deltan "▼ 1" direkt före Heroic-minin. Dessutom röda `streak_broken`-rader i News, röda felkort och sparfel (F3, F8), `RETRY`. Röd Heroic-chip (F2 Early Bird) liknar ett felchip. Mildring: ringen, pips, nivånamn i klartext, och att Heroic är material (gradient + glöd) medan semantisk röd är platt text/kant.
5. **Guld (regel 3/10), "en guldknapp per vy".** Legendary-emblemet är guld och glöder. F6: guldknappen "GOT IT" + guldeyebrow + guld Legendary-emblem i samma dialog. F2: guld "TOP TIER REACHED" + guldemblem + guldtonad ON DISPLAY-remsa. F5: Legendary-minis (guld) bredvid rank 1 (guld = rank). Ingen extra guldKNAPP tillkommer (F3 "Save display" är hårlinje-sekundär, F4 CHALLENGE är enda fyllda). Frågan är om guld som material späder ut rank 1-guldet på Board.
6. **Fjärde emblemlagret (Heroic-ringen).** Vit hairline på .55; vid `sm` är ringen bara 1 px (ring1 2 px, ring2 3 px). Council bedömer om den läses vid 28 px (se F1 1:1-raden).
7. **Kronsköld mot utmaningsskölden (F5).** Badge-minin (28 × 31, gradient, ikon) bredvid utmaningsskölden (platt, 13 × 15, guld @ .3 i podiets titelrad; 22 × 27 i ribbons). Skillnaden är ikon + gradient + storlek. Council bedömer förväxlingsrisken (det var S3:s oro; ägaren valde kronsköld).
8. **Ny komponent, gradient mot platta ytor.** Emblemet (gradient + glöd) är ingen av de tre kortvarianterna; följer Components-förlagan.
9. **F5 mobil: radhöjd.** Bildtexten säger "row height constant", men i bilden är rest-rader med minis (rad 4 och 6) ca 15 px högre än raden utan (rad 5), eftersom `sub`-raden växer från textens höjd till minins 31 px. Då hoppar raderna när `GET /api/badges/group` landar efter `users-with-runs` (B7). Förslag till Council: `sub`-raden får `min-height` = minins höjd (`--rq-badge-h-sm`) på ALLA rest-rader så att höjden är konstant; alternativet är att acceptera tillväxten. Desktop har konstant höjd i bilden.
10. **F6 "Got it"-ring.** Knappen har en permanent 2 px guldring @ .35 med offset 2 (den ser ut som en dubbelkant). Standardreceptet är `--rq-focus-ring` (full guld) vid `:focus-visible`. Förslag: använd standardfokus, ingen permanent ring.
11. **Literaler utanför typ-/spärrskalan.** Chip 11 px/.16em, held-by 10 px mono/.10em, kort-brödtext 13/14 px, popupens eyebrow 11 px/.30em. Buildern snappar till närmaste `--rq-fs-*`/`--rq-ls-*` (regel 1); Council kan bevaka att snappningen inte tappar läsbarhet i `md`-kortets held-by (10 → 11 px).
12. **Tokennamn.** Designens F8-ruta använder `--rq-tier-*`, `--rq-emblem-*`, `--rq-pip`, `--rq-popup-w`, `--rq-glow-static`. Vi använder `--rq-badge-*` (avsnitt 5) för att inte krocka med utmaningstokens. Ingen innehållsavvikelse.
13. **Innehåll, inte språk:** held-by på låsta kort (Q1) kontra ADR 009 beslut 7.

---

## 8. Öppna frågor kvar (ingen motsäger ADR 009)

- **Q1. Vad betyder "Held by X of N" på ett låst kort?** Designen visar talet (Night Owl låst: 3 av 6). Antagande: medlemmar som håller serien alls (tier ≥ 1). För intjänade kort: medlemmar på din nivå eller högre (ADR `holders`). Bildens siffror är platshållare (de motsäger sig själva: Karl visas med "Held by 1 of 6" på Heroic Streak Keeper medan Joel håller Legendary). Kräver att `GET /api/badges/group` kan leverera "≥ tier 1"-antalet; Lead/ADR avgör.
- **Q2. Hur nås väljaren?** Mobil: "Edit" i ON DISPLAY-remsan öppnar F3-panelen (antagande: inline, som `DisplayPanel` på Titles; ej ritat om det är inline eller sheet). Desktop-noteringen i F3 talar om växlare på varje samlingskort, mobilbilden om rader i väljaren. Antagande tills F3 desktop finns: samma väljarpanel som mobil, 340 px.
- **Q3. Night Owl tier 6, slutminut.** Design: "23:30–00:30". Kod: "23:30 and 00:29". Fönstret är halvöppet [23:30, 00:30) och alla andra intervall visar sista inräknade minuten (06:59, 03:59, 05:59), så 00:29 är konsekvent med motorn; 00:30 skulle läsas som att en start 00:30 räknas. Rekommendation: designens text ändras till "23:30–00:29" (ägarbeslut behövs, designen är annars facit).
- **Q4. Flavor på alla kort.** Bilden visar flavor på tre kort; vi antar alla intjänade.
- **B3.** Nedgradering/radering sker tyst (ingen vy). Oförändrat.
- **B6.** Showcase-ordning = arrayordning (platsnummer 1/2/3 vänster→höger). Oförändrat.

---

## 9. Vad i Components som ersatts

`RunQuest Components.dc.html` sektion 05 BADGES är nu omskriven enligt ADR 009 (åtta serier, sex nivåer, inga procent, Heroic/Legendary-primärer och alternativ, fyra lager, låst-rad, storlekar, anatomi). Den gamla "Mastery flash", "FLAUNT IT" och "pct" är borta. Sektion 04 "CHIPS, BADGES, STATUS" (klockans räknarbadge) är orörd. Ankaret `#badges` behålls.

---

## 10. Status per vy (beslut 54)

| ID | Vy | Referensbild | Mobil | Desktop | Status |
|---|---|---|---|---|---|
| F1 | Emblem-ark | `reference/f1.png` | n/a (komponentark) | ja | **KLAR** |
| F2 | Profil: samlingen | `reference/f2.png` | ja | ja (huvudkolumn primär + sidokolumn-alt) | **KLAR** |
| F3 | Showcase-väljare | `reference/f3.png` | ja | nej: bara textnotering | **KLAR för mobil. BLOCKERAD för desktop:** ingen desktopbild (designen skriver "same panel at 340 px in the Titles layout"). Löses av en extra Claude Design-ram, eller att Lead godtar noteringen + Q2-antagandet. |
| F4 | Runner card | `reference/f4.png` | ja | nej: bara textnotering + tomläge | **KLAR för mobil. BLOCKERAD för desktop:** panelen i 340 px-sidokolumnen ritas inte (F2:s kompakta sidolista är det närmaste, men har inte held-by och ON DISPLAY). Samma lösning som F3. |
| F5 | Board Season | `reference/f5.png` | ja | ja | **KLAR** (radhöjd: avvikelse 9) |
| F6 | Uppgraderingspopup | `reference/f6.png` | ja (340) | ja (400) | **KLAR** |
| F7 | News-rad + bell-popover | `reference/f7.png` | ja | ja (bell-popover) | **KLAR** |
| F8 | Tomma, laddar- och fellägen | `reference/f8.png` | ja (330 px panelnivå) | ja (samma paneler) | **KLAR** |

Sex vyer är helt klara att dömas och byggas. F3 och F4 är klara på mobil men saknar desktopbild; buildern får inte improvisera fram den. Lead avgör om Council körs nu med F3/F4-desktop flaggade, eller efter ett extra varv.

---

## 11. Förslag till STATE.md (Lead skriver, beslut 21–22)

Tillägg under "Designspråk" när Council godkänt: *"Badges: åtta serier × sex nivåer (Common…Legendary), flavor-namn per tier. Emblem = kronsköld i CSS (`clip-path`) + RQIcon, aldrig egen `<svg>`; fyra lager (glow, ram, Heroic-ring, kärna); tokens `--rq-badge-*`. Nivån bärs alltid av namn + pips (+ Heroic-ring), aldrig bara färg. Heroic röd, Legendary guld. Räknare = 'held by X of N in your pack', aldrig procent. Ingen belöning, popupknapp 'Got it'. Rörelse: statisk glöd från Rare; engångständning (0.9 s) i popupen; Legendary andas bara på md/lg (Council-avvikelse)."*
