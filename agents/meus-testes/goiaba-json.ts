import {
  Agent,
  ensureDirectory,
  join,
  OllamaProvider,
  readText,
  runScript,
  UsageError,
  Workspace,
  type Interaction,
  type OllamaCli,
  type Output,
} from '../../src/index';
import { currentDirectory, programArguments } from '../../src/execute/process';
import { appendText, writeText } from '../../src/filesystem/index';
import { todasAsPermissoes } from '../permissions';

/**
 * An agent that talks through a file, never the terminal:
 * agents/meus-testes/goiaba.json, one message per line, out and in by turns.
 * `{"sai": …}` is all the agent said in a turn; add a line `{"entra": …}`
 * to say something to it.
 *
 *   bun agents/meus-testes/goiaba-json.ts claude
 *   bun agents/meus-testes/goiaba-json.ts codex
 *
 * Ctrl+C ends it.
 */
const MODEL = 'qwen3.5:4b';
const FILE = join(currentDirectory(), 'agents', 'meus-testes', 'goiaba.json');
/** How often the file is read for a new `entra` line. */
const POLL_MS = 500;

/**
 * Where what the agent shows goes: the file, each message an `sai` line.
 * Starts it anew: a new conversation each run.
 */
function fileOutput(): Output {
  writeText(FILE, '');
  return {
    write: (text) => {
      appendText(FILE, `${JSON.stringify({ sai: text })}\n`);
    },
  };
}

/**
 * The conversation: what goes out to `output`, one message per turn, then
 * what comes in, the next `entra` line of the file.
 */
function fileInteraction(output: Output): Interaction {
  /** Lines of the file already read, ours included. */
  let seen = 0;

  const next = async (signal?: AbortSignal): Promise<string> => {
    for (;;) {
      signal?.throwIfAborted();
      const lines = readText(FILE)
        .split('\n')
        .filter((line) => line !== '');
      while (seen < lines.length) {
        const message = incoming(lines[seen] ?? '');
        seen += 1;
        if (message !== undefined) return message;
      }
      await pause(POLL_MS, signal);
    }
  };

  /** What the agent showed since the last line out: one line per turn. */
  const out: string[] = [];

  return {
    ask: (_question, signal) => {
      // The turn's output as one line, then the line that comes in.
      if (out.length > 0) {
        output.write(out.join('\n'));
        out.length = 0;
        seen += 1;
      }
      return next(signal);
    },
    write: (text) => {
      out.push(text);
    },
    // The output's own status line, if it has one (a file has none).
    status: (text) => output.status?.(text),
  };
}

/** The text of an `entra` line; any other line is skipped. */
function incoming(line: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === 'object' &&
      parsed !== null &&
      'entra' in parsed &&
      typeof parsed.entra === 'string'
      ? parsed.entra
      : undefined;
  } catch {
    return undefined;
  }
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** Which CLI: the first argument. */
function chosenCli(): OllamaCli {
  const cli = programArguments().at(0);
  if (cli === 'claude' || cli === 'codex') return cli;
  throw new UsageError(
    `CLI desconhecida: ${cli ?? '(nenhuma)'}. Use: bun agents/meus-testes/goiaba-json.ts claude|codex`,
  );
}

await runScript(async ({ signal }) => {
  const cli = chosenCli();
  const root = join(
    currentDirectory(),
    'storage',
    'workspaces',
    `agente-arquivo-${cli}`,
  );
  ensureDirectory(root);

  await new Agent({
    resume: false,
    name: `agente-arquivo-${cli}`,
    prompt: 'Diga oi em uma linha e pergunte em que pode ajudar.',
    provider: new OllamaProvider({ cli, model: MODEL }),
    workspace: new Workspace({ type: 'bubblewrap', root }),
    permissions: todasAsPermissoes,
    interaction: fileInteraction(fileOutput()),
    signal,
    conversation: true,
  }).run();
});
