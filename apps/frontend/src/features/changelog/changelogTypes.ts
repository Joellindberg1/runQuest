import type { RQIconName } from '@/shared/components/icons';

/**
 * Schemat för `src/data/changelog.json` — ENDA källan för det gruppen ser (Feature & Version-sidan och "What's new"-popupen).
 * Formen kontrolleras i CI av `scripts/check-versions.mjs` (ordning, semver, datum, typer); ikonnamnen kontrolleras av ett test här.
 */

/** `bugfix` (inte `fix`): så heter typen i prototypen och i alla äldre poster. */
export type ChangeKind = 'feature' | 'improvement' | 'bugfix';
export type ReleaseType = 'major' | 'minor' | 'patch';

export interface Change {
  type: ChangeKind;
  /** Enkel engelska, vad användaren märker — inga tekniska detaljer (docs/dokumentation.md). */
  description: string;
}

export interface Release {
  /** X.Y.Z — samma nummer som git-taggen, package.json och översta rubriken i CHANGELOG.md. */
  version: string;
  /** Följer versionsnumret (x.0.0 major · x.y.0 minor · annars patch); kontrolleras av versionsvakten. */
  type: ReleaseType;
  /** "5 October 2026" — samma format i alla poster. */
  date: string;
  title: string;
  /** Visas som "What's new"-popup en gång per användare. Utelämnat = ingen popup. */
  announce?: true;
  changes: Change[];
}

/** Ett kort i fliken Features: något appen kan idag. */
export interface FeatureEntry {
  title: string;
  body: string;
  icon: RQIconName;
}

/** Ett kort i fliken Working on: något på väg. */
export interface WorkingOnEntry {
  title: string;
  body: string;
  icon: RQIconName;
  details: string[];
}

export interface ChangelogData {
  features: FeatureEntry[];
  workingOn: WorkingOnEntry[];
  /** Nyaste först. */
  releases: Release[];
}

/** En annonserad post som popupen visar. `slug` är det som sparas som "sett" i onboarding-tabellen. */
export interface PatchNote {
  slug: string;
  version: string;
  title: string;
  changes: Change[];
}
