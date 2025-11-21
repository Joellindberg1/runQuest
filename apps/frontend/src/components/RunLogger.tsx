
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Calendar, Users, Plus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { runService } from '@/services/runService';
import { toast } from 'sonner';
import { RunHistoryGroup } from './RunHistoryGroup';
import { User } from '@/types/run';

interface RunLoggerProps {
  onSubmit?: () => void;
  users?: User[];
}

const RunLogger: React.FC<RunLoggerProps> = ({ onSubmit, users = [] }) => {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [distance, setDistance] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastRunResult, setLastRunResult] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("log-run");
  const { user } = useAuth();

  const getStreakMultiplier = (streak: number) => {
    if (streak >= 270) return 2.0;
    if (streak >= 240) return 1.9;
    if (streak >= 220) return 1.8;
    if (streak >= 180) return 1.7;
    if (streak >= 120) return 1.6;
    if (streak >= 90) return 1.5;
    if (streak >= 60) return 1.4;
    if (streak >= 30) return 1.3;
    if (streak >= 15) return 1.2;
    if (streak >= 5) return 1.1;
    return 1.0;
  };

  const calculateXP = (km: number, streakMultiplier: number = 1.0) => {
    if (km < 1.0) return 0;
    
    const baseXP = 15;
    const kmXP = km * 2;
    
    let bonusXP = 0;
    if (km >= 20) bonusXP = 50;
    else if (km >= 15) bonusXP = 25;
    else if (km >= 10) bonusXP = 15;
    else if (km >= 5) bonusXP = 5;
    
    const multipliedXP = (baseXP + kmXP) * streakMultiplier;
    
    return Math.floor(multipliedXP + bonusXP);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      toast.error('You must be logged in to log runs');
      return;
    }
    
    const km = parseFloat(distance);
    
    if (km < 1.0) {
      toast.error('Minimum distance is 1.0km to count as a run!');
      return;
    }

    // Check if date is before June 1, 2025
    const selectedDate = new Date(date);
    const minDate = new Date('2025-06-01');
    
    if (selectedDate < minDate) {
      toast.error('You cannot log runs before June 1, 2025!');
      return;
    }

    // Check if date is in the future
    const today = new Date();
    today.setHours(23, 59, 59, 999); // End of today
    
    if (selectedDate > today) {
      toast.error('You cannot log a run for a future date!');
      return;
    }

    setLoading(true);
    
    try {
      const processedRun = await runService.calculateRunXP(user.id, { date, distance: km });
      
      await runService.saveRun(user.id, processedRun);
      
      const resultMessage = `Run logged! You gained ${processedRun.xp_gained} XP for this ${km}km run!`;
      setLastRunResult(resultMessage);
      toast.success(resultMessage);
      
      setDistance('');
      setDate(new Date().toISOString().split('T')[0]);
      
      if (onSubmit) {
        onSubmit();
      }
    } catch (error) {
      console.error('Error saving run:', error);
      toast.error('Failed to log run. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // For preview calculation, use a default streak of 0
  const previewXP = distance ? calculateXP(parseFloat(distance) || 0, getStreakMultiplier(0)) : 0;

  const getXPBreakdown = (km: number) => {
    if (km < 1.0) return null;
    
    const baseXP = 15;
    const kmXP = km * 2;
    const streakMultiplier = getStreakMultiplier(0); // Default for preview
    let bonusXP = 0;
    let bonusLabel = '';
    
    if (km >= 20) {
      bonusXP = 50;
      bonusLabel = '20km+ bonus';
    } else if (km >= 15) {
      bonusXP = 25;
      bonusLabel = '15km+ bonus';
    } else if (km >= 10) {
      bonusXP = 15;
      bonusLabel = '10km+ bonus';
    } else if (km >= 5) {
      bonusXP = 5;
      bonusLabel = '5km+ bonus';
    }
    
    return { baseXP, kmXP, bonusXP, bonusLabel, streakMultiplier };
  };

  const breakdown = distance ? getXPBreakdown(parseFloat(distance) || 0) : null;

  return (
    <div className="max-w-4xl mx-auto">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 mb-6 bg-white border-2 border-gray-200 shadow-lg">
          <TabsTrigger 
            value="log-run" 
            className="flex items-center gap-2 data-[state=active]:bg-blue-500 data-[state=active]:text-white font-semibold"
          >
            <Plus className="w-4 h-4" />
            Log Run
          </TabsTrigger>
          <TabsTrigger 
            value="run-history-group" 
            className="flex items-center gap-2 data-[state=active]:bg-blue-500 data-[state=active]:text-white font-semibold"
          >
            <Users className="w-4 h-4" />
            Run History - Group
          </TabsTrigger>
        </TabsList>

        <TabsContent value="log-run">
          <div className="max-w-md mx-auto">
            <Card>
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
                      min="2025-06-01"
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

                  {breakdown && parseFloat(distance) >= 1.0 && (
                    <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                      <div className="text-sm font-semibold text-green-800 mb-2">
                        XP Preview: {previewXP} XP
                      </div>
                      <div className="text-xs text-green-700 space-y-1">
                        <div>• Base run: {breakdown.baseXP} XP</div>
                        <div>• Distance: {breakdown.kmXP} XP ({parseFloat(distance)} × 2)</div>
                        <div>• Multiplier: {breakdown.streakMultiplier}x (current streak will apply)</div>
                        <div>• Multiplied: {Math.floor((breakdown.baseXP + breakdown.kmXP) * breakdown.streakMultiplier)} XP</div>
                        {breakdown.bonusXP > 0 &&(
                          <div>• {breakdown.bonusLabel}: {breakdown.bonusXP} XP</div>
                        )}
                        <div className="text-xs text-green-600 mt-2 font-semibold">
                          Total: {previewXP} XP (actual may vary based on current streak)
                        </div>
                      </div>
                    </div>
                  )}

                  {distance && parseFloat(distance) < 1.0 && parseFloat(distance) > 0 && (
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
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <div className="text-sm font-semibold text-blue-800">
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
      </Tabs>
    </div>
  );
};

export { RunLogger };
export default RunLogger;
