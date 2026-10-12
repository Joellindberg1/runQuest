import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// ─── Arkitekturgränser (RUN-154) ─────────────────────────────────────────────────────────────────────────────────────────────────
// Dessa regler låg tidigare som källtextvakter i guards.test.ts (regex mot ?raw-källor). Som lint fäller de vid skrivandet,
// inte först i testkörningen. Gränserna gäller produktionskoden: testfiler och fixtures är undantagna, precis som vakterna var.
//
// ESLint ersätter en regels hela inställning när flera block träffar samma fil (de slås inte ihop). Därför byggs varje featureblock
// ur de gemensamma listorna nedan, och en fil ska bara träffas av ETT block per regel.

const NOT_PRODUCTION = ["**/*.test.{ts,tsx}", "**/*.fixture.ts"];

// Lazy-gränsen (ADR 006 beslut 11): de här sidorna och onboarding-orkestratorn laddas bara via lazy(() => import(...)).
// no-restricted-imports granskar statiska importer; dynamisk import() faller utanför, så lazy() i routes.tsx/App.tsx är tillåten.
const LAZY_ONLY = {
  regex: "(^@/pages/|^\\.\\.?/(.*/)?pages/|^\\./)(Index|\\w+PreviewPage|AdminPage|PlaybookPage|FeaturesPage|SettingsPage)$|(^|/)OnboardingOrchestrator$",
  message: "Importeras bara via lazy(() => import(...)) (ADR 006 beslut 11) — en statisk import drar in sidan i huvudbunten.",
};

// En källa för det gruppen ser: bara features/changelog/changelogData.ts läser changelog.json.
const CHANGELOG_JSON = {
  regex: "(^|/)changelog\\.json$",
  message: "Bara features/changelog/changelogData.ts läser changelog.json; övriga går via changelogData.",
};

const STREAK_CONSTANTS = {
  regex: "streakConstants",
  message: "Multiplikatortrappan kommer ur config-endpointen (/api/config/xp), inte ur en konstant.",
};

const GLOBAL_IMPORT_PATTERNS = [LAZY_ONLY, CHANGELOG_JSON];

const importRestrictions = (...extraPatterns) => ["error", { patterns: [...GLOBAL_IMPORT_PATTERNS, ...extraPatterns] }];

// Multiplikatortrappan i Board/Profile/Runner kommer ur config-endpointen, aldrig ur shared-defaultvärdena.
const NO_STREAK_DEFAULTS = {
  selector: "Identifier[name=/STREAK_MULTIPLIERS/]",
  message: "Multiplikatortrappan kommer ur config-endpointen (useXpConfig), inte ur DEFAULT_STREAK_MULTIPLIERS.",
};

// Landing är publik och gör inga anrop (ägarbeslut 4) och importerar inget ur auth: dialogen monteras av pages/Index.
const LANDING_IMPORTS = [
  STREAK_CONSTANTS,
  { regex: "backendApi|(^|/)services/|react-query|supabase|axios", message: "Landing-featuren gör inga anrop (ägarbeslut 4): hårdskriven data, ingen backend." },
  // Täcker både alias (@/features/auth, @/providers/auth) och relativa importer (../auth/foo, ../../providers/authContext).
  { regex: "features/auth|providers/auth|(^|/)\\.\\.?/(.*/)?auth/", message: "Landing importerar inget ur features/auth eller providers/auth; dialogen monteras av pages/Index." },
];
const LANDING_SYNTAX = [
  { selector: "CallExpression[callee.name='fetch']", message: "Landing-featuren gör inga anrop (ägarbeslut 4)." },
  {
    selector: "Identifier[name=/^(useUsersWithRuns|useXpConfig|useGroupName|useQuery|useMutation|useAuth)$/]",
    message: "Landing-featuren hämtar ingen data (ägarbeslut 4): inga datahooks och ingen auth.",
  },
];

// Badges (ADR 009): kontraktstyperna kommer ur @runquest/shared, api.ts är enda klienten, useBadgeQueries enda query-definitionen.
const BADGE_CONTRACT_TYPES = "BadgeUserItem|BadgeUserResponse|BadgeUserApiResponse|BadgeGroupMember|BadgeGroupResponse|BadgeGroupMeta|BadgeGroupApiResponse|BadgeShowcaseEntry|ShowcaseRequest|ShowcaseResponse|SeenRequest|SeenResponse|BadgeSeriesDef";
const BADGE_SHARED_TYPES = [
  {
    selector: `TSInterfaceDeclaration[id.name=/^(${BADGE_CONTRACT_TYPES})$/]`,
    message: "Kontraktstyperna kommer ur @runquest/shared; deklarera dem inte om i badges-featuren.",
  },
  {
    selector: `TSTypeAliasDeclaration[id.name=/^(${BADGE_CONTRACT_TYPES})$/]`,
    message: "Kontraktstyperna kommer ur @runquest/shared; deklarera dem inte om i badges-featuren.",
  },
];
const BADGE_CLIENT_STAYS_IN_API = [
  // esquery stoppar regexen vid första `/`, även escapad; snedstrecket skrivs därför \x2f.
  { selector: "Literal[value=/^\\x2fbadges\\b/]", message: "Badges-endpoints bor i features/badges/api.ts." },
  { selector: "TemplateElement[value.raw=/^\\x2fbadges\\b/]", message: "Badges-endpoints bor i features/badges/api.ts." },
  { selector: "Identifier[name='authenticatedRequest']", message: "Bara features/badges/api.ts anropar klienten (authenticatedRequest)." },
  { selector: "CallExpression[callee.name='fetch']", message: "Bara features/badges/api.ts anropar servern." },
];
const BADGE_QUERIES_STAY_IN_HOOK = [
  { selector: "Identifier[name='badgesApi']", message: "Vyerna går via hookarna i hooks/useBadgeQueries.ts, inte direkt mot badgesApi." },
  { selector: "ArrayExpression > Literal:first-child[value='badges']", message: "Query-nycklarna för badges skrivs bara i hooks/useBadgeQueries.ts." },
  { selector: "CallExpression[callee.name=/^use(Query|Mutation)$/]", message: "EN query-definition per resurs: useQuery/useMutation för badges finns bara i hooks/useBadgeQueries.ts." },
];

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": ["warn", {
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_",
        "ignoreRestSiblings": true
      }],
    },
  },

  // Gränser för all produktionskod: lazy-sidorna och changelog.json (changelogData.ts får läsa JSON-filen).
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [...NOT_PRODUCTION, "src/features/changelog/changelogData.ts"],
    rules: { "no-restricted-imports": importRestrictions() },
  },
  {
    files: ["src/features/changelog/changelogData.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [LAZY_ONLY] }] },
  },

  // Board, Profile och Runner: trappan ur config-endpointen.
  {
    files: [
      "src/features/leaderboard/**/*.{ts,tsx}", "src/pages/BoardPage.tsx", "src/shared/components/ViewTabs.tsx", "src/shared/components/ErrorState.tsx",
      "src/shared/hooks/useViewParam.ts", "src/shared/hooks/useXpConfig.ts",
      "src/features/profile/**/*.{ts,tsx}", "src/features/runs/**/*.{ts,tsx}", "src/pages/ProfilePage.tsx",
      "src/features/runner/**/*.{ts,tsx}", "src/pages/RunnerPage.tsx",
    ],
    ignores: NOT_PRODUCTION,
    rules: {
      "no-restricted-imports": importRestrictions(STREAK_CONSTANTS),
      "no-restricted-syntax": ["error", NO_STREAK_DEFAULTS],
    },
  },

  // Landing: publik, inga anrop, ingen auth, trappan ur shared (DEFAULT_STREAK_MULTIPLIERS är tillåten här men inte streakConstants).
  {
    files: ["src/features/landing/**/*.{ts,tsx}", "src/pages/LandingPage.tsx"],
    ignores: NOT_PRODUCTION,
    rules: {
      "no-restricted-imports": importRestrictions(...LANDING_IMPORTS),
      "no-restricted-syntax": ["error", ...LANDING_SYNTAX],
    },
  },

  // Badges: tre block eftersom no-restricted-syntax ersätts per fil. api.ts får allt klientrelaterat, useBadgeQueries.ts får query-definitionerna.
  {
    files: ["src/features/badges/**/*.{ts,tsx}"],
    ignores: [...NOT_PRODUCTION, "src/features/badges/api.ts", "src/features/badges/hooks/useBadgeQueries.ts"],
    rules: { "no-restricted-syntax": ["error", ...BADGE_SHARED_TYPES, ...BADGE_CLIENT_STAYS_IN_API, ...BADGE_QUERIES_STAY_IN_HOOK] },
  },
  {
    files: ["src/features/badges/hooks/useBadgeQueries.ts"],
    rules: { "no-restricted-syntax": ["error", ...BADGE_SHARED_TYPES, ...BADGE_CLIENT_STAYS_IN_API] },
  },
  {
    files: ["src/features/badges/api.ts"],
    rules: { "no-restricted-syntax": ["error", ...BADGE_SHARED_TYPES] },
  },
);
