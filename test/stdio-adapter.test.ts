import { describe, expect, test } from 'bun:test';

import { StdioAdapter, type StdioSource } from '../src/adapters/stdio/index';
import { OutputStream } from '../src/execute/stream';
import { UsageError } from '../src/errors';
import type { InputEvent } from '../src/interaction/index';

/** A source the test types into; a tty unless `tty` is false. */
function source(tty = true): {
  source: StdioSource;
  type: (text: string) => void;
  end: () => void;
} {
  const chunks = new OutputStream<string>();
  return {
    source: { tty, read: () => chunks },
    type: (text) => {
      chunks.publish(text);
    },
    end: () => {
      chunks.close();
    },
  };
}

/** The adapter's events, as they arrive. */
function listen(adapter: StdioAdapter): InputEvent[] {
  const events: InputEvent[] = [];
  void (async () => {
    for await (const event of adapter.events()) events.push(event);
  })();
  return events;
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1));
}

describe('StdioAdapter num tty', () => {
  test('edita a linha, ecoa, e o Enter manda a mensagem', async () => {
    const { source: tty, type } = source();
    const echoed: string[] = [];
    const adapter = new StdioAdapter({
      source: tty,
      echo: (text) => echoed.push(text),
    });
    const events = listen(adapter);

    type('olx');
    type('\u007f');
    type('á\r');
    await tick();

    expect(events).toEqual([{ type: 'message', text: 'olá' }]);
    expect(echoed.join('')).toBe('\u001b[?2004holx\b \bá\n');
    adapter.close();
  });

  test('o texto colado guarda as quebras; só o Enter digitado manda', async () => {
    const { source: tty, type } = source();
    const adapter = new StdioAdapter({ source: tty, echo: () => undefined });
    const events = listen(adapter);

    type('\u001b[200~um\ndois\u001b[201~\r');
    await tick();

    expect(events).toEqual([{ type: 'message', text: 'um\ndois' }]);
    adapter.close();
  });

  test('atalho vira comando, Ctrl+C vira interrupt, instant responde sem Enter', async () => {
    const { source: tty, type } = source();
    const adapter = new StdioAdapter({
      source: tty,
      echo: () => undefined,
      shortcuts: { '\u0001': 'approvals' },
    });
    const events = listen(adapter);
    adapter.request({ type: 'line', instant: ['q'] });

    type('\u0001');
    type('Q');
    type('\u0003');
    await tick();

    expect(events).toEqual([
      { type: 'command', name: 'approvals' },
      { type: 'message', text: 'Q' },
      { type: 'interrupt' },
    ]);
    adapter.close();
  });

  test('a escolha toma a próxima tecla, à frente da linha', async () => {
    const { source: tty, type } = source();
    const adapter = new StdioAdapter({ source: tty, echo: () => undefined });
    const events = listen(adapter);
    const pending = adapter.request({ type: 'choice', keys: ['s', 'n'] });

    type('x');
    type('N');
    type('a\r');
    await tick();

    expect(pending).toBeDefined();
    expect(events).toEqual([
      { type: 'choice', key: 'n' },
      { type: 'message', text: 'a' },
    ]);
    adapter.close();
  });

  test('Ctrl+D encerra a entrada', async () => {
    const { source: tty, type } = source();
    const adapter = new StdioAdapter({ source: tty, echo: () => undefined });
    let ended = false;
    void (async () => {
      for await (const event of adapter.events()) void event;
      ended = true;
    })();

    type('\u0004');
    await tick();

    expect(ended).toBe(true);
    adapter.close();
  });
});

describe('StdioAdapter num pipe', () => {
  test('cada linha é uma mensagem, e nada pode ser pedido', async () => {
    const { source: pipe, type, end } = source(false);
    const adapter = new StdioAdapter({ source: pipe });
    const events = listen(adapter);

    expect(adapter.request({ type: 'line', instant: [] })).toBeUndefined();
    type('um\ndo');
    type('is\n');
    end();
    await tick();

    expect(events).toEqual([
      { type: 'message', text: 'um' },
      { type: 'message', text: 'dois' },
    ]);
  });

  test('uma linha acima de maxRecordBytes é um erro', async () => {
    const { source: pipe, type } = source(false);
    const adapter = new StdioAdapter({ source: pipe, maxRecordBytes: 3 });
    let failure: unknown;
    void (async () => {
      try {
        for await (const event of adapter.events()) void event;
      } catch (error) {
        failure = error;
      }
    })();

    type('longa demais');
    await tick();

    expect(failure).toBeInstanceOf(UsageError);
  });
});
