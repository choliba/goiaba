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
          conversation: false,
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

test('Agent entrega a saída pelo interaction', async () => {
  const written: string[] = [];
  const agent = new Agent({
    conversation: false,
    name: 'teste',
    prompt: 'mensagem',
    provider: new EchoProvider(),
    workspace: new Workspace({
      type: 'bubblewrap',
      root: process.cwd(),
    }),
    interaction: { ask: unusedAsk, write: (value) => written.push(value) },
  });

  await agent.run();

  expect(written).toEqual([THINKING, 'mensagem']);
});

test('Agent.run escreve output e ask pelos ports injetados', async () => {
  const values: string[] = [];
  const agent = new Agent({
    conversation: false,
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

  expect(values).toEqual([
    THINKING,
    'Qual é o seu nome?',
    THINKING,
    'Olá, dev',
  ]);
});

/** The line shown when the model starts working on a turn. */
const THINKING = '⏳ pensando…';

test('Agent entrega a conversa aos subscribers, sem os detalhes do log', async () => {
  const received: AgentOutput[] = [];

  await new Agent({
    conversation: false,
    name: 'construtor',
    prompt: 'início',
    provider: new ToolProvider(),
    workspace: new Workspace({ type: 'bubblewrap', root: process.cwd() }),
    interaction: { ask: unusedAsk, write: () => undefined },
    subscribe: [(output) => received.push(output)],
  }).run();

  const conversation = received.map((output) => [output.type(), output.data()]);

  // Tools, commands and sandboxes go to the log only.
  expect(conversation).toEqual([
    ['input', { value: 'início' }],
    // What the screen shows while the model works, emitted by the agent.
    ['status', { text: THINKING }],
    ['message', { text: THINKING }],
    ['thinking', { phase: 'start', seconds: 0 }],
    ['session', { id: 'tool-session' }],
    ['status', { text: '⏳ rodando em background…' }],
    ['status', { text: THINKING }],
    ['output', { value: 'feito' }],
    ['status', { text: null }],
    ['thinking', { phase: 'end', seconds: 0 }],
    ['message', { text: 'feito' }],
  ]);
  expect(received.every((output) => output.agent().name === 'construtor')).toBe(
    true,
  );
  const agent = received[0]?.agent();
  expect(agent).toBeInstanceOf(Agent);
  expect(agent.provider.id).toBe('tool');
  expect(agent.workspace.root).toBe(process.cwd());
  expect(JSON.parse(JSON.stringify(received[0]))).toMatchObject({
    source: 'agent',
    type: 'input',
    agent: 'construtor',
  });
});

test('Agent.run envia na mesma sessão uma linha digitada durante o turno', async () => {
  const provider = new ProactiveInputProvider();
  const values: string[] = [];
  const messages = ['mude também o menu'];

  await new Agent({
    conversation: false,
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
  expect(values).toEqual([
    THINKING,
    'primeiro turno',
    THINKING,
    'segundo turno',
  ]);
});

test('Agent.run ignora Enter vazio durante o turno e continua escutando', async () => {
  const provider = new ProactiveInputProvider();
  // An Enter left by the previous program, then the real message.
  const messages = ['', '   ', 'mude também o menu'];

  await new Agent({
    conversation: false,
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
    conversation: false,
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
    conversation: false,
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
  const written: string[] = [];
  const agent = new Agent({
    conversation: false,
    name: 'teste',
    prompt: 'início',
    provider,
    workspace: new Workspace({
      type: 'bubblewrap',
      root: process.cwd(),
    }),
    interaction: {
      ask: (question) => {
        expect(question).toBe('Qual é o seu nome?');
        return Promise.resolve('dev');
      },
      write: (value) => written.push(value),
    },
  });

  await agent.run();

  expect(written).toEqual([
    THINKING,
    'Qual é o seu nome?',
    THINKING,
    'Olá, dev',
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
    conversation: false,
    name: 'teste',
    prompt: 'mensagem',
    provider: new HangingProvider(),
    workspace,
    interaction: { ask: unusedAsk, write: (value) => values.push(value) },
    signal: AbortSignal.timeout(100),
  }).run();

  expect(values).toEqual([THINKING, '\n']);
  expect(closed).toBe(true);
});

test('Agent.run para enquanto espera a resposta de um ask', async () => {
  const controller = new AbortController();

  await new Agent({
    conversation: false,
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
    conversation: false,
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

test('o aviso de uma aprovação por padrão manda repetir o comando negado, não o padrão', async () => {
  const store = Store.memory();
  const root = process.cwd();
  store.recordSession({
    id: 'sessao-antiga',
    provider: 'recorder',
    root,
    prompt: 'crie o site',
  });
  const denied = store.recordDecision({
    session: 'sessao-antiga',
    provider: 'recorder',
    root,
    command: 'curl -I http://localhost:5173/',
    decision: 'deny',
    source: 'default',
    reason: 'x',
  });
  store.saveApproval({
    root,
    pattern: 'curl *',
    kind: 'workspace',
    session: 'sessao-antiga',
    decisionId: denied,
  });
  const provider = new RecordingProvider();

  await new Agent({
    conversation: false,
    name: 'teste',
    prompt: 'crie o site',
    provider,
    workspace: new Workspace({ type: 'bubblewrap', root }),
    interaction: { ask: unusedAsk, write: () => {} },
    store,
  }).run();

  expect(provider.calls.at(0)?.input).toContain(
    '- (neste workspace) curl -I http://localhost:5173/ — liberado pelo padrão `curl *`',
  );
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
    conversation: false,
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
    conversation: false,
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

test('por padrão o agente conversa: depois da resposta espera a próxima mensagem', async () => {
  const provider = new SessionProvider('s1');
  const stop = new AbortController();
  const answers = ['segunda mensagem'];

  const run = new Agent({
    name: 'teste',
    prompt: 'primeira',
    provider,
    workspace: new Workspace({ type: 'bubblewrap', root: process.cwd() }),
    store: Store.memory(),
    signal: stop.signal,
    interaction: {
      ask: () => {
        const next = answers.shift();
        if (next !== undefined) return Promise.resolve(next);
        // Waiting for a third message: enough, end the conversation.
        stop.abort();
        return new Promise<string>(() => undefined);
      },
      write: () => undefined,
    },
  }).run();

  await run;
  expect(provider.calls).toEqual([
    { session: undefined, input: 'primeira' },
    { session: 's1', input: 'segunda mensagem' },
  ]);
});

test('se a CLI não tem mais a sessão guardada, começa uma nova em vez de parar', async () => {
  const store = Store.memory();
  store.recordSession({
    id: 'esquecida',
    provider: 'forgetful',
    root: process.cwd(),
    prompt: 'início',
  });
  const provider = new ForgetfulProvider();
  const written: string[] = [];

  await new Agent({
    conversation: false,
    name: 'teste',
    prompt: 'início',
    provider,
    workspace: new Workspace({ type: 'bubblewrap', root: process.cwd() }),
    interaction: { ask: unusedAsk, write: (value) => written.push(value) },
    store,
  }).run();

  expect(provider.calls.map((call) => call.session)).toEqual([
    'esquecida',
    undefined,
  ]);
  // A tarefa começa de novo: o prompt, não o aviso de continuar.
  expect(provider.calls.at(1)?.input).toBe('início');
  expect(written).toContain(
    'A conversa anterior não existe mais na CLI: começando uma nova.',
  );
  expect(written).toContain('nova');
  // A esquecida foi abandonada; a nova terminou (conversation: false).
  expect(store.openSession('forgetful', process.cwd())).toBeUndefined();
});

/** Fails to resume any session (its history is gone); a new one works. */
class ForgetfulProvider implements Provider<string, string> {
  public readonly id = 'forgetful';
  public readonly calls: { session: string | undefined; input: string }[] = [];

  public createCommand(input: string, sessionId?: string): ProgramCommand {
    this.calls.push({ session: sessionId, input });
    return {
      executable: process.execPath,
      arguments: [
        '-e',
        sessionId === undefined
          ? 'process.stdout.write("nova")'
          : 'process.exit(1)',
      ],
    };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    let first = true;
    for await (const { channel, chunk } of output) {
      if (channel !== 'stdout') continue;
      if (first) yield { type: 'session', id: 'nova-sessao' };
      first = false;
      yield { type: 'output', value: chunk };
    }
  }
}

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
        conversation: false,
        name: ' ',
        prompt: 'mensagem',
        provider: new EchoProvider(),
        workspace: new Workspace({ type: 'bubblewrap', root: process.cwd() }),
      }),
  ).toThrow('O nome do agente não pode estar vazio.');
});

test('run com o agente rodando devolve a execução em curso', async () => {
  const agent = new Agent({
    conversation: false,
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

test('pause mantém a sessão aberta e run continua nela', async () => {
  const provider = new SlowProvider();
  const store = Store.memory();
  const started = Promise.withResolvers<void>();
  const agent = new Agent({
    conversation: false,
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

  const resumed = agent.run();
  await Bun.sleep(50);
  expect(provider.sessions).toEqual([undefined, 'slow-session']);

  await agent.destroy();
  await resumed;
  expect(agent.status()).toBe('destroyed');
  expect(() => agent.run()).toThrow('O agente lento foi destruído.');
});

test('destroy encerra a sessão: a próxima execução começa do zero', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'goiaba-destroy-'));
  const path = join(dir, 'goiaba.db');
  try {
    const store = Store.open(path);
    store.recordSession({
      id: 'antiga',
      provider: 'slow',
      root: process.cwd(),
      prompt: 'início',
    });
    const agent = new Agent({
      conversation: false,
      name: 'lento',
      prompt: 'início',
      provider: new SlowProvider(),
      workspace: new Workspace({ type: 'bubblewrap', root: process.cwd() }),
      interaction: { ask: unusedAsk, write: () => undefined },
      store,
    });

    await agent.destroy();

    const reopened = Store.open(path);
    expect(reopened.openSession('slow', process.cwd())).toBeUndefined();
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('interrompido pelo signal (Ctrl+C), o agente fica em stopped', async () => {
  const provider = new SlowProvider();
  const started = Promise.withResolvers<void>();
  const interrupt = new AbortController();
  const agent = new Agent({
    conversation: false,
    name: 'lento',
    prompt: 'início',
    provider,
    workspace: new Workspace({ type: 'bubblewrap', root: process.cwd() }),
    interaction: { ask: unusedAsk, write: () => undefined },
    store: Store.memory(),
    signal: interrupt.signal,
    subscribe: [
      (output) => {
        if (output.type() === 'session') started.resolve();
      },
    ],
  });

  const run = agent.run();
  await started.promise;
  interrupt.abort();
  await run;

  expect(agent.status()).toBe('stopped');
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
    conversation: false,
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

test('Agent aceita regras de rede no docker', () => {
  expect(
    () =>
      new Agent({
        conversation: false,
        name: 'teste',
        prompt: 'início',
        provider: new EchoProvider(),
        workspace: new Workspace({
          type: 'docker',
          root: process.cwd(),
          image: 'FROM imagem',
        }),
        interaction: { ask: unusedAsk, write: () => undefined },
        permissions: {
          default: 'deny',
          allow: {
            filesystem: [{ operations: ['read'], paths: ['/workspace/**'] }],
            network: [{ operations: ['connect'], hosts: ['github.com'] }],
          },
        },
      }),
  ).not.toThrow();
});

test('Agent recusa regras de categorias que o Goiaba ainda não aplica', () => {
  for (const policy of [
    { tools: [{ operations: ['call' as const], tools: ['github/*'] }] },
    { agents: [{ operations: ['spawn' as const], agents: ['revisor'] }] },
  ]) {
    expect(
      () =>
        new Agent({
          conversation: false,
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
