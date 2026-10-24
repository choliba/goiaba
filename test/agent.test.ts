import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'bun:test';

import { Agent } from '../src/agent/agent.js';
import { clearConfigCache } from '../src/config/index.js';
import type { ProgramCommand, ProgramOutput } from '../src/execute/types.js';
import type { Provider } from '../src/providers/types.js';
import type { ProviderEvent } from '../src/providers/types.js';
import { Workspace } from '../src/workspace/index.js';

beforeEach(() => {
  clearConfigCache();
});

afterEach(() => {
  clearConfigCache();
});

test('Agent recusa permissões sem sandbox', () => {
  expect(() => new Agent({
    prompt: 'mensagem',
    provider: new EchoProvider(),
    workspace: new Workspace({ type: 'unrestricted', root: process.cwd() }),
    permissions: {
      default: 'deny',
      allow: {
        filesystem: [{
          operations: ['read', 'write'],
          paths: ['/workspace/**'],
        }],
      },
    },
  })).toThrow('Docker ou Bubblewrap');
});

test('Agent recusa categoria que o provider não aplica', () => {
  const root = mkdtempSync(join(tmpdir(), 'goiaba-agent-'));

  try {
    expect(() => new Agent({
      prompt: 'mensagem',
      provider: new EchoProvider(),
      workspace: new Workspace({ type: 'bubblewrap', root }),
      permissions: {
        default: 'deny',
        allow: {
          filesystem: [{ operations: ['read'], paths: ['/workspace/**'] }],
          execution: [{ commands: ['bun *'] }],
        },
      },
    })).toThrow('O provider echo não aplica a categoria execution.');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent entrega a saída pelo interact', async () => {
  const agent = new Agent({
    prompt: 'mensagem',
    provider: new EchoProvider(),
    workspace: new Workspace({
      type: 'unrestricted',
      root: process.cwd(),
    }),
  });
  const events: ProviderEvent<string>[] = [];

  for await (const event of agent.interact('mensagem', unusedAsk)) {
    events.push(event);
  }

  expect(events).toEqual([{ type: 'output', value: 'mensagem' }]);
});

test('Agent.run escreve output e ask pelos ports injetados', async () => {
  const values: string[] = [];
  const agent = new Agent({
    prompt: 'início',
    provider: new InteractiveProvider(),
    workspace: new Workspace({
      type: 'unrestricted',
      root: process.cwd(),
    }),
    interaction: {
      ask: async (question) => {
        expect(question).toBe('Qual é o seu nome?');
        return 'dev';
      },
      write: (value) => {
        values.push(value);
      },
    },
  });

  await agent.run();

  expect(values).toEqual(['Qual é o seu nome?', 'Olá, dev']);
});

test('Agent.run encerra em silêncio quando o ask aborta', async () => {
  const agent = new Agent({
    prompt: 'início',
    provider: new InteractiveProvider(),
    workspace: new Workspace({
      type: 'unrestricted',
      root: process.cwd(),
    }),
    interaction: {
      ask: async () => {
        throw { name: 'AbortError' };
      },
      write: () => undefined,
    },
  });

  await agent.run();
});

test('Agent.run imprime falha do programa sem relançar', async () => {
  const values: string[] = [];
  const agent = new Agent({
    prompt: 'mensagem',
    provider: new ExitProvider(7),
    workspace: new Workspace({
      type: 'unrestricted',
      root: process.cwd(),
    }),
    interaction: {
      ask: unusedAsk,
      write: (value) => {
        values.push(value);
      },
    },
  });

  await agent.run();

  expect(values.join('')).toContain('terminou com código 7');
});

test('Agent espera a resposta e retoma a sessão após ask', async () => {
  const provider = new InteractiveProvider();
  const agent = new Agent({
    prompt: 'início',
    provider,
    workspace: new Workspace({
      type: 'unrestricted',
      root: process.cwd(),
    }),
  });
  const events: ProviderEvent<string>[] = [];

  for await (const event of agent.interact('início', async (question) => {
    expect(question).toBe('Qual é o seu nome?');
    return 'dev';
  })) {
    events.push(event);
  }

  expect(events).toEqual([
    { type: 'output', value: 'Qual é o seu nome?' },
    { type: 'ask', question: 'Qual é o seu nome?' },
    { type: 'output', value: 'Olá, dev' },
  ]);
  expect(provider.sessions).toEqual([undefined, 'session-1']);
});

test('Agent.run para em silêncio quando o signal aborta e fecha o workspace', async () => {
  const values: string[] = [];
  const workspace = new Workspace({ type: 'unrestricted', root: process.cwd() });
  let closed = false;
  const close = workspace.close.bind(workspace);
  workspace.close = async () => {
    closed = true;
    await close();
  };

  await new Agent({
    prompt: 'mensagem',
    provider: new HangingProvider(),
    workspace,
    interaction: { ask: unusedAsk, write: (value) => values.push(value) },
    signal: AbortSignal.timeout(100),
  }).run();

  expect(values).toEqual(['\n']);
  expect(closed).toBe(true);
});

test('Agent.run para enquanto espera a resposta de um ask', async () => {
  const controller = new AbortController();

  await new Agent({
    prompt: 'início',
    provider: new InteractiveProvider(),
    workspace: new Workspace({ type: 'unrestricted', root: process.cwd() }),
    interaction: {
      ask: () => {
        setTimeout(() => controller.abort(), 10);
        return new Promise<string>(() => {});
      },
      write: () => {},
    },
    signal: controller.signal,
  }).run();
});

class HangingProvider implements Provider<string, string> {
  public readonly id = 'hanging';

  public createCommand(): ProgramCommand {
    return {
      executable: process.execPath,
      arguments: ['-e', 'setInterval(() => {}, 1000)'],
    };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    for await (const _value of output) {
      // Never produces output; only the abort ends it.
    }
  }
}

class EchoProvider implements Provider<string, string> {
  public readonly id = 'echo';

  public createCommand(input: string): ProgramCommand {
    return {
      executable: process.execPath,
      arguments: ['-e', 'process.stdin.pipe(process.stdout)'],
      input,
    };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    for await (const { channel, chunk } of output) {
      if (channel === 'stdout') {
        yield { type: 'output', value: chunk };
      }
    }
  }
}

class ExitProvider implements Provider<string, string> {
  public readonly id = 'exit';

  public constructor(private readonly code: number) {}

  public createCommand(): ProgramCommand {
    return {
      executable: process.execPath,
      arguments: ['-e', `process.exit(${String(this.code)})`],
    };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    for await (const _value of output) {
      // The process is expected to exit before producing output.
    }
  }
}

class InteractiveProvider implements Provider<string, string> {
  public readonly id = 'interactive';
  public readonly sessions: (string | undefined)[] = [];

  public createCommand(input: string, sessionId?: string): ProgramCommand {
    this.sessions.push(sessionId);
    return {
      executable: process.execPath,
      arguments: ['-e', `process.stdout.write(${JSON.stringify(input)})`],
    };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    for await (const { channel, chunk } of output) {
      if (channel !== 'stdout') {
        continue;
      }

      if (chunk === 'início') {
        yield { type: 'session', id: 'session-1' };
        yield { type: 'ask', question: 'Qual é o seu nome?' };
      } else {
        yield { type: 'output', value: `Olá, ${chunk}` };
      }
    }
  }
}

async function unusedAsk(): Promise<string> {
  throw new Error('não deveria perguntar');
}
