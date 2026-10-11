import { paths } from '@/paths';

const BACKSLASH = String.fromCharCode(92);
const LAST_CONTROL = 0x1f;
const DELETE = 0x7f;

/** Tab, radbrytning, CR och övriga kontrolltecken: webbläsarens URL-tolkning tar bort vissa av dem, så `/<tab>/evil.com` blir `//evil.com`. */
const hasControlCharacter = (text: string): boolean =>
  Array.from(text).some((char) => {
    const code = char.charCodeAt(0);
    return code <= LAST_CONTROL || code === DELETE;
  });

const staysOnThisOrigin = (next: string): boolean => {
  try {
    return new URL(next, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
};

/**
 * `?next=` efter login. Bara interna adresser accepteras (börjar med en enkel `/`, inga kontrolltecken, och tolkas av
 * webbläsaren till samma origin), annars faller vi tillbaka på /board — aldrig en öppen redirect.
 */
export function resolveNextPath(search: string): string {
  const next = new URLSearchParams(search).get('next');
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith(`/${BACKSLASH}`)) return paths.board;
  if (hasControlCharacter(next) || !staysOnThisOrigin(next)) return paths.board;
  if (next === paths.login || next.startsWith(`${paths.login}?`)) return paths.board;
  return next;
}
