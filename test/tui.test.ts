import { describe, expect, test } from 'bun:test';

import {
  TuiInteraction,
  displayWidth,
  frame,
  wrap,
  type TuiInput,
  type TuiInputHandlers,
  type TuiScreen,
} from '../src/tui/index';

describe('layout', () => {
  test('quebra por palavras e corta a palavra maior que a linha', () => {
    expect(wrap('o mar azul sob o céu', 10)).toEqual([
      'o mar azul',
      'sob o céu',
    ]);
    expect(wrap('abcdefghijkl', 5)).toEqual(['abcde', 'fghij', 'kl']);
    expect(wrap('linha um\nlinha dois', 20)).toEqual([
      'linha um',
      'linha dois',
    ]);
  });

  test('emoji e caracteres largos ocupam duas colunas; acentos, uma', () => {
    expect(displayWidth('💭 oi')).toBe(5);
    expect(displayWidth('漢字')).toBe(4);
    expect(displayWidth('ação')).toBe(4);
  });

  test('mostra as últimas mensagens que cabem, o status e a entrada', () => {
    const { lines } = frame(
      [
        { kind: 'text', text: 'primeira', open: false },
        { kind: 'user', text: 'oi', open: false },
        { kind: 'text', text: 'resposta', open: false },
      ],
      {
        rows: 5,
        columns: 20,
        status: '⏳ pensando…',
        input: 'digit',
        showReasoning: true,
      },
    );

    expect(lines).toEqual([
      '› oi',
      '',
      'resposta',
      '⏳ pensando…   /help',
      '› digit',
    ]);
  });
});

describe('TuiInteraction', () => {
  test('junta os pedaços do stream e separa raciocínio de resposta', async () => {
    const { tui, screen } = setup();
    await tui.ask('');

    tui.reasoning('pen');
    tui.reasoning('sei');
    tui.stream('Olá, ');
    tui.stream('mundo');
    await tick();

    expect(screen.lines()).toEqual(
      expect.arrayContaining(['› primeira', '💭 pensei', 'Olá, mundo']),
    );
  });

  test('/thinking esconde o raciocínio; os comandos não vão ao agente', async () => {
    const { tui, screen } = setup(['/thinking', 'segunda']);
    await tui.ask('');
    tui.reasoning('pensei muito');

    expect(await tui.ask('')).toBe('segunda');
    await tick();

    expect(screen.lines()).toEqual(
      expect.arrayContaining([
        'Raciocínio escondido.',
        '💭 pensou (/thinking mostra)',
        '› segunda',
      ]),
    );
    expect(screen.lines()).not.toContain('› /thinking');
  });

  test('um comando desconhecido é recusado, com a ajuda', async () => {
    const { tui, screen } = setup(['/xyz', 'ok']);
    await tui.ask('');
    await tui.ask('');
    await tick();

    expect(screen.lines()).toContain('Comando desconhecido: /xyz. Veja /help.');
  });

  test('o que se digita aparece na linha de entrada, com o apagar', async () => {
    const { tui, screen, echo } = setup();
    await tui.ask('');

    for (const key of ['o', 'l', 'x']) echo(key);
    echo('\b \b');
    echo('á');
    await tick();

    expect(screen.lines().at(-1)).toBe('› olá');
  });

  test('↑ e PageUp rolam para trás, End volta ao fim', async () => {
    const { tui, screen, key } = setup();
    await tui.ask('');
    for (let line = 1; line <= 12; line += 1)
      tui.write(`linha ${String(line)}`);
    await tick();
    expect(screen.lines()).toContain('linha 12');

    key('\u001b[5~');
    await tick();
    expect(screen.lines()).not.toContain('linha 12');
    expect(screen.lines().at(-2)).toMatch(/^↓ \d+ linha\(s\) abaixo/);

    key('\u001b[F');
    await tick();
    expect(screen.lines()).toContain('linha 12');
  });

  test('ao fechar, sai da tela e deixa a conversa no terminal', async () => {
    const { tui, screen } = setup();
    await tui.ask('');
    tui.write('resposta');
    tui.close();

    expect(screen.left).toEqual(['› primeira\n\nresposta']);
    expect(screen.entered).toBe(1);
  });
});

/** A TUI on a fake 8×40 screen, reading `lines` in order (then 'primeira'). */
function setup(lines: string[] = []): {
  tui: TuiInteraction;
  screen: FakeScreen;
  echo: (text: string) => void;
  key: (sequence: string) => void;
} {
  const screen = new FakeScreen();
  const queue = ['primeira', ...lines];
  let handlers: TuiInputHandlers = { echo: ignore, sequence: ignore };
  const tui = new TuiInteraction({
    screen,
    frameDelayMs: 0,
    input: (given): TuiInput => {
      handlers = given;
      return {
        next: () => Promise.resolve(queue.shift() ?? ''),
        choose: () => Promise.resolve(''),
        close: () => undefined,
      };
    },
  });
  return {
    tui,
    screen,
    echo: (text) => handlers.echo(text),
    key: (sequence) => handlers.sequence(sequence),
  };
}

class FakeScreen implements TuiScreen {
  public entered = 0;
  public readonly left: string[] = [];
  private last = '';

  public readonly rows = (): number => 8;
  public readonly columns = (): number => 40;

  public enter(): void {
    this.entered += 1;
  }

  public leave(text: string): void {
    this.left.push(text);
  }

  public draw(text: string): void {
    this.last = text;
  }

  /** The last frame's lines, without styles. */
  public lines(): string[] {
    return (
      this.last
        // oxlint-disable-next-line no-control-regex -- ESC starts every sequence.
        .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
        .split('\r\n')
        .map((line) => line.trimEnd())
    );
  }
}

function ignore(): void {
  // Until the TUI hands its echo over.
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}
