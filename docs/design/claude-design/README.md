# Claude Design-export — "Gamification-sida behöver liv"

Ögonblicksbilder från det levande designprojektet:
https://claude.ai/design/p/23754cb4-e3ec-4cd3-8cd8-4be2f0167208

Exporter:
- **2026-10-04** — första exporten (prototyper, komponentbibliotek, laddare, ikoner).
- **2026-10-11** — badge-systemet (RUN-2): ny `RunQuest Badge System.dc.html` + `runquest-badges.js`, uppdaterad `RunQuest Components.dc.html` (sektion 05 BADGES omskriven) och `runquest-icons.js` (ikonuppsättningen). Badge-designen är byggd i v0.6.0 (F1–F8, se `docs/design/badges/spec.md`; F3 och F4 saknar desktopbild, de byggdes mot spec-texten och F2). Utanför det byggda ligger två uppföljningar: "Preview on leaderboard" (väljaren den hörde till är borttagen i v2) och Board-fallbacken "Legendary-minis utan glöd" (spec §12). F2–F4 och F5:s placeringar är ersatta av v2-exporten nedan.
- **2026-10-11 (kväll)** — badge-design v2 (ägarens omritning, RUN-146): byte-exakta ersättare för `RunQuest App Prototype.dc.html`, `RunQuest Web Prototype.dc.html` (nu hel, tidigare avkapad), `RunQuest Badge System.dc.html` (vimpeln) och `runquest-badges.js` (dämpade nivåfärger, svagare glöd, ny storlek 44 px). Radreferenser och byggordning: `docs/design/badges/spec.md`, avsnittet "v2". v2 är byggd i v0.6.0 (RUN-146–152: tokens och emblem `cp`, vimpel och Board, `/badges`, profilens sammanfattning, Runner card-panelen); status per vy i spec V2.12.
- **2026-10-13 (v2)** — landningsdesignen (RUN-198): ny `RunQuest Landing.dc.html` (byte-exakt), ägarens landning med desktop (1440 px) och en mobilsektion i telefonram ("Landing — mobile"), plus filmsektionen. App och Web Prototype är kontrollerade och byte-identiska med 2026-10-11 (kväll), så de byts inte. `RunQuest Redesign.dc.html` exporteras inte (ram 1A gäller inte längre). Filmen (`uploads/RunQuest Mixed.mp4`) och postern (`assets/landing-video-poster.png`) som filen pekar på exporteras inte här; videomaterialet hanteras separat. Designen krockar fortfarande med ägarbesluten på flera punkter (guldknappar, påhittade siffror, gruppnamn, ingen väntelista, inga /legal-länkar). Gapanalysen ligger i RUN-198.

**Designprojektet är sanningen** — dessa filer är implementationsreferens
(beslut 38). Vid avvikelse: öppna länken. Ägaren arbetar aktivt i projektet;
badge-delen (exporterna 2026-10-11, v1 och v2) är byggd i v0.6.0 (v1 efter Design Council och RUN-127, v2 i RUN-146–152);
ändringar i badge-designen går via designprojektet och spec.md.

| Fil | Innehåll | Export |
|---|---|---|
| `RunQuest App Prototype.dc.html` | Mobil-prototypen — 10 skärmar (landing, leaderboard, runner card, titles, challenges, events, pack news, log runs, profile, playbook) plus v2:s Badges-sida. BYGGS FÖRST | 2026-10-04, ersatt 2026-10-11 (kväll, v2) |
| `RunQuest Web Prototype.dc.html` | Desktop-prototypen (ljust bronstema som variant) — byggs "samtidigt". Hel sedan v2 (den tidigare kopian var avkapad) | 2026-10-04, ersatt 2026-10-11 (kväll, v2) |
| `RunQuest Components.dc.html` | Komponentbiblioteket: tokens, typskala, knappar, kort, chips, progress m.m. Sektion 05 BADGES är uppdaterad (åtta serier × sex nivåer, F1) | 2026-10-04, sektion 05 uppdaterad 2026-10-11 |
| `RunQuest Badge System.dc.html` | Badges i sammanhang: ramarna F2–F8 (profil, väljare, runner card, Board Season, uppgraderingspopup, News, tillstånd). Mobil 402 + desktop 1440. F2–F4 är historik efter v2; vimpeln (utmaningstecknet) kommer härifrån | 2026-10-11 (ny), vimpeln 2026-10-11 (kväll, v2) |
| `runquest-badges.js` | Enda källan för badge-tierfärger, gradienter, emblemgeometri, storlekar (28/44/56/96, ikon 15/20/24/42), chip-/pips-recept, serier med kravtexter och flavor-namn per tier | 2026-10-11 (ny), v2 2026-10-11 (kväll) |
| `RunQuest Landing.dc.html` | Landningssidan (utloggad): header, hjälte med arenabana, filmsektion, previewkort, "How the game works" med XP-formeln, funktionsrutnät, formulär och fot i desktop (1440 px), samt mobil-landningen i telefonram. Laddar `runquest-icons.js` | 2026-10-13 (v2, ny) |
| `RunQuest Loaders.dc.html` | Laddare: stadion-ovalen i tre storlekar + skeleton-rader | 2026-10-04 |
| `runquest-icons.js` | Enda källan för ikoner + wordmark (lucide-stil 24×24, stroke 1.9) | 2026-10-04, uppdaterad 2026-10-11 |

Referensbilder (PNG) för badge-ramarna F1–F8 ligger i `docs/design/badges/reference/`; spec, ägarens beslut, tokenförslag och copy-skillnader mot `packages/shared/src/badges.ts` i `docs/design/badges/spec.md`.

Medvetet EJ exporterade: `support.js` (DC-runtime, inte designinnehåll),
`ios-frame.jsx` (telefonram för prototypvisning), `RunQuest Redesign.dc.html`
(utforskningsreferens, "ändras inte" enligt projektets CLAUDE.md), screenshots
och uploads.

Designspråket i korthet (ur prototyperna): mörk bas `#070e09`/`#212121`,
guld `#ffd700` som primär accent, silver/brons för placeringar, hairlines
`rgba(255,255,255,.07–.12)`, kort med 3 px vänsterkant, typografi
Bebas Neue (display) + Barlow Condensed (UI) + Share Tech Mono (siffror),
skarpa hörn (ingen border-radius i korten), tagline "RUN - RANK - REIGN".
