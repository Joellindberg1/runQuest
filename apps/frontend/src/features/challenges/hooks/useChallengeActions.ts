import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { backendApi } from '@/shared/services/backendApi';

export function useChallengeActions() {
  const qc = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['challenges'] });
  };

  const sendToken = async (tokenId: string, opponentId: string): Promise<boolean> => {
    const res = await backendApi.sendChallenge(tokenId, opponentId);
    if (!res.success) {
      toast.error(res.error ?? 'Failed to send challenge');
      return false;
    }
    toast.success('Challenge sent! Waiting for opponent to respond.');
    invalidate();
    return true;
  };

  const acceptChallenge = async (challengeId: string): Promise<boolean> => {
    const res = await backendApi.respondToChallenge(challengeId, 'accept');
    if (!res.success) {
      toast.error(res.error ?? 'Failed to accept challenge');
      return false;
    }
    toast.success('Challenge accepted! Let\'s go!');
    invalidate();
    return true;
  };

  const declineChallenge = async (challengeId: string): Promise<boolean> => {
    const res = await backendApi.respondToChallenge(challengeId, 'decline');
    if (!res.success) {
      toast.error(res.error ?? 'Failed to decline challenge');
      return false;
    }
    toast.success('Challenge declined.');
    invalidate();
    return true;
  };

  const withdrawChallenge = async (challengeId: string): Promise<boolean> => {
    const res = await backendApi.withdrawChallenge(challengeId);
    if (!res.success) {
      toast.error(res.error ?? 'Failed to withdraw challenge');
      return false;
    }
    toast.success('Challenge withdrawn — token returned.');
    invalidate();
    return true;
  };

  return { sendToken, acceptChallenge, declineChallenge, withdrawChallenge };
}
