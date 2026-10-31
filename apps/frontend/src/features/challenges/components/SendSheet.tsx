import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { ChallengeGroupStat } from '@runquest/shared';
import type { User } from '@runquest/types';
import { RQIcon } from '@/shared/components/icons';
import { firstName } from '@/shared/utils/format';
import { focusRunnerRowAfterBack } from '@/shared/utils/focusRowAfterBack';
import type { TierGroup } from '../duelsModel';
import { useOpponentRecords } from '../hooks/useDuelsQueries';
import { betSummary, buildOpponents, resolveOpponentParam, startingChoice, startRuleText, type SendBlocker, type SendPreselection } from '../sendModel';
import { OpponentChoice } from './OpponentChoice';
import { TierChip } from './TierChip';
import { TokenChoice } from './TokenChoice';

const ICON_HEAD = 21;
const HEADER_SEND_SELECTOR = '[data-tour="duels-send"]';
const PAGE_HEADING_SELECTOR = '.rq-duels__title';
/** Bekräftelsen efter en skickad utmaning (DuelsLayout): dit går fokus när kortet som öppnade arket inte finns kvar. */
const CONFIRMATION_SELECTOR = '.rq-duels-notice';

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
  /** Vart fokus går när sheeten avbryts: `opener` = kortet/knappen som öppnade den, `page` = sidan som tar över (avbrutet flöde från löparens popup, där skalet fokuserar löparens rad). Efter ett skick gäller alltid bekräftelsen. */
  cancelFocus?: 'opener' | 'page';
  /** Löparen vars popup öppnade flödet. Stänger webbläsarens Back arket medan skicket pågår körs ingen avbrytväg och skalet vet inget om det: arket fokuserar då löparens rad själv. */
  originRunnerId?: string;
  onClose: () => void;
  /** Kastar vid fel; sheeten visar då meddelandet och stannar kvar. */
  onSend: (tokenKey: string, opponentId: string) => Promise<void>;
}

/**
 * Skicka utmaning: bottensheet på mobil, centrerad dialog på desktop (samma markup, olika mått via tokens).
 * Steg 1 väljer nivå (nivåchips utan insats; en tom nivå går inte att välja och förklarar sig). Steg 2 väljer kort: ett kort per token på nivån, och
 * ett token fixerar mått, längd och insats (spelreglerna ändras inte i redesignen, ägarbeslut 1). Steg 3 väljer motståndare. "The bet" sammanfattar.
 * Förvalet kommer ur `startingChoice` (förvald nivå/kort, annars det ensamma kortet, aldrig förra valet); byte av nivå börjar om därifrån.
 * Monteras bara medan den är öppen, så valen nollställs varje gång.
 */
export function SendSheet({ groups, blocker, members, users, meId, preselection, initialOpponent, cancelFocus = 'opener', originRunnerId, onClose, onSend }: SendSheetProps) {
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

  const summary = betSummary(card, opponent ? firstName(opponent.name) : null);

  const pickTier = (picked: TierGroup) => {
    if (!picked.selectable) {
      setExplained((previous) => ({ label: picked.label, presses: (previous?.presses ?? 0) + 1 }));
      return;
    }
    setExplained(null);
    if (picked.tier !== group?.tier) setChoice(startingChoice(groups, { tier: picked.tier, tokenKey: null }));
  };

  // Var skicket är, för stängningen: `pending` från det att skicket går iväg tills det avgörs, `confirmed` när föräldern har fått ett lyckat svar (och stänger arket), tillbaka till `idle`
  // om skicket avvisas. Arket som stängs medan det är `pending` har stängts av webbläsarens Back (Cancel, ✕, Esc och skrim är låsta): svaret finns inte än. Ett ref och inte state,
  // eftersom Radix läser det först när arket redan har avmonterats (i en timer, efter att `submit` hunnit sätta `confirmed`).
  const sendPhase = useRef<'idle' | 'pending' | 'confirmed'>('idle');

  // Send är avstängd medan skicket pågår, och en avstängd knapp som hade fokus lämnar det på <body>. Efter ett avvisat skick (felet visas, Send är påslagen igen) får Send fokus tillbaka,
  // så ett nytt försök går att göra med tangentbordet; felet annonseras av sin alert.
  const sendRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (error) sendRef.current?.focus();
  }, [error]);

  // Medan skicket pågår är Send avstängd och fokus hade annars gått till <body>, där Escape inte längre hör hemma i arket. Fokus flyttas till arket självt tills svaret kommer.
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sending) contentRef.current?.focus();
  }, [sending]);

  // En omhämtning efter ett skick utan svar kan visa att utmaningen gick iväg: arket blir då orsaksvyn och Send, som hade fokus, försvinner. Fokus får inte hamna på <body>.
  const isBlocked = blocker !== null;
  const wasBlocked = useRef(isBlocked);
  useEffect(() => {
    if (isBlocked && !wasBlocked.current && !contentRef.current?.contains(document.activeElement)) contentRef.current?.focus();
    wasBlocked.current = isBlocked;
  }, [isBlocked]);

  // Radix flyttar annars fokus till en trigger som inte finns (då hamnar det på <body>).
  // Efter en skickad utmaning är kortet som öppnade arket borta eller avstängt (och en avstängd knapp tar inte emot fokus): fokus går till bekräftelsen på sidan.
  // Back under skicket (`pending`) från löparens popup: ingen avbrytväg körs, så arket ger löparens rad fokus själv (samma mål som Cancel, med samma väntan på att sidan ritats), och släpper sökningen om användaren går vidare eller flyttar fokus (`focusRunnerRowAfterBack`).
  // Annars till öppnaren. Saknas den (ingång som bytte sida: New-arket, popupens Challenge, djuplänken) blir det rubrikens Send-knapp, annars sidans huvudrubrik (tabIndex -1 i DuelsLayout).
  const returnFocus = (event: Event) => {
    event.preventDefault();
    if (sendPhase.current === 'pending' && originRunnerId) {
      focusRunnerRowAfterBack(originRunnerId);
      return;
    }
    if (cancelFocus === 'page' && sendPhase.current === 'idle') return;
    const confirmation = sendPhase.current === 'confirmed' ? document.querySelector<HTMLElement>(CONFIRMATION_SELECTOR) : null;
    const usable = opener instanceof HTMLElement && opener !== document.body && opener.isConnected && !opener.matches(':disabled');
    const target = confirmation ?? (usable ? opener : (document.querySelector<HTMLElement>(HEADER_SEND_SELECTOR) ?? document.querySelector<HTMLElement>(PAGE_HEADING_SELECTOR)));
    target?.focus();
  };

  const submit = async () => {
    if (!card || !opponent) return;
    setError(null);
    setSending(true);
    sendPhase.current = 'pending';
    try {
      await onSend(card.tokenKey, opponent.userId);
      sendPhase.current = 'confirmed';
    } catch (failure) {
      sendPhase.current = 'idle';
      setError(failure instanceof Error ? failure.message : 'Could not send the challenge');
      setSending(false);
    }
  };

  return (
    // Ett skick som är på väg går inte att avbryta härifrån (utmaningen går iväg ändå): Cancel och ✕ är avstängda, och Escape och tryck på skrimmen ger inget stängt ark.
    <Dialog.Root open onOpenChange={(open) => { if (!open && !sending) onClose(); }}>
      <Dialog.Portal>
        {/* Ett tryck på en yta som inte kan ta fokus (skrimmen) lägger annars fokus på <body>; medan skicket pågår hålls det kvar i arket. */}
        <Dialog.Overlay className="rq-scrim" onMouseDown={(event) => { if (sending) event.preventDefault(); }} />
        {/* Radix sätter role="dialog" men inte aria-modal; skalets övriga dialoger sätter det uttryckligen. */}
        <Dialog.Content ref={contentRef} className="rq-duels-sheet" aria-modal="true" aria-describedby={undefined} onCloseAutoFocus={returnFocus}>
          <header className="rq-duels-sheet__head">
            <RQIcon name="swords" size={ICON_HEAD} />
            <div className="rq-duels-sheet__id">
              <Dialog.Title className="rq-duels-sheet__title">Send a challenge</Dialog.Title>
              <p className="rq-duels-sheet__sub">One token, one opponent</p>
            </div>
            <Dialog.Close className="rq-sheet__close" aria-label="Close" disabled={sending}>✕</Dialog.Close>
          </header>

          <div className="rq-duels-sheet__body">
            {blocker || group === null ? (
              <p role="status" className="rq-duels-sheet__blocked">{blocker?.message ?? 'You have no tokens to send. You earn them by levelling up.'}</p>
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
                  <OpponentChoice options={options} selectedId={opponent?.userId ?? null} labelledBy="duels-send-opponent" onSelect={setOpponentId} />
                </section>

                {/* Hela vadet läses upp som en enhet (aria-atomic) när valet ändras. Regionen är permanent och bara texten ändras, så en oförändrad text läses inte om. */}
                <section className="rq-duels-bet" aria-labelledby="duels-send-bet" aria-live="polite" aria-atomic="true">
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
                    <div data-tone="muted" className="rq-duels-bet__starts">
                      <dt>Starts</dt>
                      <dd>{startRuleText(group.tier)}</dd>
                    </div>
                  </dl>
                </section>

              </>
            )}
            {/* Utanför valet: efter ett skick utan svar visar omhämtningen kanske att utmaningen gick iväg, och arket blir då orsaksvyn. Felet ska stå kvar och regionen får inte avmonteras. */}
            <p role="alert" className="rq-duels-sheet__error">{error}</p>
          </div>
          {/* Knappraden finns också när arket bara visar orsaken: Close ligger i samma fasta rad, med samma luft ovanför hemindikatorn. */}
          {blocker || group === null ? (
            <footer className="rq-duels-sheet__actions rq-duels-sheet__foot">
              <Dialog.Close className="rq-btn rq-btn--ghost rq-btn--block">Close</Dialog.Close>
            </footer>
          ) : (
            <footer className="rq-duels-sheet__actions rq-duels-sheet__foot">
              <button ref={sendRef} type="button" className="rq-btn rq-btn--primary rq-btn--block" disabled={!ready} onClick={() => void submit()}>
                {sending ? 'Sending…' : 'Send challenge'}
              </button>
              <Dialog.Close className="rq-btn rq-btn--ghost" disabled={sending}>Cancel</Dialog.Close>
            </footer>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
