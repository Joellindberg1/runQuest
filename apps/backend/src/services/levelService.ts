import { getSupabaseClient } from '../config/database.js';

interface LevelRequirement {
  level: number;
  xp_required: number;
}

class LevelService {
  private levelRequirements: LevelRequirement[] = [];
  private initialized = false;

  async initialize() {
    if (this.initialized) return;

    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('level_requirements')
        .select('level, xp_required')
        .order('level', { ascending: true });

      if (error) {
        console.error('Error fetching level requirements:', error);
        // Fallback to hardcoded values if database fails
        this.setFallbackLevels();
        return;
      }

      this.levelRequirements = data || [];
      this.initialized = true;
      console.log(`✅ Level service initialized with ${this.levelRequirements.length} levels`);
    } catch (error) {
      console.error('Error initializing level service:', error);
      this.setFallbackLevels();
    }
  }

  private setFallbackLevels() {
    // Fallback to current hardcoded levels if database is unavailable
    const fallbackXP = [
      0, 50, 102, 158, 217, 280, 349, 423, 504, 594,
      693, 806, 934, 1079, 1244, 1436, 1659, 1920, 2228, 2591,
      3026, 3549, 4181, 4953, 5902, 7089, 8584, 10482, 12912, 16071
    ];
    
    this.levelRequirements = fallbackXP.map((xp, index) => ({
      level: index + 1,
      xp_required: xp
    }));
    
    this.initialized = true;
    console.log('⚠️ Level service using fallback values');
  }

  async getLevelFromXP(totalXP: number): Promise<number> {
    await this.initialize();
    
    for (let i = this.levelRequirements.length - 1; i >= 0; i--) {
      if (totalXP >= this.levelRequirements[i].xp_required) {
        return Math.min(this.levelRequirements[i].level, 30);
      }
    }
    return 1;
  }

  async getXPForLevel(level: number): Promise<number> {
    await this.initialize();
    
    const levelReq = this.levelRequirements.find(req => req.level === level);
    return levelReq?.xp_required || 0;
  }

  async getXPForNextLevel(level: number): Promise<number> {
    return this.getXPForLevel(Math.min(level + 1, 30));
  }

  async getLevelProgress(totalXP: number): Promise<{
    currentLevel: number;
    currentLevelXP: number;
    nextLevelXP: number;
    progress: number;
    xpToNext: number;
  }> {
    await this.initialize();
    
    const currentLevel = await this.getLevelFromXP(totalXP);
    const currentLevelXP = await this.getXPForLevel(currentLevel);
    const nextLevelXP = await this.getXPForNextLevel(currentLevel);
    
    const progress = currentLevel >= 30 ? 100 : 
      ((totalXP - currentLevelXP) / (nextLevelXP - currentLevelXP)) * 100;
    
    const xpToNext = currentLevel >= 30 ? 0 : nextLevelXP - totalXP;
    
    return {
      currentLevel,
      currentLevelXP,
      nextLevelXP,
      progress: Math.max(0, Math.min(100, progress)),
      xpToNext: Math.max(0, xpToNext)
    };
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

// Convenience functions for backwards compatibility
export async function getLevelFromXP(totalXP: number): Promise<number> {
  return levelService.getLevelFromXP(totalXP);
}

export async function getXPForLevel(level: number): Promise<number> {
  return levelService.getXPForLevel(level);
}