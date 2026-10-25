import { spawn } from 'node:child_process';

import { afterAll, describe, expect, test } from 'bun:test';

import { Executor, ProgramExecutionError } from '../src/execute/index.js';
import { OutputDispatcher } from '../src/output/index.js';
import type { Provider, ProviderEvent } from '../src/providers/types.js';
import { Workspace } from '../src/workspace/index.js';
import type { ProgramCommand, ProgramOutput } from '../src/execute/types.js';

const workspace = new Workspace({
  type: 'bubblewrap',
  root: process.cwd(),
});

afterAll(() => workspace.close());

describe('Executor', () => {
  test('envia a entrada e encaminha stdout e stderr pelo provider', async () => {
    const provider = new TestProvider(`
      let input = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => input += chunk);
      process.stdin.on('end', () => {
        process.stdout.write('out:' + input);
        process.stderr.write('err:' + input);
      });
    `);

    const values = await collect(
      new Executor().run(provider, workspace, 'comando'),
    );

    expect(values.map(readOutput).toSorted()).toEqual([
      'stderr:err:comando',
      'stdout:out:comando',
    ]);
  });

  test('o signal mata o processo e encerra com AbortError', async () => {
    const provider = new TestProvider('setInterval(() => {}, 1000);');
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 100);

    const values = collect(
      new Executor().run(provider, workspace, '', undefined, controller.signal),
    );

    await expect(values).rejects.toMatchObject({ name: 'AbortError' });
    expect(Date.now() - started).toBeLessThan(1500);
  });

  test('publica execuções simultâneas no fluxo global sem misturá-las', async () => {
    const output = new OutputDispatcher<ProviderEvent<string>>();
    let nextId = 0;
    const executor = new Executor({
      output,
      createExecutionId: () => `execution-${++nextId}`,
    });
    const subscription = output.subscribe()[Symbol.asyncIterator]();
    const provider = new TestProvider('process.stdin.pipe(process.stdout);');

    const first = collect(executor.run(provider, workspace, 'primeiro'));
    const second = collect(executor.run(provider, workspace, 'segundo'));
    const events = await Promise.all([
      subscription.next(),
      subscription.next(),
    ]);

    expect((await first).map(readOutput)).toEqual(['stdout:primeiro']);
    expect((await second).map(readOutput)).toEqual(['stdout:segundo']);
    expect(
      new Set(
        events.map((event) =>
          event.done === true ? undefined : event.value.executionId,
        ),
      ),
    ).toEqual(new Set(['execution-1', 'execution-2']));
    await subscription.return?.();
  });

  test('entrega a saída pendente antes do erro de término', async () => {
    const provider = new TestProvider(
      `process.stdout.write('resultado'); process.exitCode = 7;`,
    );
    const values: ProviderEvent<string>[] = [];
    let failure: unknown;

    try {
      for await (const value of new Executor().run(provider, workspace, '')) {
        values.push(value);
      }
    } catch (error) {
      failure = error;
    }

    expect(values.map(readOutput)).toEqual(['stdout:resultado']);
    expect(failure).toBeInstanceOf(ProgramExecutionError);
    expect(failure).toHaveProperty('code', 7);
  });

  test('propaga falha ao iniciar o programa', async () => {
    const provider = new TestProvider('');
    // Inside the jail a missing program is an exit 127; only spawn can fail to start.
    const executor = new Executor({
      spawnProcess: (_executable, _args, options) =>
        spawn('/programa/inexistente', [], options),
    });
    let failure: unknown;

    try {
      await collect(executor.run(provider, workspace, ''));
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ProgramExecutionError);
  });

  test('informa quando o programa termina por sinal', async () => {
    const provider = new TestProvider(`process.kill(process.pid, 'SIGTERM');`);
    let failure: unknown;

    try {
      await collect(new Executor().run(provider, workspace, ''));
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(ProgramExecutionError);
    expect(failure).toHaveProperty('signal', 'SIGTERM');
  });

  test('executa o comando na raiz do workspace', async () => {
    const provider = new TestProvider('process.stdout.write(process.cwd());');
    const values = await collect(new Executor().run(provider, workspace, ''));

    expect(values.map(readOutput)).toEqual([`stdout:${process.cwd()}`]);
  });
});

class TestProvider implements Provider<string, string> {
  public readonly id = 'test-program';

  public constructor(private readonly script: string) {}

  public createCommand(input: string): ProgramCommand {
    return {
      executable: process.execPath,
      arguments: ['-e', this.script],
      input,
    };
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    for await (const value of output) {
      yield {
        type: 'output',
        value: `${value.channel}:${value.chunk}`,
      };
    }
  }
}

function readOutput(event: ProviderEvent<string>): string {
  if (event.type === 'ask') {
    return `ask:${event.question}`;
  }

  if (event.type === 'session') {
    return `session:${event.id}`;
  }

  return event.value;
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];

  for await (const value of values) {
    result.push(value);
  }

  return result;
}
