# Claude Design-export — "Gamification-sida behöver liv"

Ögonblicksbilder exporterade 2026-10-04 från det levande designprojektet:
https://claude.ai/design/p/23754cb4-e3ec-4cd3-8cd8-4be2f0167208

**Designprojektet är sanningen** — dessa filer är implementationsreferens
(beslut 38). Vid avvikelse: öppna länken. Ägaren arbetar aktivt i projektet
(badge-komponenter pågår och ska INTE implementeras förrän de är klara).

| Fil | Innehåll |
|---|---|
| `RunQuest App Prototype.dc.html` | Mobil-prototypen — 10 skärmar (landing, leaderboard, runner card, titles, challenges, events, pack news, log runs, profile, playbook). BYGGS FÖRST |
| `RunQuest Web Prototype.dc.html` | Desktop-prototypen (ljust bronstema som variant) — byggs "samtidigt" |
| `RunQuest Components.dc.html` | Komponentbiblioteket: tokens, typskala, knappar, kort, chips, progress m.m. (snapshot medan badge-arbete pågick) |
| `RunQuest Loaders.dc.html` | Laddare: stadion-ovalen i tre storlekar + skeleton-rader |
| `runquest-icons.js` | Enda källan för ikoner + wordmark (lucide-stil 24×24, stroke 1.9) |

Medvetet EJ exporterade: `support.js` (DC-runtime, inte designinnehåll),
`ios-frame.jsx` (telefonram för prototypvisning), `RunQuest Redesign.dc.html`
(utforskningsreferens, "ändras inte" enligt projektets CLAUDE.md), screenshots
och uploads.

Designspråket i korthet (ur prototyperna): mörk bas `#070e09`/`#212121`,
guld `#ffd700` som primär accent, silver/brons för placeringar, hairlines
`rgba(255,255,255,.07–.12)`, kort med 3 px vänsterkant, typografi
Bebas Neue (display) + Barlow Condensed (UI) + Share Tech Mono (siffror),
skarpa hörn (ingen border-radius i korten), tagline "RUN - RANK - REIGN".
