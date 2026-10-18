/**
 * One-off script to reprocess all user titles, group by group and without Pack News (like admin /titles/reprocess-all).
 * Exit code 1 if anything failed. Run: cd apps/backend && npx tsx scripts/reprocessTitles.ts
 */

import '../src/config/database';
import { EnhancedTitleService } from '../src/services/enhancedTitleService';
import { reprocessAllTitles } from '../src/scripts/reprocessTitlesRun';

reprocessAllTitles(new EnhancedTitleService(), console).then((code) => process.exit(code));
