import { UsageError } from '../errors.js';

const cache = new Map<string, RegExp>();

/** Matches a full path using Git wildmatch-style *, **, ?, [] and escaping. */
export function wildmatch(value: string, pattern: string): boolean {
  let expression = cache.get(pattern);

  if (expression === undefined) {
    expression = compileWildmatch(pattern);
    cache.set(pattern, expression);
  }

  return expression.test(value);
}

export function validateWildmatch(pattern: string): void {
  compileWildmatch(pattern);
}

function compileWildmatch(pattern: string): RegExp {
  if (pattern.length === 0) {
    throw new UsageError('Um padrão de permissão não pode estar vazio.');
  }

  let source = '^';

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index] as string;

    if (character === '\\') {
      const escaped = pattern[index + 1];

      if (escaped === undefined) {
        throw new UsageError(`Padrão inválido: ${pattern}`);
      }

      source += escapeRegExp(escaped);
      index += 1;
      continue;
    }

    if (character === '?') {
      source += '[^/]';
      continue;
    }

    if (character === '*') {
      if (pattern[index + 1] !== '*') {
        source += '[^/]*';
        continue;
      }

      while (pattern[index + 1] === '*') index += 1;

      if (pattern[index + 1] === '/') {
        source += '(?:.*/)?';
        index += 1;
      } else {
        source += '.*';
      }
      continue;
    }

    if (character === '[') {
      const end = findClassEnd(pattern, index + 1);

      if (end === -1) {
        throw new UsageError(`Classe não terminada no padrão: ${pattern}`);
      }

      let content = pattern.slice(index + 1, end);
      if (content.startsWith('!')) content = `^${content.slice(1)}`;
      source += `[${content.replaceAll('\\', '\\\\')}]`;
      index = end;
      continue;
    }

    source += escapeRegExp(character);
  }

  return new RegExp(`${source}$`);
}

function findClassEnd(pattern: string, from: number): number {
  for (let index = from; index < pattern.length; index += 1) {
    if (pattern[index] === '\\') {
      index += 1;
    } else if (pattern[index] === ']') {
      return index;
    }
  }

  return -1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
