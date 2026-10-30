import { paths } from '@/paths';
import { isInternalPath } from '@/shared/utils/internalPath';

/**
 * `?next=` efter login. Bara interna adresser accepteras (`isInternalPath`), annars faller vi tillbaka på /board — aldrig en öppen redirect.
 */
export function resolveNextPath(search: string): string {
  const next = new URLSearchParams(search).get('next');
  if (!isInternalPath(next)) return paths.board;
  if (next === paths.login || next.startsWith(`${paths.login}?`)) return paths.board;
  return next;
}
