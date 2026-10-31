import { UsageError } from '../errors';

/** Parses one-based interactive selections such as `1,3,5-8`. */
export function parseSelection(text: string, size: number): readonly number[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  const selected = new Set<number>();
  for (const token of trimmed.split(','))
    addToken(selected, token.trim(), size);
  return [...selected].toSorted((left, right) => left - right);
}

function addToken(selected: Set<number>, token: string, size: number): void {
  const range = /^(\d+)-(\d+)$/.exec(token);
  if (range !== null) {
    addRange(selected, Number(range[1]), Number(range[2]), size);
    return;
  }

  const index = /^\d+$/.test(token) ? Number(token) : Number.NaN;
  assertIndex(index, size, token);
  selected.add(index - 1);
}

function addRange(
  selected: Set<number>,
  first: number,
  last: number,
  size: number,
): void {
  assertIndex(first, size, String(first));
  assertIndex(last, size, String(last));
  if (first > last)
    throw new UsageError(`Intervalo invertido: ${first}-${last}.`);
  for (let index = first; index <= last; index += 1) selected.add(index - 1);
}

function assertIndex(index: number, size: number, token: string): void {
  if (Number.isInteger(index) && index >= 1 && index <= size) return;
  throw new UsageError(
    `Seleção inválida: ${token}. Use números entre 1 e ${String(size)}.`,
  );
}
