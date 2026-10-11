// Level-service (frontend): äger hämtningen av nivåtabellen via backenden
// (GET /api/config/levels, RUN-111) och håller den i minnet. Matematiken bor i
// @runquest/shared (ADR 004) — samma källa som backend, inklusive fallback-tabellen.
//
// Utloggad (Landing är publik) eller vid fel gäller FALLBACK_LEVEL_REQUIREMENTS, som är
// verifierad identisk med prod. Tabellen är statisk, så en lyckad hämtning gäller för sessionen.
import { backendApi } from '@/shared/services/backendApi';
import { log } from '@/shared/utils/logger';
import {
  levelFromXP, xpForLevel, xpForNextLevel, levelProgress,
  FALLBACK_LEVEL_REQUIREMENTS, MAX_LEVEL,
  type LevelRequirement, type LevelProgress, type LevelsApiResponse,
} from '@runquest/shared';

const LEVELS_ENDPOINT = '/config/levels';

function isLevelRequirement(row: unknown): row is LevelRequirement {
  const candidate = row as Partial<LevelRequirement> | null;
  return typeof candidate?.level === 'number' && typeof candidate.xp_required === 'number';
}

export class FrontendLevelService {
  private levelRequirements: LevelRequirement[] = FALLBACK_LEVEL_REQUIREMENTS;
  private initialized = false;
  private inFlight: Promise<void> | null = null;

  /**
   * Hämtar tabellen från backenden och börjar använda den. Kastar vid fel (så att react-query kan försöka igen);
   * tabellen i bruk förblir då oförändrad. Utloggad: inget nätverksanrop, kastar.
   */
  async refresh(): Promise<LevelRequirement[]> {
    if (!backendApi.getToken()) throw new Error('Level requirements need a signed-in user');

    const res = await backendApi.authenticatedRequest<LevelsApiResponse>(LEVELS_ENDPOINT);
    const rows = res.data?.data;
    if (!res.success || !Array.isArray(rows) || rows.length === 0 || !rows.every(isLevelRequirement)) {
      throw new Error(res.error || 'Failed to load level requirements');
    }

    this.levelRequirements = [...rows].sort((a, b) => a.level - b.level);
    this.initialized = true;
    return this.levelRequirements;
  }

  /** Hämtar tabellen en gång. Utloggad eller vid fel används fallback-tabellen; nästa anrop försöker igen. */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (!backendApi.getToken()) return;
    if (!this.inFlight) {
      this.inFlight = this.refresh()
        .then(() => undefined)
        .catch((error) => log.error('Level requirements unavailable, using fallback table', error))
        .finally(() => { this.inFlight = null; });
    }
    return this.inFlight;
  }

  private requirements(): LevelRequirement[] {
    return this.levelRequirements;
  }

  async getLevelFromXP(totalXP: number): Promise<number> {
    await this.initialize();
    return levelFromXP(totalXP, this.requirements());
  }

  async getXPForLevel(level: number): Promise<number> {
    await this.initialize();
    return xpForLevel(level, this.requirements());
  }

  async getXPForNextLevel(level: number): Promise<number> {
    await this.initialize();
    return xpForNextLevel(level, this.requirements());
  }

  async getLevelProgress(totalXP: number): Promise<LevelProgress> {
    await this.initialize();
    return levelProgress(totalXP, this.requirements());
  }

  // Synchronous versions (före hämtning: delade fallback-tabellen, inte en approximation)
  getLevelFromXPSync(totalXP: number): number {
    return levelFromXP(totalXP, this.requirements());
  }

  getXPForLevelSync(level: number): number {
    return xpForLevel(level, this.requirements());
  }
}

// Export singleton instance
export const frontendLevelService = new FrontendLevelService();

// Export types
export type { LevelRequirement };

// Backwards compatible functions (synchronous)
export function getLevelFromXP(totalXP: number): number {
  return frontendLevelService.getLevelFromXPSync(totalXP);
}

export function getXPForLevel(level: number): number {
  return frontendLevelService.getXPForLevelSync(level);
}

export function getXPForNextLevel(level: number): number {
  return frontendLevelService.getXPForLevelSync(Math.min(level + 1, MAX_LEVEL));
}

// Async versions for new code
export async function getLevelFromXPAsync(totalXP: number): Promise<number> {
  return frontendLevelService.getLevelFromXP(totalXP);
}

export async function getLevelProgressAsync(totalXP: number) {
  return frontendLevelService.getLevelProgress(totalXP);
}
