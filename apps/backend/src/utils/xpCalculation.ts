export function calculateRunXP(distanceKm: number): number {
  return Math.min(Math.floor(distanceKm * 17), 60);
}

export function metersToKm(meters: number): number {
  return meters / 1000;
}

export function getLevelFromXP(totalXP: number): number {
  if (totalXP < 100) return 1;
  if (totalXP < 300) return 2;
  if (totalXP < 600) return 3;
  if (totalXP < 1000) return 4;
  if (totalXP < 1500) return 5;
  if (totalXP < 2100) return 6;
  if (totalXP < 2800) return 7;
  if (totalXP < 3600) return 8;
  if (totalXP < 4500) return 9;
  return 10;
}