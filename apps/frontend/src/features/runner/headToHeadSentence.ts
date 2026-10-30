import type { HeadToHeadRecord } from '@runquest/shared';
import { firstName } from '@/shared/utils/format';

/**
 * Head to head som EN mening, för skärmläsaren: panelens siffror är `aria-hidden` och meningen bär innehållet. Rekordet är redan sett ur den inloggades sida
 * (vinster = mina), så meningen säger "to you" när jag leder, "to <förnamn>" när motståndaren leder och "level" vid lika. Aldrig him/her: ett förnamn eller "you".
 */
export function headToHeadSentence(record: Pick<HeadToHeadRecord, 'wins' | 'draws' | 'losses' | 'total'>, opponentName: string): string {
  const opponent = firstName(opponentName);
  if (record.total === 0) return `Head to head: no duels against ${opponent} yet`;

  const score = `${record.wins}–${record.draws}–${record.losses}`;
  if (record.wins > record.losses) return `Head to head: ${score} to you`;
  if (record.losses > record.wins) return `Head to head: ${score} to ${opponent}`;
  return `Head to head: ${score} level`;
}
