import { describe, expect, test } from 'bun:test';

import { OutputStream } from '../src/execute/stream';
import { UsageError } from '../src/errors';
import {
  Conversation,
  type InputEvent,
  type InteractionAdapter,
  type InteractionRequest,
} from '../src/interaction/index';
import { completeOutput } from '../src/output/index';

/** An adapter driven by the test: `send` events, see what was asked. */
function fakeAdapter({ canAsk = true } = {}): {
  adapter: InteractionAdapter;
  send: (event: InputEvent) => void;
  end: () => void;
  requests: InteractionRequest[];
  cancelled: () => number;
  shown: string[];
  closed: () => boolean;
} {
  const incoming = new OutputStream<InputEvent>();
  const requests: InteractionRequest[] = [];
  const shown: string[] = [];
  let cancelled = 0;
  let closed = false;
  const adapter: InteractionAdapter = {
    events: () => incoming,
    request: (request) => {
      if (!canAsk) return undefined;
      requests.push(request);
      return {
        cancel: () => {
          cancelled += 1;
        },
      };
    },
    output: completeOutput({
      write: (text) => {
        shown.push(text);
      },
    }),
    close: () => {
      closed = true;
      incoming.close();
    },
  };
  return {
    adapter,
    send: (event) => {
      incoming.publish(event);
    },
    end: () => {
      incoming.close();
    },
    requests,
    cancelled: () => cancelled,
    shown,
    closed: () => closed,
  };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1));
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

describe('Conversation', () => {
  test('pede uma linha ao adapter e recebe a mensagem', async () => {
    const { adapter, send, requests, cancelled } = fakeAdapter();
    const conversation = new Conversation(adapter);

    const line = conversation.ask('?', undefined, ['q']);
    send({ type: 'message', text: 'oi' });

    expect(await line).toBe('oi');
    expect(requests).toEqual([{ type: 'line', instant: ['q'] }]);
    expect(cancelled()).toBe(1);
  });

  test('o que chega sem ter sido pedido espera na fila, em ordem', async () => {
    const { adapter, send } = fakeAdapter();
    const conversation = new Conversation(adapter);
    const first = conversation.listen();

    send({ type: 'message', text: 'um' });
    send({ type: 'message', text: 'dois' });
    send({ type: 'message', text: 'três' });
    await tick();

    expect(await first).toBe('um');
    expect(await conversation.listen()).toBe('dois');
    expect(await conversation.listen()).toBe('três');
  });

  test('urgente e comando passam à frente; o comando chega como :nome', async () => {
    const { adapter, send } = fakeAdapter();
    const conversation = new Conversation(adapter, {
      urgent: (line) => line === 'já',
    });
    const first = conversation.listen();

    send({ type: 'message', text: 'primeira' });
    send({ type: 'message', text: 'depois' });
    send({ type: 'message', text: 'já' });
    send({ type: 'command', name: 'approvals' });
    await tick();

    expect(await first).toBe('primeira');
    expect(await conversation.listen()).toBe(':approvals');
    expect(await conversation.listen()).toBe('já');
    expect(await conversation.listen()).toBe('depois');
  });

  test('a escolha vem do evento choice; quem mostra é o adapter', async () => {
    const { adapter, send, requests, shown } = fakeAdapter();
    const conversation = new Conversation(adapter);

    const choice = conversation.choose(['s', 'n']);
    send({ type: 'choice', key: 's' });

    expect(await choice).toBe('s');
    expect(requests).toEqual([{ type: 'choice', keys: ['s', 'n'] }]);
    expect(shown).toEqual([]);
  });

  test('quem não pede tecla responde a escolha com uma linha', async () => {
    const { adapter, send } = fakeAdapter({ canAsk: false });
    const conversation = new Conversation(adapter);

    const choice = conversation.choose(['s', 'n']);
    send({ type: 'message', text: '  Sim ' });

    expect(await choice).toBe('s');
  });

  test('cancelar a pergunta não fecha a entrada: a linha vai para a próxima', async () => {
    const { adapter, send, closed } = fakeAdapter();
    const conversation = new Conversation(adapter);
    const controller = new AbortController();

    const asked = conversation.ask('?', controller.signal);
    controller.abort();
    const error = await rejection(asked);
    send({ type: 'message', text: 'digitado' });

    expect(error instanceof DOMException ? error.name : error).toBe(
      'AbortError',
    );
    expect(await conversation.listen()).toBe('digitado');
    expect(closed()).toBe(false);
  });

  test('o fim da entrada recusa quem espera e quem vier depois', async () => {
    const { adapter, end } = fakeAdapter();
    const conversation = new Conversation(adapter);

    const waiting = conversation.listen();
    end();

    expect(messageOf(await rejection(waiting))).toBe('stdin foi fechado.');
    expect(messageOf(await rejection(conversation.listen()))).toBe(
      'stdin foi fechado.',
    );
  });

  test('interrupt chama quem montou e fecha a conversa', async () => {
    const { adapter, send, closed } = fakeAdapter();
    let interrupted = 0;
    const conversation = new Conversation(adapter, {
      onInterrupt: () => {
        interrupted += 1;
      },
    });

    const waiting = conversation.listen();
    send({ type: 'interrupt' });

    expect(await rejection(waiting)).toBeInstanceOf(DOMException);
    expect(interrupted).toBe(1);
    expect(closed()).toBe(true);
  });

  test('pedidos que o adapter não faz: seguem até o limite, depois é erro', async () => {
    const { adapter, send } = fakeAdapter({ canAsk: false });
    const conversation = new Conversation(adapter, {
      maxUnansweredRequests: 2,
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const asked = conversation.ask('?', controller.signal);
      controller.abort();
      await rejection(asked);
    }
    expect(await rejection(conversation.listen())).toBeInstanceOf(UsageError);

    // Something arriving shows someone is there: asking works again.
    send({ type: 'message', text: 'oi' });
    await tick();
    expect(await conversation.listen()).toBe('oi');
  });
});
