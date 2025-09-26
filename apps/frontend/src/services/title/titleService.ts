
import { supabase } from '@/integrations/supabase/client'
import { titleValidationService } from './titleValidationService'
import { titleHolderService } from './titleHolderService'
import { userTitleService } from './userTitleService'

export const titleService = {
  async checkAndUpdateUserTitles(userId: string, runs: any[], totalKm: number, longestStreak: number) {
    console.log('🏆 Starting title check for user:', userId)
    console.log('📈 Stats for title check:', { totalKm, longestStreak, runsCount: runs.length })
    
    try {
      const userValues = titleValidationService.getUserCurrentValues(runs, totalKm, longestStreak)
      
      console.log('🎯 Achievement values:', userValues)

      const earnedAt = new Date().toISOString()

      // Check each title with detailed logging
      await this.checkTitle('The Reborn Eliud Kipchoge', userId, userValues.longestRun, 12, earnedAt, runs)
      await this.checkTitle('The Daaaaaviiiiiid GOGGINGS', userId, userValues.longestStreak, 20, earnedAt, runs)
      await this.checkTitle('The Ultra Man', userId, userValues.totalKm, 100, earnedAt, runs)
      await this.checkTitle('The Weekend Destroyer', userId, userValues.weekendAvg, 9, earnedAt, runs)

    } catch (error) {
      console.error('❌ Error checking titles:', error)
    }
  },

  async checkTitle(titleName: string, userId: string, userValue: number, minRequirement: number, earnedAt: string, allRuns: any[]) {
    console.log(`🔍 Checking title: "${titleName}" for user ${userId}`)
    console.log(`📊 User value: ${userValue}, Min requirement: ${minRequirement}`)
    
    try {
      if (!titleValidationService.checkUserMeetsRequirement(titleName, userValue, minRequirement)) {
        console.log(`❌ User doesn't meet requirement (${userValue} < ${minRequirement})`)
        return
      }

      console.log(`✅ User meets requirement! Calculating value based on runs up to ${earnedAt}...`)

      // Get title data
      const { data: titleData, error: titleError } = await supabase
        .from('titles')
        .select('*')
        .eq('name', titleName)
        .single()

      if (titleError) {
        console.error(`❌ Error fetching title ${titleName}:`, titleError)
        return
      }

      // Check if user needs to beat current holder
      const titleHolders = await titleHolderService.getTitleHolders()
      const currentTitle = titleHolders.find(t => t.name === titleName)
      
      if (currentTitle?.current_holder_id && currentTitle.current_holder_id !== userId) {
        const currentValue = currentTitle.current_value || 0
        const requiredValue = currentValue + 0.1 // Need to beat by 0.1
        
        if (userValue < requiredValue) {
          console.log(`❌ User value ${userValue} doesn't beat current holder's ${currentValue} (need ${requiredValue})`)
          
          // Still record the achievement even if not winning the title
          const achievementValue = titleValidationService.calculateAchievementValue(titleName, allRuns, new Date(earnedAt))
          await userTitleService.addUserTitle(userId, titleData.id, achievementValue, earnedAt)
          return
        }
      }

      // Calculate the achievement value based on runs up to the earned_at timestamp
      const achievementValue = titleValidationService.calculateAchievementValue(titleName, allRuns, new Date(earnedAt))
      
      console.log(`📊 Calculated achievement value: ${achievementValue} for ${titleName}`)

      await userTitleService.addUserTitle(userId, titleData.id, achievementValue, earnedAt)

    } catch (error) {
      console.error(`❌ Error in checkTitle for ${titleName}:`, error)
    }
  },

  // Re-export methods from sub-services
  async getTitleHolders() {
    return titleHolderService.getTitleHolders()
  },

  async getUserTitles(userId: string) {
    return userTitleService.getUserTitles(userId)
  }
}
