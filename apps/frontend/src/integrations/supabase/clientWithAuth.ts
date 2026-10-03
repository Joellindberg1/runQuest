
// supabase/clientWithAuth.ts

import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Supabase URL och publishable key läses ur env (se .env.example).
// Publishable-nyckeln är publik per design, men ska inte hårdkodas i källkoden.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error(
    'Saknar VITE_SUPABASE_URL eller VITE_SUPABASE_PUBLISHABLE_KEY – kopiera apps/frontend/.env.example till .env och fyll i värdena.'
  );
}

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
