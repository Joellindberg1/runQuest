import { supabase } from '@/integrations/supabase/client';

interface LevelRequirement {
  level: number;
  xp_required: number;
}

class FrontendLevelService {
  private levelRequirements: LevelRequirement[] = [];
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    // Prevent multiple simultaneous initialization calls
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('level_requirements')
        .select('level, xp_required')
        .order('level', { ascending: true });

      if (error) {
        console.error('Error fetching level requirements:', error);
        this.setFallbackLevels();
        return;
      }

      this.levelRequirements = data || [];
      this.initialized = true;
      console.log(`✅ Frontend level service initialized with ${this.levelRequirements.length} levels`);
      
      // Cache in localStorage for offline use
      localStorage.setItem('levelRequirements', JSON.stringify(this.levelRequirements));
    } catch (error) {
      console.error('Error initializing frontend level service:', error);
      this.loadFromCache();
    }
  }

  private setFallbackLevels(): void {
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
    console.log('⚠️ Frontend level service using fallback values');
  }

  private loadFromCache(): void {
    try {
      const cached = localStorage.getItem('levelRequirements');
      if (cached) {
        this.levelRequirements = JSON.parse(cached);
        this.initialized = true;
        console.log('✅ Frontend level service loaded from cache');
        return;
      }
    } catch (error) {
      console.error('Error loading from cache:', error);
    }
    
    // If cache fails, use fallback
    this.setFallbackLevels();
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

  // Synchronous versions for backwards compatibility (uses cached data)
  getLevelFromXPSync(totalXP: number): number {
    if (!this.initialized) {
      console.warn('Level service not initialized, using fallback calculation');
      // Quick fallback calculation
      if (totalXP < 50) return 1;
      if (totalXP < 102) return 2;
      if (totalXP < 158) return 3;
      if (totalXP < 217) return 4;
      if (totalXP < 280) return 5;
      if (totalXP < 349) return 6;
      if (totalXP < 423) return 7;
      if (totalXP < 504) return 8;
      if (totalXP < 594) return 9;
      if (totalXP < 693) return 10;
      if (totalXP < 806) return 11;
      if (totalXP < 934) return 12;
      if (totalXP < 1079) return 13;
      if (totalXP < 1244) return 14;
      if (totalXP < 1436) return 15;
      // Continue pattern...
      return Math.min(Math.floor(totalXP / 100) + 1, 30);
    }

    for (let i = this.levelRequirements.length - 1; i >= 0; i--) {
      if (totalXP >= this.levelRequirements[i].xp_required) {
        return Math.min(this.levelRequirements[i].level, 30);
      }
    }
    return 1;
  }

  getXPForLevelSync(level: number): number {
    if (!this.initialized) {
      const fallbackXP = [0, 50, 102, 158, 217, 280, 349, 423, 504, 594, 693, 806, 934, 1079, 1244];
      return fallbackXP[Math.min(level - 1, fallbackXP.length - 1)] || 0;
    }

    const levelReq = this.levelRequirements.find(req => req.level === level);
    return levelReq?.xp_required || 0;
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
  return frontendLevelService.getXPForLevelSync(Math.min(level + 1, 30));
}

// Async versions for new code
export async function getLevelFromXPAsync(totalXP: number): Promise<number> {
  return frontendLevelService.getLevelFromXP(totalXP);
}

export async function getLevelProgressAsync(totalXP: number) {
  return frontendLevelService.getLevelProgress(totalXP);
}