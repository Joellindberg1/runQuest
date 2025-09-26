
import { supabase } from '@/integrations/supabase/client'

export const titleHolderService = {
  async getTitleHolders() {
    console.log('🏆 Fetching current title holders...')
    
    try {
      // Get all titles
      const { data: titles, error: titlesError } = await supabase
        .from('titles')
        .select('*')

      if (titlesError) {
        console.error('❌ Error fetching titles:', titlesError)
        return []
      }

      const titleHolders = []

      // For each title, find the current holder and runners-up
      for (const title of titles) {
        const { data: allHolders, error: holdersError } = await supabase
          .from('user_titles')
          .select(`
            user_id,
            value,
            earned_at,
            users!user_titles_user_id_fkey (
              name
            )
          `)
          .eq('title_id', title.id)
          .not('value', 'is', null)
          .order('value', { ascending: false })
          .order('earned_at', { ascending: true })

        if (holdersError) {
          console.error(`❌ Error finding holders for ${title.name}:`, holdersError)
          continue
        }

        const topHolder = allHolders?.[0]
        const runnersUp = allHolders?.slice(1, 4).map(holder => ({
          user_id: holder.user_id,
          user_name: holder.users?.name || 'Unknown',
          value: holder.value
        })) || []

        titleHolders.push({
          ...title,
          current_holder_id: topHolder?.user_id || null,
          current_value: topHolder?.value || null,
          holder_name: topHolder?.users?.name || null,
          runners_up: runnersUp
        })
      }

      return titleHolders
    } catch (error) {
      console.error('❌ Error getting title holders:', error)
      return []
    }
  }
}
