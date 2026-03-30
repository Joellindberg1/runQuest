-- ============================================================
-- Migration 018: Lägg till event_xp på users
-- ============================================================
-- event_xp ackumulerar XP från events (participation och competition).
-- Inkluderas i total_xp-beräkningen i calculateUserTotals.

ALTER TABLE users
  ADD COLUMN event_xp INT NOT NULL DEFAULT 0;
