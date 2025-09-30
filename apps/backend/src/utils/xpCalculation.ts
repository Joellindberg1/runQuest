import { levelService } from '../services/levelService.js';

export function calculateRunXP(distanceKm: number): number {
  return Math.min(Math.floor(distanceKm * 17), 60);
}

export function metersToKm(meters: number): number {
  return meters / 1000;
}

export async function getLevelFromXP(totalXP: number): Promise<number> {
  return levelService.getLevelFromXP(totalXP);
}

export async function getXPForLevel(level: number): Promise<number> {
  return levelService.getXPForLevel(level);
}

export async function getLevelProgress(totalXP: number) {
  return levelService.getLevelProgress(totalXP);
}