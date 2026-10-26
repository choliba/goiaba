import { parseArgs } from 'node:util';

import { UsageError } from '../errors';
import type { CommandDefinition } from './types';

/**
 * The only place that knows how the command line is read (`parseArgs`, built
 * into Bun); swapping the reader changes only this file.
 */
export type CommandLine =
  | { readonly help: true }
  | {
      readonly help: false;
      /** Shaped as `ParsedArgs`/`ParsedOptions` of the declaration. */
      readonly args: Readonly<Record<string, string | undefined>>;
      readonly options: Readonly<Record<string, string | boolean | undefined>>;
    };

const HELP = 'help';

export function parseCommandLine(
  definition: CommandDefinition,
  argv: readonly string[],
): CommandLine {
  const argSpecs = Object.entries(definition.args ?? {});
  const optionSpecs = Object.entries(definition.options ?? {});

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: true,
      options: {
        [HELP]: { type: 'boolean', short: 'h' },
        ...Object.fromEntries(
          optionSpecs.map(([name, spec]) => [
            name,
            {
              type: spec.type,
              ...(spec.short === undefined ? {} : { short: spec.short }),
            },
          ]),
        ),
      },
    });
  } catch (error) {
    throw usageError(definition, readerMessage(error));
  }

  if (parsed.values[HELP] === true) return { help: true };

  const { positionals } = parsed;
  if (positionals.length > argSpecs.length) {
    throw usageError(
      definition,
      `Argumento a mais: ${positionals.slice(argSpecs.length).join(' ')}`,
    );
  }

  const args: Record<string, string | undefined> = {};
  argSpecs.forEach(([name, spec], index) => {
    const value = positionals.at(index);
    if (value === undefined && spec.required === true) {
      throw usageError(definition, `Falta o argumento <${name}>.`);
    }
    args[name] = value;
  });

  const options: Record<string, string | boolean | undefined> = {};
  for (const [name, spec] of optionSpecs) {
    const value = parsed.values[name];
    options[name] =
      spec.type === 'boolean'
        ? value === true
        : typeof value === 'string'
          ? value
          : spec.default;
  }

  return { help: false, args, options };
}

function usageError(
  definition: CommandDefinition,
  message: string,
): UsageError {
  return new UsageError(
    `${message}\nUso: ${usageLine(definition)}\nVeja: bun ${definition.name} --help`,
  );
}

export function usageLine(definition: CommandDefinition): string {
  const args = Object.entries(definition.args ?? {}).map(([name, spec]) =>
    spec.required === true ? `<${name}>` : `[${name}]`,
  );
  const options =
    Object.keys(definition.options ?? {}).length > 0 ? ['[opções]'] : [];
  return ['bun', definition.name, ...args, ...options].join(' ');
}

/** The reader's errors, in Portuguese. */
function readerMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : '';
  // `'--x'`, or `'-r, --repo <value>'` when a value is missing.
  const option = (/'([^']+)'/.exec(message)?.[1] ?? '').replace(
    / <value>$/,
    '',
  );

  switch (code) {
    case 'ERR_PARSE_ARGS_UNKNOWN_OPTION':
      return `Opção desconhecida: ${option}`;
    case 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE':
      return `Falta o valor de ${option}.`;
    default:
      return message;
  }
}
