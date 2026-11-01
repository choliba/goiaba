import { describe, expect, test } from 'bun:test';

import { readOllamaTraffic } from '../src/providers/ollama-traffic';
import type { TokenUsage, TrafficEvent } from '../src/providers/types';

describe('readOllamaTraffic', () => {
  test('lê o consumo do /v1/messages em stream, com o cache na entrada', async () => {
    const response = chunked(
      sse('message_start', {
        type: 'message_start',
        message: { usage: { input_tokens: 2, output_tokens: 0 } },
      }),
      sse('content_block_delta', {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'oi' },
      }),
      sse('message_delta', {
        type: 'message_delta',
        usage: {
          input_tokens: 4,
          cache_read_input_tokens: 9,
          output_tokens: 40,
        },
      }),
    );

    expect(await usages(split(response, 7))).toEqual([
      { input: 13, output: 40, cachedInput: 9 },
    ]);
  });

  test('lê o consumo do /v1/responses, com raciocínio', async () => {
    const response = chunked(
      sse('response.completed', {
        type: 'response.completed',
        response: {
          object: 'response',
          usage: {
            input_tokens: 13,
            input_tokens_details: { cached_tokens: 9 },
            output_tokens: 40,
            output_tokens_details: { reasoning_tokens: 30 },
          },
        },
      }),
    );

    expect(await usages(split(response, 5))).toEqual([
      { input: 13, output: 40, cachedInput: 9, reasoning: 30 },
    ]);
  });

  test('entrega os pedaços de texto e de raciocínio das duas rotas, em ordem', async () => {
    const messages = chunked(
      sse('content_block_delta', {
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: 'hm' },
      }),
      sse('content_block_delta', {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Olá, ' },
      }),
      sse('content_block_delta', {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'mundo' },
      }),
    );
    const responses = chunked(
      sse('response.reasoning_summary_text.delta', {
        type: 'response.reasoning_summary_text.delta',
        delta: 'Thinking',
      }),
      sse('response.output_text.delta', {
        type: 'response.output_text.delta',
        delta: 'oi',
      }),
    );

    expect(await events(split(messages + responses, 9))).toEqual([
      { type: 'reasoning', text: 'hm' },
      { type: 'text', text: 'Olá, ' },
      { type: 'text', text: 'mundo' },
      { type: 'reasoning', text: 'Thinking' },
      { type: 'text', text: 'oi' },
    ]);
  });

  test('várias respostas na mesma conexão, e uma resposta JSON sem stream', async () => {
    const body = JSON.stringify({
      type: 'message',
      usage: { input_tokens: 100, output_tokens: 5 },
    });
    const json = `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${String(Buffer.byteLength(body))}\r\n\r\n${body}`;
    const stream = chunked(
      sse('message_delta', {
        type: 'message_delta',
        usage: { input_tokens: 50, output_tokens: 3 },
      }),
    );
    const error =
      'HTTP/1.1 500 Internal Server Error\r\nContent-Length: 2\r\n\r\n{}';

    expect(await usages(split(json + error + stream, 11))).toEqual([
      { input: 100, output: 5, cachedInput: 0 },
      { input: 50, output: 3, cachedInput: 0 },
    ]);
  });
});

/** An SSE event, as Ollama writes it. */
function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** An HTTP/1.1 response whose body is `bodies`, one chunk each. */
function chunked(...bodies: string[]): string {
  const chunks = bodies
    .map((event) => {
      const size = Buffer.byteLength(event).toString(16);
      return `${size}\r\n${event}\r\n`;
    })
    .join('');
  return `HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n${chunks}0\r\n\r\n`;
}

/** The bytes in pieces of `size`, cut anywhere (headers, chunk sizes, JSON). */
async function* split(text: string, size: number): AsyncIterable<Uint8Array> {
  const bytes = Buffer.from(text);
  for (let start = 0; start < bytes.length; start += size) {
    yield bytes.subarray(start, start + size);
  }
}

async function events(
  bytes: AsyncIterable<Uint8Array>,
): Promise<TrafficEvent[]> {
  const result: TrafficEvent[] = [];
  for await (const event of readOllamaTraffic(bytes)) result.push(event);
  return result;
}

async function usages(bytes: AsyncIterable<Uint8Array>): Promise<TokenUsage[]> {
  return (await events(bytes)).flatMap((event) =>
    event.type === 'usage' ? [event.usage] : [],
  );
}
