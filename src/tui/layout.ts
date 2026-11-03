/**
 * What the screen shows, computed: no I/O here. The messages fill the top,
 * the status line and the input line take the bottom two rows.
 */

const ESC = '\u001b';
// oxlint-disable-next-line no-control-regex -- ESC starts every sequence.
const ESCAPES = /\u001b\[[0-9;?]*[A-Za-z]/g;
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
/** Wide characters (CJK, Hangul, full-width forms): two columns each. */
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u;
const EMOJI = /\p{Extended_Pictographic}/u;
const COMBINING = /^\p{M}+$/u;
const DIM = `${ESC}[2m`;
const BOLD = `${ESC}[1m`;
const INVERSE = `${ESC}[7m`;
const RESET = `${ESC}[0m`;
const CLEAR_TO_END = `${ESC}[K`;

/** One thing in the conversation, as the screen shows it. */
export interface Entry {
  readonly kind: 'user' | 'text' | 'reasoning' | 'note';
  text: string;
  /** Still being written (a stream): the next piece joins it. */
  open: boolean;
}

export interface FrameOptions {
  readonly rows: number;
  readonly columns: number;
  /** The status line's text (`⏳ pensando…`), if any. */
  readonly status: string | undefined;
  /** What is being typed. */
  readonly input: string;
  /** Reasoning in full, or one line saying it is there. */
  readonly showReasoning: boolean;
  /** Lines scrolled up from the end; 0 shows the last messages. */
  readonly scroll?: number;
}

export interface Frame {
  /** The lines of the screen, top to bottom, without escape sequences. */
  readonly lines: readonly string[];
  /** The same, as written to the terminal: styles, clearing, the cursor. */
  readonly text: string;
  /** The scroll actually used: never past the first or the last line. */
  readonly scroll: number;
}

const PROMPT = '› ';
const HELP_HINT = '/help';

/** The whole screen for these entries, the last messages that fit. */
export function frame(entries: readonly Entry[], options: FrameOptions): Frame {
  const columns = Math.max(options.columns, 10);
  const messageRows = Math.max(options.rows - 2, 1);

  const styled = entries.flatMap((entry, index) => [
    ...(index === 0 ? [] : [{ plain: '', style: '' }]),
    ...entryLines(entry, columns, options.showReasoning),
  ]);
  const scroll = Math.min(
    Math.max(options.scroll ?? 0, 0),
    Math.max(styled.length - messageRows, 0),
  );
  const visible = styled.slice(
    Math.max(styled.length - messageRows - scroll, 0),
    styled.length - scroll,
  );
  const padding = Array.from({ length: messageRows - visible.length }, () => ({
    plain: '',
    style: '',
  }));
  const messages = [...padding, ...visible];

  const status = statusLine(
    scroll === 0
      ? options.status
      : `↓ ${String(scroll)} linha(s) abaixo (End volta ao fim)`,
    columns,
  );
  const input = inputLine(options.input, columns);

  const lines = [...messages.map((line) => line.plain), status, input.plain];
  const drawn = [
    ...messages.map((line) => paint(line.plain, line.style)),
    `${INVERSE}${status}${RESET}`,
    input.plain,
  ];
  const text = `${ESC}[H${drawn.map((line) => `${line}${CLEAR_TO_END}`).join('\r\n')}${ESC}[${String(messageRows + 2)};${String(input.cursor + 1)}H`;
  return { lines, text, scroll };
}

/** The conversation as plain text, for the terminal once the screen is left. */
export function transcript(entries: readonly Entry[]): string {
  return entries
    .map((entry) => `${prefixOf(entry.kind)}${plain(entry.text)}`.trimEnd())
    .join('\n\n');
}

/** Columns a text takes on screen: wide characters and emoji take two. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const { segment } of GRAPHEMES.segment(plain(text))) {
    width += graphemeWidth(segment);
  }
  return width;
}

/** The text broken into lines of at most `columns`, by words where it can. */
export function wrap(text: string, columns: number): string[] {
  return plain(text)
    .replaceAll('\t', '  ')
    .split('\n')
    .flatMap((paragraph) => wrapParagraph(paragraph, columns));
}

function entryLines(
  entry: Entry,
  columns: number,
  showReasoning: boolean,
): { plain: string; style: string }[] {
  const style =
    entry.kind === 'reasoning' ? DIM : entry.kind === 'user' ? BOLD : '';
  const body =
    entry.kind === 'reasoning' && !showReasoning
      ? 'pensou (/thinking mostra)'
      : entry.text.replace(/\n+$/, '');
  return wrap(`${prefixOf(entry.kind)}${body}`, columns).map((line) => ({
    plain: line,
    style,
  }));
}

function prefixOf(kind: Entry['kind']): string {
  if (kind === 'user') return PROMPT;
  if (kind === 'reasoning') return '💭 ';
  return '';
}

function statusLine(status: string | undefined, columns: number): string {
  const left = status ?? '';
  const room = columns - displayWidth(left);
  if (room <= displayWidth(HELP_HINT) + 1) return fit(left, columns);
  return `${left}${' '.repeat(room - displayWidth(HELP_HINT))}${HELP_HINT}`;
}

/** The line being typed (its last line, if pasted text has several). */
function inputLine(
  input: string,
  columns: number,
): { plain: string; cursor: number } {
  const current = input.slice(input.lastIndexOf('\n') + 1);
  const room = columns - displayWidth(PROMPT) - 1;
  const shown = tail(current, room);
  const line = `${PROMPT}${shown}`;
  return { plain: line, cursor: displayWidth(line) };
}

function wrapParagraph(paragraph: string, columns: number): string[] {
  if (paragraph === '') return [''];
  const lines: string[] = [];
  let line = '';
  let width = 0;

  for (const word of paragraph.split(/(\s+)/)) {
    if (word === '') continue;
    const wordWidth = displayWidth(word);
    if (width + wordWidth <= columns) {
      line += word;
      width += wordWidth;
      continue;
    }
    if (/^\s+$/.test(word)) {
      lines.push(line);
      line = '';
      width = 0;
      continue;
    }
    if (line !== '') lines.push(line.trimEnd());
    line = '';
    width = 0;
    // A word longer than the line is cut where the line ends.
    for (const { segment } of GRAPHEMES.segment(word)) {
      const grapheme = graphemeWidth(segment);
      if (width + grapheme > columns) {
        lines.push(line);
        line = '';
        width = 0;
      }
      line += segment;
      width += grapheme;
    }
  }
  lines.push(line);
  return lines;
}

function graphemeWidth(grapheme: string): number {
  if (COMBINING.test(grapheme)) return 0;
  if (EMOJI.test(grapheme) || WIDE.test(grapheme)) return 2;
  return 1;
}

/** At most `columns` from the start. */
function fit(text: string, columns: number): string {
  let width = 0;
  let result = '';
  for (const { segment } of GRAPHEMES.segment(text)) {
    width += graphemeWidth(segment);
    if (width > columns) break;
    result += segment;
  }
  return result;
}

/** At most `columns` from the end: the cursor side of what is typed. */
function tail(text: string, columns: number): string {
  const segments = Array.from(GRAPHEMES.segment(text), (part) => part.segment);
  let width = 0;
  let start = segments.length;
  while (start > 0) {
    const next = graphemeWidth(segments[start - 1] ?? '');
    if (width + next > columns) break;
    width += next;
    start -= 1;
  }
  return segments.slice(start).join('');
}

function paint(text: string, style: string): string {
  return style === '' || text === '' ? text : `${style}${text}${RESET}`;
}

function plain(text: string): string {
  return text.replace(ESCAPES, '');
}
