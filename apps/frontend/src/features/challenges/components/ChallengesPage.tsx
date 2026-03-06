import React, { useState } from 'react';
import { TabsContent } from '@/shared/components/ui/tabs';
import { PageTabs } from '@/shared/components/PageTabs';
import { Trophy, Clock, BookOpen, History, ChevronDown, ChevronUp } from 'lucide-react';
import { ChallengeLeaderboard, type LeaderboardEntry } from './ChallengeLeaderboard';
import { OngoingChallengeCard, type ProgressEntry } from './OngoingChallengeCard';
import { ChallengesRulebook } from './ChallengesRulebook';
import { ChallengeHistory } from './ChallengeHistory';
import { ChallengesSidebar } from './ChallengesSidebar';
import { SentReceivedBar } from './SentReceivedBar';
import type { Challenge, ChallengeToken, UserBoost, ChallengeStats } from '@runquest/types';
import type { GroupMember } from './SendChallengeModal';

const TABS = [
  { value: 'leaderboard', label: 'Leaderboard',     icon: <Trophy className="w-4 h-4" /> },
  { value: 'ongoing',     label: 'Ongoing',          icon: <Clock className="w-4 h-4" /> },
  { value: 'challenges',  label: 'Challenges Info',  icon: <BookOpen className="w-4 h-4" /> },
  { value: 'history',     label: 'History',          icon: <History className="w-4 h-4" /> },
];

export interface ChallengeWithProgress {
  challenge: Challenge;
  progress: ProgressEntry[];
}

interface ChallengesPageProps {
  currentUserId: string;
  leaderboard: LeaderboardEntry[];
  allActiveChallenges: ChallengeWithProgress[];
  sentChallenge: Challenge | null;
  receivedChallenges: Challenge[];
  tokens: ChallengeToken[];
  allHistory: Challenge[];
  boosts: UserBoost[];
  stats: ChallengeStats;
  groupMembers: GroupMember[];
  onSendToken?: (tokenId: string, opponentId: string) => void;
  onAccept?: (challengeId: string) => void;
  onDecline?: (challengeId: string) => void;
  onWithdraw?: (challengeId: string) => void;
}

/** Wraps challenge cards in a 2-column flex grid that centers the last odd item */
const ChallengeGrid: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex flex-wrap gap-3 justify-center">
    {React.Children.map(children, child =>
      child ? (
        <div className="w-full sm:w-[calc(50%-6px)]">{child}</div>
      ) : null
    )}
  </div>
);

export const ChallengesPage: React.FC<ChallengesPageProps> = ({
  currentUserId,
  leaderboard,
  allActiveChallenges,
  sentChallenge,
  receivedChallenges,
  tokens,
  allHistory,
  boosts,
  stats,
  groupMembers,
  onSendToken,
  onAccept,
  onDecline,
  onWithdraw,
}) => {
  const [tab, setTab] = useState('leaderboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const myActiveEntry = allActiveChallenges.find(
    e => e.challenge.challenger_id === currentUserId || e.challenge.opponent_id === currentUserId
  );
  const otherEntries = allActiveChallenges.filter(
    e => e.challenge.challenger_id !== currentUserId && e.challenge.opponent_id !== currentUserId
  );

  const sidebarProps = {
    tokens,
    boosts,
    stats,
    activeChallenge: myActiveEntry?.challenge ?? null,
    activeProgress: myActiveEntry?.progress,
    currentUserId,
    groupMembers,
    onSendToken,
    onGoToOngoing: () => setTab('ongoing'),
  };

  return (
    <div>
      {/* Sent & Received — always visible, always centered */}
      <SentReceivedBar
        sentChallenge={sentChallenge}
        receivedChallenges={receivedChallenges}
        currentUserId={currentUserId}
        onAccept={onAccept}
        onDecline={onDecline}
        onWithdraw={onWithdraw}
      />

      <div className="grid lg:grid-cols-[1fr_280px] gap-4 items-start">
        {/* Main column */}
        <div>
          <PageTabs value={tab} onValueChange={setTab} tabs={TABS} tabsGridClass="grid-cols-2 md:grid-cols-4">
            {/* Mobile sidebar toggle — between tab bar and tab content */}
            <div className="lg:hidden px-4 pb-3">
              <button
                className="w-full flex items-center justify-between px-3 py-2.5 bg-sidebar border-2 border-foreground/15 rounded-lg text-sm font-semibold"
                onClick={() => setSidebarOpen(o => !o)}
              >
                <span>My Stats &amp; Challenges</span>
                {sidebarOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {sidebarOpen && (
                <div className="mt-2">
                  <ChallengesSidebar {...sidebarProps} />
                </div>
              )}
            </div>

            {/* ── Leaderboard ──────────────────────────────── */}
            <TabsContent value="leaderboard" className="px-4 pb-4">
              <ChallengeLeaderboard entries={leaderboard} currentUserId={currentUserId} />
            </TabsContent>

            {/* ── Ongoing ──────────────────────────────────── */}
            <TabsContent value="ongoing" className="px-4 pb-4 space-y-6">
              {/* My Challenge */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  My Challenge
                </h3>
                {myActiveEntry ? (
                  <ChallengeGrid>
                    <OngoingChallengeCard
                      challenge={myActiveEntry.challenge}
                      progress={myActiveEntry.progress}
                      currentUserId={currentUserId}
                      isOwn
                    />
                  </ChallengeGrid>
                ) : (
                  <div className="py-4 text-center text-sm text-muted-foreground border border-dashed border-foreground/20 rounded-lg">
                    No current challenge active
                  </div>
                )}
              </div>

              {/* All Other Challenges */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  All Other Challenges
                </h3>
                {otherEntries.length === 0 ? (
                  <div className="py-4 text-center text-sm text-muted-foreground border border-dashed border-foreground/20 rounded-lg">
                    No other active challenges
                  </div>
                ) : (
                  <ChallengeGrid>
                    {otherEntries.map(({ challenge, progress }) => (
                      <OngoingChallengeCard
                        key={challenge.id}
                        challenge={challenge}
                        progress={progress}
                        currentUserId={currentUserId}
                      />
                    ))}
                  </ChallengeGrid>
                )}
              </div>
            </TabsContent>

            {/* ── Challenges Info ───────────────────────────── */}
            <TabsContent value="challenges" className="px-4 pb-4">
              <ChallengesRulebook />
            </TabsContent>

            {/* ── History ──────────────────────────────────── */}
            <TabsContent value="history" className="px-4 pb-4">
              <ChallengeHistory challenges={allHistory} currentUserId={currentUserId} />
            </TabsContent>
          </PageTabs>
        </div>

        {/* Desktop sidebar */}
        <div className="hidden lg:block pt-4 pr-4">
          <ChallengesSidebar {...sidebarProps} />
        </div>
      </div>
    </div>
  );
};
