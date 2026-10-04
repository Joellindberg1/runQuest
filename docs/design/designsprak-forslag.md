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

2. **Skarpa hörn.** `border-radius: 0` överallt. Cirklar finns bara för
   avatarer, nivåringar, prickar — plus toggle-spår, räknebadge och den runda
   guld-plussen. Aldrig kort, knapp, chip, flik eller input. Tab-barens "New"
   är en guldfylld *kvadrat*.

3. **Guld = belöning, en guldknapp per vy.** Fylld guld (`.rq-btn--primary`,
   Bebas, svart text) finns högst en gång per vy: den primära handlingen.
   Sekundär = guld-hårlinje, avbryt = ghost. Grön = lever/vinst, röd =
   förlust/risk, orange = duell, Strava-orange endast som källmarkör. Fylld
   röd knapp endast för oåterkalleliga handlingar.

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
