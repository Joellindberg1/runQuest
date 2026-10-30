import type { MouseEvent } from 'react';
import { firstName } from '@/shared/utils/format';
import { restOfName } from '../podiumName';

interface PodiumNameProps {
  userId: string;
  name: string;
  onOpen: () => void;
}

/**
 * Mobilens podium: namnknappen med förnamn och efternamn i var sin ruta, så pilen kan stå vid förnamnet och efternamnet få en egen rad (layouten bor i board.css).
 * Knappens text är fortfarande hela namnet, och den bär data-runner-id som `RunnerName`. Egen komponent, inte en variant av `RunnerName`: BoardParts delas med landningen, och landningens JS ska inte växa.
 */
export function PodiumName({ userId, name, onOpen }: PodiumNameProps) {
  const surname = restOfName(name);
  const open = (event: MouseEvent) => {
    event.stopPropagation();
    onOpen();
  };
  return (
    <button type="button" className="rq-name rq-board-namebtn" data-runner-id={userId} onClick={open}>
      <span className="rq-board-podium__given">{firstName(name)}</span>
      {surname && (
        <>
          {' '}
          <span className="rq-board-podium__surname">{surname}</span>
        </>
      )}
    </button>
  );
}
