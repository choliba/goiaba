import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'bun:test';

import { Agent } from '../src/agent/agent';
import type { AgentOutput } from '../src/agent/output';
import { clearConfigCache } from '../src/config/index';
import type { ProgramCommand, ProgramOutput } from '../src/execute/types';
import type { Provider } from '../src/providers/types';
import type { ProviderEvent } from '../src/providers/types';
import { Store } from '../src/store/index';
import { Workspace } from '../src/workspace/index';

beforeEach(() => {
  clearConfigCache();
});

afterEach(() => {
  clearConfigCache();
});

test('Agent recusa categoria que o provider não aplica', () => {
  const root = mkdtempSync(join(tmpdir(), 'goiaba-agent-'));

  try {
    expect(
      () =>
        new Agent({
          name: 'teste',
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
        }),
    ).toThrow('O provider echo não aplica a categoria execution.');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent entrega a saída pelo interact', async () => {
  const agent = new Agent({
    name: 'teste',
    prompt: 'mensagem',
    provider: new EchoProvider(),
    workspace: new Workspace({
      type: 'bubblewrap',
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
    name: 'teste',
    prompt: 'início',
    provider: new InteractiveProvider(),
    workspace: new Workspace({
      type: 'bubblewrap',
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

const INFRASTRUCTURE: ReadonlySet<string> = new Set(['command', 'sandbox']);

test('Agent entrega toda a saída aos subscribers', async () => {
  const received: AgentOutput[] = [];

  await new Agent({
    name: 'construtor',
    prompt: 'início',
    provider: new ToolProvider(),
    workspace: new Workspace({ type: 'bubblewrap', root: process.cwd() }),
    interaction: { ask: unusedAsk, write: () => undefined },
    subscribe: [(output) => received.push(output)],
  }).run();

  const conversation = received
    .filter((output) => !INFRASTRUCTURE.has(output.type()))
    .map((output) => [output.type(), output.level(), output.data()]);

  expect(conversation).toEqual([
    ['input', undefined, { value: 'início' }],
    ['session', undefined, { id: 'tool-session' }],
    ['tool', 'debug', { tool: 'Bash' }],
    ['tool_error', 'error', { tool: 'Bash', message: 'x' }],
    ['output', undefined, { value: 'feito' }],
    ['message', 'debug', { text: 'feito' }],
  ]);
  // All of it, commands and sandboxes too, comes from this agent.
  expect(received.every((output) => output.agent().name === 'construtor')).toBe(
    true,
  );
  const agent = received[0]?.agent();
  expect(agent).toBeInstanceOf(Agent);
  expect(agent.provider.id).toBe('tool');
  expect(agent.workspace.root).toBe(process.cwd());
  expect(received.some((output) => output.type() === 'command')).toBe(true);
  expect(received.some((output) => output.type() === 'sandbox')).toBe(true);
  expect(JSON.parse(JSON.stringify(received[0]))).toMatchObject({
    type: 'input',
    agent: 'construtor',
  });
});

test('Agent.run envia na mesma sessão uma linha digitada durante o turno', async () => {
  const provider = new ProactiveInputProvider();
  const values: string[] = [];
  const messages = ['mude também o menu'];

  await new Agent({
    name: 'teste',
    prompt: 'início',
    provider,
    workspace: new Workspace({ type: 'bubblewrap', root: process.cwd() }),
    interaction: {
      ask: unusedAsk,
      listen: () => {
        const message = messages.shift();
        return message === undefined
          ? new Promise<string>(() => undefined)
          : Promise.resolve(message);
      },
      write: (value) => values.push(value),
    },
  }).run();

  expect(provider.calls).toEqual([
    { input: 'início', session: undefined },
    { input: 'mude também o menu', session: 'proactive-session' },
  ]);
  expect(values).toEqual(['primeiro turno', 'segundo turno']);
});

test('Agent.run ignora Enter vazio durante o turno e continua escutando', async () => {
  const provider = new ProactiveInputProvider();
  // An Enter left by the previous program, then the real message.
  const messages = ['', '   ', 'mude também o menu'];

  await new Agent({
    name: 'teste',
    prompt: 'início',
    provider,
    workspace: new Workspace({ type: 'bubblewrap', root: process.cwd() }),
    interaction: {
      ask: unusedAsk,
      listen: () => {
        const message = messages.shift();
        return message === undefined
          ? new Promise<string>(() => undefined)
          : Promise.resolve(message);
      },
      write: () => undefined,
    },
  }).run();

  expect(provider.calls).toEqual([
    { input: 'início', session: undefined },
    { input: 'mude também o menu', session: 'proactive-session' },
  ]);
});

test('Agent.run encerra em silêncio quando o ask aborta', async () => {
  const agent = new Agent({
    name: 'teste',
    prompt: 'início',
    provider: new InteractiveProvider(),
    workspace: new Workspace({
      type: 'bubblewrap',
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
    name: 'teste',
    prompt: 'mensagem',
    provider: new ExitProvider(7),
    workspace: new Workspace({
      type: 'bubblewrap',
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
    name: 'teste',
    prompt: 'início',
    provider,
    workspace: new Workspace({
      type: 'bubblewrap',
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
  const workspace = new Workspace({ type: 'bubblewrap', root: process.cwd() });
  let closed = false;
  const close = workspace.close.bind(workspace);
  workspace.close = async () => {
    closed = true;
    await close();
  };

  await new Agent({
    name: 'teste',
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
    name: 'teste',
    prompt: 'início',
    provider: new InteractiveProvider(),
    workspace: new Workspace({ type: 'bubblewrap', root: process.cwd() }),
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
    for await (const { channel, chunk } of output) {
      if (channel === 'stdout') {
        yield { type: 'output', value: chunk };
      }
    }
  }
}

class ProactiveInputProvider implements Provider<string, string> {
  public readonly id = 'proactive';
  public readonly calls: { input: string; session: string | undefined }[] = [];

  public createCommand(input: string, session?: string): ProgramCommand {
    this.calls.push({ input, session });
    return {
      executable: process.execPath,
      arguments: ['-e', 'setTimeout(() => process.stdout.write("ok"), 20)'],
    };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    yield { type: 'session', id: 'proactive-session' };
    for await (const value of output) {
      if (value.channel !== 'stdout') continue;
      yield {
        type: 'output',
        value: this.calls.length === 1 ? 'primeiro turno' : 'segundo turno',
      };
    }
  }
}

test('continua sozinho a tarefa interrompida, com o que foi aprovado', async () => {
  const store = Store.memory();
  const root = process.cwd();
  store.recordSession({
    id: 'sessao-antiga',
    provider: 'recorder',
    root,
    prompt: 'crie o site',
  });
  store.saveApproval({
    root,
    pattern: 'touch done.txt',
    kind: 'once',
    session: 'sessao-antiga',
  });
  const provider = new RecordingProvider();

  await new Agent({
    name: 'teste',
    prompt: 'crie o site',
    provider,
    workspace: new Workspace({ type: 'bubblewrap', root }),
    interaction: { ask: unusedAsk, write: () => {} },
    store,
  }).run();

  // The task is already in the session: only what changed is sent.
  expect(provider.calls).toEqual([
    {
      session: 'sessao-antiga',
      input: [
        'Permissões atualizadas: estes comandos, que foram bloqueados, agora estão permitidos.',
        'Execute-os de novo, exatamente como estão, antes de seguir:',
        '- (uma vez) touch done.txt',
        'Continue a tarefa de onde parou.',
      ].join('\n'),
    },
  ]);
});

test('tarefa que terminou ou prompt novo começam uma sessão nova', async () => {
  const store = Store.memory();
  const root = process.cwd();
  store.recordSession({
    id: 'terminada',
    provider: 'recorder',
    root,
    prompt: 'crie o site',
  });
  store.finishSession('terminada');
  store.recordSession({
    id: 'outra-tarefa',
    provider: 'recorder',
    root,
    prompt: 'escreva testes',
  });
  const provider = new RecordingProvider();

  await new Agent({
    name: 'teste',
    prompt: 'crie o site agora em vue',
    provider,
    workspace: new Workspace({ type: 'bubblewrap', root }),
    interaction: { ask: unusedAsk, write: () => {} },
    store,
  }).run();

  expect(provider.calls).toEqual([
    { session: undefined, input: 'crie o site agora em vue' },
  ]);
});

test('com comando negado pendente, espera a aprovação e continua sozinho', async () => {
  const store = Store.memory();
  const root = process.cwd();
  store.recordDecision({
    session: 'sx',
    provider: 'session',
    root,
    command: 'mkdir src/pages',
    decision: 'deny',
    source: 'default',
    reason: 'Nenhuma regra corresponde à ação.',
  });
  const provider = new SessionProvider('sx');
  const written: string[] = [];

  setTimeout(() => {
    const denied = store.deniedDecisions(root).at(0);
    store.saveApproval({
      root,
      pattern: 'mkdir src/pages',
      kind: 'once',
      session: 'sx',
      ...(denied === undefined ? {} : { decisionId: denied.id }),
    });
  }, 800);

  await new Agent({
    name: 'teste',
    prompt: 'crie as páginas',
    provider,
    workspace: new Workspace({ type: 'bubblewrap', root }),
    interaction: { ask: unusedAsk, write: (value) => written.push(value) },
    store,
  }).run();

  expect(written.some((value) => value.includes('Aguardando aprovação'))).toBe(
    true,
  );
  expect(provider.calls).toEqual([
    { session: undefined, input: 'crie as páginas' },
    {
      session: 'sx',
      input: [
        'Permissões atualizadas: estes comandos, que foram bloqueados, agora estão permitidos.',
        'Execute-os de novo, exatamente como estão, antes de seguir:',
        '- (uma vez) mkdir src/pages',
        'Continue a tarefa de onde parou.',
      ].join('\n'),
    },
  ]);
});

class SessionProvider implements Provider<string, string> {
  public readonly id = 'session';
  public readonly calls: { session: string | undefined; input: string }[] = [];

  public constructor(private readonly session: string) {}

  public createCommand(input: string, sessionId?: string): ProgramCommand {
    this.calls.push({ session: sessionId, input });
    return {
      executable: process.execPath,
      arguments: ['-e', 'process.stdout.write("ok")'],
    };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    yield { type: 'session', id: this.session };
    for await (const { channel, chunk } of output) {
      if (channel === 'stdout') yield { type: 'output', value: chunk };
    }
  }
}

class RecordingProvider implements Provider<string, string> {
  public readonly id = 'recorder';
  public readonly calls: { session: string | undefined; input: string }[] = [];

  public createCommand(input: string, sessionId?: string): ProgramCommand {
    this.calls.push({ session: sessionId, input });
    return { executable: process.execPath, arguments: ['-e', ''] };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    for await (const { channel, chunk } of output) {
      if (channel === 'stdout') yield { type: 'output', value: chunk };
    }
  }
}

class ToolProvider implements Provider<string, string> {
  public readonly id = 'tool';

  public createCommand(): ProgramCommand {
    return { executable: process.execPath, arguments: ['-e', ''] };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    for await (const _ of output) {
      // The CLI prints nothing; the events below stand for what it reported.
    }
    yield { type: 'session', id: 'tool-session' };
    yield { type: 'tool', phase: 'call', detail: { tool: 'Bash' } };
    yield {
      type: 'tool',
      phase: 'error',
      detail: { tool: 'Bash', message: 'x' },
    };
    yield { type: 'output', value: 'feito' };
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
    for await (const { channel, chunk } of output) {
      if (channel === 'stdout') {
        yield { type: 'output', value: chunk };
      }
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

test('Agent exige um nome', () => {
  expect(
    () =>
      new Agent({
        name: ' ',
        prompt: 'mensagem',
        provider: new EchoProvider(),
        workspace: new Workspace({ type: 'bubblewrap', root: process.cwd() }),
      }),
  ).toThrow('O nome do agente não pode estar vazio.');
});

test('run com o agente rodando devolve a execução em curso', async () => {
  const agent = new Agent({
    name: 'lento',
    prompt: 'início',
    provider: new SlowProvider(),
    workspace: new Workspace({ type: 'bubblewrap', root: process.cwd() }),
    interaction: { ask: unusedAsk, write: () => undefined },
    store: Store.memory(),
  });

  const first = agent.run();
  expect(agent.run()).toBe(first);
  expect(agent.status()).toBe('running');

  await agent.stop();
  expect(agent.status()).toBe('stopped');
});

test('pause mantém a sessão aberta e resume continua nela', async () => {
  const provider = new SlowProvider();
  const store = Store.memory();
  const started = Promise.withResolvers<void>();
  const agent = new Agent({
    name: 'lento',
    prompt: 'início',
    provider,
    workspace: new Workspace({ type: 'bubblewrap', root: process.cwd() }),
    interaction: { ask: unusedAsk, write: () => undefined },
    store,
    subscribe: [
      (output) => {
        if (output.type() === 'session') started.resolve();
      },
    ],
  });

  void agent.run();
  await started.promise;
  await agent.pause();

  expect(agent.status()).toBe('paused');
  expect(store.openSession('slow', process.cwd())).toBe('slow-session');

  const resumed = agent.resume();
  await Bun.sleep(50);
  expect(provider.sessions).toEqual([undefined, 'slow-session']);

  await agent.destroy();
  await resumed;
  expect(agent.status()).toBe('destroyed');
  expect(() => agent.run()).toThrow('O agente lento foi destruído.');
});

test('reset abandona a sessão aberta: o próximo run começa do zero', async () => {
  const store = Store.memory();
  store.recordSession({
    id: 'antiga',
    provider: 'slow',
    root: process.cwd(),
    prompt: 'início',
  });
  const agent = new Agent({
    name: 'lento',
    prompt: 'início',
    provider: new SlowProvider(),
    workspace: new Workspace({ type: 'bubblewrap', root: process.cwd() }),
    store,
  });

  await agent.reset();

  expect(store.openSession('slow', process.cwd())).toBeUndefined();
  expect(agent.status()).toBe('idle');
});

/** Reports its session at once, then keeps working until it is stopped. */
class SlowProvider implements Provider<string, string> {
  public readonly id = 'slow';
  public readonly sessions: (string | undefined)[] = [];

  public createCommand(_input: string, sessionId?: string): ProgramCommand {
    this.sessions.push(sessionId);
    return {
      executable: process.execPath,
      arguments: ['-e', "console.log('ok'); setTimeout(() => {}, 30_000)"],
    };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    for await (const { channel } of output) {
      if (channel === 'stdout') yield { type: 'session', id: 'slow-session' };
    }
  }
}

test('Agent recusa regras de categorias que o Goiaba ainda não aplica', () => {
  for (const policy of [
    { network: [{ operations: ['connect' as const], hosts: ['github.com'] }] },
    { tools: [{ operations: ['call' as const], tools: ['github/*'] }] },
    { agents: [{ operations: ['spawn' as const], agents: ['revisor'] }] },
    { secrets: [{ operations: ['read' as const], secrets: ['*_TOKEN'] }] },
  ]) {
    expect(
      () =>
        new Agent({
          name: 'teste',
          prompt: 'início',
          provider: new EchoProvider(),
          workspace: new Workspace({ type: 'bubblewrap', root: process.cwd() }),
          interaction: { ask: unusedAsk, write: () => undefined },
          permissions: { default: 'deny', deny: policy },
        }),
    ).toThrow(
      `O Goiaba ainda não aplica a categoria ${Object.keys(policy)[0] ?? ''}`,
    );
  }
});
