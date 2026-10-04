import { Link } from 'react-router-dom';
import { RQIcon } from '@/shared/components/icons';
import { duelsSendPath } from '@/paths';

interface ChallengeButtonProps {
  opponentId: string;
  /** Pågående/väntande utmaning mellan paret (head-to-head `active`) — då går det inte att skicka en ny. */
  active: 'pending' | 'active' | null;
}

/**
 * Den primära handlingen på Runner card (guld, en per vy — regel 3). Länkar till `/duels?send=1&opponent=<id>`;
 * send-sheeten som läser parametrarna byggs i inkrement 5, tills dess landar länken på Duels.
 */
export function ChallengeButton({ opponentId, active }: ChallengeButtonProps) {
  if (active) {
    return (
      <button type="button" className="rq-btn rq-btn--primary rq-btn--sm" disabled>
        <RQIcon name="swords" size={15} />
        {active === 'pending' ? 'Challenge pending' : 'Challenge live'}
      </button>
    );
  }
  return (
    <Link to={duelsSendPath(opponentId)} className="rq-btn rq-btn--primary rq-btn--sm">
      <RQIcon name="swords" size={15} />
      Challenge
    </Link>
  );
}
