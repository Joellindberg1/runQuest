-- Migration 028: Add end_day_offset to event_templates
--
-- Fixes multi-day participation events (e.g. Half Marathon Chaser: Fri–Sun).
-- end_day_offset = number of days after the start date when the event ends.
-- Default 0 = ends the same calendar day it starts (all existing events).
--
-- Half Marathon Chaser: starts Friday 00:00, should end Sunday 23:59 → offset 2.

ALTER TABLE event_templates
  ADD COLUMN IF NOT EXISTS end_day_offset SMALLINT NOT NULL DEFAULT 0;

UPDATE event_templates SET end_day_offset = 2 WHERE name = 'Half Marathon Chaser';
