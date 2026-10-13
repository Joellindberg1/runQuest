// Gemensam källa för integritetstext och villkor (RUN-201): /legal (RUN-204), väntelistans samtycke (RUN-211) och
// Strava-samtycket (RUN-180, v0.7.0) läser härifrån. Signaturen är låst mellan RUN-201 och RUN-204; texten fylls i RUN-201.
// SKELETT (Lead-förcommit P0): utkasttext, ersätts av RUN-201.

export interface LegalSection {
  /** Stabil nyckel. Obligatoriska: 'strava', 'deletion', 'waitlist' (integritet) och 'terms' (villkor). Bara [a-z0-9-]. */
  readonly id: string;
  readonly title: string;
  /** Stycken i klartext på engelska. Ingen HTML och ingen markdown. E-postadressen får stå som text. */
  readonly paragraphs: readonly string[];
}

export interface DataController {
  readonly name: string;
  readonly email: string;
}

export interface LegalDocument {
  readonly version: string;
  readonly controller: DataController;
  readonly sections: readonly LegalSection[];
}

/** Version av integritetstexten, 'YYYY-MM-DD[.N]'. Höjs vid varje innehållsändring. */
export const DATA_POLICY_VERSION = '2026-10-13';

/** Personuppgiftsansvarig (ägarbeslut 2026-10-13, publik visning godkänd av ägaren). */
export const DATA_CONTROLLER: DataController = {
  name: 'Joel Lindberg',
  email: 'joellindberg23@gmail.com',
};

/** Integritetsavsnitten i visningsordning, utan 'terms'. */
export const DATA_POLICY_SECTIONS: readonly LegalSection[] = [
  { id: 'waitlist', title: 'Waitlist', paragraphs: ['Draft.'] },
  { id: 'strava', title: 'Strava', paragraphs: ['Draft.'] },
  { id: 'deletion', title: 'Deleting your data', paragraphs: ['Draft.'] },
];

export const TERMS_SECTION: LegalSection = { id: 'terms', title: 'Terms', paragraphs: ['Draft.'] };

export function getDataPolicySection(id: string): LegalSection | undefined {
  if (id === TERMS_SECTION.id) return TERMS_SECTION;
  return DATA_POLICY_SECTIONS.find((section) => section.id === id);
}

export function getDataPolicy(): LegalDocument {
  return { version: DATA_POLICY_VERSION, controller: DATA_CONTROLLER, sections: DATA_POLICY_SECTIONS };
}

export function getTerms(): LegalDocument {
  return { version: DATA_POLICY_VERSION, controller: DATA_CONTROLLER, sections: [TERMS_SECTION] };
}
