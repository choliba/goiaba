import { expect, test } from 'bun:test';

import { Agent } from '../src/agent/agent.js';
import type { AgentIO } from '../src/agent/io.js';
import type { ProgramCommand, ProgramOutput } from '../src/execute/types.js';
import type { Provider } from '../src/providers/types.js';
import type { ProviderEvent } from '../src/providers/types.js';
import { Workspace } from '../src/workspace/index.js';

test('Agent delega a execução e mantém o AsyncIterable público', async () => {
  const io = new MemoryIO();
  const agent = new Agent({
    prompt: 'mensagem',
    provider: new EchoProvider(),
    workspace: new Workspace({
      type: 'unrestricted',
      root: process.cwd(),
    }),
    io,
  });

  await agent.run();

  expect(io.values).toEqual(['mensagem']);
  expect(io.closed).toBe(true);
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
    { type: 'ask', question: 'Qual é o seu nome?' },
    { type: 'output', value: 'Olá, dev' },
  ]);
  expect(provider.sessions).toEqual([undefined, 'session-1']);
});

class MemoryIO implements AgentIO {
  public readonly values: string[] = [];
  public closed = false;

  public write(value: string): void {
    this.values.push(value);
  }

  public async ask(): Promise<string> {
    return 'dev';
  }

  public close(): void {
    this.closed = true;
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
