# Designspråk-förslag (Designern 2026-10-04)

Lead skriver in sektionen nedan i STATE.md (ersätter platshållaren under
"## Designspråk"). Reglerna under den bor kvar här i docs/ och refereras av
builders och Design Council.

---

## Att klistra in i STATE.md

```
## Designspråk
Temafil: apps/frontend/src/index.css — EN tokenuppsättning (--rq-*, källa: docs/design/temafil-forslag.css); mörkt är standard, ljust brons via <html data-theme="light"> (förberett, ej designat). Referens: docs/design/claude-design/ (Components = tokens, App Prototype = skärmar; designprojektet är sanningen). Regler: docs/design/designsprak-forslag.md.
Ton: mörk arena (#070e09-bas, panel #212121) där guld (#ffd700) är belöningssignalen — XP, rank 1, primär handling. Skarpa hörn (radius 0), hårlinjer i stället för kanter, ett kort = 3 px vänsterkant i tillståndsfärg. Tagline "RUN - RANK - REIGN". En guldknapp per vy.
Typ: Bebas Neue (rubriker/siffror/primärknappar) · Barlow Condensed (allt annat; namn VERSALER 700) · Share Tech Mono (klockor, XP, eyebrows) · Oswald endast i logotypen.
Rörelse: staplar växer från noll en gång (1.6 s) och står still; bara live-saker loopar (pulserande prickar, sweep på live-kort, grid-drift, podium #1-glöd).
Skuld: 240 inline-styles + 7 typsnitt i nuvarande kod ersätts per inkrement (redesign-plan.md); shadcn-alias + legacy --rq-* i temafilen är temporära.
```

---

## De tio reglerna builders måste följa

1. **Tokens, inga råvärden.** Inga hex/rgba/px-färger, inga inline-styles för
   färg/typ/spacing — allt via `var(--rq-*)` eller de delade `.rq-*`-klasserna.
   Behöver du en färg med alfa: `rgb(var(--rq-gold-rgb) / .1)`, aldrig en ny hex.
   Textsteg snappas till de fem (`--rq-text-1…5`); hårlinjer till `--rq-line-1…6`.
   Hittar du inget token som passar: stanna och fråga, hitta inte på.
   Ägarbeslut 2026-10-04: `--rq-text-4` höjd till .50 för WCAG AA (4.5:1).
   `--rq-text-5` är endast för disabled och ren dekor (spökrank) — aldrig för
   läsbar text. Ägarexperiment 2026-10-06 (v0.5.3): eyebrows läser
   `--rq-text-eyebrow` (= `--rq-text-4`, .50); backas genom att peka den på `--rq-text-5`.

2. **Skarpa hörn.** `border-radius: 0` överallt. Cirklar finns bara för
   avatarer, nivåringar, prickar — plus toggle-spår, räknebadge och den runda
   guld-plussen. Aldrig kort, knapp, chip, flik eller input. Tab-barens "New"
   är en guldfylld *kvadrat*.

3. **Guld = belöning, en guldknapp per vy.** Fylld guld (`.rq-btn--primary`,
   Bebas, svart text) finns högst en gång per vy: den primära handlingen.
   Sekundär = guld-hårlinje, avbryt = ghost. Grön = lever/vinst, röd =
   förlust/risk, orange = duell, Strava-orange endast som källmarkör. Fylld
   röd knapp endast för oåterkalleliga handlingar. Undantag för "oläst"
   (ägarbeslut 2026-10-05): olästa nyheter markeras med en statisk guldprick
   (`.rq-dot.rq-news-unread`) och klockans räknare är guldfylld — oläst räknas
   som något nytt att hämta, alltså belöningens familj. Aldrig blinkande.

4. **Statuschip-receptet.** Tint 10 % / kant 45 % / text i full accent
   (`.rq-chip--status`). Valda filter/flikar och värdetaggar ("+25 XP") ligger
   på 14 % / 50 %. Ett valt filter tar accentfärgen av det det filtrerar
   (Outdoor = grön, resten = guld). Prickar blinkar (live 1.4 s, alarm 1.2 s).

5. **Kortmönstret har tre varianter — ingen fjärde.** Standard (panel +
   hårlinje; med tillstånd → 3 px vänsterkant i tillståndsfärg, `.rq-card--edge`),
   hjältekort (guld-kant .6, profil/runner card, `.rq-card--hero`), podium
   (rankfärgad kant, skugga, spökrank-siffra, #1 glöder, `.rq-card--podium`).
   Skuggor finns endast på podium och flytande lager (popover/sheet).

6. **Data = hårlinjegrid, inte kanter.** Rader och celler skiljs av 1 px gap
   över en `--rq-line-2`-bakgrund (`.rq-hairgrid`), aldrig border-bottom per
   rad och ingen zebra. Rubrikraden har silvertint (`--rq-table-head`). Statceller:
   Bebas-värde + versal etikett i `--rq-text-4`.

7. **Typsnittsroller är hårda.** Bebas Neue = rubriker, stora siffror och
   primärknappar — *aldrig brödtext*. Barlow Condensed = allt annat; löparnamn
   i listor/kort alltid VERSALER 700 + .06em. Share Tech Mono = klockor, XP-
   räknare och 11 px-eyebrows (.28em). Oswald endast inuti `<Logo/>`. Rubriker
   i Bebas är alltid `--rq-text-1` (#fff); brödtext är `--rq-text-2/3`.

8. **Rörelsepolicy.** Staplar och ringar animerar från noll *en gång*
   (`rqBar`, 1.6 s, `cubic-bezier(.2,.8,.2,1)`, stagger .1 s via `--rq-delay`)
   och står sedan still. Bara *levande* saker loopar: blink-prickar, sweep på
   live-kort, marquee/ticker, `rqGrid`-bakgrunden, podium #1-glöd, laddare.
   Inga hover-animationer utöver färgbyte, inget studsande. Vyer får glida in
   med `rqRise`. Motion/Framer endast för mount/unmount (sheets, popovers,
   accordion, omsortering när rank ändras) — allt annat är CSS. Respektera
   `prefers-reduced-motion` (temafilen gör det globalt).

9. **Laddning, tomt, fel.** Väntan ska fortfarande läsas som löpning:
   stadion-ovalen (Loaders) i knappar/panes, skeleton-rader för listor,
   `rqDots` för inline-väntan. `rqSpin`-spinnern är bara reserv ≤ 20 px.
   Tomt läge = streckad kant, Bebas-rubrik, en sekundärknapp. Fel = rött
   kantkort med "Retry" och en mening om att datan är säker.

10. **Ikoner och rank-färger.** Ikoner kommer enbart ur `runquest-icons.js`
    (24×24, stroke 1.9) i 15/17/21 px; inga emojis i UI:t (prototypens
    väder-emojis i Group history byts mot ikoner). Rank 1/2/3 = guld/silver/
    brons på siffra, ring och kant; placering 4+ är `--rq-rank-rest`. Guld får
    aldrig användas som dekor på något som inte är belöning, rank eller primär
    handling.
   Undantag badges (Design Council 2026-10-11): ikonen inuti ett badge-emblem skalar med emblemet (15/20/24/42 px vid 28/44/56/96 px; v2 2026-10-11) — gäller bara inuti emblemet; panelrubrikers ikoner följer ikontrappan (`--rq-icon-md`). Nivåfärgerna `--rq-badge-*` används bara på emblem, chip, pips och nivårad, aldrig som status- eller varningsfärg; Rare-blå aliasas inte mot `--rq-tier-minor`.

---

## Dokumenterade undantag

Ett undantag är ett beslut med en token eller ett ställe i koden, inte en genväg. Varje rad säger vilken regel som viker, var det syns, vem som beslutat och vad undantaget INTE täcker. Ett nytt undantag kräver ett nytt beslut och en rad här. De äldre undantagen (olästa nyheter i regel 3, badges i regel 10) står kvar där de ligger i reglerna.
Källa för de fyra v0.7.0-undantagen: `docs/design/claude-design/RunQuest Frames v0.7 - beslut.md` (Design Council 2026-10-14) och ägarbeslut 2026-10-14 och 2026-10-15.

1. **Undantag från regel 3 — grönt reglage (`--rq-toggle-on`, `--rq-toggle-on-knob`).** Ett reglage som är PÅ är grönt (spårfärgen är `--rq-up`, knoppen `--rq-on-up`): "grönt = på/aktivt i ett reglage". Skäl: nästan alla notisreglage är på som standard, och guld skulle göra kortet till en guldvägg och förbruka "guld = belöning" (Change password, rundturen). Läget bärs inte av färgen ensam: av-läget har en 1 px ram (≥ 3:1 mot ytan) och knoppen byter sida.
   Ägarbeslut 2026-10-14. Token i temafilen, sektion 1.35; konsument `shared/components/form/form.css` (Switch). Gäller INTE temaväxlaren i headern (`.rq-toggle`, `app-shell`), som förblir guld och inte läser de två tokens.
2. **Undantag från regel 3 — rundturens guldknappar.** Turens popover (`.rq-tour-popover`, driver.js) har en guldfylld primärknapp (Next/Done) och guldtext på titeln även när sidan bakom har en egen guldknapp. Turen är ett flytande lager över sidan, så "en guldknapp per vy" räknas inom lagret.
   Design Council 2026-10-14. Stilen står i temafilen, sektion 8. Gäller INTE någon annan yta.
3. **Undantag från regel 9 — popoverns tomtläge.** När Pack News-popovern har rader men alla är bortfiltrerade av användarens notisinställningar visas "Nothing new for you" (Bebas-rubrik) med en mening och länken "See all pack news": ingen streckad kant och ingen sekundärknapp, eftersom länken till /news redan finns i popoverns fot och är den enda åtgärden.
   Design Council 2026-10-14 (frame N2). Stil: `features/news/news.css` (`.rq-news-pop__empty`). Gäller INTE ett helt tomt flöde ("No news yet — go make some.") eller /news självt, där tomläget följer regel 9.
4. **Undantag från regel 10 — Ranks är blå (`--rq-news-rank-rgb`, `--rq-news-rank-ink`).** Nyhetskategorin Ranks (`rank_passed`) har en egen blå färg: de övriga kategorierna bär redan guld, orange, grönt, rött och två neutrala, silver är rang 2 och guld är rang 1 och belöning. Tinten och kanten är `#38bdf8` (`56 189 248`), texten, ikonen och pricken `#7dd3fc`.
   Ägarbeslut 2026-10-14 ("Ranks är blå") och 2026-10-15 (himmelsblå `#38bdf8`/`#7dd3fc` godkänd). Tokens i temafilen, sektion 1.28; konsument `features/news/news.css`. Strikt skilda från `--rq-tier-minor*` och `--rq-badge-*`: inga alias och inga delade värden (vakt i `features/news/guards.test.ts`), så att minor-nivån och badge-serierna kan ändras utan att Ranks följer med. Ljust läge har mörkare blått men är inte granskat (se Frames-beslutets "Known gap").

Lint: undantagen kräver ingen utökad tillåtelselista. Reglagets tokens bor i temafilen (som får deklarera tokens), `news.css` och `form.css` läser dem som vanliga `var(--rq-…)`, och turen ligger i `index.css`, som lintreglerna inte begränsar. Ingen regel är avstängd generellt.
