import type { RQIconName } from '@/shared/components/icons';
import type { ChangeKind, PatchNote, Release, ReleaseType } from './changelogTypes';

/** Flikarna på Feature & Version (`?view=`). Ordningen är prototypens: Features · Working on · Releases. */
export const CHANGELOG_VIEWS = ['features', 'working', 'releases'] as const;
export type ChangelogView = (typeof CHANGELOG_VIEWS)[number];
export const DEFAULT_CHANGELOG_VIEW: ChangelogView = 'features';

export const RELEASE_TYPE_LABEL: Record<ReleaseType, string> = { major: 'Major', minor: 'Minor', patch: 'Patch' };

/** Ikon och namn per ändringstyp (prototypens `chg`: sparkles/grön · settings/neutral · bug/röd). Färgen sätts i CSS via `data-kind`. */
export const CHANGE_KIND: Record<ChangeKind, { label: string; icon: RQIconName }> = {
  feature: { label: 'Feature', icon: 'sparkles' },
  improvement: { label: 'Improvement', icon: 'settings' },
  bugfix: { label: 'Bugfix', icon: 'bug' },
};

/** Nyaste först är kontraktet (versionsvakten kräver det), så den första posten är den senaste. */
export const latestRelease = (releases: readonly Release[]): Release | undefined => releases[0];

/** "Version 0.5.2 · released 5 October 2026" — versaliseringen sköter CSS. Tom sträng utan poster. */
export const versionLine = (release: Release | undefined): string =>
  release ? `Version ${release.version} · released ${release.date}` : '';

/** Den senaste releasen börjar öppen; ett klick på den öppna stänger den, ett klick på en annan byter. */
export const initialOpenVersion = (releases: readonly Release[]): string | null => latestRelease(releases)?.version ?? null;
export const toggleOpenVersion = (current: string | null, clicked: string): string | null => (current === clicked ? null : clicked);

/** DOM-id för en release (punkter i ett id fungerar men krånglar i selektorer). */
export const releasePanelId = (version: string): string => `fx-release-${version.replace(/\./g, '-')}`;

/** Slugen som sparas som "sett" när användaren stängt popupen för en version. Ändra den aldrig för en redan släppt version. */
export const slugForVersion = (version: string): string => `patch_v${version}`;

/** Posterna med `announce: true`, nyaste först — det onboarding-kön och popupen visar. */
export const announcedNotes = (releases: readonly Release[]): PatchNote[] =>
  releases
    .filter((release) => release.announce === true)
    .map((release) => ({ slug: slugForVersion(release.version), version: release.version, title: release.title, changes: release.changes }));
