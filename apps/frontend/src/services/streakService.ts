
import { supabase } from '@/integrations/supabase/client';

export const streakService = {
  async fixStreakInconsistencies() {
    console.log('🔄 Fixing streak inconsistencies...');
    
    try {
      // Update users where current_streak > longest_streak
      const { data, error } = await supabase
        .from('users')
        .select('id, name, current_streak, longest_streak')
        .gt('current_streak', 0);

      if (error) {
        console.error('Error fetching users for streak fix:', error);
        throw error;
      }

      const usersToUpdate = data?.filter(user => user.current_streak > user.longest_streak) || [];

      if (usersToUpdate.length > 0) {
        for (const user of usersToUpdate) {
          const { error: updateError } = await supabase
            .from('users')
            .update({ longest_streak: user.current_streak })
            .eq('id', user.id);

          if (updateError) {
            console.error('Error updating user streak:', updateError);
            throw updateError;
          }
        }

        console.log('✅ Fixed streak inconsistencies for users:', usersToUpdate);
        return usersToUpdate;
      } else {
        console.log('✅ No streak inconsistencies found');
        return [];
      }
    } catch (error) {
      console.error('Error in fixStreakInconsistencies:', error);
      throw error;
    }
  },

  async validateAndFixUserStreak(userId: string, currentStreak: number) {
    try {
      const { data: user, error } = await supabase
        .from('users')
        .select('longest_streak')
        .eq('id', userId)
        .single();

      if (error) throw error;

      if (currentStreak > user.longest_streak) {
        const { error: updateError } = await supabase
          .from('users')
          .update({ longest_streak: currentStreak })
          .eq('id', userId);

        if (updateError) throw updateError;
        
        console.log(`✅ Updated longest_streak to ${currentStreak} for user ${userId}`);
        return true;
      }

      return false;
    } catch (error) {
      console.error('Error validating user streak:', error);
      throw error;
    }
  }
};
