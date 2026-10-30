import { useId } from 'react';
import { Link } from 'react-router-dom';
import { RQIcon } from '@/shared/components/icons';
import type { SendOriginRouteState } from '@/shared/hooks/useOpenRunner';
import { duelsSendPath } from '@/paths';
import type { ChallengeAvailability } from '../challengeAvailability';

interface ChallengeButtonProps {
  opponentId: string;
  /** Pågående/väntande utmaning mellan paret (head-to-head `active`) — då går det inte att skicka en ny. */
  active: 'pending' | 'active' | null;
  /**
   * Profil-popupen (på mobil och på sidan utelämnas den): länken ersätter popupens historikpost, så att Back från send-flödet går till sidan under och inte öppnar popupen igen, och
   * `state` bär vart ett avbrutet flöde ska tillbaka. `availability` avgör om det går att skicka; annars blir knappen avstängd (laddar: utan text, hinder: med skälet bredvid).
   */
  inPopup?: { state: SendOriginRouteState | undefined; availability: ChallengeAvailability };
}

/**
 * Runner cards primärhandling, men en SEKUNDÄR knapp (guld-hårlinje) enligt prototypen — kortet har ingen
 * fylld guldknapp. Länkar till `/duels?send=1&opponent=<id>`; send-sheeten (features/challenges/SendSheet) läser
 * parametrarna och förväljer löparen. Med en pågående utmaning visas i stället en statuschip
 * (en avstängd knapp har för låg kontrast för att bära tillståndsinfo), och den har företräde framför ett skäl.
 *
 * Avstängd är `aria-disabled` på en knapp som går att fokusera (inte `disabled`): skälet står som synlig text och är knappens beskrivning, och ett klick eller Enter gör ingenting.
 */
export function ChallengeButton({ opponentId, active, inPopup }: ChallengeButtonProps) {
  const reasonId = useId();

  if (active) {
    return (
      <span className="rq-chip rq-chip--status rq-chip--duel">
        <RQIcon name="swords" size={15} />
        {active === 'pending' ? 'Challenge pending' : 'Challenge live'}
      </span>
    );
  }

  const availability = inPopup?.availability;
  if (availability && availability.status !== 'ready') {
    const reason = availability.status === 'blocked' ? availability.reason : null;
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

  return (
    <Link to={duelsSendPath(opponentId)} replace={inPopup ? true : undefined} state={inPopup?.state} className="rq-btn rq-btn--secondary rq-btn--sm">
      <RQIcon name="swords" size={15} />
      Challenge
    </Link>
  );
}
