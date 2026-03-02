
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { TabsContent } from '@/shared/components/ui/tabs';
import { PageTabs } from '@/shared/components/PageTabs';
import { Input } from '@/shared/components/ui/input';
import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';
import { Calendar, Users, Plus } from 'lucide-react';
import { useAuth } from '@/features/auth';
import { toast } from 'sonner';
import { RunHistoryGroup } from './RunHistoryGroup';
import { useCreateRun } from '../hooks/useCreateRun';
import type { User } from '@/types/run';
import { MIN_RUN_DATE, MIN_RUN_DISTANCE_KM } from '@/constants/appConstants';

interface RunLoggerProps {
  onSubmit?: () => void;
  users?: User[];
}

const RunLogger: React.FC<RunLoggerProps> = ({ onSubmit, users = [] }) => {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [distance, setDistance] = useState('');
  const [lastRunResult, setLastRunResult] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("log-run");
  const { user } = useAuth();
  const { createRun, loading } = useCreateRun(onSubmit);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      toast.error('You must be logged in to log runs');
      return;
    }
    
    const km = parseFloat(distance);
    
    if (km < MIN_RUN_DISTANCE_KM) {
      toast.error('Minimum distance is 1.0km to count as a run!');
      return;
    }

    // Check if date is before project start
    const selectedDate = new Date(date);
    const minDate = new Date(MIN_RUN_DATE);
    
    if (selectedDate < minDate) {
      toast.error(`You cannot log runs before ${MIN_RUN_DATE}!`);
      return;
    }

    // Check if date is in the future
    const today = new Date();
    today.setHours(23, 59, 59, 999); // End of today
    
    if (selectedDate > today) {
      toast.error('You cannot log a run for a future date!');
      return;
    }

    const { success, message } = await createRun(date, km);
    if (success && message) {
      setLastRunResult(message);
      setDistance('');
      setDate(new Date().toISOString().split('T')[0]);
    }
  };

  const previewXP = (() => {
    if (!distance) return 0;
    const km = parseFloat(distance);
    const kmXP = Math.floor(km * 2);
    const bonus = km >= 20 ? 50 : km >= 15 ? 25 : km >= 10 ? 15 : km >= 5 ? 5 : 0;
    return '~' + (15 + kmXP + bonus);
  })();

  const tabs = [
    { value: 'log-run',           label: 'Log Run',            icon: <Plus className="w-4 h-4" /> },
    { value: 'run-history-group', label: 'Run History - Group', icon: <Users className="w-4 h-4" /> },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      <PageTabs value={activeTab} onValueChange={setActiveTab} tabs={tabs}>

        <TabsContent value="log-run">
          <div className="max-w-md mx-auto">
            <Card className="bg-sidebar border-2 border-foreground/15">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="w-5 h-5" />
                  Log Your Run
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <Label htmlFor="date">Date</Label>
                    <Input
                      id="date"
                      type="date"
                      value={date}
                      min={MIN_RUN_DATE}
                      max={new Date().toISOString().split('T')[0]}
                      onChange={(e) => setDate(e.target.value)}
                      required
                    />
                    <div className="text-sm text-muted-foreground mt-1">
                      Runs can only be logged from June 1, 2025
                    </div>
                  </div>
                  
                  <div>
                    <Label htmlFor="distance">Distance (km)</Label>
                    <Input
                      id="distance"
                      type="number"
                      step="0.1"
                      min="0.1"
                      placeholder="Enter distance in km"
                      value={distance}
                      onChange={(e) => setDistance(e.target.value)}
                      required
                    />
                    <div className="text-sm text-muted-foreground mt-1">
                      Minimum 1.0km required
                    </div>
                  </div>

                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? 'Logging Run...' : 'Log Run'}
                  </Button>

                  {distance && parseFloat(distance) >= MIN_RUN_DISTANCE_KM && (
                    <div className="p-3 bg-background border border-foreground/10 rounded-lg">
                      <div className="text-sm font-semibold mb-2">
                        Estimated XP: {previewXP}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <div>Note: Actual XP will be calculated by the server and may include streak bonuses</div>
                      </div>
                    </div>
                  )}

                  {distance && parseFloat(distance) < MIN_RUN_DISTANCE_KM && parseFloat(distance) > 0 && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                      <div className="text-sm font-semibold text-red-800">
                        No XP - Distance too short
                      </div>
                      <div className="text-xs text-red-600">
                        Minimum 1.0km required for XP
                      </div>
                    </div>
                  )}

                  {lastRunResult && (
                    <div className="p-3 bg-background border border-foreground/10 rounded-lg">
                      <div className="text-sm font-semibold">
                        {lastRunResult}
                      </div>
                    </div>
                  )}
                </form>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="run-history-group">
          <RunHistoryGroup users={users} />
        </TabsContent>
      </PageTabs>
    </div>
  );
};

export { RunLogger };
export default RunLogger;

