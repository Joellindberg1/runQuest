import React, { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Button } from '@/shared/components/ui/button';
import { Trophy, Pen, ChevronLeft, ChevronRight } from 'lucide-react';
import { EditRunDialog } from '@/shared/components/EditRunDialog';
import type { Run } from '@runquest/types';

// Height of a single collapsed run card (px) — used to fit as many as possible
const RUN_CARD_H = 80;
// Height of the pagination bar (px)
const PAGINATOR_H = 44;
// Minimum cards to show even if the container is very small
const MIN_RUNS = 3;

interface UserRunHistoryProps {
  runs: Run[];
  onRunUpdated: () => void;
}

export const UserRunHistory: React.FC<UserRunHistoryProps> = ({ runs, onRunUpdated }) => {
  const [page, setPage] = useState(0);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [editingRun, setEditingRun] = useState<Run | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [runsPerPage, setRunsPerPage] = useState(MIN_RUNS);
  const containerRef = useRef<HTMLDivElement>(null);

  // Dynamically compute how many run cards fit in the available container height
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const height = entry.contentRect.height;
      setRunsPerPage(Math.max(MIN_RUNS, Math.floor((height - PAGINATOR_H) / RUN_CARD_H)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Reset to first page whenever page size or run list changes
  useEffect(() => {
    setPage(0);
  }, [runsPerPage, runs.length]);

  const handleEditRun = (run: Run, event: React.MouseEvent) => {
    event.stopPropagation();
    setEditingRun(run);
    setShowEditDialog(true);
  };

  const renderRunDetails = (run: Run) => (
    <div className="px-3 pb-3">
      <div className="w-4/5 mx-auto border-t border-foreground/15 my-2" />
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <div>Base XP: <span className="font-medium text-foreground">{run.base_xp}</span></div>
        <div>Distance XP: <span className="font-medium text-foreground">{run.km_xp}</span> <span>({run.distance.toFixed(1)}km × 2)</span></div>
        <div>Multiplier: <span className="font-medium text-foreground">{run.multiplier}x</span></div>
        <div>Distance Bonus: <span className="font-medium text-foreground">+{run.distance_bonus}</span></div>
        <div>Streak Bonus: <span className="font-medium text-foreground">+{run.streak_bonus}</span></div>
        <div className="font-semibold text-foreground">Total: +{run.xp_gained} XP</div>
      </div>
    </div>
  );

  const sorted = [...runs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const totalPages = Math.ceil(sorted.length / runsPerPage);
  const pageRuns = sorted.slice(page * runsPerPage, (page + 1) * runsPerPage);

  return (
    <>
      <Card className="bg-sidebar border-2 border-foreground/15 h-full flex flex-col">
        <CardHeader className="shrink-0">
          <CardTitle className="flex items-center gap-2">
            <Trophy className="w-5 h-5" />
            Run History
          </CardTitle>
        </CardHeader>
        <CardContent ref={containerRef} className="flex-1 min-h-0 flex flex-col">
          {runs.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-muted-foreground mb-2">No runs logged yet</div>
              <div className="text-sm text-muted-foreground">Start logging your runs to see them here!</div>
            </div>
          ) : (
            <>
              <div className="space-y-3 flex-1">
                {pageRuns.map((run) => {
                  const isOpen = selectedRun?.id === run.id;
                  return (
                  <div key={run.id} className="bg-background border border-foreground/10 rounded-lg">
                    <div
                      className={`flex items-center justify-between p-3 cursor-pointer hover:bg-accent transition-colors ${isOpen ? 'rounded-t-lg' : 'rounded-lg'}`}
                      onClick={() => setSelectedRun(isOpen ? null : run)}
                    >
                      <div className="flex-1">
                        <div className="font-semibold">{run.date}</div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span>{run.distance.toFixed(1)}km • Streak Day {run.streak_day}</span>
                          {run.is_treadmill === true && (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30">
                              Treadmill
                            </span>
                          )}
                          {run.is_treadmill === false && (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-500/15 text-green-500 border border-green-500/30">
                              Outdoor
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <div className="font-bold" style={{ color: 'var(--rq-gold)' }}>+{run.xp_gained} XP</div>
                          <div className="text-sm text-muted-foreground">{run.multiplier}x multiplier</div>
                        </div>
                        <Button
                          variant="default"
                          size="sm"
                          onClick={(e) => handleEditRun(run, e)}
                          className="ml-2"
                        >
                          <Pen className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    {isOpen && renderRunDetails(run)}
                  </div>
                  );
                })}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-3 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setPage(p => p - 1); setSelectedRun(null); }}
                    disabled={page === 0}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {page + 1} / {totalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setPage(p => p + 1); setSelectedRun(null); }}
                    disabled={page >= totalPages - 1}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <EditRunDialog
        run={editingRun}
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        onRunUpdated={onRunUpdated}
      />
    </>
  );
};
