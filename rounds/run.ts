/**
 * Runs a round declared in rounds/definitions (`<id>.ts`, or `<id>/<id>.ts`
 * with its pieces beside it): `bun rounds/run.ts <id>`.
 * Each run leaves its record in rounds/data, the source of the rounds' pages.
 */
import { defineCommand, runCommand } from '../src/command/index';
import { UsageError } from '../src/errors';
import { join, resolve } from '../src/filesystem/index';
import {
  ROUNDS_DATA_DIR,
  ROUNDS_DEFINITIONS_DIR,
} from '../src/rounds/constants';
import {
  findDefinition,
  runRound,
  type RoundDefinition,
} from '../src/rounds/index';

/** The Goiaba's root: the records leave its path out (`<projeto>`). */
const PROJECT = resolve(import.meta.dir, '..');
const DEFINITIONS = join(PROJECT, ROUNDS_DEFINITIONS_DIR);
const DATA = join(PROJECT, ROUNDS_DATA_DIR);

/** A module whose default export looks like a declaration (`defineRound` checked it). */
function isDefinition(value: unknown): value is RoundDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'flow' in value &&
    Array.isArray(value.flow)
  );
}

await runCommand(
  defineCommand({
    name: 'rounds',
    description:
      'Roda uma rodada declarada em rounds/definitions e grava o registro em rounds/data.',
    args: {
      rodada: {
        description: 'O id da rodada (o nome do arquivo, sem .ts)',
        required: true,
      },
    },
    options: {
      label: {
        type: 'string',
        short: 'l',
        value: 'texto',
        description:
          'O que mudou nesta execução, nas suas palavras; vale mais que o label da declaração',
      },
    },
    run: async ({ args, options }) => {
      const file = findDefinition(DEFINITIONS, args.rodada);
      const loaded: unknown = await import(file);
      const definition =
        typeof loaded === 'object' && loaded !== null && 'default' in loaded
          ? loaded.default
          : undefined;
      if (!isDefinition(definition)) {
        throw new UsageError(
          `${file} deve exportar por padrão uma rodada: export default defineRound({ … }).`,
        );
      }
      await runRound(definition, {
        dir: DATA,
        project: PROJECT,
        ...(options.label === undefined ? {} : { label: options.label }),
      });
    },
  }),
);
