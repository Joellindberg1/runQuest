
// supabase/clientWithAuth.ts

import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Din Supabase URL och public (anon) key – samma som i client.ts
const SUPABASE_URL = 'https://yrrqaxdngayakcivfrck.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlycnFheGRuZ2F5YWtjaXZmcmNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk2MzE5MzYsImV4cCI6MjA2NTIwNzkzNn0.CvcJ-7UsvvthYr_l3iN7XqxsFxNsKM6s4gH_tjkMjAo';

// Skapa klient med session-hantering aktiverad
export const supabase = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  }
);
