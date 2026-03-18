/**
 * One-off script to reprocess all user titles.
 * Run: cd apps/backend && npx tsx scripts/reprocessTitles.ts
 */

import '../src/config/database';
import { EnhancedTitleService } from '../src/services/enhancedTitleService';

async function main() {
  console.log('🏆 Starting full title reprocess...');
  const service = new EnhancedTitleService();
  await service.processAllUsersTitles();
  console.log('✅ Done.');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
