-- STEG 1: Skapa title_leaderboard tabellen
CREATE TABLE IF NOT EXISTS title_leaderboard (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title_id UUID NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1 AND position <= 10),
  value DECIMAL(10,2) NOT NULL,
  earned_at TIMESTAMP WITH TIME ZONE NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(title_id, position),
  UNIQUE(title_id, user_id)
);

-- STEG 2: Lägg till index
CREATE INDEX IF NOT EXISTS idx_title_leaderboard_title_position 
ON title_leaderboard (title_id, position);

CREATE INDEX IF NOT EXISTS idx_title_leaderboard_updated_at 
ON title_leaderboard (updated_at);

-- STEG 3: Uppdatera titles tabellen
ALTER TABLE titles 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();