import { UsageError } from '../../errors';
import {
  appendText,
  pathExists,
  readText,
  writeText,
} from '../../filesystem/index';
import type {
  InputEvent,
  InteractionAdapter,
  PendingRequest,
} from '../../interaction/index';
import { log } from '../../logger/index';
import {
  completeOutput,
  type Output,
  type OutputKind,
} from '../../output/index';
import { DEFAULT_MAX_RECORD_BYTES, DEFAULT_POLL_MS } from '../constants';

const encoder = new TextEncoder();

export interface JsonlAdapterOptions {
  /** The conversation file: what comes in and what goes out, a line each. */
  readonly path: string;
  /** The most a line may take, in bytes. */
  readonly maxRecordBytes?: number;
  /** How often the file is read for new lines, in milliseconds. */
  readonly pollMs?: number;
  /** Empties the file first: a new conversation each run. */
  readonly startEmpty?: boolean;
}

/**
 * The conversation through a file, one JSON object per line, added at the
 * end (a log, never rewritten). A line that comes in is an event, as
 * `InputEvent` writes it:
 *
 *   {"type":"message","text":"oi"}
 *   {"type":"choice","key":"s"}
 *   {"type":"command","name":"approvals"}
 *   {"type":"interrupt"}
 *
 * What goes out is `{"out":"message"|"reasoning"|"error","text":…}`, a
 * line each (a reply streamed is one line, once it ends), so the adapter
 * never reads its own lines back. Nothing can be asked: a file has no
 * prompt and no keys. There is no status line either.
 */
export class JsonlAdapter implements InteractionAdapter {
  public readonly output: Output;
  private readonly path: string;
  private readonly maxRecordBytes: number;
  private readonly pollMs: number;
  private readonly reading = new AbortController();
  private started = false;

  public constructor({
    path,
    maxRecordBytes = DEFAULT_MAX_RECORD_BYTES,
    pollMs = DEFAULT_POLL_MS,
    startEmpty = false,
  }: JsonlAdapterOptions) {
    this.path = path;
    this.maxRecordBytes = maxRecordBytes;
    this.pollMs = pollMs;
    if (startEmpty || !pathExists(path)) writeText(path, '');

    const append = (out: string, text: string): void => {
      appendText(this.path, `${JSON.stringify({ out, text })}\n`);
    };
    this.output = completeOutput({
      write: (text, kind: OutputKind = 'message') => {
        append(kind, text);
      },
      error: (text) => {
        append('error', text);
      },
    });
  }

  public async *events(): AsyncGenerator<InputEvent> {
    if (this.started) {
      throw new UsageError('Os eventos de um adapter são lidos uma vez só.');
    }
    this.started = true;

    /** Characters of the file already read: whole lines only. */
    let read = 0;
    let number = 0;
    const signal = this.reading.signal;
    while (!signal.aborted) {
      const text = pathExists(this.path) ? readText(this.path) : '';
      const end = text.lastIndexOf('\n') + 1;
      const fresh = end > read ? text.slice(read, end) : '';
      read = Math.max(read, end);
      this.checkLength(text.slice(read), number + 1);

      for (const line of fresh.split('\n').slice(0, -1)) {
        number += 1;
        this.checkLength(line, number);
        const event = this.eventOf(line, number);
        if (event !== undefined) yield event;
      }
      await pause(this.pollMs, signal);
    }
  }

  /** A file cannot ask: what comes in answers anyway. */
  public request(): PendingRequest | undefined {
    return undefined;
  }

  public close(): void {
    this.reading.abort();
  }

  /** The event of a line; `undefined` for a line that went out. */
  private eventOf(line: string, number: number): InputEvent | undefined {
    if (line.trim() === '') return undefined;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw this.refuse(number, 'não é JSON');
    }
    if (typeof value !== 'object' || value === null) {
      throw this.refuse(number, 'não é um objeto');
    }
    if ('out' in value && !('type' in value)) return undefined;

    const event = inputEvent(value);
    if (event === undefined) {
      throw this.refuse(
        number,
        'não é um evento (message, choice, command ou interrupt)',
      );
    }
    log.debug({ type: 'input_submitted', value: event });
    return event;
  }

  private checkLength(line: string, number: number): void {
    if (encoder.encode(line).byteLength <= this.maxRecordBytes) return;
    throw new UsageError(
      `A linha ${String(number)} de ${this.path} passou de ${String(this.maxRecordBytes)} bytes. Divida a mensagem ou aumente maxRecordBytes.`,
    );
  }

  private refuse(number: number, why: string): UsageError {
    return new UsageError(
      `A linha ${String(number)} de ${this.path} ${why}. Cada linha que entra é um objeto como {"type":"message","text":"oi"}.`,
    );
  }
}

function inputEvent(value: object): InputEvent | undefined {
  if (!('type' in value)) return undefined;
  switch (value.type) {
    case 'message':
      return 'text' in value && typeof value.text === 'string'
        ? { type: 'message', text: value.text }
        : undefined;
    case 'choice':
      return 'key' in value && typeof value.key === 'string'
        ? { type: 'choice', key: value.key }
        : undefined;
    case 'command':
      return 'name' in value && typeof value.name === 'string'
        ? { type: 'command', name: value.name }
        : undefined;
    case 'interrupt':
      return { type: 'interrupt' };
    default:
      return undefined;
  }
}

/** Waits `ms`, or less if `signal` aborts first. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}
