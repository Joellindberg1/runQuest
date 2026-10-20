import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { errorCode } from './errorCode.js';
import { logger } from './logger.js';

/** Kostnadsfaktorn för alla lösenordshashar (skapa användare, byta och nollställa lösenord, dummy-hashen). */
export const BCRYPT_COST = 10;

let dummyHash: Promise<string> | null = null;

/**
 * Hash som login jämför mot när kontot saknas eller uppslaget fallerar, så att bcrypt-arbetet
 * (och därmed svarstiden) blir detsamma som för ett riktigt konto. Skapas första gången den behövs,
 * en gång per process, av ett slumpat värde; hashen tillhör ingen användare och lösenordet bakom den slängs.
 */
export function getDummyPasswordHash(): Promise<string> {
  if (!dummyHash) {
    const made = (async () => bcrypt.hash(randomBytes(32).toString('hex'), BCRYPT_COST))();
    made.catch(() => { dummyHash = null; });
    dummyHash = made;
  }
  return dummyHash;
}

/**
 * Anropas en gång när servern startar, så att inget inloggningsförsök betalar för att skapa hashen. Väntar inte på den och
 * kraschar inte processen om det misslyckas: nästa login försöker då skapa den själv.
 */
export function warmUpDummyPasswordHash(): void {
  getDummyPasswordHash().catch((error: unknown) => {
    logger.warn('⚠️ Could not warm up the login dummy hash:', errorCode(error));
  });
}
