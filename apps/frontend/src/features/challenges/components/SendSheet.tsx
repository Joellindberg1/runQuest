import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { LEGENDARY_AUTO_START_DAYS, type ChallengeGroupStat } from '@runquest/shared';
import type { User } from '@runquest/types';
import { RQIcon } from '@/shared/components/icons';
import { firstName } from '@/shared/utils/format';
import type { TierGroup } from '../duelsModel';
import { useOpponentRecords } from '../hooks/useDuelsQueries';
import { buildOpponents, resolveOpponentParam, startingChoice, type OpponentOption, type SendBlocker, type SendPreselection } from '../sendModel';
import { TierChip } from './TierChip';
import { TokenChoice } from './TokenChoice';

const ICON_HEAD = 21;

interface SendSheetProps {
  groups: TierGroup[];
  /** Varför jag inte kan skicka just nu — då visar sheeten bara orsaken. */
  blocker: SendBlocker | null;
  members: ChallengeGroupStat[];
  users: User[] | undefined;
  meId: string;
  /** Nivå och kort som tryckts på i tokens-panelen; null = inget förval. */
  preselection: SendPreselection | null;
  /** `?opponent=`: förvald motståndare om personen går att utmana. */
  initialOpponent: string | null;
  onClose: () => void;
  /** Kastar vid fel; sheeten visar då meddelandet och stannar kvar. */
  onSend: (tokenKey: string, opponentId: string) => Promise<void>;
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
 * Steg 1 väljer nivå (nivåchips utan insats; en tom nivå går inte att välja och förklarar sig). Steg 2 väljer kort: ett kort per token på nivån, och
 * ett token fixerar mått, längd och insats (spelreglerna ändras inte i redesignen, ägarbeslut 1). Steg 3 väljer motståndare. "The bet" sammanfattar.
 * Förvalet kommer ur `startingChoice` (förvald nivå/kort, annars det ensamma kortet, aldrig förra valet); byte av nivå börjar om därifrån.
 * Monteras bara medan den är öppen, så valen nollställs varje gång.
 */
export function SendSheet({ groups, blocker, members, users, meId, preselection, initialOpponent, onClose, onSend }: SendSheetProps) {
  const baseOptions = useMemo(() => buildOpponents({ members, users, meId, headToHead: {} }), [members, users, meId]);

  const [choice, setChoice] = useState<SendPreselection | null>(() => startingChoice(groups, preselection));
  // Räknaren gör att samma tomma nivå som aktiveras igen ger en ny text i statusregionen (en oförändrad text läses inte upp två gånger).
  const [explained, setExplained] = useState<{ label: string; presses: number } | null>(null);
  const [opponentId, setOpponentId] = useState<string | null>(() => resolveOpponentParam(initialOpponent, baseOptions));
  // Sheeten öppnas av en knapp utan att vara en Dialog.Trigger, så Radix vet inte vart fokus ska tillbaka: elementet som hade fokus när sheeten monterades (före Radix flyttar fokus in).
  const [opener] = useState(() => document.activeElement);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const records = useOpponentRecords(
    baseOptions.map((option) => option.userId),
    blocker === null,
  );
  const options = useMemo(() => buildOpponents({ members, users, meId, headToHead: records }), [members, users, meId, records]);

  // Valet härleds mot dagens tokens: en nivå eller ett kort som försvunnit (t.ex. efter en omhämtning) pekar aldrig på något.
  const group = groups.find((candidate) => candidate.tier === choice?.tier && candidate.selectable) ?? groups.find((candidate) => candidate.selectable) ?? null;
  const card = group?.cards.find((candidate) => candidate.tokenKey === choice?.tokenKey) ?? null;
  const opponent = options.find((option) => option.userId === opponentId && !option.disabled) ?? null;
  const ready = !!card && !!opponent && !sending;

  const summary = card
    ? `${card.metricLabel}${opponent ? ` vs ${firstName(opponent.name)}` : ''} · ${card.durationLabel}`
    : 'Pick a challenge';

  const pickTier = (picked: TierGroup) => {
    if (!picked.selectable) {
      setExplained((previous) => ({ label: picked.label, presses: (previous?.presses ?? 0) + 1 }));
      return;
    }
    setExplained(null);
    if (picked.tier !== group?.tier) setChoice(startingChoice(groups, { tier: picked.tier, tokenKey: null }));
  };

  // Radix flyttar annars fokus till en trigger som inte finns (då hamnar det på <body>). Avstängd knapp (efter en skickad utmaning) tar inte emot fokus; det är fortfarande rätt.
  const returnFocus = (event: Event) => {
    event.preventDefault();
    if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) opener.focus();
  };

  const submit = async () => {
    if (!card || !opponent) return;
    setError(null);
    setSending(true);
    try {
      await onSend(card.tokenKey, opponent.userId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not send the challenge');
      setSending(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="rq-scrim" />
        <Dialog.Content className="rq-duels-sheet" aria-describedby={undefined} onCloseAutoFocus={returnFocus}>
          <header className="rq-duels-sheet__head">
            <RQIcon name="swords" size={ICON_HEAD} />
            <div className="rq-duels-sheet__id">
              <Dialog.Title className="rq-duels-sheet__title">Send a challenge</Dialog.Title>
              <p className="rq-duels-sheet__sub">One token, one opponent</p>
            </div>
            <Dialog.Close className="rq-sheet__close" aria-label="Close">✕</Dialog.Close>
          </header>

          <div className="rq-duels-sheet__body">
            {blocker || group === null ? (
              <>
                <p role="status" className="rq-duels-sheet__blocked">{blocker?.message ?? 'You have no tokens to send. You earn them by levelling up.'}</p>
                <Dialog.Close className="rq-btn rq-btn--ghost">Close</Dialog.Close>
              </>
            ) : (
              <>
                <section aria-labelledby="duels-send-tier">
                  <h3 id="duels-send-tier" className="rq-duels-step">1 · Pick a tier</h3>
                  <div role="group" aria-labelledby="duels-send-tier" className="rq-segmented rq-duels-chips">
                    {groups.map((candidate) => (
                      <TierChip key={candidate.tier} tier={candidate.tier} label={candidate.label} count={candidate.count} selected={candidate.tier === group.tier} onPress={() => pickTier(candidate)} />
                    ))}
                  </div>
                  {/* Live-regionen måste finnas innan texten kommer för att annonseras: behållaren är permanent, bara texten monteras (ny nyckel vid varje aktivering). */}
                  <div role="status" className="rq-duels-sheet__status">
                    {explained && <p key={explained.presses} className="rq-duels-note">No {explained.label} tokens right now</p>}
                  </div>
                </section>

                <section aria-labelledby="duels-send-token">
                  <h3 id="duels-send-token" className="rq-duels-step">2 · Pick a challenge · Your {group.label.toLowerCase()} tokens</h3>
                  <TokenChoice cards={group.cards} selectedKey={card?.tokenKey ?? null} labelledBy="duels-send-token" onSelect={(tokenKey) => setChoice({ tier: group.tier, tokenKey })} />
                </section>

                <section aria-labelledby="duels-send-opponent">
                  <h3 id="duels-send-opponent" className="rq-duels-step">3 · Pick an opponent</h3>
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
                      <dd>{card?.stake.winFor ?? '—'}</dd>
                    </div>
                    <div data-tone={card?.stake.loseTone ?? 'muted'}>
                      <dt>If you lose</dt>
                      <dd>{card?.stake.loseFor ?? '—'}</dd>
                    </div>
                    <div data-tone="muted">
                      <dt>Starts</dt>
                      <dd>{card?.tier === 'legendary' ? `Midnight after it is accepted, or after ${LEGENDARY_AUTO_START_DAYS} d unanswered` : 'Midnight after it is accepted'}</dd>
                    </div>
                  </dl>
                </section>

                <p role="alert" className="rq-duels-sheet__error">{error}</p>

              </>
            )}
          </div>
          {blocker || group === null ? null : (
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
