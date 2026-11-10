/**
 * The rounds on the command line, in this repository or in any project that
 * installed the Goiaba:
 *
 *   goiaba rounds <id> [--label "…"]   runs a round declared in rounds.definitions
 *   goiaba rounds:web [--port 5173]    serves the rounds' pages
 *
 * Where the declarations, the fixtures and the records are comes from the
 * project's goiaba.config.ts (`rounds.definitions`, `rounds.fixtures`,
 * `rounds.data`). In the Goiaba's own repository, with the pages' project
 * installed, Vite serves the pages (they reload as records arrive);
 * anywhere else, the built pages the package ships are served.
 */

import { agentConversation } from '../agent/agent';
import { defineCommand, runCommand } from '../command/index';
import { getConfig } from '../config/index';
import { UsageError } from '../errors';
import {
  openInBrowser,
  runtimeExecutable,
  startHelper,
} from '../execute/process';
import { basename, join, pathExists, resolve } from '../filesystem/index';
import { stdinIsTty } from '../input/index';
import type { Interaction } from '../interaction/index';
import {
  ROUNDS_DATA_ENV,
  ROUNDS_WEB_DIR,
  ROUNDS_WEB_DIST,
  ROUNDS_WEB_POLL_MS,
  ROUNDS_WEB_PROBE_MS,
  ROUNDS_WEB_START_MS,
  ROUNDS_WEB_URL,
  ROUNDS_WEB_VITE,
} from '../rounds/constants';
import {
  findDefinition,
  runRound,
  type RoundDefinition,
} from '../rounds/index';
import { servePages } from '../rounds/pages';

/** The package's root: where the pages' project (and its build) is. */
const PACKAGE = resolve(import.meta.dir, '..', '..');
const WEB = join(PACKAGE, ROUNDS_WEB_DIR);
const VITE = join(WEB, ROUNDS_WEB_VITE);

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

/** Whether the rounds' pages answer (someone already serves them). */
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

/** The pages, being served until `stop`. */
interface Pages {
  /** Whether they answer yet (Vite takes a moment to start). */
  ready(signal: AbortSignal): Promise<boolean>;
  /** Resolves when the server ends by itself (Vite exiting). */
  ended(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Starts serving the pages on `port`: Vite in the Goiaba's repository (the
 * pages' project installed), the built pages anywhere else.
 */
function startPages(port: number): Pages {
  const data = getConfig().rounds.data;
  if (pathExists(VITE)) {
    // On this port or not at all: Vite would take the next free one, and
    // the page opened would be someone else's.
    const vite = startHelper(
      runtimeExecutable(),
      [VITE, '--port', String(port), '--strictPort'],
      { cwd: WEB, env: { [ROUNDS_DATA_ENV]: data } },
    );
    return {
      ready: (signal) => waitForPages(ROUNDS_WEB_START_MS, signal),
      ended: () => new Promise((done) => vite.onExit(() => done())),
      stop: () => vite.stop(),
    };
  }
  const server = servePages({ dist: join(WEB, ROUNDS_WEB_DIST), data, port });
  return {
    ready: () => Promise.resolve(true),
    ended: () => new Promise<void>(() => undefined),
    stop: () => server.stop(),
  };
}

/** Until Ctrl+C, or until the server ends by itself. */
function untilStopped(pages: Pages, signal: AbortSignal): Promise<void> {
  return Promise.race([
    pages.ended(),
    new Promise<void>((done) => {
      if (signal.aborted) done();
      signal.addEventListener('abort', () => done(), { once: true });
    }),
  ]);
}

/**
 * At the end, the page of the round that just ran, offered to open (yes by
 * default). When the pages are not up, they are served here until Ctrl+C.
 * Without a terminal, only the address.
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

  const pages = (await pagesUp())
    ? undefined
    : startPages(Number(new URL(ROUNDS_WEB_URL).port));
  try {
    if (pages !== undefined) {
      output.write('Subindo as páginas das rodadas…');
      if (!(await pages.ready(signal))) {
        if (!signal.aborted) {
          output.write(
            `As páginas não subiram em ${String(ROUNDS_WEB_START_MS / 1000)} s. Rode goiaba rounds:web para ver o erro e abra ${url}`,
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
    if (pages !== undefined) {
      output.write('As páginas ficam no ar até Ctrl+C.');
      await untilStopped(pages, signal);
    }
  } finally {
    await pages?.stop();
  }
}

/** `goiaba rounds <id>`: runs a round and offers its page. */
export async function roundsCommand(argv?: readonly string[]): Promise<void> {
  // One conversation with the terminal for the whole run: the round's
  // screen and the question at the end, with one reader of the keyboard.
  const screen = agentConversation();
  try {
    await runCommand(
      defineCommand({
        program: 'goiaba',
        name: 'rounds',
        description:
          'Roda uma rodada declarada em rounds.definitions e grava o registro em rounds.data.',
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
          const config = getConfig();
          const file = findDefinition(config.rounds.definitions, args.rodada);
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
            dir: config.rounds.data,
            project: config.project,
            fixtures: config.rounds.fixtures,
            screen,
            ...(options.label === undefined ? {} : { label: options.label }),
          });
          // With repeat, the last run's page: the others are a click away in it.
          const last = files.at(-1);
          if (last !== undefined) await offerPage(last, output, signal);
        },
      }),
      { output: screen, ...(argv === undefined ? {} : { argv }) },
    );
  } finally {
    // Given to runCommand, it is not closed there: released here, or the
    // process stays alive.
    screen.close();
  }
}

/** `goiaba rounds:web`: serves the rounds' pages until Ctrl+C. */
export async function roundsWebCommand(
  argv?: readonly string[],
): Promise<void> {
  await runCommand(
    defineCommand({
      program: 'goiaba',
      name: 'rounds:web',
      description:
        'Serve as páginas das rodadas, com os registros de rounds.data, até Ctrl+C.',
      options: {
        port: {
          type: 'string',
          short: 'p',
          value: 'porta',
          description: `A porta; ${new URL(ROUNDS_WEB_URL).port} por padrão`,
        },
      },
      run: async ({ options, output, signal }) => {
        const port = Number(options.port ?? new URL(ROUNDS_WEB_URL).port);
        if (!Number.isInteger(port) || port < 1 || port > 65_535) {
          throw new UsageError(
            `--port deve ser um número de 1 a 65535, veio ${String(options.port)}.`,
          );
        }
        const pages = startPages(port);
        try {
          if (!(await pages.ready(signal))) return;
          output.write(
            `As páginas das rodadas: http://localhost:${String(port)}/ (Ctrl+C para parar)`,
          );
          await untilStopped(pages, signal);
        } finally {
          await pages.stop();
        }
      },
    }),
    argv === undefined ? {} : { argv },
  );
}

if (import.meta.main) await roundsCommand();
