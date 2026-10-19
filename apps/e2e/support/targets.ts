import { resolveE2eTargets } from '../../../scripts/e2e-guard.mjs';

/**
 * Adresserna sviten kör mot, kontrollerade av E2E-vakten (scripts/e2e-guard.mjs) redan när modulen läses: pekar E2E_BASE_URL eller E2E_API_URL
 * på något annat än staging eller localhost kastar importen, och varken `playwright test` eller `playwright test --list` startar.
 */
export const targets = resolveE2eTargets(process.env);

/** Sant när frontenden är en lokal utvecklingsserver (vakten tillåter bara http för localhost): den har inget stagingbygge med banner. */
export const frontendIsLocal = targets.baseUrl.startsWith('http://');

export interface Credentials {
  login: string;
  password: string;
}

/**
 * Testkontots uppgifter. De kommer bara ur miljön (i CI från GitHub-secrets) och skrivs aldrig ut. Läses först när ett test behöver dem,
 * så att `--list` fungerar utan hemligheter.
 */
export function userCredentials(): Credentials {
  const login = process.env.E2E_USER_LOGIN;
  const password = process.env.E2E_USER_PASSWORD;
  if (!login || !password) {
    throw new Error('E2E_USER_LOGIN and E2E_USER_PASSWORD must be set to the staging test account (see docs/e2e.md).');
  }
  return { login, password };
}
