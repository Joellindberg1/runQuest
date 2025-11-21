// Re-export functions from the level service for backwards compatibility
export { 
  getLevelFromXP, 
  getXPForLevel, 
  getXPForNextLevel,
  getLevelFromXPAsync,
  getLevelProgressAsync,
  frontendLevelService
} from '@/shared/services/levelService';
