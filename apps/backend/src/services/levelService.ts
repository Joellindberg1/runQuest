// Level-service: äger DB-läsning + cache av level_requirements.
// Själva matematiken bor i @runquest/shared (ADR 004) — enda källan.
import { getSupabaseClient } from '../config/database.js';
import { logger } from '../utils/logger.js';
import {
  levelFromXP, xpForLevel, xpForNextLevel, levelProgress,
  FALLBACK_LEVEL_REQUIREMENTS,
  type LevelRequirement, type LevelProgress,
} from '@runquest/shared';

// Fallback ska vara tillfälligt: utan nytt försök sitter en process med ett engångsfel kvar på
// fallback-nivåerna tills den startas om (RUN-137).
export const FALLBACK_RETRY_TTL_MS = 5 * 60 * 1000;

class LevelService {
  private levelRequirements: LevelRequirement[] = [];
  private initialized = false;
  // null = värdena kommer från DB och cachas utan tidsgräns; annars när fallback får bytas ut.
  private retryAfter: number | null = null;

  private useFallback() {
    this.levelRequirements = FALLBACK_LEVEL_REQUIREMENTS;
    this.initialized = true;
    this.retryAfter = Date.now() + FALLBACK_RETRY_TTL_MS;
  }

  async initialize() {
    if (this.initialized && (this.retryAfter === null || Date.now() < this.retryAfter)) return;

    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('level_requirements')
        .select('level, xp_required')
        .order('level', { ascending: true });

      if (error || !data?.length) {
        if (error) logger.error('Error fetching level requirements:', error);
        this.useFallback();
        logger.warn('⚠️ Level service using fallback values');
        return;
      }

      this.levelRequirements = data;
      this.initialized = true;
      this.retryAfter = null;
      logger.info(`✅ Level service initialized with ${this.levelRequirements.length} levels`);
    } catch (error) {
      logger.error('Error initializing level service:', error);
      this.useFallback();
    }
  }

  async getLevelFromXP(totalXP: number): Promise<number> {
    await this.initialize();
    return levelFromXP(totalXP, this.levelRequirements);
  }

  async getXPForLevel(level: number): Promise<number> {
    await this.initialize();
    return xpForLevel(level, this.levelRequirements);
  }

  async getXPForNextLevel(level: number): Promise<number> {
    await this.initialize();
    return xpForNextLevel(level, this.levelRequirements);
  }

  async getLevelProgress(totalXP: number): Promise<LevelProgress> {
    await this.initialize();
    return levelProgress(totalXP, this.levelRequirements);
  }

  async getAllLevelRequirements(): Promise<LevelRequirement[]> {
    await this.initialize();
    return [...this.levelRequirements];
  }
}

// Export singleton instance
export const levelService = new LevelService();

// Export types
export type { LevelRequirement };

// Convenience functions
export async function getLevelFromXP(totalXP: number): Promise<number> {
  return levelService.getLevelFromXP(totalXP);
}

export async function getXPForLevel(level: number): Promise<number> {
  return levelService.getXPForLevel(level);
}
