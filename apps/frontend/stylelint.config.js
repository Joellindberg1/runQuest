// Designspråkets CSS-regler som lint (RUN-223). Tidigare vaktades de av regex mot CSS-text i guards.test.ts per feature
// (src/test/designGuards.ts och elva inklistrade kopior). Som lint fäller de vid skrivandet, med fil och rad.
//
// Reglerna gäller varje feature-CSS. src/index.css är temafilen där tokens (med px, hex och rgb-tripletter) får deklareras; där gäller bara
// förbudet mot kända rester, och src/test/themeTokens.sync.test.ts prövar den (index.css mot docs/design/temafil-forslag.css, och att varje
// token används).
//
// Stylelint ersätter en regels hela inställning när ett overrides-block sätter samma regel. Därför bygger `designRules()` alltid hela
// uppsättningen ur en liten beskrivning av vad filen får göra, och varje fil träffas av exakt ett block.

import stylelint from "stylelint";

// Stravas regler för "Compatible with Strava"-loggan (landningens footer): oförändrad, aldrig animerad, inte större än omgivande text och utan
// hover-effekt på själva bilden. Stylelint har ingen inbyggd regel för "höjd högst 1em" per selektor, så det här är en liten egen regel som bara
// läser regler som siktar på loggan (eller på en `img` i landningens footer). Den prövas med negativa prov i src/features/landing/stravaLogoLint.test.ts.
const STRAVA_TARGET = /rq-landing-footer__strava|rq-landing-footer\b[^,{]*\bimg\b/;
const STRAVA_FORBIDDEN_PROPERTIES = /^(?:-webkit-)?(?:filter|backdrop-filter|opacity|transform|rotate|scale|translate|zoom|mix-blend-mode|mask(?:-.*)?|clip-path|animation(?:-.*)?|transition(?:-.*)?)$/;
const STRAVA_STATE_SELECTOR = /:(?:hover|active|focus|focus-visible|focus-within)\b/;
const AT_MOST_ONE_EM = /^(?:0?\.\d+|1)(?:\.0+)?em$/;
const STRAVA_RULE_NAME = "rq/strava-logo";
const stravaMessages = stylelint.utils.ruleMessages(STRAVA_RULE_NAME, {
  property: (property) => `Stravas logga får inte modifieras eller animeras: "${property}" är förbjuden på loggan.`,
  state: (selector) => `Stravas logga får ingen hover- eller fokuseffekt på bilden: "${selector}".`,
  height: (value) => `Stravas logga får vara högst lika hög som textens teckenhöjd (höjd högst 1em), inte "${value}".`,
  width: (value) => `Stravas logga behåller bildens proportion: bredden är auto, inte "${value}".`,
});
const stravaLogoRule = stylelint.createPlugin(STRAVA_RULE_NAME, (enabled) => (root, result) => {
  if (!enabled) return;
  root.walkRules((rule) => {
    if (!STRAVA_TARGET.test(rule.selector)) return;
    if (STRAVA_STATE_SELECTOR.test(rule.selector)) {
      stylelint.utils.report({ result, ruleName: STRAVA_RULE_NAME, message: stravaMessages.state(rule.selector), node: rule });
    }
    rule.walkDecls((decl) => {
      const prop = decl.prop.toLowerCase();
      const value = decl.value.trim();
      const report = (message) => stylelint.utils.report({ result, ruleName: STRAVA_RULE_NAME, message, node: decl, word: decl.prop });
      if (STRAVA_FORBIDDEN_PROPERTIES.test(prop)) report(stravaMessages.property(prop));
      else if ((prop === "height" || prop === "max-height") && !AT_MOST_ONE_EM.test(value)) report(stravaMessages.height(value));
      else if ((prop === "width" || prop === "max-width") && value !== "auto") report(stravaMessages.width(value));
    });
  });
});

// Dialogen med röd Disconnect måste ha en egen, icke-guld fokusring. Stylelint har ingen regel för "måste finnas", så det här är en liten egen regel som kräver
// en :focus-visible-regel med en explicit outline/outline-color ur textnivåerna (--rq-text-1..3 eller bläcket). Tas deklarationen bort faller filen här.
const FOCUS_RING_RULE_NAME = "rq/neutral-focus-ring";
const focusRingMessages = stylelint.utils.ruleMessages(FOCUS_RING_RULE_NAME, {
  missing: () => "Filen måste deklarera en neutral fokusring: en :focus-visible-regel med outline-color ur --rq-text-1..3 (den globala ringen är guld och får inte stå bredvid röd).",
});
const NEUTRAL_RING_VALUE = /var\(--rq-(?:text-[1-3]|ink)/;
const neutralFocusRingRule = stylelint.createPlugin(FOCUS_RING_RULE_NAME, (enabled) => (root, result) => {
  if (!enabled) return;
  let found = false;
  root.walkRules((rule) => {
    if (!/:focus-visible/.test(rule.selector)) return;
    rule.walkDecls(/^outline(-color)?$/, (decl) => { if (NEUTRAL_RING_VALUE.test(decl.value)) found = true; });
  });
  if (!found) stylelint.utils.report({ result, ruleName: FOCUS_RING_RULE_NAME, message: focusRingMessages.missing(), node: root });
});

/** Värde för `animations` och `zIndex` som betyder "inte begränsat i den här filen". */
const ANY = "any";

/**
 * @param {object} [allowed] Vad den här CSS-filen får göra utöver grundreglerna.
 * @param {string[]} [allowed.locals] Egna custom properties (utan --; regex-fragment tillåts). Utelämnad = filen deklarerar inga.
 * @param {string[]|"any"} [allowed.animations] Tillåtna `animation:`-värden (regex); "any" = valfria. Utelämnad = ingen animation.
 * @param {string[]|"any"} [allowed.zIndex] Tillåtna `z-index`-värden; "any" = valfria. Utelämnad = inget z-index.
 * @param {boolean} [allowed.zeroRadius] `border-radius: 0` (skarpa hörn) är tillåtet. Default true.
 * @param {boolean} [allowed.rawLineHeight] Enhetslösa line-height-värden är tillåtna (skalet, äldre än tokenen). Default false.
 * @param {string[]} [allowed.bannedProperties] Egenskaper som dessutom är förbjudna i just den här filen (regex).
 * @param {string[]} [allowed.bannedValues] Värdemönster som dessutom är förbjudna i just den här filen (alla egenskaper).
 * @param {string[]} [allowed.bannedSelectors] Selektormönster som dessutom är förbjudna i just den här filen.
 * @param {Record<string, unknown>} [allowed.extraRules] Ytterligare Stylelint-regler för just den här filen.
 */
function designRules({
  locals = [],
  animations,
  zIndex,
  zeroRadius = true,
  rawLineHeight = false,
  bannedProperties = [],
  bannedValues = [],
  bannedSelectors = [],
  extraRules = {},
} = {}) {
  const allowedValues = {
    // Egna custom properties: bara de filen uttryckligen får deklarera (kortets kant- och tonvariabler m.fl.). Regex-nyckeln träffar
    // deklarationen av varje annan custom property, och inget värdemönster godkänner den.
    [locals.length ? `/^--(?!(?:${locals.join("|")})$)/` : "/^--/"]: ["/(?!)/"],
    // Hörn: skarpa (0) eller radie-token (regel 2).
    "/^border-radius$/": zeroRadius ? ["0", "/^var\\(--rq-radius/"] : ["/^var\\(--rq-radius/"],
    // Typografi ur tokens (regel 1).
    "/^font-family$/": ["/^var\\(--rq-font-/"],
  };
  if (!rawLineHeight) allowedValues["/^line-height$/"] = ["/^var\\(--rq-lh-/"];
  if (Array.isArray(animations)) allowedValues["/^animation$/"] = animations;
  if (Array.isArray(zIndex)) allowedValues["/^z-index$/"] = zIndex;

  const disallowedProperties = ["/^(-webkit-)?transition/", ...bannedProperties];
  if (animations === undefined) disallowedProperties.push("/^(-webkit-)?animation/");
  if (zIndex === undefined) disallowedProperties.push("z-index");

  return {
    // Regel 1: inga råvärden. rgb(var(--rq-…-rgb) / alfa) är det sanktionerade alfa-receptet, så bara bokstavliga rgb()/rgba() fälls.
    "color-no-hex": [true, { message: "Hex-färger hör hemma i temafilen (index.css); använd en token (regel 1)." }],
    "unit-disallowed-list": [["px"], { ignoreMediaFeatureNames: { px: ["/.*/"] }, message: "px-mått hör hemma i temafilen (index.css); använd en token (regel 1)." }],
    "declaration-property-value-disallowed-list": [
      { "/.*/": ["/rgba\\(/", "/rgb\\(\\s*\\d/", ...LEGACY_VALUES, ...bannedValues] },
      { message: "Förbjudet värde: bokstavlig rgb()/rgba() (färger kommer ur tokens, alfa via rgb(var(--rq-…-rgb) / alfa)) eller ett filspecifikt förbud." },
    ],
    "declaration-property-value-allowed-list": [
      allowedValues,
      { message: "Otillåtet värde eller custom property: hörn är 0 eller var(--rq-radius*), line-height var(--rq-lh-*), font-family var(--rq-font-*), animation och z-index bara de dokumenterade, egna custom properties bara de listade." },
    ],
    "property-disallowed-list": [disallowedProperties, { message: "Egenskapen är förbjuden i den här CSS-filen (regel 8 rörelse, lager eller filspecifik regel i designspråket)." }],
    "selector-disallowed-list": [["/:root/", ...bannedSelectors], { message: "Förbjuden selektor: inga egna :root-definitioner i feature-CSS (tokens bor i index.css), eller en borttagen klass." }],
    ...extraRules,
  };
}

// Kända trasiga rester som inte får komma tillbaka: shadcn-sidebarens hsl(var(--sidebar)), var(--rq-foreground) och Silkscreen-typsnittet.
const LEGACY_VALUES = ["/hsl\\(var\\(--sidebar\\)\\)/", "/var\\(--rq-foreground\\)/", "/silkscreen/i"];

const keyframesBanned = { "at-rule-disallowed-list": [["keyframes"], { message: "Ingen rörelse i den här featuren (regel 8): inga @keyframes." }] };

/** @type {import("stylelint").Config} */
export default {
  ignoreFiles: ["dist/**"],
  plugins: [stravaLogoRule, neutralFocusRingRule],
  // Grundregler för alla feature-CSS som inte har ett eget block nedan: ingen rörelse, inget z-index, inga egna custom properties.
  rules: designRules(),
  overrides: [
    {
      // Temafilen får deklarera mått, hex och rgb-tripletter (det är där tokens bor), men inte de kända trasiga resterna.
      files: ["src/index.css"],
      rules: {
        ...Object.fromEntries(Object.keys(designRules()).map((rule) => [rule, null])),
        "declaration-property-value-disallowed-list": [{ "/.*/": LEGACY_VALUES }, { message: "Kända trasiga rester får inte komma tillbaka (hsl(var(--sidebar)), var(--rq-foreground), Silkscreen)." }],
      },
    },
    {
      // Filmen: bara play-ringen pulserar (rqPulse, samma takt som previewkortets ring). Reducerad rörelse hanteras av temafilens globala regel.
      // --rq-film-progress sätts inline (cssVars) och läses av progressen; den deklareras aldrig i CSS.
      files: ["src/features/landing/landingFilm.css"],
      rules: designRules({
        animations: ["/^rqPulse var\\(--rq-landing-pulse\\) ease-in-out infinite$/"],
        bannedProperties: ["animation-duration"],
        extraRules: { "declaration-no-important": [true, { message: "landingFilm.css sätter ingen !important; reducerad rörelse hanteras av temafilens globala regel." }] },
      }),
    },
    {
      // Stagingbannern (v0.8.0): ingen rörelse, inga egna custom properties; lagret är bara dess egen token, ovanför de sticky sidhuvudena.
      files: ["src/app-shell/staging-banner.css"],
      rules: designRules({ zIndex: ["/^var\\(--rq-z-staging-banner\\)$/"] }),
    },
    { files: ["src/features/admin/admin.css"], rules: designRules({ locals: ["rq-edge", "rq-edge-line", "rq-form-gap"] }) },
    {
      // Chippet "Paused" (RUN-241) är neutral bläck och aldrig silver (silver = placering 2): inget i den här filen läser rangfärgerna.
      // rq-c/rq-c-solid är chippets färgvariabler.
      files: ["src/features/settings/settings.css"],
      rules: designRules({
        locals: ["rq-edge", "rq-edge-line", "rq-form-gap", "rq-c", "rq-c-solid"],
        bannedValues: ["/--rq-silver/", "/--rq-rank-/"],
      }),
    },
    {
      // Pause or disconnect-dialogen (RUN-241): röd (Disconnect, bekräftelsen) står aldrig bredvid guld, så ingen guld- eller rangfärg läses här. Dialogen
      // ligger i skalets modallager (66, som profilens redigeringsruta). Fokusringen är neutral: den globala är guld, så filen MÅSTE deklarera en egen
      // (rq/neutral-focus-ring), annars hamnar en guldring bredvid den röda knappen.
      files: ["src/features/settings/strava-connection-dialog.css"],
      rules: designRules({
        locals: ["rq-edge", "rq-edge-line"],
        zIndex: ["66"],
        bannedValues: ["/--rq-gold/", "/--rq-silver/", "/--rq-rank-/"],
        extraRules: { [FOCUS_RING_RULE_NAME]: true },
      }),
    },
    { files: ["src/shared/components/form/form.css"], rules: designRules({ locals: ["rq-form-gap"] }) },
    // Titles och Runner card hade ingen vakt för line-height/rörelse; deras enhetslösa radhöjder (.9, 1.15) och Runner cards ensamma knopp-animation
    // är kända luckor som inte ändras här (CSS-ändring = visuell ändring), men de får inte växa.
    { files: ["src/features/titles/titles.css"], rules: designRules({ locals: ["rq-edge"], rawLineHeight: true }) },
    {
      files: ["src/features/runner/runner.css"],
      rules: designRules({
        animations: ["/^rqRunnerKnob var\\(--rq-dur-bar\\) var\\(--rq-ease-bar\\) both$/"],
        rawLineHeight: true,
        // BADGES-panelens stil bor i badges.css (flyttad från runner.css).
        bannedSelectors: ["/rq-badge-panel/"],
      }),
    },
    { files: ["src/shared/components/error-state.css"], rules: designRules({ locals: ["rq-edge", "rq-edge-line"] }) },
    {
      // Bakgrundsbanan (ägarundantag 2026-10-13): bara rutnätet (rqTrackDrift) och de tre löparna (rqTrackLap1–3, bara transform) loopar, och båda stängs av helt med
      // animation: none under prefers-reduced-motion (prövas i trackBackdrop.guards.test.ts). Inget z-index: lagret ritas under innehållet i trädordning.
      files: ["src/shared/components/track-backdrop.css"],
      rules: designRules({
        animations: [
          "/^rqTrackDrift var\\(--rq-track-bg-grid-dur\\) linear infinite$/",
          "/^rqTrackLap([1-3]) var\\(--rq-track-bg-lap-\\1\\) linear infinite$/",
          "/^none$/",
        ],
        locals: ["rq-dot-alpha"],
        bannedProperties: ["animation-duration"],
      }),
    },
    {
      // Emblemets lokala mappning nivå/storlek → tokens (--rq-emblem-*) och chippets accent. Animationen får vara vilken som helst (andning,
      // tändning, skelettpuls), men ligger i no-preference-blocket (det prövar badges/guards.test.ts), och popupens knappar får aldrig en permanent ring.
      files: ["src/features/badges/badges.css"],
      rules: designRules({
        locals: [
          "rq-emblem-c", "rq-emblem-c-rgb", "rq-emblem-grad", "rq-emblem-w", "rq-emblem-h", "rq-emblem-icon", "rq-emblem-core", "rq-emblem-ring",
          "rq-emblem-ring-core", "rq-emblem-glow", "rq-emblem-glow-leg", "rq-emblem-ignite-from", "rq-c", "rq-c-solid",
        ],
        animations: ANY,
        bannedSelectors: [
          // Borttagna byggstenar (profilens samlingskort, den separata väljaren, panelens gamla rad) ska inte komma tillbaka.
          "/\\.rq-badge-(collection|display|pick|slot|textlink)/",
          "/\\.rq-badge-grid\\b/",
          "/\\.rq-badge-card__id|\\.rq-badge-skel-list|\\.rq-badge-empty__minis/",
          "/\\.rq-badge-panel__(row|text|nameline|display|held|list|name)\\b/",
          // Musfokus ska aldrig ge en ring på popupen: bara :focus-visible.
          "/rq-badge-popup.*:focus(?!-visible)/",
        ],
        extraRules: {
          // Council 20: "Got it" har ingen permanent guldring; fokus visas bara av den globala :focus-visible-ringen.
          "rule-selector-property-disallowed-list": [
            { "/^(?!.*:focus-visible).*rq-badge-popup__(btn|close)/": ["outline", "outline-offset", "box-shadow"] },
            { message: "Popupens knappar har ingen permanent ring (Council 20): fokus visas bara av den globala :focus-visible-ringen." },
          ],
        },
      }),
    },
    { files: ["src/features/challenges/duels.css"], rules: designRules({ locals: ["rq-duels-tier", "rq-duels-tier-fg", "rq-duels-tier-rgb", "rq-duels-tier-stroke", "rq-edge", "rq-edge-line"], zIndex: ["66"] }) },
    {
      // Ingen rörelse alls (varken animation eller @keyframes), ingen tonad text i --rq-text-5 (dekornivå, WCAG) och radien är alltid en token.
      files: ["src/features/changelog/changelog.css", "src/features/onboarding/whatsNew.css"],
      rules: designRules({ locals: ["rq-edge", "rq-edge-line", "rq-kind"], zeroRadius: false, bannedValues: ["/--rq-text-5/"], extraRules: keyframesBanned }),
    },
    {
      files: ["src/features/news/news.css"],
      rules: designRules({ locals: ["rq-c", "rq-c-edge", "rq-c-solid"], zeroRadius: false, bannedValues: ["/--rq-text-5/"], extraRules: keyframesBanned }),
    },
    {
      files: ["src/features/events/events.css"],
      rules: designRules({
        locals: ["rq-c", "rq-c-solid", "rq-edge", "rq-edge-line", "rq-events-accent", "rq-events-accent-rgb", "rq-events-week", "rq-ring-c"],
        animations: ["/^rqSweep 5s linear infinite$/"],
      }),
    },
    {
      // Bara levande saker loopar: rutnätet, löparna och deras XP-pop, kortets guldring och sweep. Reducerad rörelse hanteras av temafilens globala
      // regel, så landing.css sätter ingen egen animation-duration eller !important. "LEADERBOARD" bryts aldrig mitt i ordet.
      files: ["src/features/landing/landing.css"],
      rules: designRules({
        zIndex: ["/^var\\(--rq-z-landing-header\\)$/"],
        animations: [
          "/^rqGrid var\\(--rq-landing-grid-dur\\) linear infinite$/",
          "/^rqOrbit var\\(--rq-landing-lap-[1-6]\\) linear infinite$/",
          "/^rqLandingPop var\\(--rq-landing-lap-[1-6]\\) linear infinite$/",
          "/^rqRing var\\(--rq-landing-pulse\\) ease-in-out infinite$/",
          "/^rqSweep var\\(--rq-landing-sweep\\) linear infinite$/",
        ],
        bannedProperties: ["animation-duration", "overflow-wrap", "word-break"],
        extraRules: {
          "declaration-no-important": [true, { message: "landing.css sätter ingen !important; reducerad rörelse hanteras av temafilens globala regel." }],
          [STRAVA_RULE_NAME]: true,
        },
      }),
    },
    {
      files: ["src/features/leaderboard/board.css"],
      rules: designRules({
        // Lokala variabler pekar bara på andra tokens (rangens färger, nivåfärgerna, kortets kant) och sockelns mått.
        locals: ["rq-(?:rank-solid|rank-edge|rank-subtle|ring-c|tier-rgb|tier-stroke|tier-fg|acc|acc-edge|edge|edge-line)", "rq-board-plinth[a-z0-9-]*"],
        animations: ANY,
        bannedSelectors: ["/rq-board-namerow/"],
      }),
    },
    { files: ["src/features/log/log.css"], rules: designRules({ locals: ["rq-edge", "rq-edge-line", "rq-log-tone", "rq-log-tone-rgb"] }) },
    {
      // Väntelistans kort (RUN-211): ingen rörelse, inget z-index, inga egna custom properties. Honeypot-fältet ligger utanför skärmen:
      // det får inte döljas med display eller visibility, annars hoppar enkla botar över det. Testerna kör med css:false och kan inte prova klassen.
      files: ["src/features/landing/landingWaitlist.css"],
      rules: designRules({
        extraRules: {
          "rule-selector-property-disallowed-list": [
            { "/rq-landing-waitlist__trap/": ["display", "visibility"] },
            { message: "Honeypot-fältet ska ligga utanför skärmen (position + left), inte döljas med display eller visibility." },
          ],
        },
      }),
    },
    {
      files: ["src/features/profile/profile.css"],
      rules: designRules({
        // Redigeringsrutan ligger i skalets modallager (66). Bara markören och rutnätets veckor animerar, en gång var; inget loopar.
        animations: [
          "/^rqProfileKnob var\\(--rq-dur-bar\\) var\\(--rq-ease-bar\\) both$/",
          "/^rqGrowY var\\(--rq-dur-grow\\) var\\(--rq-ease-bar\\) both$/",
        ],
        zIndex: ["66"],
      }),
    },
    {
      // Skalet äger lagren (z-index), rörelsen och de äldre enhetslösa radhöjderna; för skalet gäller bara att mått, färger och hörn är tokens.
      files: ["src/app-shell/app-shell.css"],
      rules: designRules({ locals: ["rq-edge"], animations: ANY, zIndex: ANY, rawLineHeight: true }),
    },
  ],
};
