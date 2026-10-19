/**
 * One-off script to reprocess all user titles, group by group and without Pack News (like admin /titles/reprocess-all).
 * Exit code 1 if anything failed. Run: npm run reprocess:titles --workspace=@runquest/backend
 */

import '../config/database.js';
import { EnhancedTitleService } from '../services/enhancedTitleService.js';
import { reprocessAllTitles } from './reprocessTitlesRun.js';

reprocessAllTitles(new EnhancedTitleService(), console).then((code) => process.exit(code));
