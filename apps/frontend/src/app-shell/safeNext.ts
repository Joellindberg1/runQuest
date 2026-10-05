import { paths } from '@/paths';

const BACKSLASH = String.fromCharCode(92);

/**
 * `?next=` efter login. Bara interna adresser accepteras (börjar med en enkel `/`),
 * annars faller vi tillbaka på /board — aldrig en öppen redirect.
 */
export function resolveNextPath(search: string): string {
  const next = new URLSearchParams(search).get('next');
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith(`/${BACKSLASH}`)) return paths.board;
  if (next === paths.login || next.startsWith(`${paths.login}?`)) return paths.board;
  return next;
}
