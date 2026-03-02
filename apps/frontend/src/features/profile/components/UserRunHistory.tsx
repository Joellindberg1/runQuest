import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Button } from '@/shared/components/ui/button';
import { Trophy, Pen } from 'lucide-react';
import { EditRunDialog } from '@/shared/components/EditRunDialog';
import { ShowMoreButton } from '@/shared/components/ShowMoreButton';
import type { Run } from '@/types/run';

interface UserRunHistoryProps {
  runs: Run[];
  onRunUpdated: () => void;
}

export const UserRunHistory: React.FC<UserRunHistoryProps> = ({ runs, onRunUpdated }) => {
  const [visibleRuns, setVisibleRuns] = useState(5);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [editingRun, setEditingRun] = useState<Run | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);

  const handleEditRun = (run: Run, event: React.MouseEvent) => {
    event.stopPropagation();
    setEditingRun(run);
    setShowEditDialog(true);
  };

  const renderRunDetails = (run: Run) => (
    <div className="mt-2 text-xs text-muted-foreground bg-background p-2 rounded">
      <div>Base XP: {run.base_xp}</div>
      <div>Distance XP: {run.km_xp} ({run.distance.toFixed(1)}km × 2)</div>
      <div>Multiplier: {run.multiplier}x</div>
      <div>Distance Bonus: {run.distance_bonus}</div>
      <div>Streak Bonus: {run.streak_bonus}</div>
      <div className="font-semibold mt-1">Total: {run.xp_gained} XP</div>
    </div>
  );

  return (
    <>
      <Card className="bg-sidebar border-2 border-foreground/15">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="w-5 h-5" />
            Run History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-muted-foreground mb-2">No runs logged yet</div>
              <div className="text-sm text-muted-foreground">Start logging your runs to see them here!</div>
            </div>
          ) : (
            <div className="space-y-3">
              {[...runs]
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .slice(0, visibleRuns)
                .map((run) => (
                  <div key={run.id} className="border border-foreground/10 rounded-lg">
                    <div
                      className="flex items-center justify-between p-3 bg-background rounded-lg cursor-pointer hover:bg-accent transition-colors"
                      onClick={() => setSelectedRun(selectedRun?.id === run.id ? null : run)}
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
                    {selectedRun?.id === run.id && renderRunDetails(run)}
                  </div>
                ))}

              {visibleRuns < runs.length && (
                <ShowMoreButton
                  showAll={false}
                  onClick={() => setVisibleRuns((prev) => prev + 10)}
                  moreText="Show More Runs"
                />
              )}
            </div>
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
