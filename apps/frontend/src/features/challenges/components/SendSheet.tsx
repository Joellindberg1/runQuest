import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { ChallengeTier, User } from '@runquest/types';
import { RQIcon } from '@/shared/components/icons';
import { firstName, tierLabel } from '../duelsFormat';
import type { GroupStat, TierGroup, TokenCombo } from '../duelsModel';
import { useOpponentRecords } from '../hooks/useDuelsQueries';
import { buildOpponents, resolveOpponentParam, type OpponentOption, type SendBlocker } from '../sendModel';
import { TierRibbon } from './TierRibbon';

const ICON_HEAD = 21;
/** Legendary startar av sig själv efter fyra dagar utan svar (challengeScheduler). */
const LEGENDARY_AUTO_START_DAYS = 4;

interface SendSheetProps {
  groups: TierGroup[];
  /** Varför jag inte kan skicka just nu — då visar sheeten bara orsaken. */
  blocker: SendBlocker | null;
  members: GroupStat[];
  users: User[] | undefined;
  meId: string;
  /** Nivån som tryckts på i tokens-panelen. */
  initialTier: ChallengeTier | null;
  /** `?opponent=`: förvald motståndare om personen går att utmana. */
  initialOpponent: string | null;
  onClose: () => void;
  /** Kastar vid fel; sheeten visar då meddelandet och stannar kvar. */
  onSend: (tokenId: string, opponentId: string) => Promise<void>;
}

function TokenOption({ combo, selected, onSelect }: { combo: TokenCombo; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className="rq-duels-option rq-duels-option--token" data-tier={combo.tier} aria-pressed={selected} onClick={onSelect}>
      <TierRibbon tier={combo.tier} count={combo.count} />
      <span className="rq-duels-option__text">
        <span className="rq-duels-option__tier">{tierLabel(combo.tier)}</span>
        <span className="rq-duels-option__what">{`${combo.metricLabel} · ${combo.durationLabel}`}</span>
        <span className="rq-duels-option__stake">
          <span data-tone="up">{combo.stake.win}</span>
          <span data-tone={combo.stake.loseTone}>{combo.stake.lose}</span>
        </span>
      </span>
    </button>
  );
}

function OpponentRow({ option, selected, onSelect }: { option: OpponentOption; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className="rq-duels-option rq-duels-option--opponent" aria-pressed={selected} disabled={option.disabled} onClick={onSelect}>
      <span className="rq-avatar rq-duels-avatar">
        {option.pictureUrl ? <img src={option.pictureUrl} alt="" /> : option.initials}
      </span>
      <span className="rq-duels-option__text">
        <span className="rq-name">{option.name}</span>
        <span className="rq-duels-option__note">{option.note}</span>
      </span>
      {option.disabledReason ? (
        <span className="rq-duels-option__h2h" data-tone="muted">{option.disabledReason}</span>
      ) : (
        option.h2h && <span className="rq-duels-option__h2h" data-tone={option.h2h.tone}>{option.h2h.text}</span>
      )}
    </button>
  );
}

/**
 * Skicka utmaning: bottensheet på mobil, centrerad dialog på desktop (samma markup, olika mått via tokens).
 * Steg 1 väljer token — ett token fixerar nivå, mått och längd (spelreglerna ändras inte i redesignen, ägarbeslut 1,
 * så designens fria val av mått/längd ersätts av tokenets). Steg 2 väljer motståndare. "The bet" sammanfattar.
 * Monteras bara medan den är öppen, så valen nollställs varje gång.
 */
export function SendSheet({ groups, blocker, members, users, meId, initialTier, initialOpponent, onClose, onSend }: SendSheetProps) {
  const combos = useMemo(() => groups.flatMap((group) => group.combos), [groups]);
  const baseOptions = useMemo(() => buildOpponents({ members, users, meId, headToHead: {} }), [members, users, meId]);

  const [comboKey, setComboKey] = useState<string | null>(
    () => (groups.find((group) => group.tier === initialTier) ?? groups[0])?.combos[0]?.key ?? null,
  );
  const [opponentId, setOpponentId] = useState<string | null>(() => resolveOpponentParam(initialOpponent, baseOptions));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const records = useOpponentRecords(
    baseOptions.map((option) => option.userId),
    blocker === null,
  );
  const options = useMemo(() => buildOpponents({ members, users, meId, headToHead: records }), [members, users, meId, records]);

  const combo = combos.find((candidate) => candidate.key === comboKey) ?? combos[0];
  const opponent = options.find((option) => option.userId === opponentId && !option.disabled) ?? null;
  const ready = !!combo && !!opponent && !sending;

  const summary = combo
    ? `${combo.metricLabel}${opponent ? ` vs ${firstName(opponent.name)}` : ''} · ${combo.durationLabel}`
    : '';

  const submit = async () => {
    if (!combo || !opponent) return;
    setError(null);
    setSending(true);
    try {
      await onSend(combo.tokenId, opponent.userId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not send the challenge');
      setSending(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="rq-scrim" />
        <Dialog.Content className="rq-duels-sheet" aria-describedby={undefined}>
          <header className="rq-duels-sheet__head">
            <RQIcon name="swords" size={ICON_HEAD} />
            <div className="rq-duels-sheet__id">
              <Dialog.Title className="rq-duels-sheet__title">Send a challenge</Dialog.Title>
              <p className="rq-duels-sheet__sub">One token, one opponent</p>
            </div>
            <Dialog.Close className="rq-sheet__close" aria-label="Close">✕</Dialog.Close>
          </header>

          <div className="rq-duels-sheet__body">
            {blocker || !combo ? (
              <>
                <p role="status" className="rq-duels-sheet__blocked">{blocker?.message ?? 'You have no tokens to send. You earn them by levelling up.'}</p>
                <Dialog.Close className="rq-btn rq-btn--ghost">Close</Dialog.Close>
              </>
            ) : (
              <>
                <section aria-labelledby="duels-send-token">
                  <h3 id="duels-send-token" className="rq-duels-step">1 · Spend a token</h3>
                  <div className="rq-duels-token-options" role="group" aria-labelledby="duels-send-token">
                    {combos.map((candidate) => (
                      <TokenOption key={candidate.key} combo={candidate} selected={candidate.key === combo.key} onSelect={() => setComboKey(candidate.key)} />
                    ))}
                  </div>
                </section>

                <section aria-labelledby="duels-send-opponent">
                  <h3 id="duels-send-opponent" className="rq-duels-step">2 · Pick an opponent</h3>
                  <div className="rq-hairgrid rq-duels-opponents" role="group" aria-labelledby="duels-send-opponent">
                    {options.map((option) => (
                      <OpponentRow key={option.userId} option={option} selected={option.userId === opponent?.userId} onSelect={() => setOpponentId(option.userId)} />
                    ))}
                  </div>
                </section>

                <section className="rq-duels-bet" aria-labelledby="duels-send-bet">
                  <h3 id="duels-send-bet" className="rq-duels-bet__label">The bet</h3>
                  <p className="rq-duels-bet__summary">{summary}</p>
                  <dl className="rq-duels-bet__stakes">
                    <div data-tone="up">
                      <dt>If you win</dt>
                      <dd>{combo.stake.win}</dd>
                    </div>
                    <div data-tone={combo.stake.loseTone}>
                      <dt>If you lose</dt>
                      <dd>{combo.stake.lose}</dd>
                    </div>
                    <div data-tone="muted">
                      <dt>Starts</dt>
                      <dd>{combo.tier === 'legendary' ? `When accepted, or in ${LEGENDARY_AUTO_START_DAYS} d` : 'When accepted'}</dd>
                    </div>
                  </dl>
                </section>

                <p role="alert" className="rq-duels-sheet__error">{error}</p>

              </>
            )}
          </div>
          {blocker || !combo ? null : (
            <footer className="rq-duels-sheet__actions rq-duels-sheet__foot">
              <button type="button" className="rq-btn rq-btn--primary rq-btn--block" disabled={!ready} onClick={() => void submit()}>
                {sending ? 'Sending…' : 'Send challenge'}
              </button>
              <Dialog.Close className="rq-btn rq-btn--ghost rq-duels-sheet__cancel">Cancel</Dialog.Close>
            </footer>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
