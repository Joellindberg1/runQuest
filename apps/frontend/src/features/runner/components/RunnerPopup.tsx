import { useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { User } from '@runquest/types';
import { SkeletonRows } from '@/shared/components/loaders/SkeletonRows';
import { findRunnerElement } from '@/shared/utils/findRunnerElement';
import { useHeadToHead } from '../hooks/useRunnerQueries';
import { DEFAULT_STAT_VIEW, type StatView } from '../statViews';
import { ChallengeButton } from './ChallengeButton';
import { RunnerPanels } from './RunnerPanels';
import '../runner.css';

interface RunnerPopupProps {
  /** Löparen i adressen. */
  id: string;
  /** Löparen, eller undefined medan gruppen laddar eller har felat. */
  runner: User | undefined;
  users: User[];
  /** Felkortet (med Retry) som ersätter innehållet när gruppen inte gick att hämta. */
  failure: ReactNode;
  failed: boolean;
  /** Esc, ✕ och klick på skrimman (`useCloseRunner`). */
  onClose: () => void;
}

/**
 * Challenge i huvudytan: head-to-head avgör om knappen blir en statuschip (samma fråga som panelen, så den delas i cachen). Följs länken på vanligt sätt (inte Ctrl/Cmd/Shift/Alt-klick,
 * som öppnar en annan flik och lämnar popupen kvar) anropas `onLeave`: popupen lämnas då genom navigering och inte genom Esc, ✕ eller skrimman.
 */
function PopupChallenge({ runnerId, onLeave }: { runnerId: string; onLeave: () => void }) {
  const headToHead = useHeadToHead(runnerId);
  return (
    <span
      onClick={(event) => {
        const plainLeftClick = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
        if (plainLeftClick && (event.target as Element).closest('a')) onLeave();
      }}
    >
      <ChallengeButton opponentId={runnerId} active={headToHead.data?.active?.status ?? null} />
    </span>
  );
}

/**
 * Löparens kort i dialogens scrollande yta. Tillståndet är komponenttillstånd, inte adress (ADR 006 addendum 2026-10-26, beslut 3): statfliken nollställs vid varje öppning
 * eftersom ramen monterar komponenten med `key={user.id}` och popupen avmonteras när den stängs. Popupen skriver aldrig `?view=`. Tills flikarna (Overview, The journey,
 * Titles held, Badges) är byggda ritar den Runner cards befintliga paneler.
 */
function PopupContent({ user, allUsers }: { user: User; allUsers: User[] }) {
  const [statView, setStatView] = useState<StatView>(DEFAULT_STAT_VIEW);

  return (
    <div className="rq-runner rq-rise">
      <div className="rq-runner__body">
        <RunnerPanels user={user} allUsers={allUsers} statView={statView} onStatViewChange={setStatView} />
      </div>
    </div>
  );
}

/**
 * Profil-popupen: dialogramen och innehållet (ADR 006 addendum 2026-10-26, beslut 1 och 2). Radix Dialog över skalets `.rq-scrim`/`.rq-modal`, med en fast huvudyta
 * (rubrik, Challenge, ✕) och en scrollande yta för innehållet, så att dialogen aldrig blir högre än fönstret. Bredden är `--rq-modal-w`.
 *
 * Hela komponenten laddas lazy från `pages/RunnerPage.tsx` (`React.lazy` bakom Suspense) och hamnar därför aldrig i fullappens ingångs-chunk.
 * - Fokus in: rubriken (`tabIndex={-1}`), så att skärmläsaren läser dialogens namn före första knappen. Fokusfällan, Esc och klick på skrimman är Radix, alla via `onClose`.
 * - Fokus tillbaka: dialogen har ingen Trigger, och Safari och Firefox på Mac fokuserar inte en knapp vid klick, så Radix standard räcker inte. Efter stängning fokuseras det
 *   första synliga `[data-runner-id]` för löparen i bakgrundssidan. Det sker i `onCloseAutoFocus` (som Radix kör först när dialogen är borta), inte medan den är öppen:
 *   bakgrunden är då `aria-hidden` och ofokuserbar. Finns ingen rad gäller Radix standard. Lämnar Challenge popupen går användaren till en annan sida, och då får fokus
 *   inte dras till en rad där.
 */
export function RunnerPopup({ id, runner, users, failure, failed, onClose }: RunnerPopupProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const leftByNavigation = useRef(false);

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="rq-scrim" />
        <Dialog.Content
          className="rq-modal rq-runner-popup"
          aria-modal="true"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            titleRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            if (leftByNavigation.current) return;
            const row = findRunnerElement(id);
            if (!row) return;
            event.preventDefault();
            row.focus();
          }}
        >
          <div className="rq-runner-popup__bar">
            <Dialog.Title ref={titleRef} tabIndex={-1} className="rq-runner-popup__title">
              {/* Det som syns är "Runner card"; namnet är skärmläsartext. En sr-only-fortsättning efter den synliga texten ger "Runner card : Karl Persson" i Chrome (spans med
                  position absolute räknas som block och får mellanrum runt sig), så den synliga delen göms för hjälpmedel och sr-only-delen bär hela namnet. */}
              <span aria-hidden={runner ? true : undefined}>Runner card</span>
              {runner && <span className="sr-only">Runner card: {runner.name}</span>}
            </Dialog.Title>
            <span className="rq-runner__spacer" />
            {runner && <PopupChallenge runnerId={runner.id} onLeave={() => { leftByNavigation.current = true; }} />}
          </div>
          <Dialog.Close className="rq-modal__close" aria-label="Close">✕</Dialog.Close>
          <div className="rq-runner-popup__content">
            {runner ? <PopupContent key={runner.id} user={runner} allUsers={users} /> : failed ? failure : <SkeletonRows rows={4} label="Loading runner" />}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
