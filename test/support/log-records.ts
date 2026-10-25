import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Records of the session's JSONL transcript in `logDir`, or [] when none. */
export function readLogRecords(logDir: string): Record<string, unknown>[] {
  const file = readdirSync(logDir).find((name) => name.endsWith('.jsonl'));

  if (file === undefined) {
    return [];
  }

  const text = readFileSync(join(logDir, file), 'utf8').trim();

  if (text.length === 0) {
    return [];
  }

  return text.split('\n').map(parseRecord);
}

function parseRecord(line: string): Record<string, unknown> {
  const value: unknown = JSON.parse(line);

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Linha de log não é um objeto: ${line}`);
  }

  return Object.fromEntries(Object.entries(value));
}
