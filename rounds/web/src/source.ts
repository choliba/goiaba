/**
 * Values as TypeScript source in the project's style, the way prettier would
 * print them (`.prettierrc.json`: single quotes, the default 80 columns,
 * trailing commas): what the declaration and agent generators paste needs no
 * formatting afterwards. Pure: no prettier at run time (the pages use it).
 */

/** Prettier's default line width. */
const WIDTH = 80;

/** A key that needs no quotes. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** An expression written as is, not quoted: `getConfig().workspaces.dir`. */
export class Code {
  public constructor(public readonly text: string) {}
}

/** `callee(argument)`: the argument, an object, hugs the parentheses. */
export class Call {
  public constructor(
    public readonly callee: string,
    public readonly argument: unknown,
  ) {}
}

/** `params => body`: an arrow whose body (an array) breaks inside itself. */
export class Arrow {
  public constructor(
    public readonly params: string,
    public readonly body: unknown,
  ) {}
}

const pad = (columns: number): string => ' '.repeat(columns);

/**
 * A string literal: single quotes, unless the text has more single quotes
 * than double ones (prettier's choice: the fewest escapes).
 */
export function quote(text: string): string {
  const singles = text.split("'").length - 1;
  const doubles = text.split('"').length - 1;
  const json = JSON.stringify(text);
  if (singles > doubles) return json;
  const inner = json.slice(1, -1).replaceAll('\\"', '"').replaceAll("'", "\\'");
  return `'${inner}'`;
}

/** A property name: bare when it can be, quoted otherwise. */
export const key = (name: string): string =>
  IDENTIFIER.test(name) ? name : quote(name);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Code) &&
  !(value instanceof Call) &&
  !(value instanceof Arrow);

/** How many items an array or object has (0 for anything else). */
const size = (value: unknown): number =>
  Array.isArray(value)
    ? value.length
    : isRecord(value)
      ? Object.keys(value).length
      : 0;

/**
 * Prettier always breaks an array of several objects (or arrays) that each
 * have more than one item, even when it would fit on one line.
 */
const alwaysBreaks = (items: readonly unknown[]): boolean =>
  items.length > 1 &&
  (items.every((item) => isRecord(item) && size(item) > 1) ||
    items.every((item) => Array.isArray(item) && size(item) > 1));

/** `name: value` on one line, or the shorthand `root` for `root: root`. */
function entry(name: string, item: unknown): string {
  return item instanceof Code && item.text === name
    ? name
    : `${key(name)}: ${flat(item)}`;
}

/** The value on one line: `{ a: 1 }`, `['x', 'y']`, `{}`. */
function flat(value: unknown): string {
  if (value instanceof Code) return value.text;
  if (value instanceof Call) return `${value.callee}(${flat(value.argument)})`;
  if (value instanceof Arrow) return `${value.params} => ${flat(value.body)}`;
  if (typeof value === 'string') return quote(value);
  if (Array.isArray(value)) return `[${value.map(flat).join(', ')}]`;
  if (isRecord(value)) {
    const entries = Object.entries(value);
    return entries.length === 0
      ? '{}'
      : `{ ${entries.map(([name, item]) => entry(name, item)).join(', ')} }`;
  }
  return String(value);
}

/**
 * `value` as source, starting at `column` on a line indented `indent`, with
 * `suffix` characters after it on that line (`,`, `),`): on one line when it
 * fits, otherwise one item per line, indented two more.
 */
export function source(
  value: unknown,
  indent: number,
  column: number,
  suffix: number,
): string {
  const one = flat(value);
  const breaks = Array.isArray(value) && alwaysBreaks(value);
  if (!breaks && column + one.length + suffix <= WIDTH) return one;

  if (value instanceof Call) {
    const open = `${value.callee}(`;
    return `${open}${source(value.argument, indent, column + open.length, suffix + 1)})`;
  }
  if (value instanceof Arrow) {
    const head = `${value.params} => `;
    return `${head}${source(value.body, indent, column + head.length, suffix)}`;
  }

  const inner = indent + 2;
  if (Array.isArray(value) && value.length > 0) {
    const lines = value.map(
      (item) => `${pad(inner)}${source(item, inner, inner, 1)},`,
    );
    return `[\n${lines.join('\n')}\n${pad(indent)}]`;
  }
  if (isRecord(value) && size(value) > 0) {
    const lines = Object.entries(value).map(
      ([name, item]) => `${property(name, item, inner, 1)},`,
    );
    return `{\n${lines.join('\n')}\n${pad(indent)}}`;
  }
  return one;
}

/** `import { a, b } from 'x';`, broken one name per line when too long. */
export function importLine(names: readonly string[], from: string): string {
  const one = `import { ${names.join(', ')} } from ${quote(from)};`;
  if (one.length <= WIDTH) return one;
  return `import {\n${names.map((name) => `  ${name},`).join('\n')}\n} from ${quote(from)};`;
}

/**
 * One property, `name: value`, on a line indented `indent` and followed by
 * `suffix` characters: an object or array breaks inside itself; a string
 * that does not fit goes to the next line, indented two more (as prettier
 * does).
 */
export function property(
  name: string,
  value: unknown,
  indent: number,
  suffix: number,
): string {
  if (value instanceof Code && value.text === name)
    return `${pad(indent)}${name}`;
  const head = `${pad(indent)}${key(name)}: `;
  const one = flat(value);
  if (typeof value === 'string' && head.length + one.length + suffix > WIDTH) {
    return `${head.trimEnd()}\n${pad(indent + 2)}${one}`;
  }
  return `${head}${source(value, indent, head.length, suffix)}`;
}
