export function getLevelFromXP(totalXP: number): number {
  const levelRequirements = [
    0, 50, 102, 158, 217, 280, 349, 423, 504, 594,
    693, 806, 934, 1079, 1244, 1436, 1659, 1920, 2228, 2591,
    3026, 3549, 4181, 4953, 5902, 7089, 8584, 10482, 12912, 16071
  ];
  
  for (let i = levelRequirements.length - 1; i >= 0; i--) {
    if (totalXP >= levelRequirements[i]) {
      return Math.min(i + 1, 30);
    }
  }
  return 1;
}

export function getXPForLevel(level: number): number {
  const levelRequirements = [
    0, 50, 102, 158, 217, 280, 349, 423, 504, 594,
    693, 806, 934, 1079, 1244, 1436, 1659, 1920, 2228, 2591,
    3026, 3549, 4181, 4953, 5902, 7089, 8584, 10482, 12912, 16071
  ];
  
  const index = Math.min(Math.max(level - 1, 0), levelRequirements.length - 1);
  return levelRequirements[index];
}

export function getXPForNextLevel(level: number): number {
  return getXPForLevel(Math.min(level + 1, 30));
}