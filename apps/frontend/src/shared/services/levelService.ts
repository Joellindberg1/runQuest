// Level-service (frontend): äger DB-läsning + localStorage-cache av
// level_requirements. Matematiken bor i @runquest/shared (ADR 004) — samma
// källa som backend, inklusive fallback-tabellen (den tidigare tredje
// approximationen över nivå 15 är borta).
import { supabase } from '@/integrations/supabase/clientWithAuth';
import {
  levelFromXP, xpForLevel, xpForNextLevel, levelProgress,
  FALLBACK_LEVEL_REQUIREMENTS, MAX_LEVEL,
  type LevelRequirement, type LevelProgress,
} from '@runquest/shared';

class FrontendLevelService {
  private levelRequirements: LevelRequirement[] = [];
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('level_requirements')
        .select('level, xp_required')
        .order('level', { ascending: true });

      if (error || !data?.length) {
        if (error) console.error('Error fetching level requirements:', error);
        this.loadFromCache();
        return;
      }

      this.levelRequirements = data;
      this.initialized = true;
      try {
        localStorage.setItem('levelRequirements', JSON.stringify(this.levelRequirements));
      } catch {
        // localStorage kan vara otillgängligt (private mode) — cachen är bara en bonus
      }
    } catch (error) {
      console.error('Error initializing frontend level service:', error);
      this.loadFromCache();
    }
  }

  private loadFromCache(): void {
    try {
      const cached = localStorage.getItem('levelRequirements');
      if (cached) {
        this.levelRequirements = JSON.parse(cached);
        this.initialized = true;
        return;
      }
    } catch (error) {
      console.error('Error loading from cache:', error);
    }
    this.levelRequirements = FALLBACK_LEVEL_REQUIREMENTS;
    this.initialized = true;
  }

  private requirements(): LevelRequirement[] {
    return this.initialized && this.levelRequirements.length > 0
      ? this.levelRequirements
      : FALLBACK_LEVEL_REQUIREMENTS;
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

  // Synchronous versions (före init: delade fallback-tabellen, inte en approximation)
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
