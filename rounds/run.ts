/**
 * Runs a round declared in rounds/definitions: `bun rounds/run.ts <id>`.
 * Each run leaves its record in rounds/data, the source of the rounds' pages.
 */
import { defineCommand, runCommand } from '../src/command/index';
import { UsageError } from '../src/errors';
import {
  join,
  listDirectory,
  pathExists,
  resolve,
} from '../src/filesystem/index';
import { runRound, type RoundDefinition } from '../src/rounds/index';

/** The Goiaba's root: the records leave its path out (`<projeto>`). */
const PROJECT = resolve(import.meta.dir, '..');
const DEFINITIONS = join(PROJECT, 'rounds', 'definitions');
const DATA = join(PROJECT, 'rounds', 'data');

const available = (): string =>
  listDirectory(DEFINITIONS)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => name.slice(0, -'.ts'.length))
    .join(', ');

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
    run: async ({ args }) => {
      const file = join(DEFINITIONS, `${args.rodada}.ts`);
      if (!pathExists(file)) {
        throw new UsageError(
          `Não há a rodada ${args.rodada} em rounds/definitions. As que existem: ${available()}.`,
        );
      }
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
      await runRound(definition, { dir: DATA, project: PROJECT });
    },
  }),
);
