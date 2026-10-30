import { Link } from 'react-router-dom';
import { RQIcon } from '@/shared/components/icons';
import type { SendOriginRouteState } from '@/shared/hooks/useOpenRunner';
import { duelsSendPath } from '@/paths';

interface ChallengeButtonProps {
  opponentId: string;
  /** Pågående/väntande utmaning mellan paret (head-to-head `active`) — då går det inte att skicka en ny. */
  active: 'pending' | 'active' | null;
  /** Profil-popupen: länken ersätter popupens historikpost, så att Back från send-flödet går till sidan under och inte öppnar popupen igen. Mobilens sida lämnar den ospecificerad. */
  replace?: boolean;
  /** Router-state som länken bär med (popupen: `{ sendOrigin }`, se `SendOriginState`). */
  state?: SendOriginRouteState;
  /** Duels-fliken (`?view=`) som popupen öppnades över: en send som slutar utan ursprung landar på samma flik. */
  view?: string;
}

/**
 * Runner cards primärhandling, men en SEKUNDÄR knapp (guld-hårlinje) enligt prototypen — kortet har ingen
 * fylld guldknapp. Länkar till `/duels?send=1&opponent=<id>`; send-sheeten (features/challenges/SendSheet) läser
 * parametrarna och förväljer löparen. Med en pågående utmaning visas i stället en statuschip
 * (en avstängd knapp har för låg kontrast för att bära tillståndsinfo). Popupens avstängda knapp med skäl är `ChallengeOff`, som bara popupens chunk bär.
 */
export function ChallengeButton({ opponentId, active, replace, state, view }: ChallengeButtonProps) {
  if (active) {
    return (
      <span className="rq-chip rq-chip--status rq-chip--duel">
        <RQIcon name="swords" size={15} />
        {active === 'pending' ? 'Challenge pending' : 'Challenge live'}
      </span>
    );
  }
  return (
    <Link to={duelsSendPath(opponentId, view)} replace={replace} state={state} className="rq-btn rq-btn--secondary rq-btn--sm">
      <RQIcon name="swords" size={15} />
      Challenge
    </Link>
  );
}
