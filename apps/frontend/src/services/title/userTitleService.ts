
import { supabase } from '@/integrations/supabase/client'
import { UserTitle } from '@/types/run'
import { titleHolderService } from './titleHolderService'

export const userTitleService = {
  async getUserTitles(userId: string): Promise<UserTitle[]> {
    try {
      const { data: userTitles, error } = await supabase
        .from('user_titles')
        .select(`
          title_id,
          value,
          earned_at,
          titles!user_titles_title_id_fkey (
            name
          )
        `)
        .eq('user_id', userId)

      if (error) {
        console.error('❌ Error fetching user titles:', error)
        return []
      }

      // Check which titles the user currently holds
      const titleHolders = await titleHolderService.getTitleHolders()
      
      return userTitles?.map(userTitle => ({
        title_name: userTitle.titles?.name || '',
        value: userTitle.value,
        earned_at: userTitle.earned_at,
        is_current_holder: titleHolders.some(holder => 
          holder.id === userTitle.title_id && holder.current_holder_id === userId
        )
      })) || []
    } catch (error) {
      console.error('❌ Error getting user titles:', error)
      return []
    }
  },

  async addUserTitle(userId: string, titleId: string, achievementValue: number, earnedAt: string) {
    // Remove any existing entry for this user and title
    await supabase
      .from('user_titles')
      .delete()
      .eq('user_id', userId)
      .eq('title_id', titleId)

    // Add/update the user's achievement for this title
    const { data: userTitleData, error: userTitleError } = await supabase
      .from('user_titles')
      .insert({
        user_id: userId,
        title_id: titleId,
        value: achievementValue,
        earned_at: earnedAt
      })
      .select()

    if (userTitleError) {
      console.error('❌ Error adding user title:', userTitleError)
      throw userTitleError
    }

    console.log(`✅ User achievement recorded in user_titles:`, userTitleData)
    return userTitleData
  }
}
