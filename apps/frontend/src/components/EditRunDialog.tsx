
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { runService } from '@/services/runService';
import { Run } from '@/types/run';
import { toast } from 'sonner';

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
  const [isLoading, setIsLoading] = useState(false);

  React.useEffect(() => {
    if (run) {
      setDistance(run.distance.toString());
      setDate(run.date);
    }
  }, [run]);

  const handleSave = async () => {
    if (!run || !distance || !date) return;

    const newDistance = parseFloat(distance);
    if (isNaN(newDistance) || newDistance <= 0) {
      toast.error('Please enter a valid distance');
      return;
    }

    setIsLoading(true);
    try {
      // Update the run in the database
      const { error } = await supabase
        .from('runs')
        .update({
          distance: newDistance,
          date: date
        })
        .eq('id', run.id);

      if (error) throw error;

      // Recalculate all runs for this user to ensure correct streaks and XP
      await runService.recalculateAllRuns(run.user_id);
      
      // Force a complete recalculation of user totals
      await runService.updateUserTotals(run.user_id);
      
      // Force title recalculation as backup
      await runService.triggerTitleRecalculation();

      // Trigger a custom event to notify other components of data changes
      window.dispatchEvent(new CustomEvent('runsUpdated', { 
        detail: { userId: run.user_id, action: 'updated' } 
      }));

      toast.success('Run updated successfully');
      onRunUpdated();
      onOpenChange(false);
    } catch (error) {
      console.error('Error updating run:', error);
      toast.error('Failed to update run');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!run) return;

    setIsLoading(true);
    try {
      // Delete the run from the database
      const { error } = await supabase
        .from('runs')
        .delete()
        .eq('id', run.id);

      if (error) throw error;

      // Recalculate all runs for this user to ensure correct streaks and XP
      await runService.recalculateAllRuns(run.user_id);
      
      // Force a complete recalculation of user totals after deletion
      await runService.updateUserTotals(run.user_id);
      
      // Force title recalculation as backup
      await runService.triggerTitleRecalculation();

      // Trigger a custom event to notify other components of data changes
      window.dispatchEvent(new CustomEvent('runsUpdated', { 
        detail: { userId: run.user_id, action: 'deleted' } 
      }));

      toast.success('Run deleted successfully');
      onRunUpdated();
      onOpenChange(false);
      setShowDeleteDialog(false);
    } catch (error) {
      console.error('Error deleting run:', error);
      toast.error('Failed to delete run');
    } finally {
      setIsLoading(false);
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
