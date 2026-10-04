import { useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { paths, SEND_PARAM } from '@/paths';
import { RQIcon, type RQIconName } from '@/shared/components/icons';

const ICON_ACTION = 21;

interface ActionSpec {
  key: string;
  label: string;
  note: string;
  icon: RQIconName;
  /** Kantens färg: guld = belöning/primär handling, duel = utmaning. */
  tone: 'gold' | 'duel';
  to: string;
}

const ACTIONS: ActionSpec[] = [
  { key: 'log', label: 'Log a run', note: 'Treadmill, or a run Strava missed', icon: 'plus', tone: 'gold', to: paths.log },
  // "Send a challenge" öppnar send-sheeten via ?send=1 (ADR 006 beslut 4); sheeten byggs i inkrement 5.
  { key: 'send', label: 'Send a challenge', note: 'Spend a token on someone', icon: 'swords', tone: 'duel', to: `${paths.duels}?${SEND_PARAM}=1` },
];

interface NewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** +New-sheeten (mobil): skal-tillstånd, ingen egen route (ADR 006 beslut 4). */
export function NewSheet({ open, onOpenChange }: NewSheetProps) {
  const navigate = useNavigate();

  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="rq-scrim" />
        <Dialog.Content className="rq-sheet" aria-describedby={undefined}>
          <div className="rq-sheet__head">
            <Dialog.Title className="rq-sheet__title">CREATE</Dialog.Title>
            <Dialog.Close className="rq-sheet__close" aria-label="Close">✕</Dialog.Close>
          </div>
          {ACTIONS.map((action) => (
            <button
              key={action.key}
              type="button"
              className={`rq-sheet__action rq-sheet__action--${action.tone}`}
              onClick={() => go(action.to)}
            >
              <RQIcon name={action.icon} size={ICON_ACTION} />
              <span>
                <span className="rq-sheet__action-label">{action.label}</span>
                <br />
                <span className="rq-sheet__action-note">{action.note}</span>
              </span>
            </button>
          ))}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
