/**
 * Exemplo 4 do curso de output: a saída como resposta HTTP. O mesmo
 * `relatorio` responde de dois jeitos:
 *
 * - `/texto`: junta as mensagens e responde tudo de uma vez (o stream vira
 *   uma mensagem só, pelo `completeOutput`);
 * - `/eventos`: Server-Sent Events, cada pedaço vai ao cliente assim que é
 *   escrito (é como o site acompanha um agente, em agents/api.ts).
 *
 * O exemplo sobe o servidor numa porta livre, pede as duas rotas a si mesmo
 * e mostra o que o cliente recebeu, com o tempo de chegada.
 *
 *   bun guides/output/exemplos/4-http.ts
 */
import {
  completeOutput,
  stdioOutput,
  type Output,
} from '../../../src/output/index';

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Mostra o andamento de um trabalho: não sabe que vai para a web. */
async function relatorio(output: Output): Promise<void> {
  await output.status('⏳ contando os arquivos…');
  await pause(300);
  await output.writeStream(contando());
  await output.status(undefined);
  await output.error('1 arquivo ignorado');
}

/** A resposta em pedaços, como um modelo escreve. */
async function* contando(): AsyncGenerator<string> {
  for (const piece of ['3 ', 'arquivos']) {
    await pause(200);
    yield piece;
  }
}

/** Junta tudo na memória; o texto vira o corpo da resposta no fim. */
function textOutput(): Output & { body(): string } {
  const lines: string[] = [];
  return {
    ...completeOutput({
      write: (text) => {
        lines.push(text);
      },
      error: (text) => {
        lines.push(`aviso: ${text}`);
      },
    }),
    body: () => `${lines.join('\n')}\n`,
  };
}

/** Cada mensagem é um evento SSE, enviado na hora. */
function eventsOutput(
  controller: ReadableStreamDefaultController<Uint8Array>,
): Output {
  const encoder = new TextEncoder();
  const send = (event: string, data: string): void => {
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
  };
  return completeOutput({
    write: (text) => {
      send('message', text);
    },
    // Cada pedaço é um evento: o cliente vê a resposta sendo escrita.
    writeStream: async (pieces) => {
      for await (const piece of pieces) send('piece', piece);
    },
    error: (text) => {
      send('error', text);
    },
    // Na web o status é um evento também; a página decide como mostrar.
    status: (text) => {
      send('status', text ?? '');
    },
  });
}

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const { pathname } = new URL(request.url);

    if (pathname === '/texto') {
      const output = textOutput();
      await relatorio(output);
      return new Response(output.body(), {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    if (pathname === '/eventos') {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          await relatorio(eventsOutput(controller));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { 'content-type': 'text/event-stream' },
      });
    }

    return new Response('não encontrado', { status: 404 });
  },
});

/** O cliente: mostra o que chega da resposta, com o tempo de chegada. */
async function ask(path: string): Promise<void> {
  const startedAt = performance.now();
  const response = await fetch(
    `http://127.0.0.1:${String(server.port)}${path}`,
  );
  await stdioOutput.write(
    `GET ${path} → ${String(response.status)} ${response.headers.get('content-type') ?? ''}`,
  );
  if (response.body === null) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    // Os tipos do Bun dão o pedaço como `any`: ele é conferido.
    const read: { readonly done: boolean; readonly value?: unknown } =
      await reader.read();
    if (read.done) return;
    if (!(read.value instanceof Uint8Array)) continue;
    const value = read.value;
    const ms = `${String(Math.round(performance.now() - startedAt)).padStart(4)} ms`;
    for (const line of readable(decoder.decode(value))) {
      await stdioOutput.write(`  ${ms}  ${line}`);
    }
  }
}

/** Um evento SSE (`event: x` + `data: y`) vira `x: y`; um texto, suas linhas. */
function readable(text: string): string[] {
  if (!text.startsWith('event: ')) return text.trimEnd().split('\n');
  return text
    .split('\n\n')
    .filter((block) => block !== '')
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? '';
      const data = /^data: ?(.*)$/m.exec(block)?.[1] ?? '';
      return `${event}: ${data === '' ? '(apaga)' : data}`;
    });
}

try {
  await ask('/texto');
  await ask('/eventos');
} finally {
  await server.stop(true);
}
