import { assertStagingFrontendServes } from '../../../scripts/e2e-guard.mjs';
import { targets } from './targets';

/** Andra lagret i E2E-vakten: den adress som svarar måste vara ett stagingbygge (robots.txt blockerar alla robotar), annars startar inget test. */
export default async function globalSetup(): Promise<void> {
  await assertStagingFrontendServes(targets.baseUrl);
}
