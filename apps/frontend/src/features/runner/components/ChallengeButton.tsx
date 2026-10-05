import { Link } from 'react-router-dom';
import { RQIcon } from '@/shared/components/icons';
import { duelsSendPath } from '@/paths';

interface ChallengeButtonProps {
  opponentId: string;
  /** Pågående/väntande utmaning mellan paret (head-to-head `active`) — då går det inte att skicka en ny. */
  active: 'pending' | 'active' | null;
}

/**
 * Runner cards primärhandling, men en SEKUNDÄR knapp (guld-hårlinje) enligt prototypen — kortet har ingen
 * fylld guldknapp. Länkar till `/duels?send=1&opponent=<id>`; send-sheeten (features/challenges/SendSheet) läser
 * parametrarna och förväljer löparen. Med en pågående utmaning visas i stället en statuschip
 * (en avstängd knapp har för låg kontrast för att bära tillståndsinfo).
 */
export function ChallengeButton({ opponentId, active }: ChallengeButtonProps) {
  if (active) {
    return (
      <span className="rq-chip rq-chip--status rq-chip--duel">
        <RQIcon name="swords" size={15} />
        {active === 'pending' ? 'Challenge pending' : 'Challenge live'}
      </span>
    );
  }
  return (
    <Link to={duelsSendPath(opponentId)} className="rq-btn rq-btn--secondary rq-btn--sm">
      <RQIcon name="swords" size={15} />
      Challenge
    </Link>
  );
}
