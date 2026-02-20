import changelogData from '@/data/changelog.json';

export type ChangeType = 'feature' | 'bugfix' | 'improvement';
export type ReleaseType = 'major' | 'minor' | 'patch';

export interface Change {
  type: ChangeType;
  description: string;
}

export interface Release {
  version: string;
  type: ReleaseType;
  date: string;
  title: string;
  changes: Change[];
}

// Assumes changelog.json is sorted newest first
export const getAllReleases = (): Release[] => changelogData as Release[];
export const getLatestRelease = (): Release => getAllReleases()[0];
export const getPreviousReleases = (): Release[] => getAllReleases().slice(1);
