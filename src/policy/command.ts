import { UsageError } from '../errors';

/**
 * Command selectors (`execution.commands`) are not paths: `*` and `**` match
 * any sequence, spaces and `/` included (`npm *` matches `npm i ./a/b`). Other
 * glob syntax has no meaning here and is refused.
 */
export function validateCommandPattern(pattern: string): void {
  if (pattern.trim().length === 0) {
    throw new UsageError('Um padrão de comando não pode estar vazio.');
  }

  if (/[?[\]\\]/.test(pattern)) {
    throw new UsageError(`Padrão de comando só aceita texto e *: ${pattern}`);
  }
}

export function commandMatches(command: string, pattern: string): boolean {
  const source = pattern
    .split(/\*+/)
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');

  return new RegExp(`^${source}$`, 's').test(command.trim());
}

export interface ParsedCommand {
  /** Simple commands joined by `&&`, `||`, `;` or `|`. */
  readonly parts: readonly string[];
  /**
   * Redirection, substitution, heredoc, backgrounding or a multi-line
   * script: what actually runs cannot be read from the parts alone.
   */
  readonly complex: boolean;
}

/**
 * Shell tokens, in priority order: quoted strings, escapes, separators, the
 * markers of a complex line, plain text, and any other single character (an
 * unmatched quote falls here).
 */
const TOKEN =
  /'[^']*'|"(?:\\.|[^"\\])*"|\\.|&&|\|\||[;|]|\$\(|[<>`&\n]|[^'"\\&|;<>`$\n]+|./gs;

const SEPARATORS: ReadonlySet<string> = new Set(['&&', '||', ';', '|']);
const COMPLEX_MARKERS: ReadonlySet<string> = new Set([
  '>',
  '<',
  '`',
  '&',
  '\n',
  '$(',
]);
const UNMATCHED_QUOTES: ReadonlySet<string> = new Set(["'", '"']);

/** `<<EOF`, `<<- 'EOF'`, `<< "EOF"`: the lines after it are data. */
const HEREDOC = /<<-?\s*['"]?\w+/;

/** Splits a shell command line into its simple commands, quote-aware. */
export function parseCommand(command: string): ParsedCommand {
  const [firstLine = '', ...body] = command.split('\n');

  // A heredoc's body is file content, not commands: `};` in it is not a
  // separator. Only the line that opens it is parsed; the line is complex.
  if (body.length > 0 && HEREDOC.test(firstLine)) {
    return { parts: splitParts(firstLine.match(TOKEN) ?? []), complex: true };
  }

  const tokens = command.match(TOKEN) ?? [];

  return {
    parts: splitParts(tokens),
    complex: tokens.some(isComplexToken),
  };
}

function splitParts(tokens: readonly string[]): string[] {
  const parts: string[][] = [[]];

  for (const token of tokens) {
    if (SEPARATORS.has(token)) {
      parts.push([]);
      continue;
    }

    parts.at(-1)?.push(token);
  }

  return parts
    .map((part) => part.join('').trim())
    .filter((part) => part.length > 0);
}

/** Redirection, substitution, backgrounding, newline or an unmatched quote. */
function isComplexToken(token: string): boolean {
  if (COMPLEX_MARKERS.has(token) || UNMATCHED_QUOTES.has(token)) return true;

  // Double quotes still expand `$(...)`, `$VAR` and backticks.
  return token.startsWith('"') && /[$`]/.test(token);
}
