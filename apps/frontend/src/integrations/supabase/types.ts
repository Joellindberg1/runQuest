export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      admin_settings: {
        Row: {
          admin_password_hash: string
          base_xp: number | null
          bonus_10km: number | null
          bonus_15km: number | null
          bonus_20km: number | null
          bonus_5km: number | null
          created_at: string | null
          id: string
          min_run_date: string | null
          min_run_distance: number | null
          updated_at: string | null
          xp_per_km: number | null
        }
        Insert: {
          admin_password_hash: string
          base_xp?: number | null
          bonus_10km?: number | null
          bonus_15km?: number | null
          bonus_20km?: number | null
          bonus_5km?: number | null
          created_at?: string | null
          id?: string
          min_run_date?: string | null
          min_run_distance?: number | null
          updated_at?: string | null
          xp_per_km?: number | null
        }
        Update: {
          admin_password_hash?: string
          base_xp?: number | null
          bonus_10km?: number | null
          bonus_15km?: number | null
          bonus_20km?: number | null
          bonus_5km?: number | null
          created_at?: string | null
          id?: string
          min_run_date?: string | null
          min_run_distance?: number | null
          updated_at?: string | null
          xp_per_km?: number | null
        }
        Relationships: []
      }
      level_requirements: {
        Row: {
          id: string
          level: number
          xp_required: number
        }
        Insert: {
          id?: string
          level: number
          xp_required: number
        }
        Update: {
          id?: string
          level?: number
          xp_required?: number
        }
        Relationships: []
      }
      runs: {
        Row: {
          base_xp: number
          created_at: string | null
          date: string
          distance: number
          distance_bonus: number
          external_id: string | null
          id: string
          km_xp: number
          multiplier: number
          source: string | null
          streak_bonus: number
          streak_day: number
          user_id: string
          xp_gained: number
        }
        Insert: {
          base_xp: number
          created_at?: string | null
          date: string
          distance: number
          distance_bonus: number
          external_id?: string | null
          id?: string
          km_xp: number
          multiplier: number
          source?: string | null
          streak_bonus: number
          streak_day: number
          user_id: string
          xp_gained: number
        }
        Update: {
          base_xp?: number
          created_at?: string | null
          date?: string
          distance?: number
          distance_bonus?: number
          external_id?: string | null
          id?: string
          km_xp?: number
          multiplier?: number
          source?: string | null
          streak_bonus?: number
          streak_day?: number
          user_id?: string
          xp_gained?: number
        }
        Relationships: [
          {
            foreignKeyName: "runs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      strava_tokens: {
        Row: {
          access_token: string | null
          connection_date: string | null
          created_at: string | null
          expires_at: number | null
          refresh_token: string | null
          user_id: string
        }
        Insert: {
          access_token?: string | null
          connection_date?: string | null
          created_at?: string | null
          expires_at?: number | null
          refresh_token?: string | null
          user_id: string
        }
        Update: {
          access_token?: string | null
          connection_date?: string | null
          created_at?: string | null
          expires_at?: number | null
          refresh_token?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "strava_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      streak_multipliers: {
        Row: {
          days: number
          id: string
          multiplier: number
        }
        Insert: {
          days: number
          id?: string
          multiplier: number
        }
        Update: {
          days?: number
          id?: string
          multiplier?: number
        }
        Relationships: []
      }
      titles: {
        Row: {
          created_at: string | null
          current_holder_id: string | null
          current_value: number | null
          description: string
          id: string
          name: string
          unlock_requirement: number
        }
        Insert: {
          created_at?: string | null
          current_holder_id?: string | null
          current_value?: number | null
          description: string
          id?: string
          name: string
          unlock_requirement: number
        }
        Update: {
          created_at?: string | null
          current_holder_id?: string | null
          current_value?: number | null
          description?: string
          id?: string
          name?: string
          unlock_requirement?: number
        }
        Relationships: [
          {
            foreignKeyName: "titles_current_holder_id_fkey"
            columns: ["current_holder_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_titles: {
        Row: {
          earned_at: string | null
          id: string
          title_id: string
          user_id: string
          value: number | null
        }
        Insert: {
          earned_at?: string | null
          id?: string
          title_id: string
          user_id: string
          value?: number | null
        }
        Update: {
          earned_at?: string | null
          id?: string
          title_id?: string
          user_id?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "user_titles_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: false
            referencedRelation: "titles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_titles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string | null
          current_level: number | null
          current_streak: number | null
          email: string
          id: string
          longest_streak: number | null
          name: string
          password_hash: string
          profile_picture: string | null
          total_km: number | null
          total_xp: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          current_level?: number | null
          current_streak?: number | null
          email: string
          id?: string
          longest_streak?: number | null
          name: string
          password_hash: string
          profile_picture?: string | null
          total_km?: number | null
          total_xp?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          current_level?: number | null
          current_streak?: number | null
          email?: string
          id?: string
          longest_streak?: number | null
          name?: string
          password_hash?: string
          profile_picture?: string | null
          total_km?: number | null
          total_xp?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
