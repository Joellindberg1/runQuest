
import React, { createContext, useContext, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import bcrypt from 'bcryptjs'

interface LoginContextType {
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string; userId?: string }>
  loading: boolean
}

const LoginContext = createContext<LoginContextType | undefined>(undefined)

export const LoginProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(false)

  const login = async (username: string, password: string) => {
    try {
      setLoading(true)
      
      console.log(`🔍 Looking for username "${username}" in table "users"`)
      
      // First, let's see what's actually in the users table
      const { data: allUsers, error: allUsersError } = await supabase
        .from('users')
        .select('*')

      if (allUsersError) {
        console.error('Error fetching all users:', allUsersError)
      } else {
        console.log('📋 All users in database:', allUsers)
      }
      
      const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('name', username)
        .maybeSingle()

      if (error) {
        console.error('Database query error:', error)
        return { success: false, error: 'Database error: ' + error.message }
      }

      console.log(`🔎 Search result for username "${username}":`, user)

      if (!user) {
        return { success: false, error: 'User not found' }
      }

      console.log(`🔐 Comparing password with stored hash for user "${username}"`)
      console.log(`📝 Stored password hash: "${user.password_hash}"`)
      console.log(`🔑 Input password: "${password}"`)

      // Check if password is already hashed (starts with $2a$ or $2b$) or plain text
      const isPasswordHashed = user.password_hash.startsWith('$2a$') || user.password_hash.startsWith('$2b$')
      
      let passwordMatches = false
      
      if (isPasswordHashed) {
        // Use bcrypt to compare hashed password
        passwordMatches = await bcrypt.compare(password, user.password_hash)
      } else {
        // For plain text passwords (legacy), do direct comparison
        passwordMatches = password === user.password_hash
        
        // If plain text password matches, hash it and update the database
        if (passwordMatches) {
          const hashedPassword = await bcrypt.hash(password, 10)
          await supabase
            .from('users')
            .update({ password_hash: hashedPassword })
            .eq('id', user.id)
          console.log('🔄 Updated plain text password to hashed version')
        }
      }

      if (passwordMatches) {
        return { success: true, userId: user.id }
      } else {
        return { success: false, error: 'Invalid password' }
      }
    } catch (error) {
      console.error('Login error:', error)
      return { success: false, error: 'Login failed: ' + (error as Error).message }
    } finally {
      setLoading(false)
    }
  }

  return (
    <LoginContext.Provider value={{
      login,
      loading
    }}>
      {children}
    </LoginContext.Provider>
  )
}

export const useLogin = () => {
  const context = useContext(LoginContext)
  if (context === undefined) {
    throw new Error('useLogin must be used within a LoginProvider')
  }
  return context
}
