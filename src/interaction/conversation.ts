import { UsageError } from '../errors';
import { interruptProgram } from '../execute/process';
import { OutputStream } from '../execute/stream';
import { log } from '../logger/index';
import type { InteractionAdapter, PendingRequest } from './adapter';
import { DEFAULT_MAX_UNANSWERED_REQUESTS } from './constants';
import type { InputEvent, InteractionRequest } from './events';
import type { Interaction } from './index';

export interface ConversationOptions {
  /** Lines that go ahead of the ones waiting (e.g. an approvals command). */
  readonly urgent?: (line: string) => boolean;
  /** What an `interrupt` does before the conversation closes; Ctrl+C by default. */
  readonly onInterrupt?: () => void;
  /** See `DEFAULT_MAX_UNANSWERED_REQUESTS`. */
  readonly maxUnansweredRequests?: number;
}

interface Waiter {
  readonly resolve: (value: string) => void;
  readonly reject: (error: unknown) => void;
  readonly settle: () => void;
}

/**
 * The conversation, whatever the adapter: asks it for lines and choices,
 * waits for the right event, keeps what arrives unasked for the next one
 * who asks, and puts urgent lines first. The same for a terminal, a file or
 * a web chat; only the adapter knows which one it is.
 *
 * A command arrives to whoever reads as the line `:name`, ahead of the
 * others (Ctrl+A is `:approvals`).
 */
export class Conversation implements Interaction {
  private readonly urgent: (line: string) => boolean;
  private readonly onInterrupt: () => void;
  private readonly maxUnanswered: number;
  /** Lines that arrived with nobody waiting. */
  private readonly queued: string[] = [];
  private readonly lines: Waiter[] = [];
  private readonly choices: Waiter[] = [];
  private reading = false;
  /** The input is over (ended, failed or closed): why. */
  private ended: unknown;
  private unanswered = 0;
  /** The reply streaming now, if any. */
  private streaming: OutputStream<string> | undefined;
  /** What is being shown, for the next thing to wait for. */
  private showing: Promise<void> | undefined;

  public constructor(
    private readonly adapter: InteractionAdapter,
    {
      urgent = () => false,
      onInterrupt = interruptProgram,
      maxUnansweredRequests = DEFAULT_MAX_UNANSWERED_REQUESTS,
    }: ConversationOptions = {},
  ) {
    this.urgent = urgent;
    this.onInterrupt = onInterrupt;
    this.maxUnanswered = maxUnansweredRequests;
  }

  public ask(
    _question: string,
    signal?: AbortSignal,
    instant: readonly string[] = [],
  ): Promise<string> {
    return this.line(signal, instant);
  }

  public listen(signal?: AbortSignal): Promise<string> {
    return this.line(signal, []);
  }

  public async choose(
    keys: readonly string[],
    signal?: AbortSignal,
  ): Promise<string> {
    const key = await this.wait(
      this.choices,
      { type: 'choice', keys },
      signal,
      {
        cancelled: 'A escolha foi cancelada.',
      },
    );
    this.write(key);
    return key;
  }

  public write(value: string): void {
    this.show(() => this.adapter.output.write(value));
  }

  public stream(text: string): void {
    if (this.streaming === undefined) {
      const pieces = new OutputStream<string>();
      this.streaming = pieces;
      this.show(() => this.adapter.output.writeStream(pieces), {
        keepStream: true,
      });
    }
    this.streaming.publish(text);
  }

  public status(text: string | undefined): void {
    this.show(() => this.adapter.output.status(text));
  }

  public error(text: string): void {
    this.show(() => this.adapter.output.error(text));
  }

  public lineLength(): number {
    return this.adapter.output.lineLength();
  }

  public close(): void {
    this.endStream();
    this.end(abortError('stdin foi fechado.'));
    this.adapter.close();
  }

  private line(
    signal: AbortSignal | undefined,
    instant: readonly string[],
  ): Promise<string> {
    const queued = this.queued.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return this.wait(this.lines, { type: 'line', instant }, signal, {
      cancelled: 'A entrada foi cancelada.',
    });
  }

  /** Asks the adapter and waits for the answer, or for `signal`. */
  private wait(
    waiters: Waiter[],
    request: InteractionRequest,
    signal: AbortSignal | undefined,
    { cancelled }: { readonly cancelled: string },
  ): Promise<string> {
    if (this.ended !== undefined) return Promise.reject(this.ended);
    if (signal?.aborted === true) {
      return Promise.reject(abortError(cancelled));
    }

    this.read();
    let pending: PendingRequest | undefined;
    try {
      pending = this.requestOf(request);
    } catch (error) {
      return Promise.reject(error);
    }

    return new Promise<string>((resolve, reject) => {
      const onAbort = (): void => {
        waiter.settle();
        reject(abortError(cancelled));
      };
      const waiter: Waiter = {
        resolve: (value) => {
          waiter.settle();
          resolve(value);
        },
        reject: (error) => {
          waiter.settle();
          reject(error);
        },
        settle: () => {
          remove(waiters, waiter);
          signal?.removeEventListener('abort', onAbort);
          pending?.cancel();
        },
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      waiters.push(waiter);
    });
  }

  /** The adapter's request; a request it cannot ask is logged and counted. */
  private requestOf(request: InteractionRequest): PendingRequest | undefined {
    const pending = this.adapter.request(request);
    if (pending !== undefined) return pending;

    this.unanswered += 1;
    log.debug({
      type: 'request_ignored',
      request: request.type,
      count: this.unanswered,
    });
    if (this.unanswered > this.maxUnanswered) {
      throw new UsageError(
        `A entrada não responde: ${String(this.unanswered)} pedidos seguidos sem nada chegar. Verifique a fonte da conversa ou aumente maxUnansweredRequests.`,
      );
    }
    return undefined;
  }

  /** Reads the adapter's events, from the first request on. */
  private read(): void {
    if (this.reading) return;
    this.reading = true;
    void this.pump();
  }

  private async pump(): Promise<void> {
    try {
      for await (const event of this.adapter.events()) {
        if (this.ended !== undefined) return;
        this.receive(event);
      }
      this.end(abortError('stdin foi fechado.'));
    } catch (error) {
      this.end(error);
    }
  }

  private receive(event: InputEvent): void {
    this.unanswered = 0;
    switch (event.type) {
      case 'message':
        // An adapter that cannot ask for a key answers with a line: its
        // first character is the choice.
        if (this.choices.length > 0) {
          this.choices[0]?.resolve(event.text.trim().toLowerCase().charAt(0));
          return;
        }
        this.deliver(event.text, { first: this.urgent(event.text) });
        return;
      case 'choice':
        this.choices[0]?.resolve(event.key);
        return;
      case 'command':
        // Ahead of anything queued: whoever reads next gets it.
        this.deliver(`:${event.name}`, { first: true });
        return;
      case 'interrupt':
        this.onInterrupt();
        this.close();
        return;
    }
  }

  private deliver(line: string, { first }: { readonly first: boolean }): void {
    const waiter = this.lines.at(0);
    if (waiter !== undefined) {
      waiter.resolve(line);
      return;
    }
    if (first) this.queued.unshift(line);
    else this.queued.push(line);
  }

  /** No more input: whoever waits gets `reason`, and so will anyone else. */
  private end(reason: unknown): void {
    if (this.ended !== undefined) return;
    this.ended = reason;
    for (const waiter of [...this.choices, ...this.lines]) {
      waiter.reject(reason);
    }
  }

  /**
   * Shows after what is being shown; at once (in the same call) when
   * nothing is, so a program that writes and exits loses nothing. A reply
   * streams until anything else is shown.
   */
  private show(task: () => Promise<void>, { keepStream = false } = {}): void {
    if (!keepStream) this.endStream();
    const previous = this.showing;
    const current = (previous === undefined ? task() : previous.then(task))
      .catch((error: unknown) => {
        log.failure(error);
      })
      .finally(() => {
        if (this.showing === current) this.showing = undefined;
      });
    this.showing = current;
  }

  private endStream(): void {
    this.streaming?.close();
    this.streaming = undefined;
  }
}

function remove<T>(values: T[], value: T): void {
  const index = values.indexOf(value);
  if (index !== -1) values.splice(index, 1);
}

function abortError(message: string): DOMException {
  return new DOMException(message, 'AbortError');
}
