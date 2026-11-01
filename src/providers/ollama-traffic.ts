import type { TokenUsage, TrafficEvent } from './types';

const HEAD_END = '\r\n\r\n';
const LINE_END = '\r\n';

/**
 * What Ollama sends back on one connection, as it arrives: each piece of an
 * answer's text and each request's usage. The bytes are HTTP/1.1 responses
 * one after the other, each a JSON body or a stream of server-sent events.
 * Both routes the CLIs use are read: `/v1/messages` (Anthropic's format,
 * Claude Code) and `/v1/responses` (OpenAI's, Codex). Anything else is
 * skipped.
 */
export async function* readOllamaTraffic(
  responses: AsyncIterable<Uint8Array>,
): AsyncIterable<TrafficEvent> {
  const reader = new HttpReader();
  for await (const chunk of responses) {
    yield* reader.push(chunk);
  }
  yield* reader.end();
}

type Framing =
  | { readonly kind: 'chunked' }
  | { readonly kind: 'length'; remaining: number }
  | { readonly kind: 'close' };

/** One connection's responses, as bytes arrive. */
class HttpReader {
  private pending = Buffer.alloc(0);
  private framing: Framing | undefined;
  private body = new BodyReader();

  public *push(chunk: Uint8Array): Iterable<TrafficEvent> {
    this.pending = Buffer.concat([this.pending, chunk]);
    for (;;) {
      const usage = this.step();
      if (usage === 'wait') return;
      yield* usage;
    }
  }

  public *end(): Iterable<TrafficEvent> {
    if (this.framing?.kind === 'close') {
      yield* this.body.write(this.pending);
      yield* this.body.end();
    }
  }

  /** Consumes what it can of `pending`: the usages found, or `wait`. */
  private step(): readonly TrafficEvent[] | 'wait' {
    if (this.framing === undefined) return this.readHead();
    if (this.framing.kind === 'close') {
      const usage = this.body.write(this.pending);
      this.pending = Buffer.alloc(0);
      return usage.length === 0 ? 'wait' : usage;
    }
    if (this.framing.kind === 'length') {
      const length = Math.min(this.framing.remaining, this.pending.length);
      const usage = [...this.body.write(this.pending.subarray(0, length))];
      this.pending = this.pending.subarray(length);
      this.framing.remaining -= length;
      if (this.framing.remaining > 0)
        return usage.length === 0 ? 'wait' : usage;
      return [...usage, ...this.finish()];
    }
    return this.readChunk();
  }

  private readHead(): readonly TrafficEvent[] | 'wait' {
    const end = this.pending.indexOf(HEAD_END);
    if (end === -1) return 'wait';
    const head = this.pending.subarray(0, end).toString('latin1');
    this.pending = this.pending.subarray(end + HEAD_END.length);
    const headers = new Map(
      head
        .split(LINE_END)
        .slice(1)
        .map((line) => {
          const colon = line.indexOf(':');
          return [
            line.slice(0, colon).trim().toLowerCase(),
            line.slice(colon + 1).trim(),
          ] as const;
        }),
    );
    const length = Number(headers.get('content-length'));
    this.framing = /chunked/i.test(headers.get('transfer-encoding') ?? '')
      ? { kind: 'chunked' }
      : Number.isInteger(length)
        ? { kind: 'length', remaining: length }
        : { kind: 'close' };
    this.body = new BodyReader();
    return this.framing.kind === 'length' && length === 0 ? this.finish() : [];
  }

  /** One chunk of a chunked body: `size\r\n data \r\n`; size 0 ends it. */
  private readChunk(): readonly TrafficEvent[] | 'wait' {
    const lineEnd = this.pending.indexOf(LINE_END);
    if (lineEnd === -1) return 'wait';
    const size = Number.parseInt(
      this.pending.subarray(0, lineEnd).toString('latin1'),
      16,
    );
    if (size === 0) {
      const trailerEnd = this.pending.indexOf(LINE_END, lineEnd + 2);
      if (trailerEnd === -1) return 'wait';
      this.pending = this.pending.subarray(trailerEnd + LINE_END.length);
      return this.finish();
    }
    const start = lineEnd + LINE_END.length;
    if (this.pending.length < start + size + LINE_END.length) return 'wait';
    const usage = this.body.write(this.pending.subarray(start, start + size));
    this.pending = this.pending.subarray(start + size + LINE_END.length);
    return usage;
  }

  /** The response ended: the next bytes are the next response's head. */
  private finish(): readonly TrafficEvent[] {
    this.framing = undefined;
    return this.body.end();
  }
}

/** A response body: server-sent events (`data:` lines) or one JSON. */
class BodyReader {
  private readonly decoder = new TextDecoder();
  private text = '';
  private events = false;

  public write(bytes: Uint8Array): readonly TrafficEvent[] {
    this.text += this.decoder.decode(bytes, { stream: true });
    if (!this.events && /^(event|data):/m.test(this.text)) this.events = true;
    if (!this.events) return [];

    const lines = this.text.split('\n');
    this.text = lines.pop() ?? '';
    return lines.flatMap((line) => eventsOfLine(line));
  }

  public end(): readonly TrafficEvent[] {
    this.text += this.decoder.decode();
    if (this.events) return eventsOfLine(this.text);
    const usage = usageOf(parseJson(this.text));
    return usage === undefined ? [] : [{ type: 'usage', usage }];
  }
}

function eventsOfLine(line: string): readonly TrafficEvent[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return [];
  const value = parseJson(trimmed.slice('data:'.length));
  const text = textOf(value);
  const reasoning = reasoningOf(value);
  const usage = usageOf(value);
  return [
    ...(text === undefined ? [] : [{ type: 'text' as const, text }]),
    ...(reasoning === undefined
      ? []
      : [{ type: 'reasoning' as const, text: reasoning }]),
    ...(usage === undefined ? [] : [{ type: 'usage' as const, usage }]),
  ];
}

/**
 * A piece of the reasoning: Anthropic's `content_block_delta` with a
 * `thinking_delta`, or OpenAI's `response.reasoning_summary_text.delta`.
 */
function reasoningOf(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (value['type'] === 'content_block_delta') {
    const delta = value['delta'];
    return isRecord(delta) &&
      delta['type'] === 'thinking_delta' &&
      typeof delta['thinking'] === 'string' &&
      delta['thinking'].length > 0
      ? delta['thinking']
      : undefined;
  }
  if (value['type'] === 'response.reasoning_summary_text.delta') {
    const delta = value['delta'];
    return typeof delta === 'string' && delta.length > 0 ? delta : undefined;
  }
  return undefined;
}

/**
 * A piece of the answer's text: Anthropic's `content_block_delta` with a
 * `text_delta`, or OpenAI's `response.output_text.delta`. Reasoning and
 * tool input are not text.
 */
function textOf(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (value['type'] === 'content_block_delta') {
    const delta = value['delta'];
    return isRecord(delta) &&
      delta['type'] === 'text_delta' &&
      typeof delta['text'] === 'string' &&
      delta['text'].length > 0
      ? delta['text']
      : undefined;
  }
  if (value['type'] === 'response.output_text.delta') {
    const delta = value['delta'];
    return typeof delta === 'string' && delta.length > 0 ? delta : undefined;
  }
  return undefined;
}

/**
 * The usage in an event or body: Anthropic's `message_delta` (or a whole
 * `message`), whose `input_tokens` leaves out the cache, or OpenAI's
 * `response.completed` (or a whole `response`), whose input includes it.
 */
function usageOf(value: unknown): TokenUsage | undefined {
  if (!isRecord(value)) return undefined;

  if (value['type'] === 'message_delta' || value['type'] === 'message') {
    const usage = value['usage'];
    if (!isRecord(usage)) return undefined;
    const fresh = numberOf(usage['input_tokens']);
    const output = numberOf(usage['output_tokens']);
    if (fresh === undefined || output === undefined) return undefined;
    const cached = numberOf(usage['cache_read_input_tokens']) ?? 0;
    const written = numberOf(usage['cache_creation_input_tokens']) ?? 0;
    return {
      input: fresh + cached + written,
      output,
      cachedInput: cached,
    };
  }

  if (value['type'] === 'response.completed') {
    const response = value['response'];
    return responsesUsage(isRecord(response) ? response['usage'] : undefined);
  }
  return value['object'] === 'response'
    ? responsesUsage(value['usage'])
    : undefined;
}

function responsesUsage(usage: unknown): TokenUsage | undefined {
  if (!isRecord(usage)) return undefined;
  const input = numberOf(usage['input_tokens']);
  const output = numberOf(usage['output_tokens']);
  if (input === undefined || output === undefined) return undefined;
  const inputDetails = usage['input_tokens_details'];
  const outputDetails = usage['output_tokens_details'];
  const cached = isRecord(inputDetails)
    ? numberOf(inputDetails['cached_tokens'])
    : undefined;
  const reasoning = isRecord(outputDetails)
    ? numberOf(outputDetails['reasoning_tokens'])
    : undefined;
  return {
    input,
    output,
    ...(cached === undefined ? {} : { cachedInput: cached }),
    ...(reasoning === undefined ? {} : { reasoning }),
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
