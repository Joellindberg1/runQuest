import React, { useState, useEffect } from 'react';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { TierBadge } from './TierBadge';
import { MetricLabel } from './MetricLabel';
import { Send, Inbox, Check, X, Clock, ChevronDown, ChevronRight, Undo2 } from 'lucide-react';
import type { Challenge } from '@runquest/types';

interface SentReceivedBarProps {
  sentChallenge: Challenge | null;
  receivedChallenges: Challenge[];
  currentUserId: string;
  onAccept?: (id: string) => Promise<boolean> | void;
  onDecline?: (id: string) => void;
  onWithdraw?: (id: string) => void;
}

const OSWALD = "'Oswald', 'Arial Narrow', Arial, sans-serif";

const METRIC_DESCRIPTIONS: Record<string, string> = {
  total_xp: 'Earn the most XP for the duration of the challenge.',
  km:       'Run the most kilometers during the duration of the challenge.',
  runs:     'Complete the most runs during the duration of the challenge.',
};

function formatStartDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

function autoStartLabel(legendary_sent_at: string): string {
  const autoStart = new Date(new Date(legendary_sent_at).getTime() + 4 * 24 * 60 * 60 * 1000);
  const diff = autoStart.getTime() - Date.now();
  if (diff <= 0) return 'Auto-starts soon';
  const days = Math.floor(diff / 86_400_000);
  const hrs = Math.floor((diff % 86_400_000) / 3_600_000);
  return `Auto-starts in ${days}d ${hrs}h`;
}

/** Expandable single received challenge row */
const ReceivedItem: React.FC<{
  challenge: Challenge;
  onAccept?: (id: string) => Promise<boolean> | void;
  onDecline?: (id: string) => void;
  onClose: () => void;
}> = ({ challenge, onAccept, onDecline, onClose }) => {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [startDate, setStartDate] = useState('');

  useEffect(() => {
    if (!open) setConfirmed(false);
  }, [open]);

  const handleAccept = async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setStartDate(tomorrow.toISOString().split('T')[0]);
    await (onAccept?.(challenge.id) as Promise<boolean> | undefined);
    setConfirmed(true);
  };

  return (
    <div className="rounded-lg border border-foreground/15 overflow-hidden">
      {/* Collapsed header */}
      <button
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-accent transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          <TierBadge tier={challenge.tier} size="sm" />
          <span className="text-sm font-medium"><MetricLabel metric={challenge.metric} /></span>
          <span className="text-xs text-muted-foreground">· from {challenge.challenger_name}</span>
        </div>
        {open ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
      </button>

      {/* Expanded */}
      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-foreground/10 bg-sidebar/50">
          {confirmed ? (
            /* ── Accept confirmation ── */
            <div className="text-center space-y-3 py-3">
              <p style={{ fontFamily: OSWALD }} className="text-xl font-medium tracking-wide">
                Challenge Accepted!
              </p>
              <p className="text-sm text-muted-foreground">
                You accepted the <span className="font-semibold text-foreground">
                  <MetricLabel metric={challenge.metric} />
                </span> challenge from <span className="font-semibold text-foreground">
                  {challenge.challenger_name}
                </span>.
              </p>
              {startDate && (
                <p style={{ fontFamily: OSWALD }} className="text-base font-medium tracking-wide text-foreground">
                  Starts {formatStartDate(startDate)}
                </p>
              )}
              <Button size="sm" className="w-full" onClick={onClose}>OK</Button>
            </div>
          ) : (
            /* ── Challenge details + actions ── */
            <>
              {METRIC_DESCRIPTIONS[challenge.metric] && (
                <p className="pt-2 text-xs text-muted-foreground italic">{METRIC_DESCRIPTIONS[challenge.metric]}</p>
              )}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div className="text-muted-foreground">Duration</div>
                <div className="font-medium">{challenge.duration_days} days</div>
                <div className="text-muted-foreground">Winner</div>
                <div className="font-medium text-green-600 dark:text-green-400">
                  +{challenge.winner_delta}x / {challenge.winner_duration}d
                </div>
                <div className="text-muted-foreground">Loser</div>
                <div className={challenge.tier === 'legendary' ? 'font-medium text-muted-foreground' : 'font-medium text-red-500 dark:text-red-400'}>
                  {challenge.tier === 'legendary' ? 'No penalty' : `${challenge.loser_delta}x / ${challenge.loser_duration}d`}
                </div>
              </div>

              <div className="flex gap-2">
                {challenge.tier !== 'legendary' && onDecline && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => { onDecline(challenge.id); onClose(); }}
                  >
                    <X className="w-3.5 h-3.5 mr-1" /> Decline
                  </Button>
                )}
                <Button size="sm" className="flex-1" onClick={handleAccept}>
                  <Check className="w-3.5 h-3.5 mr-1" /> Accept
                </Button>
              </div>

              {challenge.tier === 'legendary' && challenge.legendary_sent_at && (
                <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                  <Clock className="w-3 h-3" />
                  {autoStartLabel(challenge.legendary_sent_at)}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export const SentReceivedBar: React.FC<SentReceivedBarProps> = ({
  sentChallenge,
  receivedChallenges,
  currentUserId,
  onAccept,
  onDecline,
  onWithdraw,
}) => {
  const [sentOpen, setSentOpen] = useState(false);
  const [receivedOpen, setReceivedOpen] = useState(false);

  const hasSent     = sentChallenge !== null;
  const hasReceived = receivedChallenges.length > 0;

  return (
    <>
      {/* Grid: [empty left] [Sent + Received center] [empty right] */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center mb-3 pb-3 border-b border-foreground/10">
        <div />

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!hasSent}
            onClick={() => hasSent && setSentOpen(true)}
            className={`flex items-center gap-1.5 text-xs ${!hasSent ? 'opacity-40 cursor-default' : 'border-foreground/20'}`}
          >
            <Send className="w-3.5 h-3.5" />
            {hasSent ? `Sent (${sentChallenge!.opponent_name})` : 'Sent'}
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={!hasReceived}
            onClick={() => hasReceived && setReceivedOpen(true)}
            className={`flex items-center gap-1.5 text-xs ${
              hasReceived
                ? 'border-primary/40 bg-primary/5 text-primary'
                : 'opacity-40 cursor-default'
            }`}
          >
            <Inbox className="w-3.5 h-3.5" />
            Received
            {hasReceived && (
              <span className="bg-primary text-primary-foreground text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                {receivedChallenges.length}
              </span>
            )}
          </Button>
        </div>

        <div />
      </div>

      {/* Sent dialog */}
      <Dialog open={sentOpen} onOpenChange={setSentOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="w-4 h-4" /> Sent Challenge
            </DialogTitle>
          </DialogHeader>
          {sentChallenge && (
            <div className="space-y-3">
              <div className="rounded-lg bg-sidebar border border-foreground/15 p-3 space-y-1.5 text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <TierBadge tier={sentChallenge.tier} />
                  <span className="font-semibold"><MetricLabel metric={sentChallenge.metric} /></span>
                </div>
                {METRIC_DESCRIPTIONS[sentChallenge.metric] && (
                  <p className="text-xs text-muted-foreground italic pb-1">{METRIC_DESCRIPTIONS[sentChallenge.metric]}</p>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">To</span>
                  <span className="font-medium">{sentChallenge.opponent_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Duration</span>
                  <span className="font-medium">{sentChallenge.duration_days} days</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Winner</span>
                  <span className="font-medium text-green-600 dark:text-green-400">+{sentChallenge.winner_delta}x/{sentChallenge.winner_duration}d</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Loser</span>
                  <span className={sentChallenge.tier === 'legendary' ? 'font-medium text-muted-foreground' : 'font-medium text-red-500 dark:text-red-400'}>
                    {sentChallenge.tier === 'legendary' ? 'No penalty' : `${sentChallenge.loser_delta}x/${sentChallenge.loser_duration}d`}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="w-3.5 h-3.5" />
                Waiting for {sentChallenge.opponent_name} to respond
              </div>
              {sentChallenge.tier !== 'legendary' && onWithdraw && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-muted-foreground"
                  onClick={() => { onWithdraw(sentChallenge.id); setSentOpen(false); }}
                >
                  <Undo2 className="w-3.5 h-3.5 mr-1.5" />
                  Withdraw challenge
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Received dialog */}
      <Dialog open={receivedOpen} onOpenChange={setReceivedOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Inbox className="w-4 h-4" /> Received Challenges
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {receivedChallenges.map(c => (
              <ReceivedItem
                key={c.id}
                challenge={c}
                onAccept={onAccept}
                onDecline={onDecline}
                onClose={() => setReceivedOpen(false)}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
