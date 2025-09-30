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

export function getXPForLevel(level: number): number {
  const thresholds = [0, 100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500];
  return thresholds[Math.min(level, thresholds.length - 1)] || 0;
}

export function getXPForNextLevel(level: number): number {
  const thresholds = [0, 100, 300, 600, 1000, 1500, 2100, 2800, 3600, 4500];
  return thresholds[Math.min(level + 1, thresholds.length - 1)] || 4500;
}