import { describe, expect, test } from 'bun:test';

import {
  Conversation,
  type InteractionAdapter,
} from '../src/interaction/index';
import {
  DEFAULT_LINE_LENGTH,
  completeOutput,
  type Output,
} from '../src/output/index';

/** An output that records what it got, in order; streams as `[pieces]`. */
function recorder(): { output: Output; shown: string[] } {
  const shown: string[] = [];
  const output = completeOutput({
    write: (text) => {
      shown.push(text);
    },
    writeStream: async (pieces) => {
      const got: string[] = [];
      for await (const piece of pieces) got.push(piece);
      shown.push(`[${got.join('|')}]`);
    },
    error: (text) => {
      shown.push(`erro: ${text}`);
    },
  });
  return { output, shown };
}

/** An adapter that only shows: nothing ever arrives. */
function showing(output: Output): InteractionAdapter {
  return {
    output,
    events: async function* () {
      // Nothing arrives.
    },
    request: () => undefined,
    close: () => undefined,
  };
}

/** Until everything queued has been shown. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

describe('completeOutput', () => {
  test('sem writeStream, os pedaços viram uma mensagem só, no fim', async () => {
    const shown: string[] = [];
    const output = completeOutput({
      write: (text) => {
        shown.push(text);
      },
    });

    await output.writeStream(['Olá, ', 'mundo']);
    await output.writeStream(
      (async function* () {
        yield 'a';
        yield 'b';
      })(),
    );
    await output.error('falhou');

    expect(shown).toEqual(['Olá, mundo', 'ab', 'falhou']);
    expect(output.lineLength()).toBe(DEFAULT_LINE_LENGTH);
  });
});

describe('Conversation: a ordem do que mostra', () => {
  test('um stream vai até outra coisa ser mostrada, que espera por ele', async () => {
    const { output, shown } = recorder();
    const terminal = new Conversation(showing(output));

    terminal.stream('Olá, ');
    terminal.stream('mundo');
    terminal.write('depois');
    terminal.stream('outra ');
    terminal.stream('resposta');
    terminal.error('ops');
    await settle();

    expect(shown).toEqual([
      '[Olá, |mundo]',
      'depois',
      '[outra |resposta]',
      'erro: ops',
    ]);
  });

  test('sem nada sendo mostrado, escreve na mesma chamada', () => {
    const { output, shown } = recorder();
    new Conversation(showing(output)).write('na hora');

    expect(shown).toEqual(['na hora']);
  });
});
