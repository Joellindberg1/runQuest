import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Button } from '@/shared/components/ui/button';
import { TierBadge } from './TierBadge';
import { MetricLabel } from './MetricLabel';
import { Send, AlertCircle } from 'lucide-react';
import type { ChallengeToken } from '@runquest/types';

export interface GroupMember {
  id: string;
  name: string;
  challenge_active: boolean;
  has_pending_challenge: boolean;
}

interface SendChallengeModalProps {
  token: ChallengeToken | null;
  groupMembers: GroupMember[];
  currentUserId: string;
  userHasActiveChallenge?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend?: (tokenId: string, opponentId: string) => Promise<boolean> | void;
}

const OSWALD = "'Bebas Neue', sans-serif";

export const SendChallengeModal: React.FC<SendChallengeModalProps> = ({
  token,
  groupMembers,
  currentUserId,
  userHasActiveChallenge = false,
  open,
  onOpenChange,
  onSend,
}) => {
  const [selectedId, setSelectedId] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setSelectedId(''); setSentTo(null); }
  }, [open]);

  if (!token) return null;

  const eligible = groupMembers
    .filter(m => m.id !== currentUserId)
    .sort((a, b) => Number(a.challenge_active || a.has_pending_challenge) - Number(b.challenge_active || b.has_pending_challenge));

  const canSend = !!selectedId && !userHasActiveChallenge;

  const handleSend = async () => {
    if (!canSend) return;
    const opponentName = eligible.find(m => m.id === selectedId)?.name ?? 'opponent';
    await (onSend?.(token.id, selectedId) as Promise<boolean> | undefined);
    setSentTo(opponentName);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TierBadge tier={token.tier} />
            {sentTo ? 'Challenge Sent!' : 'Send Challenge'}
          </DialogTitle>
        </DialogHeader>

        {sentTo ? (
          /* ── Confirmation ── */
          <div className="text-center space-y-4 py-2">
            <p style={{ fontFamily: OSWALD }} className="text-2xl font-medium tracking-wide">
              You challenged {sentTo}!
            </p>
            <div className="flex justify-center gap-2 items-center">
              <TierBadge tier={token.tier} />
              <span className="text-sm font-medium"><MetricLabel metric={token.metric} /></span>
              <span className="text-xs text-muted-foreground">· {token.duration_days}d</span>
            </div>
            <p className="text-sm text-muted-foreground">
              The challenge starts once <span className="font-semibold text-foreground">{sentTo}</span> accepts.
            </p>
            <Button className="w-full" onClick={() => onOpenChange(false)}>OK</Button>
          </div>
        ) : (
          /* ── Send form ── */
          <div className="space-y-4">
            {/* Token details */}
            <div className="rounded-lg bg-sidebar border border-foreground/15 p-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Metric</span>
                <span className="font-medium"><MetricLabel metric={token.metric} /></span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Duration</span>
                <span className="font-medium">{token.duration_days} days</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Winner</span>
                <span className="font-medium" style={{ color: 'var(--rq-success)' }}>+{token.winner_delta}x / {token.winner_duration}d</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Loser</span>
                <span className="font-medium" style={{ color: 'var(--rq-danger)' }}>{token.loser_delta}x / {token.loser_duration}d</span>
              </div>
            </div>

            {userHasActiveChallenge && (
              <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: 'color-mix(in srgb, var(--rq-gold) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--rq-gold) 30%, transparent)', color: 'var(--rq-gold)' }}>
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>You already have an active challenge. Complete it before sending a new one.</span>
              </div>
            )}

            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground mb-2">Choose opponent</p>
              {eligible.map(m => {
                const isBusy = m.challenge_active || m.has_pending_challenge;
                return (
                  <button
                    key={m.id}
                    disabled={isBusy || userHasActiveChallenge}
                    onClick={() => !isBusy && !userHasActiveChallenge && setSelectedId(m.id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                      isBusy || userHasActiveChallenge
                        ? 'border-foreground/10 text-muted-foreground/40 cursor-not-allowed bg-muted/30'
                        : selectedId === m.id
                        ? 'border-primary bg-primary/10 text-primary font-medium'
                        : 'border-foreground/15 hover:border-foreground/30 hover:bg-accent'
                    }`}
                  >
                    <span>{m.name}</span>
                    {isBusy && <span className="text-xs text-muted-foreground/50">Challenge active</span>}
                  </button>
                );
              })}
            </div>

            <Button className="w-full" disabled={!canSend} onClick={handleSend}>
              <Send className="w-4 h-4 mr-2" />
              Send Challenge
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
