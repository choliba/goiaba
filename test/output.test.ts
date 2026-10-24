import { describe, expect, test } from 'bun:test';

import { OutputDispatcher } from '../src/output/index.js';

describe('OutputDispatcher', () => {
  test('entrega valores genéricos para a execução e assinantes', async () => {
    const output = new OutputDispatcher<{ count: number }>();
    const execution = output.open('execution-1', 'program-1');
    const subscription = output.subscribe()[Symbol.asyncIterator]();

    output.publish('execution-1', 'program-1', { count: 1 });
    output.close('execution-1', 'program-1');

    expect(await collect(execution)).toEqual([{ count: 1 }]);
    expect(await subscription.next()).toEqual({
      done: false,
      value: {
        executionId: 'execution-1',
        programId: 'program-1',
        value: { count: 1 },
      },
    });

    await subscription.return?.();
  });

  test('uma falha encerra somente a execução correspondente', async () => {
    const output = new OutputDispatcher<string>();
    const failed = output.open('failed', 'program');
    const successful = output.open('successful', 'program');

    output.publish('failed', 'program', 'antes da falha');
    output.fail('failed', 'program', new Error('falhou'));
    output.publish('successful', 'program', 'continua');
    output.close('successful', 'program');

    const failedValues: string[] = [];
    let failure: unknown;

    try {
      for await (const value of failed) {
        failedValues.push(value);
      }
    } catch (error) {
      failure = error;
    }

    expect(failedValues).toEqual(['antes da falha']);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('falhou');
    expect(await collect(successful)).toEqual(['continua']);
  });
});

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];

  for await (const value of values) {
    result.push(value);
  }

  return result;
}
