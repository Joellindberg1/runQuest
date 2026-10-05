import changelogJson from '@/data/changelog.json';
import type { ChangelogData } from './changelogTypes';

/** Det enda stället som läser changelog.json. Formen vaktas av scripts/check-versions.mjs (CI) och changelogData.test.ts. */
export const changelog = changelogJson as ChangelogData;
