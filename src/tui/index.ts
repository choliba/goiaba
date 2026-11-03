import { interruptProgram } from '../execute/process';
import { StdinReader, type StdinReaderOptions } from '../adapters/stdio/reader';
import type { Interaction } from '../interaction/index';
import {
  enterAlternateScreen,
  leaveAlternateScreen,
  onTtyResize,
  ttyColumns,
  ttyRows,
  writeOut,
} from '../output/stdio';
import { UsageError } from '../errors';
import { frame, transcript, type Entry } from './layout';

export { displayWidth, frame, transcript, wrap, type Entry } from './layout';

/** Where the TUI draws: the terminal, or a test's own screen. */
export interface TuiScreen {
  readonly rows: () => number;
  readonly columns: () => number;
  /** Takes a screen of its own (the terminal's alternate screen). */
  enter(): void;
  /** Gives it back, leaving `text` (the conversation) on the terminal. */
  leave(text: string): void;
  /** Draws a whole frame. */
  draw(text: string): void;
  /** Calls `listener` when the screen changes size; returns how to stop. */
  onResize?(listener: () => void): () => void;
}

/** What the TUI reads: lines and one-key choices, as `StdinReader` gives. */
export type TuiInput = Pick<StdinReader, 'next' | 'choose' | 'close'>;

/** What the TUI hears from its input besides the lines. */
export interface TuiInputHandlers {
  /** The echo of what is typed. */
  readonly echo: (text: string) => void;
  /** A key that is not text, as the terminal sends it. */
  readonly sequence: (sequence: string) => void;
}

/** The keys that scroll the messages, and by how much. */
const SCROLL_KEYS: ReadonlyMap<string, 'line' | 'page' | 'end'> = new Map([
  ['\u001b[A', 'line'],
  ['\u001b[B', 'line'],
  ['\u001b[5~', 'page'],
  ['\u001b[6~', 'page'],
  ['\u001b[F', 'end'],
  ['\u001b[4~', 'end'],
]);
const SCROLL_UP = new Set(['\u001b[A', '\u001b[5~']);

export interface TuiOptions extends Pick<
  StdinReaderOptions,
  'shortcuts' | 'urgent'
> {
  /** Where it draws; the terminal by default. */
  readonly screen?: TuiScreen;
  /**
   * What it reads, given where the echo of what is typed and the keys that
   * are not text (↑, PageUp…) go; a `StdinReader` on the terminal by default.
   */
  readonly input?: (handlers: TuiInputHandlers) => TuiInput;
  /** Milliseconds between redraws while text streams in. */
  readonly frameDelayMs?: number;
}

const DEFAULT_FRAME_DELAY_MS = 16;

const HELP = [
  'Comandos:',
  '  /thinking  mostra ou esconde o raciocínio do modelo',
  '  /clear     limpa a tela (a conversa continua)',
  '  /exit      encerra (o mesmo que Ctrl+C)',
  '  /help      esta ajuda',
  'Ctrl+A abre as aprovações.',
].join('\n');

/**
 * The conversation on a full screen: the messages on top, a status line and
 * the line being typed at the bottom. Reads through `StdinReader` (the only
 * reader of the keyboard) and writes through the terminal's writer; what is
 * typed is echoed to the TUI, which draws it in its input line.
 */
export class TuiInteraction implements Interaction {
  private readonly screen: TuiScreen;
  private readonly input: TuiInput;
  private readonly frameDelayMs: number;
  private readonly entries: Entry[] = [];
  /** What is being typed, as the input echoes it. */
  private typed = '';
  private statusText: string | undefined;
  private showReasoning = true;
  /** Lines scrolled up from the end; 0 follows the conversation. */
  private scroll = 0;
  private active = false;
  /** Entries already left on the terminal by an earlier `close`. */
  private printed = 0;
  private scheduled: ReturnType<typeof setTimeout> | undefined;
  private stopResize: (() => void) | undefined;

  public constructor({
    screen = ttyScreen(),
    input,
    frameDelayMs = DEFAULT_FRAME_DELAY_MS,
    ...options
  }: TuiOptions = {}) {
    this.screen = screen;
    this.frameDelayMs = frameDelayMs;
    const handlers: TuiInputHandlers = {
      echo: (text) => this.echo(text),
      sequence: (sequence) => this.scrollBy(sequence),
    };
    this.input =
      input?.(handlers) ??
      new StdinReader({
        ...options,
        write: handlers.echo,
        onSequence: handlers.sequence,
        // Raw mode does not send SIGINT: the terminal's Ctrl+C becomes one.
        onInterrupt: interruptProgram,
      });
  }

  public async ask(
    _question: string,
    signal?: AbortSignal,
    instant: readonly string[] = [],
  ): Promise<string> {
    return this.read(signal, instant);
  }

  public listen(signal?: AbortSignal): Promise<string> {
    return this.read(signal, []);
  }

  public async choose(
    keys: readonly string[],
    signal?: AbortSignal,
  ): Promise<string> {
    this.open();
    const key = await this.input.choose(keys, signal);
    this.add({ kind: 'user', text: key === '' ? '↵' : key, open: false });
    return key;
  }

  public write(text: string): void {
    this.add({ kind: 'text', text, open: false });
  }

  public stream(text: string): void {
    this.append('text', text);
  }

  public reasoning(text: string): void {
    this.append('reasoning', text);
  }

  public status(text: string | undefined): void {
    this.statusText = text;
    this.render();
  }

  public lineLength(): number {
    return this.screen.columns();
  }

  /** Leaves the screen, the conversation so far left on the terminal. */
  public close(): void {
    this.input.close();
    if (!this.active) return;
    this.active = false;
    this.stopResize?.();
    this.stopResize = undefined;
    if (this.scheduled !== undefined) clearTimeout(this.scheduled);
    this.scheduled = undefined;
    this.screen.leave(transcript(this.entries.slice(this.printed)));
    this.printed = this.entries.length;
  }

  /** The next line, after running the TUI's own commands (`/help`…). */
  private async read(
    signal: AbortSignal | undefined,
    instant: readonly string[],
  ): Promise<string> {
    this.open();
    for (;;) {
      const line = await this.input.next(signal, instant);
      this.consumeTyped(line);
      // What is sent is read at the end of the conversation.
      this.scroll = 0;
      if (!this.command(line.trim())) {
        this.add({ kind: 'user', text: line, open: false });
        return line;
      }
    }
  }

  /** Runs a TUI command; `false` when the line is for the agent. */
  private command(line: string): boolean {
    if (!line.startsWith('/')) return false;
    const name = line.split(/\s+/, 1)[0];
    switch (name) {
      case '/help':
        this.add({ kind: 'note', text: HELP, open: false });
        return true;
      case '/thinking':
        this.showReasoning = !this.showReasoning;
        this.add({
          kind: 'note',
          text: this.showReasoning
            ? 'Raciocínio visível.'
            : 'Raciocínio escondido.',
          open: false,
        });
        return true;
      case '/clear':
        this.entries.splice(0);
        this.printed = 0;
        this.render();
        return true;
      case '/exit':
        interruptProgram();
        return true;
      default:
        this.add({
          kind: 'note',
          text: `Comando desconhecido: ${name}. Veja /help.`,
          open: false,
        });
        return true;
    }
  }

  /** ↑/↓ a line, PageUp/PageDown a page, End back to the end. */
  private scrollBy(sequence: string): void {
    const step = SCROLL_KEYS.get(sequence);
    if (step === undefined) return;
    if (step === 'end') {
      this.scroll = 0;
    } else {
      const page = Math.max(this.screen.rows() - 3, 1);
      const amount = step === 'line' ? 1 : page;
      this.scroll += SCROLL_UP.has(sequence) ? amount : -amount;
    }
    this.render();
  }

  /** Takes the screen, if it is not taken yet. */
  private open(): void {
    if (this.active) return;
    this.active = true;
    this.screen.enter();
    this.stopResize = this.screen.onResize?.(() => this.render());
    this.render();
  }

  private add(entry: Entry): void {
    const last = this.entries.at(-1);
    if (last !== undefined) last.open = false;
    this.entries.push(entry);
    this.render();
  }

  /** A piece joins the open entry of its kind, or starts a new one. */
  private append(kind: 'text' | 'reasoning', text: string): void {
    const last = this.entries.at(-1);
    if (last?.open === true && last.kind === kind) last.text += text;
    else this.add({ kind, text, open: true });
    this.render();
  }

  /**
   * The input's echo, kept as the line being typed: characters, a
   * backspace (`\b \b`), line breaks. Escape sequences change no text.
   */
  private echo(text: string): void {
    if (text === '\b \b') {
      this.typed = Array.from(
        new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
          this.typed,
        ),
        (part) => part.segment,
      )
        .slice(0, -1)
        .join('');
    } else {
      // oxlint-disable-next-line no-control-regex -- ESC starts every sequence.
      this.typed += text.replace(/\u001b\[[0-9;?]*[A-Za-z~]/g, '');
    }
    this.render();
  }

  /** The submitted line leaves the input line; what came after stays. */
  private consumeTyped(line: string): void {
    this.typed = this.typed.startsWith(`${line}\n`)
      ? this.typed.slice(line.length + 1)
      : '';
  }

  /** Redraws soon, once for many changes (a stream sends many). */
  private render(): void {
    if (!this.active || this.scheduled !== undefined) return;
    this.scheduled = setTimeout(() => {
      this.scheduled = undefined;
      this.draw();
    }, this.frameDelayMs);
  }

  private draw(): void {
    if (!this.active) return;
    const drawn = frame(this.entries, {
      rows: this.screen.rows(),
      columns: this.screen.columns(),
      status: this.statusText,
      input: this.typed,
      showReasoning: this.showReasoning,
      scroll: this.scroll,
    });
    // Never past the first or the last line, whatever was pressed.
    this.scroll = drawn.scroll;
    this.screen.draw(drawn.text);
  }
}

/**
 * The terminal as the TUI's screen. Refused at once without one (a pipe, a
 * redirection): nothing would be seen.
 */
export function ttyScreen(): TuiScreen {
  if (screenRows() === 0) {
    throw new UsageError(
      'O TUI precisa de um terminal: rode o programa direto, sem pipe nem redirecionamento.',
    );
  }
  return {
    rows: screenRows,
    columns: screenColumns,
    enter: enterAlternateScreen,
    leave: (text) => {
      leaveAlternateScreen();
      if (text !== '') writeOut(`${text}\n`);
    },
    draw: writeOut,
    onResize: onTtyResize,
  };
}

function screenRows(): number {
  return ttyRows() ?? 0;
}

function screenColumns(): number {
  return ttyColumns() ?? 0;
}
