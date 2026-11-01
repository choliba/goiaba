import { spawn } from 'node:child_process';

import { afterAll, describe, expect, test } from 'bun:test';

import { runProvider } from '../src/agent/run-provider';
import {
  Executor,
  OutputDispatcher,
  ProgramExecutionError,
} from '../src/execute/index';
import type { ProgramCommand, ProgramOutput } from '../src/execute/types';
import type { Provider, ProviderEvent } from '../src/providers/types';
import { Workspace } from '../src/workspace/index';

/** A bun script as a command: no sandbox, no provider. */
function script(source: string, input?: string): ProgramCommand {
  return {
    executable: process.execPath,
    arguments: ['-e', source],
    ...(input === undefined ? {} : { input }),
  };
}

describe('Executor', () => {
  test('envia a entrada e entrega stdout e stderr', async () => {
    const chunks = await collect(
      new Executor().run(
        script(
          `let input = '';
           process.stdin.setEncoding('utf8');
           process.stdin.on('data', chunk => input += chunk);
           process.stdin.on('end', () => {
             process.stdout.write('out:' + input);
             process.stderr.write('err:' + input);
           });`,
          'comando',
        ),
      ),
    );

    expect(chunks.map(readChunk).toSorted()).toEqual([
      'stderr:err:comando',
      'stdout:out:comando',
    ]);
  });

  test('o signal mata o processo e encerra com AbortError', async () => {
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 100);

    const chunks = collect(
      new Executor().run(script('setInterval(() => {}, 1000);'), {
        signal: controller.signal,
      }),
    );

    await expect(chunks).rejects.toMatchObject({ name: 'AbortError' });
    expect(Date.now() - started).toBeLessThan(1500);
  });

  test('no abort, chama onAbort além de matar o processo', async () => {
    const controller = new AbortController();
    let aborted = false;
    setTimeout(() => controller.abort(), 50);

    await expect(
      collect(
        new Executor().run(script('setInterval(() => {}, 1000);'), {
          signal: controller.signal,
          onAbort: () => {
            aborted = true;
          },
        }),
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(aborted).toBe(true);
  });

  test('entrega a saída pendente antes do erro de término', async () => {
    const chunks: ProgramOutput[] = [];
    let failure: unknown;

    try {
      for await (const chunk of new Executor().run(
        script(`process.stdout.write('resultado'); process.exitCode = 7;`),
      )) {
        chunks.push(chunk);
      }
    } catch (error) {
      failure = error;
    }

    expect(chunks.map(readChunk)).toEqual(['stdout:resultado']);
    expect(failure).toBeInstanceOf(ProgramExecutionError);
    expect(failure).toHaveProperty('code', 7);
  });

  test('propaga falha ao iniciar o programa', async () => {
    let failure: unknown;

    try {
      await collect(
        new Executor().run({ executable: '/programa/inexistente' }),
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ProgramExecutionError);
  });

  test('informa quando o programa termina por sinal', async () => {
    await expect(
      collect(
        new Executor().run(script(`process.kill(process.pid, 'SIGTERM');`)),
      ),
    ).rejects.toMatchObject({ signal: 'SIGTERM' });
  });

  test('roda no cwd do comando e avisa o pid em onStart', async () => {
    let pid: number | undefined;
    const chunks = await collect(
      new Executor().run(
        { ...script('process.stdout.write(process.cwd());'), cwd: '/tmp' },
        {
          onStart: (started) => {
            pid = started;
          },
        },
      ),
    );

    expect(chunks.map(readChunk)).toEqual(['stdout:/tmp']);
    expect(pid).toBeNumber();
  });

  test('sair antes do fim (break) mata o programa', async () => {
    const started = Date.now();
    for await (const _ of new Executor().run(
      script(`process.stdout.write('a'); setInterval(() => {}, 1000);`),
    )) {
      break;
    }
    expect(Date.now() - started).toBeLessThan(1500);
  });

  test('usa o spawnProcess dado', async () => {
    const executor = new Executor({
      spawnProcess: (_executable, _args, options) =>
        spawn(
          process.execPath,
          ['-e', 'process.stdout.write("trocado")'],
          options,
        ),
    });

    const chunks = await collect(executor.run({ executable: 'qualquer' }));
    expect(chunks.map(readChunk)).toEqual(['stdout:trocado']);
  });
});

describe('runProvider', () => {
  const workspace = new Workspace({
    type: 'bubblewrap',
    root: process.cwd(),
  });

  afterAll(() => workspace.close());

  test('o provider cria o comando e lê a saída; roda na raiz do workspace', async () => {
    const events = await collect(
      runProvider(new TestProvider('process.stdout.write(process.cwd());'), {
        executor: new Executor(),
        workspace,
        input: '',
      }),
    );

    expect(events.map(readEvent)).toEqual([`stdout:${process.cwd()}`]);
  });

  test('publica execuções simultâneas no despachante sem misturá-las', async () => {
    const dispatcher = new OutputDispatcher<ProviderEvent<string>>();
    const subscription = dispatcher.subscribe()[Symbol.asyncIterator]();
    const provider = new TestProvider('process.stdin.pipe(process.stdout);');
    const run = (input: string): Promise<ProviderEvent<string>[]> =>
      collect(
        runProvider(provider, {
          executor: new Executor(),
          workspace,
          input,
          dispatcher,
        }),
      );

    const first = run('primeiro');
    const second = run('segundo');
    const published = await Promise.all([
      subscription.next(),
      subscription.next(),
    ]);

    expect((await first).map(readEvent)).toEqual(['stdout:primeiro']);
    expect((await second).map(readEvent)).toEqual(['stdout:segundo']);
    expect(
      new Set(
        published.map((event) =>
          event.done === true ? undefined : event.value.programId,
        ),
      ),
    ).toEqual(new Set(['test-program']));
    expect(
      new Set(
        published.map((event) =>
          event.done === true ? undefined : event.value.executionId,
        ),
      ).size,
    ).toBe(2);
    await subscription.return?.();
  });
});

class TestProvider implements Provider<string, string> {
  public readonly id = 'test-program';

  public constructor(private readonly source: string) {}

  public createCommand(input: string): ProgramCommand {
    return script(this.source, input);
  }

  public async *parseOutput(
    output: AsyncIterable<ProgramOutput>,
  ): AsyncIterable<ProviderEvent<string>> {
    for await (const chunk of output) {
      yield { type: 'output', value: readChunk(chunk) };
    }
  }
}

function readChunk({ channel, chunk }: ProgramOutput): string {
  return `${channel}:${chunk}`;
}

function readEvent(event: ProviderEvent<string>): string {
  return event.type === 'output' ? event.value : event.type;
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];

  for await (const value of values) {
    result.push(value);
  }

  return result;
}
