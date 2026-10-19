// Level-service (frontend): äger hämtningen av nivåtabellen via backenden
// (GET /api/config/levels, RUN-111) och håller den i minnet. Matematiken bor i
// @runquest/shared (ADR 004) — samma källa som backend, inklusive fallback-tabellen.
//
// Utloggad (Landing är publik) eller vid fel gäller FALLBACK_LEVEL_REQUIREMENTS, som är
// verifierad identisk med prod. Tabellen är statisk, så en lyckad hämtning gäller för sessionen.
import { backendApi } from '@/shared/services/backendApi';
import {
  levelFromXP, xpForLevel,
  FALLBACK_LEVEL_REQUIREMENTS,
  type LevelRequirement, type LevelsApiResponse,
} from '@runquest/shared';

const LEVELS_ENDPOINT = '/config/levels';

function isLevelRequirement(row: unknown): row is LevelRequirement {
  const candidate = row as Partial<LevelRequirement> | null;
  return typeof candidate?.level === 'number' && typeof candidate.xp_required === 'number';
}

export class FrontendLevelService {
  private levelRequirements: LevelRequirement[] = FALLBACK_LEVEL_REQUIREMENTS;

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
    return this.levelRequirements;
  }

  private requirements(): LevelRequirement[] {
    return this.levelRequirements;
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

export function getLevelFromXP(totalXP: number): number {
  return frontendLevelService.getLevelFromXPSync(totalXP);
}

export function getXPForLevel(level: number): number {
  return frontendLevelService.getXPForLevelSync(level);
}
