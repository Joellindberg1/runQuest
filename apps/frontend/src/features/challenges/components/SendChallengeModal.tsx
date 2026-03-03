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
import type { ChallengeToken } from '@/types/run';

export interface GroupMember {
  id: string;
  name: string;
  challenge_active: boolean;
}

interface SendChallengeModalProps {
  token: ChallengeToken | null;
  groupMembers: GroupMember[];
  currentUserId: string;
  userHasActiveChallenge?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend?: (tokenId: string, opponentId: string) => void;
}

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

  // Reset selection when modal closes
  useEffect(() => {
    if (!open) setSelectedId('');
  }, [open]);

  if (!token) return null;

  // Eligible members sorted: available first, challenge_active last
  const eligible = groupMembers
    .filter(m => m.id !== currentUserId)
    .sort((a, b) => Number(a.challenge_active) - Number(b.challenge_active));

  const canSend = !!selectedId && !userHasActiveChallenge;

  const handleSend = () => {
    if (!canSend) return;
    onSend?.(token.id, selectedId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TierBadge tier={token.tier} />
            Send Challenge
          </DialogTitle>
        </DialogHeader>

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
              <span className="font-medium text-green-600 dark:text-green-400">+{token.winner_delta}x / {token.winner_duration}d</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Loser</span>
              <span className="font-medium text-red-500 dark:text-red-400">{token.loser_delta}x / {token.loser_duration}d</span>
            </div>
          </div>

          {/* Blocked message */}
          {userHasActiveChallenge && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>You already have an active challenge. Complete it before sending a new one.</span>
            </div>
          )}

          {/* Member picker */}
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground mb-2">Choose opponent</p>
            <div className="max-h-48 overflow-y-auto space-y-1">
            {eligible.map(m => (
              <button
                key={m.id}
                disabled={m.challenge_active || userHasActiveChallenge}
                onClick={() => !m.challenge_active && !userHasActiveChallenge && setSelectedId(m.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                  m.challenge_active || userHasActiveChallenge
                    ? 'border-foreground/10 text-muted-foreground/40 cursor-not-allowed bg-muted/30'
                    : selectedId === m.id
                    ? 'border-primary bg-primary/10 text-primary font-medium'
                    : 'border-foreground/15 hover:border-foreground/30 hover:bg-accent'
                }`}
              >
                <span>{m.name}</span>
                {m.challenge_active && (
                  <span className="text-xs text-muted-foreground/50">Challenge active</span>
                )}
              </button>
            ))}
            </div>
          </div>

          <Button className="w-full" disabled={!canSend} onClick={handleSend}>
            <Send className="w-4 h-4 mr-2" />
            Send Challenge
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
