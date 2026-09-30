// Rebuilds public/data/history/summary.json from the per-asset history files.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { summarizeHistory } from '../src/lib/parity.ts';
import type { AssetHistory, HistorySummary } from '../src/lib/types.ts';

export const HISTORY_META_FILES = new Set(['index.json', 'summary.json']);

export function writeHistorySummary(historyDir: string): HistorySummary {
  const files = readdirSync(historyDir).filter((f) => f.endsWith('.json') && !HISTORY_META_FILES.has(f));
  const summary: HistorySummary = {
    generatedAt: new Date().toISOString(),
    assets: files
      .map((f) => summarizeHistory(JSON.parse(readFileSync(join(historyDir, f), 'utf8')) as AssetHistory))
      .sort((a, b) => (b.spreadP50 ?? 0) - (a.spreadP50 ?? 0)),
  };
  writeFileSync(join(historyDir, 'summary.json'), JSON.stringify(summary));
  return summary;
}
