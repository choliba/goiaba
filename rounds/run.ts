/**
 * Runs a round declared in rounds/definitions (`<id>.ts`, or `<id>/<id>.ts`
 * with its pieces beside it): `bun rounds/run.ts <id>`.
 * Each run leaves its record in rounds/data, the source of the rounds' pages.
 */
import { agentConversation } from '../src/agent/agent';
import { defineCommand, runCommand } from '../src/command/index';
import { UsageError } from '../src/errors';
import {
  openInBrowser,
  runtimeExecutable,
  startHelper,
} from '../src/execute/process';
import { basename, join, resolve } from '../src/filesystem/index';
import { stdinIsTty } from '../src/input/index';
import type { Interaction } from '../src/interaction/index';
import {
  ROUNDS_DATA_DIR,
  ROUNDS_DEFINITIONS_DIR,
  ROUNDS_WEB_DIR,
  ROUNDS_WEB_POLL_MS,
  ROUNDS_WEB_PROBE_MS,
  ROUNDS_WEB_START_MS,
  ROUNDS_WEB_URL,
  ROUNDS_WEB_VITE,
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

/** Whether the rounds' pages answer (`bun run rounds:web` is running). */
async function pagesUp(): Promise<boolean> {
  try {
    const response = await fetch(ROUNDS_WEB_URL, {
      signal: AbortSignal.timeout(ROUNDS_WEB_PROBE_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Whether the pages answer within `ms`, checking every `ROUNDS_WEB_POLL_MS`. */
async function waitForPages(ms: number, signal: AbortSignal): Promise<boolean> {
  const until = Date.now() + ms;
  while (!signal.aborted && Date.now() < until) {
    if (await pagesUp()) return true;
    await Bun.sleep(ROUNDS_WEB_POLL_MS);
  }
  return false;
}

/**
 * At the end, the page of the round that just ran, offered to open (yes by
 * default). When the pages are not up, their server starts here and stays
 * until Ctrl+C. Without a terminal, only the address.
 */
async function offerPage(
  file: string,
  output: Interaction,
  signal: AbortSignal,
): Promise<void> {
  const url = `${ROUNDS_WEB_URL}#/rodada/${encodeURIComponent(basename(file, '.json'))}`;
  if (!stdinIsTty()) {
    output.write(`A rodada: ${url}`);
    return;
  }
  output.write('Abrir a página da rodada no navegador? [S/n]');
  // Waits for Enter: an instant key would leave the Enter in the terminal
  // for the next program to read.
  const answer = await output.ask('', signal);
  if (answer.trim().toLowerCase() === 'n') {
    output.write(`A rodada: ${url}`);
    return;
  }

  // The server, when it is not up: Vite in the pages' project, its output
  // left out (it has no one to talk to here), stopped with Ctrl+C.
  const server = (await pagesUp())
    ? undefined
    : startHelper(
        runtimeExecutable(),
        // On ROUNDS_WEB_URL's port or not at all: Vite would take the next
        // free one, and the page opened would be someone else's.
        [
          ROUNDS_WEB_VITE,
          '--port',
          new URL(ROUNDS_WEB_URL).port,
          '--strictPort',
        ],
        {
          cwd: join(PROJECT, ROUNDS_WEB_DIR),
        },
      );
  try {
    if (server !== undefined) {
      output.write('Subindo as páginas das rodadas…');
      if (!(await waitForPages(ROUNDS_WEB_START_MS, signal))) {
        if (!signal.aborted) {
          output.write(
            `As páginas não subiram em ${String(ROUNDS_WEB_START_MS / 1000)} s. Rode bun run rounds:web para ver o erro e abra ${url}`,
          );
        }
        return;
      }
    }
    try {
      await openInBrowser(url);
      output.write(`A rodada: ${url}`);
    } catch {
      output.write(`Não deu para abrir o navegador. A rodada: ${url}`);
    }
    if (server !== undefined) {
      output.write('As páginas ficam no ar até Ctrl+C.');
      await new Promise<void>((done) => {
        if (signal.aborted) done();
        signal.addEventListener('abort', () => done(), { once: true });
        server.onExit(() => done());
      });
    }
  } finally {
    await server?.stop();
  }
}

/**
 * One conversation with the terminal for the whole run: the round's screen
 * and the question at the end, in the order they were written, with one
 * reader of the keyboard.
 */
const screen = agentConversation();

try {
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
      run: async ({ args, options, output, signal }) => {
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
        const files = await runRound(definition, {
          dir: DATA,
          project: PROJECT,
          screen,
          ...(options.label === undefined ? {} : { label: options.label }),
        });
        // With repeat, the last run's page: the others are a click away in it.
        const last = files.at(-1);
        if (last !== undefined) await offerPage(last, output, signal);
      },
    }),
    { output: screen },
  );
} finally {
  // Given to runCommand, it is not closed there: released here, or the
  // process stays alive.
  screen.close();
}
