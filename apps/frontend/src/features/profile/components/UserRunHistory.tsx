import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Button } from '@/shared/components/ui/button';
import { Trophy, Pen, ChevronLeft, ChevronRight } from 'lucide-react';
import { EditRunDialog } from '@/shared/components/EditRunDialog';
import type { Run } from '@/types/run';

const RUNS_PER_PAGE = 7;

interface UserRunHistoryProps {
  runs: Run[];
  onRunUpdated: () => void;
}

export const UserRunHistory: React.FC<UserRunHistoryProps> = ({ runs, onRunUpdated }) => {
  const [page, setPage] = useState(0);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [editingRun, setEditingRun] = useState<Run | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);

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
  const totalPages = Math.ceil(sorted.length / RUNS_PER_PAGE);
  const pageRuns = sorted.slice(page * RUNS_PER_PAGE, (page + 1) * RUNS_PER_PAGE);

  return (
    <>
      <Card className="bg-sidebar border-2 border-foreground/15 h-full flex flex-col">
        <CardHeader className="shrink-0">
          <CardTitle className="flex items-center gap-2">
            <Trophy className="w-5 h-5" />
            Run History
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 flex flex-col">
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
                  <div key={run.id} className="bg-background border border-foreground/50 rounded-lg">
                    <div
                      className={`flex items-center justify-between p-3 cursor-pointer hover:bg-accent transition-colors ${isOpen ? 'rounded-t-lg' : 'rounded-lg'}`}
                      onClick={() => setSelectedRun(isOpen ? null : run)}
                    >
                      <div className="flex-1">
                        <div className="font-semibold">{run.date}</div>
                        <div className="text-sm text-muted-foreground">
                          {run.distance.toFixed(1)}km • Streak Day {run.streak_day}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <div className="font-bold text-green-600">+{run.xp_gained} XP</div>
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
