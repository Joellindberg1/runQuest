import { paths } from '@/paths';

/** Publik adress. index.html har startsidans canonical för alla SPA-adresser; /legal står i sitemapen och pekar på sig själv. */
export const LEGAL_CANONICAL_URL = `https://www.runquest.dev${paths.legal}`;
export const LEGAL_PAGE_TITLE = 'Privacy & Terms — RunQuest';
export const LEGAL_PAGE_DESCRIPTION = 'What RunQuest stores about you, how to have it deleted, and the terms of this private hobby project.';

/** DOM-id för ett avsnitts rubrik. Prefixet håller dem skilda från sektionsankarna (#privacy, #terms). */
export const legalSectionDomId = (sectionId: string): string => `legal-${sectionId}`;

export interface TextPart {
  readonly kind: 'text' | 'email';
  readonly text: string;
}

/** Delar ett stycke så att kontaktadressen kan bli en mailto-länk. Texten är oförändrad: delarna sätts ihop till originalet. */
export function splitOnEmail(paragraph: string, email: string): TextPart[] {
  if (!email) return [{ kind: 'text', text: paragraph }];
  const parts: TextPart[] = [];
  let rest = paragraph;
  for (let at = rest.indexOf(email); at !== -1; at = rest.indexOf(email)) {
    if (at > 0) parts.push({ kind: 'text', text: rest.slice(0, at) });
    parts.push({ kind: 'email', text: email });
    rest = rest.slice(at + email.length);
  }
  if (rest) parts.push({ kind: 'text', text: rest });
  return parts;
}
