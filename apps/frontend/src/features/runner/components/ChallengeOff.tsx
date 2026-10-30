import { useId } from 'react';
import { RQIcon } from '@/shared/components/icons';

interface ChallengeOffProps {
  /** Varför det inte går att skicka, som synlig text bredvid knappen; null medan det laddas (då står ingen text). */
  reason: string | null;
}

/**
 * Popupens Challenge när det inte går (eller inte går att veta än) att skicka. Knappen är `aria-disabled`, inte `disabled`, så att den går att fokusera: skälet är dess beskrivning
 * (`aria-describedby`) och står som synlig text bredvid, och ett klick eller Enter gör ingenting. En avstängd knapp har för låg kontrast för att bära skälet själv.
 */
export function ChallengeOff({ reason }: ChallengeOffProps) {
  const reasonId = useId();
  return (
    <>
      {reason && <span id={reasonId} className="rq-runner-popup__reason">{reason}</span>}
      <button type="button" className="rq-btn rq-btn--secondary rq-btn--sm" aria-disabled="true" aria-describedby={reason ? reasonId : undefined}>
        <RQIcon name="swords" size={15} />
        Challenge
      </button>
    </>
  );
}
