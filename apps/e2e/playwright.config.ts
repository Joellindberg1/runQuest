import { defineConfig, devices } from '@playwright/test';
import { AUTH_FILE } from './support/paths';
import { targets } from './support/targets';

// Importen av `targets` kör E2E-vakten: konfigurationen kan inte läsas om adressen inte är staging eller localhost.

// Playwright skriver vid varje fel test-results/**/error-context.md med en ARIA-ögonblicksbild av sidan, och en bild av ett ifyllt lösenordsfält bär lösenordet i klartext.
// Variabeln stänger av ögonblicksbilden (felmeddelandet finns kvar). Sätts här, före arbetarna startar, så att den gäller även lokalt; workflowen städar dessutom artefakten.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

const MINUTE_MS = 60_000;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  globalSetup: './support/global-setup.ts',
  // En körning är en rök, inte en regressionssvit: den avbryts hellre än växer förbi fem minuter (workflow-timeouten är ett extra nät).
  globalTimeout: 4.5 * MINUTE_MS,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Specerna delar ett testkonto och en databas: en i taget, i filordning. Inloggningsgränsen (20 försök per 15 min och IP) tål det.
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['list'], ['github']] : [['list']],
  use: {
    baseURL: targets.baseUrl,
    // Spår sparas bara vid fel. De specer som skriver in lösenordet slår av det (test.use i filen), eftersom ett spår bär de ifyllda värdena.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts$/ },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE },
      dependencies: ['setup'],
      testIgnore: [/auth\.setup\.ts$/, /\.mobile\.spec\.ts$/],
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], storageState: AUTH_FILE },
      dependencies: ['setup'],
      testMatch: /\.mobile\.spec\.ts$/,
    },
  ],
});
