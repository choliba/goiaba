import type {
  InputEvent,
  InteractionRequest,
  PendingRequest,
} from '../../interaction/index';
import { log } from '../../logger/index';
import { KeyDecoder } from './keys';
import { LineEditor } from './line';

const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const BACKSPACE = new Set(['\b', '\u007f']);

export interface TypingOptions {
  /** Keys that send a command by name (`{ '\u0001': 'approvals' }`: Ctrl+A). */
  readonly shortcuts?: Readonly<Record<string, string>>;
  /** Each event, as typed. */
  readonly emit: (event: InputEvent) => void;
  /** Ctrl+D outside a choice: nothing else will be typed. */
  readonly end: () => void;
  /**
   * What a plain terminal shows of the typing, as text for it to print: the
   * keys, a backspace as `\b \b`, line breaks, an answered choice.
   */
  readonly echo?: (text: string) => void;
  /** The line being typed changed: whoever draws it draws `text`. */
  readonly onLine?: (text: string) => void;
  /** A key that is not text (↑, PageUp…), as the terminal sends it. */
  readonly onSequence?: (sequence: string) => void;
}

/**
 * Keys typed on a terminal, read raw, as events: what is typed joins the
 * line being typed (a backspace removes a character as seen), pasted text
 * keeps its line breaks, Enter sends the line, a key of an `instant`
 * answers alone on an empty line, a choice takes the next key ahead of the
 * line, Ctrl+C interrupts, Ctrl+D ends the input (in a choice, it is the
 * default) and shortcuts send commands. Shared by the adapters that read a
 * terminal: each shows the typing its own way.
 */
export class Typing {
  private readonly shortcuts: ReadonlyMap<string, string>;
  private readonly decoder: KeyDecoder;
  private readonly line = new LineEditor();
  private started = false;
  private lineRequest: { readonly instant: readonly string[] } | undefined;
  private choiceRequest: { readonly keys: readonly string[] } | undefined;

  public constructor(private readonly options: TypingOptions) {
    this.shortcuts = new Map(Object.entries(options.shortcuts ?? {}));
    this.decoder = new KeyDecoder(options.onSequence);
  }

  /** The line being typed. */
  public get text(): string {
    return this.line.text;
  }

  public request(request: InteractionRequest): PendingRequest {
    if (request.type === 'line') {
      const taken = { instant: request.instant };
      this.lineRequest = taken;
      return {
        cancel: () => {
          if (this.lineRequest === taken) this.lineRequest = undefined;
        },
      };
    }
    const taken = { keys: request.keys };
    this.choiceRequest = taken;
    return {
      cancel: () => {
        if (this.choiceRequest === taken) this.choiceRequest = undefined;
      },
    };
  }

  /** What the terminal sent. */
  public feed(chunk: string): void {
    for (const { key, pasted } of this.decoder.feed(chunk)) {
      // A choice takes typed keys only; pasted text cannot answer it.
      if (this.choiceRequest !== undefined) {
        if (!pasted) this.answerChoice(key, this.choiceRequest.keys);
      } else if (pasted) this.paste(key);
      else this.accept(key);
    }
  }

  /** Pasted text joins the line being typed; only a typed Enter sends it. */
  private paste(key: string): void {
    if (key === '\r' || key === '\n') {
      this.line.insert('\n');
      this.show('\n');
      return;
    }
    if (key !== '\t' && !isPrintable(key)) return;
    this.type(key);
  }

  private accept(key: string): void {
    const command = this.shortcuts.get(key);
    if (command !== undefined) {
      this.show('\n');
      log.debug({ type: 'input_shortcut', value: command });
      this.reset();
      this.options.emit({ type: 'command', name: command });
      return;
    }
    if (key === CTRL_C) {
      this.options.emit({ type: 'interrupt' });
      return;
    }
    if (key === CTRL_D) {
      this.options.end();
      return;
    }
    if (key === '\r' || key === '\n') {
      this.show('\n');
      const text = this.line.text;
      log.debug({ type: 'input_submitted', value: text });
      this.reset();
      this.options.emit({ type: 'message', text });
      return;
    }
    if (BACKSPACE.has(key)) {
      if (this.line.erase()) this.show('\b \b');
      return;
    }
    if (!isPrintable(key)) return;
    if (
      this.line.text === '' &&
      this.lineRequest?.instant.includes(key.toLowerCase()) === true
    ) {
      this.show(`${key}\n`);
      log.debug({ type: 'input_submitted', value: key });
      this.options.emit({ type: 'message', text: key });
      return;
    }
    this.type(key);
  }

  private type(key: string): void {
    if (!this.started) {
      this.started = true;
      log.debug({ type: 'input_started' });
    }
    this.line.insert(key);
    this.show(key);
  }

  /** Ctrl+C interrupts, Ctrl+D is the default; other keys outside wait. */
  private answerChoice(raw: string, keys: readonly string[]): void {
    const key = raw.toLowerCase();
    if (key === CTRL_C) {
      this.options.emit({ type: 'interrupt' });
      return;
    }
    const value = key === '\r' || key === '\n' || key === CTRL_D ? '' : key;
    if (value !== '' && !keys.includes(value)) return;

    log.debug({ type: 'input_choice', value });
    this.choiceRequest = undefined;
    this.options.echo?.(`${value}\n`);
    this.options.emit({ type: 'choice', key: value });
  }

  /** The echo for a plain terminal, and the line for whoever draws it. */
  private show(echo: string): void {
    this.options.echo?.(echo);
    this.options.onLine?.(this.line.text);
  }

  private reset(): void {
    this.line.take();
    this.started = false;
    this.options.onLine?.('');
  }
}

function isPrintable(key: string): boolean {
  return key.length > 0 && key >= ' ' && key !== '\u007f';
}
