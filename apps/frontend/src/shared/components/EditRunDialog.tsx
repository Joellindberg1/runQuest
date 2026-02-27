
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/shared/components/ui/dialog';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/shared/components/ui/alert-dialog';
import { useRunMutations } from '@/shared/hooks/useRunMutations';
import type { Run } from '@/types/run';

interface EditRunDialogProps {
  run: Run | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRunUpdated: () => void;
}

export const EditRunDialog: React.FC<EditRunDialogProps> = ({
  run,
  open,
  onOpenChange,
  onRunUpdated
}) => {
  const [distance, setDistance] = useState(run?.distance?.toString() || '');
  const [date, setDate] = useState(run?.date || '');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { updateRun, deleteRun, isLoading } = useRunMutations(onRunUpdated);

  React.useEffect(() => {
    if (run) {
      setDistance(run.distance.toString());
      setDate(run.date);
    }
  }, [run]);

  const handleSave = async () => {
    if (!run || !distance || !date) return;
    const newDistance = parseFloat(distance);
    if (isNaN(newDistance) || newDistance <= 0) return;
    const success = await updateRun(run, newDistance, date);
    if (success) onOpenChange(false);
  };

  const handleDelete = async () => {
    if (!run) return;
    const success = await deleteRun(run);
    if (success) {
      onOpenChange(false);
      setShowDeleteDialog(false);
    }
  };

  if (!run) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Run</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={isLoading}
              />
            </div>
            
            <div>
              <Label htmlFor="distance">Distance (km)</Label>
              <Input
                id="distance"
                type="number"
                step="0.1"
                min="0.1"
                value={distance}
                onChange={(e) => setDistance(e.target.value)}
                disabled={isLoading}
              />
            </div>
          </div>

          <DialogFooter className="flex justify-between">
            <Button
              variant="destructive"
              onClick={() => setShowDeleteDialog(true)}
              disabled={isLoading}
            >
              Delete Run
            </Button>
            
            <div className="space-x-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={isLoading}
              >
                {isLoading ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Run</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this run? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isLoading ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

