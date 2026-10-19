// Logiken bakom scripts/reprocessTitles.ts, utan databasanslutning och utan process.exit, så att den går att pröva utan nätverk.
// Som admin /titles/reprocess-all: alla gruppers titlar räknas om en grupp i taget och utan Pack News (ADR 012 beslut 4.2).
import { errorCode } from '../utils/errorCode.js';

interface Out {
  log: (message: string) => void;
  error: (message: string) => void;
}

interface TitleReprocessor {
  processAllGroupsTitles(options: { emitNews: boolean }): Promise<{ total: number; processed: number; failed: number }>;
}

/** Returnerar skriptets exit-kod: 0 när alla lyckades, annars 1. Skriver aldrig databasens text, bara koden. */
export async function reprocessAllTitles(service: TitleReprocessor, out: Out): Promise<number> {
  out.log('🏆 Starting full title reprocess...');
  try {
    const { total, processed, failed } = await service.processAllGroupsTitles({ emitNews: false });
    if (failed > 0) {
      out.error(`❌ ${failed} of ${total} users failed (${processed} recalculated)`);
      return 1;
    }
    out.log(`✅ Done: ${processed} of ${total} users recalculated.`);
    return 0;
  } catch (error) {
    out.error(`❌ Error (${errorCode(error)})`);
    return 1;
  }
}
