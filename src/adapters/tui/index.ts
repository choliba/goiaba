import { UsageError } from '../../errors';
import { onProgramExit } from '../../execute/process';
import { OutputStream } from '../../execute/stream';
import type {
  InputEvent,
  InteractionAdapter,
  InteractionRequest,
  PendingRequest,
} from '../../interaction/index';
import type { Output, OutputKind } from '../../output/index';
import {
  enterAlternateScreen,
  leaveAlternateScreen,
  onTtyResize,
  ttyColumns,
  ttyRows,
  writeOut,
} from '../../output/stdio';
import {
  PASTE_OFF,
  PASTE_ON,
  readKeys,
  stdinSource,
  Typing,
  type StdioSource,
} from '../stdio/index';
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
  /** Draws a whole frame (or sends the terminal a setting). */
  draw(text: string): void;
  /** Calls `listener` when the screen changes size; returns how to stop. */
  onResize?(listener: () => void): () => void;
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

export interface TuiAdapterOptions {
  /** Keys that send a command by name (`{ '\u0001': 'approvals' }`: Ctrl+A). */
  readonly shortcuts?: Readonly<Record<string, string>>;
  /** Where it draws; the terminal by default. */
  readonly screen?: TuiScreen;
  /** Where it reads the keys; stdin by default. */
  readonly source?: StdioSource;
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
 * the line being typed at the bottom. Reads the keys raw (`Typing`) and
 * draws the line being typed itself; scrolling (↑/↓ and the mouse wheel,
 * PageUp/PageDown, End) and its own commands (`/help`, `/thinking`,
 * `/clear`, `/exit`) never leave it. What it shows is drawn through the
 * screen; on `close` (or when the program ends) it leaves the screen and
 * prints the conversation.
 */
export class TuiAdapter implements InteractionAdapter {
  public readonly output: Output;
  private readonly screen: TuiScreen;
  private readonly source: StdioSource;
  private readonly frameDelayMs: number;
  private readonly reading = new AbortController();
  private readonly incoming = new OutputStream<InputEvent>();
  private readonly typing: Typing;
  private readonly entries: Entry[] = [];
  /** The line being typed. */
  private typed = '';
  private statusText: string | undefined;
  private showReasoning = true;
  /** Lines scrolled up from the end; 0 follows the conversation. */
  private scroll = 0;
  private active = false;
  private started = false;
  /** Entries already left on the terminal by an earlier `close`. */
  private printed = 0;
  private scheduled: ReturnType<typeof setTimeout> | undefined;
  private stopResize: (() => void) | undefined;
  private stopExit: (() => void) | undefined;

  public constructor({
    shortcuts,
    screen = ttyScreen(),
    source = stdinSource,
    frameDelayMs = DEFAULT_FRAME_DELAY_MS,
  }: TuiAdapterOptions = {}) {
    this.screen = screen;
    this.source = source;
    this.frameDelayMs = frameDelayMs;
    this.typing = new Typing({
      shortcuts,
      emit: (event) => {
        this.receive(event);
      },
      end: () => {
        this.incoming.close();
      },
      onLine: (text) => {
        this.typed = text;
        this.render();
      },
      onSequence: (sequence) => {
        this.scrollBy(sequence);
      },
    });
    this.output = {
      write: async (text, kind = 'message') => {
        this.add({ kind: entryKind(kind), text, open: false });
      },
      writeStream: async (pieces, kind = 'message') => {
        let entry: Entry | undefined;
        for await (const piece of pieces) {
          if (entry === undefined) {
            entry = { kind: entryKind(kind), text: piece, open: true };
            this.add(entry);
          } else {
            entry.text += piece;
            this.render();
          }
        }
        if (entry !== undefined) entry.open = false;
      },
      error: async (text) => {
        this.add({ kind: 'note', text, open: false });
      },
      status: async (text) => {
        this.statusText = text;
        this.render();
      },
      lineLength: () => this.screen.columns(),
    };
  }

  public async *events(): AsyncGenerator<InputEvent> {
    if (this.started) {
      throw new UsageError('Os eventos de um adapter são lidos uma vez só.');
    }
    this.started = true;
    this.open();
    // Pasted text arrives marked, so its line breaks do not submit it.
    this.screen.draw(PASTE_ON);
    void readKeys(this.source, this.reading.signal, this.typing, this.incoming);
    yield* this.incoming;
  }

  public request(request: InteractionRequest): PendingRequest {
    this.open();
    return this.typing.request(request);
  }

  /** Leaves the screen, the conversation so far left on the terminal. */
  public close(): void {
    this.reading.abort();
    this.incoming.close();
    this.leave();
  }

  /** What was typed: the TUI's own commands stay here, the rest goes on. */
  private receive(event: InputEvent): void {
    if (event.type === 'message') {
      // What is sent is read at the end of the conversation.
      this.scroll = 0;
      const line = event.text.trim();
      if (line.startsWith('/')) {
        this.command(line);
        return;
      }
      this.add({ kind: 'user', text: event.text, open: false });
    } else if (event.type === 'choice') {
      this.add({
        kind: 'user',
        text: event.key === '' ? '↵' : event.key,
        open: false,
      });
    }
    this.incoming.publish(event);
  }

  private command(line: string): void {
    const name = line.split(/\s+/, 1)[0];
    switch (name) {
      case '/help':
        this.add({ kind: 'note', text: HELP, open: false });
        return;
      case '/thinking':
        this.showReasoning = !this.showReasoning;
        this.add({
          kind: 'note',
          text: this.showReasoning
            ? 'Raciocínio visível.'
            : 'Raciocínio escondido.',
          open: false,
        });
        return;
      case '/clear':
        this.entries.splice(0);
        this.printed = 0;
        this.render();
        return;
      case '/exit':
        this.incoming.publish({ type: 'interrupt' });
        return;
      default:
        this.add({
          kind: 'note',
          text: `Comando desconhecido: ${name}. Veja /help.`,
          open: false,
        });
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
    this.stopResize = this.screen.onResize?.(() => {
      this.render();
    });
    // However the program ends, the terminal gets its screen back.
    this.stopExit = onProgramExit(() => {
      this.leave();
    });
    this.render();
  }

  private leave(): void {
    if (!this.active) return;
    this.active = false;
    this.stopResize?.();
    this.stopResize = undefined;
    this.stopExit?.();
    this.stopExit = undefined;
    if (this.scheduled !== undefined) clearTimeout(this.scheduled);
    this.scheduled = undefined;
    if (this.started) this.screen.draw(PASTE_OFF);
    this.screen.leave(transcript(this.entries.slice(this.printed)));
    this.printed = this.entries.length;
  }

  private add(entry: Entry): void {
    this.open();
    const last = this.entries.at(-1);
    if (last !== undefined) last.open = false;
    this.entries.push(entry);
    this.render();
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

function entryKind(kind: OutputKind): Entry['kind'] {
  return kind === 'reasoning' ? 'reasoning' : 'text';
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
